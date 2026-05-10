import path from "path";
import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { isHermesGatewayModelLabel } from "@/lib/model-display";

/** Hermes home on disk (same layout as gateway `HERMES_HOME`; mounted in chat as read-only). */
export function getHermesDataDir(): string | null {
  const h = process.env.HERMES_DATA_DIR?.trim();
  return h || null;
}

/**
 * Read `model.default` from Hermes `config.yaml` (provider catalog id, e.g. Nous).
 * The gateway’s `/v1/chat/completions` stream usually reports `model: hermes-agent`; the footer should show this id instead.
 */
export async function readHermesPrimaryModelFromConfig(): Promise<string | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  try {
    let raw = await readFile(path.join(root, "config.yaml"), "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    let inModelBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^model:\s*$/.test(line)) {
        inModelBlock = true;
        continue;
      }
      if (inModelBlock) {
        const m = line.match(/^\s*default:\s*(.+?)\s*$/);
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, "");
          if (v) return v;
        }
        if (line.trim() && !/^\s/.test(line)) inModelBlock = false;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read `model.provider` from Hermes `config.yaml` (e.g. `nous`, `openrouter`).
 * Used to decide whether OpenRouter public list pricing is a sane fallback for token-only usage when the gateway does not report USD.
 */
export async function readHermesModelProviderFromConfig(): Promise<string | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  try {
    let raw = await readFile(path.join(root, "config.yaml"), "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    let inModelBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^model:\s*$/.test(line)) {
        inModelBlock = true;
        continue;
      }
      if (inModelBlock) {
        const m = line.match(/^\s*provider:\s*(.+?)\s*$/);
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, "");
          return v || null;
        }
        if (line.trim() && !/^\s/.test(line)) inModelBlock = false;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Optional override when config.yaml is not mounted (e.g. dev). Same format as `model.default` (e.g. `nvidia/nemotron-...`). */
export function getHermesChatPrimaryModelOverride(): string | null {
  const h = process.env.HERMES_CHAT_PRIMARY_MODEL?.trim();
  return h || null;
}

/**
 * Active stack preset’s `mainModel` from `hermes-data/model_presets.json` when present.
 * Matches the tier the user selected even if `config.yaml` `model.default` has not been updated yet.
 */
export async function readHermesActivePresetMainModel(): Promise<string | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  try {
    let raw = await readFile(path.join(root, "model_presets.json"), "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const j = JSON.parse(raw) as {
      active?: unknown;
      presets?: Record<string, { mainModel?: unknown }>;
    };
    const active = typeof j.active === "string" ? j.active.trim() : "";
    if (!active || !j.presets || typeof j.presets !== "object") return null;
    const bundle = j.presets[active];
    const main =
      bundle && typeof bundle.mainModel === "string"
        ? bundle.mainModel.trim()
        : "";
    return main || null;
  } catch {
    return null;
  }
}

/** Preset main (if any), then `config.yaml` default, then env — for footer and persisted assistant rows. */
export async function readEffectiveHermesMainModelId(): Promise<string | null> {
  const fromPreset = await readHermesActivePresetMainModel();
  const fromConfig = await readHermesPrimaryModelFromConfig();
  const fromEnv = getHermesChatPrimaryModelOverride();
  const s = fromPreset || fromConfig || fromEnv;
  return s?.trim() || null;
}

/**
 * Prefer the API’s real `model` for this turn over static config (footer should match what answered).
 * Falls back to preset / Hermes config / env when the gateway only returns cosmetic labels (`hermes-agent`).
 */
export async function resolveAssistantDisplayModel(params: {
  responseModel?: string;
  requestModelId: string;
}): Promise<string | null> {
  const fallback = await readEffectiveHermesMainModelId();
  const { responseModel, requestModelId } = params;
  const apiModel =
    responseModel && !isHermesGatewayModelLabel(responseModel)
      ? responseModel
      : null;
  const reqModel =
    requestModelId && !isHermesGatewayModelLabel(requestModelId)
      ? requestModelId
      : null;
  return apiModel || reqModel || fallback || null;
}

