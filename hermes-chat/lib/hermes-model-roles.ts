import path from "path";
import { readFile } from "fs/promises";
import { parse as parseYaml } from "yaml";
import { hermesGatewayAdminFetch } from "@/lib/hermes-gateway-admin";
import {
  getChatModel,
  getDeployIngestChatModel,
  getHermesBaseUrl,
  getHermesDataDir,
  getHermesToken,
  getIngestChatModel,
  getIngestChatModelFromFile,
  getTitleChatModel,
  getValidatorChatModel,
  getValidatorEnabled,
  readHermesModelProviderFromConfig,
  readHermesPrimaryModelFromConfig,
} from "@/lib/hermes-config";

const AUXILIARY_LABELS: Record<string, string> = {
  vision: "Vision",
  web_extract: "Web extract",
  compression: "Compression",
  session_search: "Session search",
  skills_hub: "Skills hub",
  approval: "Approval",
  mcp: "MCP",
  flush_memories: "Flush memories",
};

export type AuxiliaryTaskRow = {
  key: string;
  label: string;
  provider: string;
  model: string;
};

export type ModelRolesOk = {
  ok: true;
  primaryChat: {
    model: string | null;
    provider: string | null;
  };
  /** Cosmetic label sent on chat requests (Hermes may ignore). */
  requestLabel: string;
  /** Model used for auto chat titles (HermesChat env, falls back to request label). */
  titleChatModel: string;
  /** `INGEST_CHAT_MODEL` in deploy; legacy fallback when the active plan file is empty. */
  deployIngestModel: string | null;
  /** Ingest id from `hermes-data/ingest_chat_model` (active plan file wins). */
  ingestPresetFileModel: string | null;
  /** Effective id used for vault/wiki-style ingest: file, else deploy, else same as main chat. */
  wikiIngestServerDefault: string | null;
  validator: {
    enabled: boolean;
    model: string | null;
  };
  fallback: {
    configured: boolean;
    provider: string | null;
    model: string | null;
  };
  smartRouting: {
    enabled: boolean;
    cheapProvider: string | null;
    cheapModel: string | null;
    cheapConfigured: boolean;
  };
  imageGen: {
    model: string | null;
    useGateway: boolean | null;
  };
  auxiliary:
    | { mode: "summary"; summary: string }
    | { mode: "detail"; tasks: AuxiliaryTaskRow[] };
};

export type ModelRolesErr = {
  ok: false;
  detail: "no_hermes_data_dir" | "config_read_failed" | "config_parse_failed";
  message?: string;
};

export type ModelRolesPayload = ModelRolesOk | ModelRolesErr;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function isAuxiliaryAutoRow(p: string | null, m: string | null): boolean {
  const prov = (p ?? "").toLowerCase();
  return (prov === "auto" || prov === "") && !(m && m.length > 0);
}

function isFsPermissionError(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("code" in e)) return false;
  const c = (e as { code?: string }).code;
  return c === "EACCES" || c === "EPERM";
}

/**
 * When HermesChat cannot read `hermes-data/config.yaml` (e.g. uid 1001 vs root-owned 0600), the
 * gateway process can still read the same file. Requires HERMES_URL + HERMES_TOKEN.
 */