/** Hermes OpenAI-compatible API base (no trailing slash). */
export function getHermesBaseUrl(): string | null {
  const raw =
    process.env.HERMES_URL?.trim() ||
    process.env.OPENCLAW_URL?.trim();
  if (!raw) return null;
  if (process.env.HERMES_GATEWAY_BASE_URL?.trim()) {
    return process.env.HERMES_GATEWAY_BASE_URL.trim();
  }
  // Host .env often sets HERMES_URL=http://127.0.0.1:8642 for local dev; that fails inside the
  // chat container. Prefer Docker DNS to the `hermes` service when the port matches the gateway.
  try {
    const u = new URL(raw);
    if (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      u.port === "8642"
    ) {
      return "http://hermes:8642";
    }
  } catch {
    return raw;
  }
  return raw;
}

export function getHermesToken(): string | null {
  const t =
    process.env.HERMES_TOKEN?.trim() ||
    process.env.OPENCLAW_TOKEN?.trim();
  return t || null;
}

/**
 * Shared WikiVault ingest gateway.
 *
 * Legacy env names keep old deploys working, but the preferred no-architect
 * shape is to route shared ingest to the already-running tenant gateway:
 * HERMES_SHARED_INGEST_URL / TOKEN, falling back to HERMES_URL / TOKEN.
 */
export function getHermesArchitectBaseUrl(): string | null {
  const h =
    process.env.HERMES_SHARED_INGEST_URL?.trim() ||
    process.env.HERMES_ARCHITECT_URL?.trim() ||
    getHermesBaseUrl()?.trim();
  return h || null;
}

export function getHermesArchitectToken(): string | null {
  const t =
    process.env.HERMES_SHARED_INGEST_TOKEN?.trim() ||
    process.env.HERMES_ARCHITECT_TOKEN?.trim() ||
    getHermesToken()?.trim();
  return t || null;
}

/**
 * Shared secret for `POST /api/internal/architect-ingest-notify` (optional; architect worker
 * can call Chat to send push when Chat does not await the completion stream).
 */
export function getHermesChatArchitectNotifyToken(): string | null {
  return process.env.HERMES_CHAT_ARCHITECT_NOTIFY_TOKEN?.trim() || null;
}

/** Model id sent in client requests (Hermes often treats as cosmetic; backend uses Hermes config). */
export function getChatModel(): string {
  return process.env.CHAT_MODEL?.trim() || "hermes-agent";
}

function readStackOptionalLineFile(filename: string): string | null {
  const root = getHermesDataDir();
  if (!root) return null;
  const f = path.join(root, filename);
  try {
    if (existsSync(f)) {
      const raw = readFileSync(f, "utf-8");
      const line = raw.split(/\r?\n/)[0]?.trim() ?? "";
      if (line) return line;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Optional catalog id for automatic chat title generation only (POST chat/send + /api/sessions/generate-title).
 * The active plan file wins; deploy env is only a legacy fallback.
 */
export function getTitleChatModel(): string {
  const plan = readStackOptionalLineFile("title_chat_model");
  if (plan) return plan;
  const t = process.env.TITLE_CHAT_MODEL?.trim();
  if (t) return t;
  return getChatModel();
}

/**
 * `INGEST_CHAT_MODEL` in the chat deploy only. Kept as a legacy fallback;
 * active plan files are authoritative for normal stack operation.
 */
export function getDeployIngestChatModel(): string | null {
  const m = process.env.INGEST_CHAT_MODEL?.trim();
  return m || null;
}

/**
 * One-line file written when a quality tier sets an optional ingest model (apply preset);
 * empty file / missing file means “same as main chat” for ingest.
 */
export function getIngestChatModelFromFile(): string | null {
  const root = getHermesDataDir();
  if (!root) return null;
  const f = path.join(root, "ingest_chat_model");
  try {
    if (existsSync(f)) {
      const raw = readFileSync(f, "utf-8");
      const line = raw.split(/\r?\n/)[0]?.trim() ?? "";
      if (line) return line;
    }
  } catch {
    /* use combine below */
  }
  return null;
}

/**
 * Effective ingest id: preset file, else deploy env, else `null` (use same as main chat
 * in callers, typically `config.yaml` primary or `getChatModel()`).
 */
export function getIngestChatModel(): string | null {
  return getIngestChatModelFromFile() ?? getDeployIngestChatModel();
}

export type IngestReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type IngestServiceTier = "normal" | "fast";

export type IngestSwarmEffortConfig = {
  readerEffort?: IngestReasoningEffort;
  reviewEffort?: IngestReasoningEffort;
  mergeEffort?: IngestReasoningEffort;
  serviceTier?: IngestServiceTier;
};

function normalizeIngestReasoningEffort(
  raw: string | null | undefined
): IngestReasoningEffort | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "xhigh") return v;
  return undefined;
}

function normalizeIngestServiceTier(
  raw: string | null | undefined
): IngestServiceTier | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "fast" || v === "priority" || v === "on") return "fast";
  if (v === "normal" || v === "standard" || v === "default" || v === "off") return "normal";
  return undefined;
}

/**
 * Optional GPT/ChatGPT-plan tuning for ingest. These files are written by the
 * stack settings page when the ChatGPT plan is active; env vars are legacy/admin
 * fallbacks for deployments that do not expose the settings UI.
 */
export function getIngestSwarmEffortConfig(): IngestSwarmEffortConfig {
  return {
    readerEffort: normalizeIngestReasoningEffort(
      readStackOptionalLineFile("ingest_reader_effort") ??
        process.env.INGEST_READER_EFFORT
    ),
    reviewEffort: normalizeIngestReasoningEffort(
      readStackOptionalLineFile("ingest_review_effort") ??
        process.env.INGEST_REVIEW_EFFORT
    ),
    mergeEffort: normalizeIngestReasoningEffort(
      readStackOptionalLineFile("ingest_merge_effort") ??
        process.env.INGEST_MERGE_EFFORT
    ),
    serviceTier: normalizeIngestServiceTier(
      readStackOptionalLineFile("ingest_service_tier") ??
        process.env.INGEST_SERVICE_TIER
    ),
  };
}

function readValidatorEnabledFile(): boolean | null {
  const root = getHermesDataDir();
  if (!root) return null;
  const f = path.join(root, "validator_enabled");
  try {
    if (existsSync(f)) {
      const raw = readFileSync(f, "utf-8");
      const line = (raw.split(/\r?\n/)[0] ?? "").trim().toLowerCase();
      if (line === "1" || line === "true" || line === "yes" || line === "on") return true;
      if (line === "0" || line === "false" || line === "no" || line === "off") return false;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Two-pass chat: active plan file first, then deploy env fallback, else off.
 */
export function getValidatorEnabled(): boolean {
  const f = readValidatorEnabledFile();
  if (f !== null) return f;
  const v = process.env.VALIDATOR_ENABLED?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return false;
}

/**
 * Active plan validator model first, then `VALIDATOR_CHAT_MODEL` legacy fallback.
 */
export function getValidatorChatModel(): string | null {
  const plan = readStackOptionalLineFile("validator_chat_model");
  if (plan) return plan;
  const m = process.env.VALIDATOR_CHAT_MODEL?.trim();
  if (m) return m;
  return null;
}

/** 0–100: random sample of turns also run Pass 2 (deterministic hash). 0 disables sampling-only triggers. */
export function getValidatorSamplePercent(): number {
  const raw = process.env.VALIDATOR_SAMPLE_PERCENT?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.floor(n);
}

/**
 * When Pass 1 used tools (`sawToolProgress`) but assistant text is shorter than this, run Pass 2.
 */
export function getValidatorMinReplyCharsAfterTools(): number {
  const raw = process.env.VALIDATOR_MIN_REPLY_CHARS_AFTER_TOOLS?.trim();
  const n = raw ? Number(raw) : 24;
  if (!Number.isFinite(n) || n < 0) return 24;
  return Math.min(500, Math.floor(n));
}

/** App-owned session + message files under `HERMES_CHAT_DATA_DIR`. */
export function getHermesChatDataDir(): string {
  const ex = process.env.HERMES_CHAT_DATA_DIR?.trim();
  if (ex) return ex;
  return path.join(process.cwd(), "data", "hermes-chat");
}

/** Staging dir for vault uploads (bridge materializes to HERMES_HOME/projects). Docker: /var/vault-staging */
export function getVaultStagingDir(): string | null {
  const s = process.env.VAULT_STAGING_DIR?.trim();
  return s || null;
}