async function tryLoadConfigViaGateway(): Promise<Record<string, unknown> | null> {
  if (!getHermesBaseUrl() || !getHermesToken()) return null;
  try {
    const res = await hermesGatewayAdminFetch("/api/stack/model-state", {
      method: "GET",
      timeoutMs: 12_000,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { config?: unknown };
    const cfg = j.config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      return cfg as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseAuxiliary(raw: unknown): ModelRolesOk["auxiliary"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      mode: "summary",
      summary: "Auto (Hermes chooses per task)",
    };
  }
  const tasks: AuxiliaryTaskRow[] = [];
  let allAuto = true;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const o = val as Record<string, unknown>;
    const provider = str(o.provider as string) ?? "";
    const model = str(o.model as string) ?? "";
    if (!isAuxiliaryAutoRow(provider, model)) allAuto = false;
    tasks.push({
      key,
      label: AUXILIARY_LABELS[key] ?? key.replace(/_/g, " "),
      provider: provider || "auto",
      model: model || "—",
    });
  }
  if (tasks.length === 0) {
    return {
      mode: "summary",
      summary: "Auto (Hermes chooses per task)",
    };
  }
  if (allAuto) {
    return {
      mode: "summary",
      summary: "Auto (Hermes chooses per task)",
    };
  }
  return { mode: "detail", tasks };
}

/**
 * @param useLineParserFallback  When true, re-reads model from disk via line-scan helpers if YAML
 *   blocks are empty. Skip when `cfg` came from the gateway (file still unreadable by this process).
 */
async function buildPayloadFromConfigRecord(
  cfg: Record<string, unknown>,
  useLineParserFallback: boolean
): Promise<ModelRolesOk> {
  const modelBlock = cfg.model;
  let defaultModel: string | null = null;
  let providerFromYaml: string | null = null;
  if (modelBlock && typeof modelBlock === "object" && !Array.isArray(modelBlock)) {
    const m = modelBlock as Record<string, unknown>;
    defaultModel = str(m.default);
    providerFromYaml = str(m.provider);
  }

  let fromConfigFns: string | null = null;
  let fromProviderFns: string | null = null;
  if (useLineParserFallback) {
    fromConfigFns = await readHermesPrimaryModelFromConfig();
    fromProviderFns = await readHermesModelProviderFromConfig();
  }
  const primaryModel = defaultModel ?? fromConfigFns;
  const primaryProvider = providerFromYaml ?? fromProviderFns;

  let fallbackConfigured = false;
  let fallbackProvider: string | null = null;
  let fallbackModel: string | null = null;
  const fb = cfg.fallback_model;
  if (fb && typeof fb === "object" && !Array.isArray(fb)) {
    const f = fb as Record<string, unknown>;
    fallbackProvider = str(f.provider);
    fallbackModel = str(f.model);
    fallbackConfigured = !!(fallbackProvider || fallbackModel);
  }

  const sr = cfg.smart_model_routing;
  let smartEnabled = false;
  let cheapProvider: string | null = null;
  let cheapModel: string | null = null;
  let cheapConfigured = false;
  if (sr && typeof sr === "object" && !Array.isArray(sr)) {
    const s = sr as Record<string, unknown>;
    smartEnabled = s.enabled === true;
    const cm = s.cheap_model;
    if (cm && typeof cm === "object" && !Array.isArray(cm) && Object.keys(cm).length > 0) {
      const c = cm as Record<string, unknown>;
      cheapProvider = str(c.provider);
      cheapModel = str(c.model);
      cheapConfigured = !!(cheapProvider || cheapModel);
    }
  }

  const ig = cfg.image_gen;
  let imageModel: string | null = null;
  let useGateway: boolean | null = null;
  if (ig && typeof ig === "object" && !Array.isArray(ig)) {
    const i = ig as Record<string, unknown>;
    imageModel = str(i.model as string);
    if (typeof i.use_gateway === "boolean") useGateway = i.use_gateway;
  }

  const auxiliary = parseAuxiliary(cfg.auxiliary);

  const payload: ModelRolesOk = {
    ok: true,
    primaryChat: {
      model: primaryModel,
      provider: primaryProvider,
    },
    requestLabel: getChatModel(),
    titleChatModel: getTitleChatModel(),
    deployIngestModel: getDeployIngestChatModel(),
    ingestPresetFileModel: getIngestChatModelFromFile(),
    wikiIngestServerDefault: getIngestChatModel() ?? primaryModel,
    validator: {
      enabled: getValidatorEnabled(),
      model: getValidatorChatModel(),
    },
    fallback: {
      configured: fallbackConfigured,
      provider: fallbackProvider,
      model: fallbackModel,
    },
    smartRouting: {
      enabled: smartEnabled,
      cheapProvider,
      cheapModel,
      cheapConfigured,
    },
    imageGen: {
      model: imageModel,
      useGateway,
    },
    auxiliary,
  };
  return payload;
}

/**
 * Build read-only model-role snapshot for the UI (Hermes `config.yaml` + HermesChat env).
 */
export async function getHermesModelRolesPayload(): Promise<ModelRolesPayload> {
  const root = getHermesDataDir();
  if (!root) {
    return { ok: false, detail: "no_hermes_data_dir" };
  }

  let raw: string;
  try {
    raw = await readFile(path.join(root, "config.yaml"), "utf-8");
  } catch (e) {
    if (isFsPermissionError(e)) {
      const viaGw = await tryLoadConfigViaGateway();
      if (viaGw) {
        return await buildPayloadFromConfigRecord(viaGw, false);
      }
    }
    return {
      ok: false,
      detail: "config_read_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    return {
      ok: false,
      detail: "config_parse_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const cfg = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  return await buildPayloadFromConfigRecord(cfg, true);
}
