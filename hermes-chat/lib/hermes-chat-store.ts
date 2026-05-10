import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import {
  getHermesChatDataDir,
  readEffectiveHermesMainModelId,
} from "@/lib/hermes-config";
import { isHermesGatewayModelLabel } from "@/lib/model-display";
import type {
  ChatMessage,
  ChatCostBasis,
  ChatCostSource,
  InferenceBreakdownEntry,
} from "@/lib/sessions";
import { getImageUrls, getTextContent } from "@/lib/sessions";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  readSessionsStoreDb,
  writeSessionsStoreDb,
  loadSessionMessagesDb,
  saveSessionMessagesDb,
  sessionHasMessagesDb,
} from "@/lib/db/repositories";
import { HERMESCHAT_GLOBAL_ASSISTANT_RULES } from "@/lib/hermeschat-global-assistant-rules";

export function getSessionsJsonPath(): string {
  return path.join(getHermesChatDataDir(), "sessions.json");
}

export function getMessagesJsonPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getHermesChatDataDir(), "messages", `${safe}.json`);
}

async function ensureDirs() {
  const root = getHermesChatDataDir();
  await mkdir(path.join(root, "messages"), { recursive: true });
}

export type MessagesFileV1 = {
  version: 1;
  sessionId: string;
  messages: ChatMessage[];
};

async function loadSessionMessagesFromFs(sessionId: string): Promise<ChatMessage[]> {
  try {
    const raw = await readFile(getMessagesJsonPath(sessionId), "utf-8");
    const data = JSON.parse(raw) as MessagesFileV1;
    if (!data.messages || !Array.isArray(data.messages)) return [];
    return data.messages;
  } catch {
    return [];
  }
}

export async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  if (shouldUseChatDatabase()) {
    const fromDb = await loadSessionMessagesDb(sessionId);
    if (fromDb.length > 0) return fromDb;
    return loadSessionMessagesFromFs(sessionId);
  }
  return loadSessionMessagesFromFs(sessionId);
}

/** True if the session has at least one stored message (DB and/or legacy FS). */
export async function sessionHasAnyMessages(sessionId: string): Promise<boolean> {
  if (shouldUseChatDatabase()) {
    if (await sessionHasMessagesDb(sessionId)) return true;
    const fromFs = await loadSessionMessagesFromFs(sessionId);
    return fromFs.length > 0;
  }
  const fromFs = await loadSessionMessagesFromFs(sessionId);
  return fromFs.length > 0;
}

function messageContentEquivalent(a: ChatMessage, b: ChatMessage): boolean {
  if (a.role !== b.role) return false;
  const ta = getTextContent(a.content).replace(/\s+/g, " ").trim();
  const tb = getTextContent(b.content).replace(/\s+/g, " ").trim();
  if (ta !== tb) return false;
  const ia = getImageUrls(a.content);
  const ib = getImageUrls(b.content);
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    if (ia[i] !== ib[i]) return false;
  }
  return true;
}

/**
 * Client POST bodies only include role+content per turn. Reconcile with disk so we do not
 * strip usageTokens, timestamps, or costs from prior assistant rows on early save.
 */
export function mergeIncomingMessagesPreservingMeta(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const prev = existing[i];
    if (prev && messageContentEquivalent(prev, inc)) {
      out.push(prev);
    } else {
      out.push(inc);
    }
  }
  return out;
}

export async function saveSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
  if (shouldUseChatDatabase()) {
    await saveSessionMessagesDb(sessionId, messages);
    return;
  }
  await ensureDirs();
  const payload: MessagesFileV1 = {
    version: 1,
    sessionId,
    messages,
  };
  await writeFile(getMessagesJsonPath(sessionId), JSON.stringify(payload, null, 2), "utf-8");
}

async function readSessionsStoreFromFs(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(getSessionsJsonPath(), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** With Postgres: merge legacy sessions.json with DB (DB wins on same key). */
export async function readSessionsStore(): Promise<Record<string, unknown>> {
  if (shouldUseChatDatabase()) {
    const fromDb = await readSessionsStoreDb();
    const fromJson = await readSessionsStoreFromFs();
    return { ...fromJson, ...fromDb };
  }
  return readSessionsStoreFromFs();
}

export async function writeSessionsStore(store: Record<string, unknown>): Promise<void> {
  if (shouldUseChatDatabase()) {
    await writeSessionsStoreDb(store);
    return;
  }
  await ensureDirs();
  await writeFile(getSessionsJsonPath(), JSON.stringify(store, null, 2), "utf-8");
}

export function resolveSessionKey(
  store: Record<string, unknown>,
  sessionKey: string
): string | null {
  if (store[sessionKey]) return sessionKey;
  const fallback = Object.keys(store).find(
    (k) => k.endsWith(`:${sessionKey}`) || k === sessionKey
  );
  return fallback || null;
}

/** Resolve the sessions store key for a webchat session id (matches GET /api/sessions/[id] logic). */
export function resolveSessionKeyFromStore(
  store: Record<string, unknown>,
  sessionId: string,
  preferredKey: string | null | undefined
): string | null {
  const pk = preferredKey?.trim() || null;
  if (pk && store[pk]) return pk;
  if (store[`webchat:${sessionId}`]) return `webchat:${sessionId}`;
  const longKey = Object.keys(store).find((k) =>
    k.endsWith(`:webchat:${sessionId}`)
  );
  if (longKey) return longKey;
  const bySessionId = Object.entries(store).find(
    ([, v]) =>
      v &&
      typeof v === "object" &&
      (v as { sessionId?: string }).sessionId === sessionId
  );
  return bySessionId?.[0] ?? null;
}

/**
 * Resolve store key + entry for a webchat id. Prefer `resolveSessionKeyFromStore`, then
 * any row with the same `sessionId` and a non-empty `projectId` (workspace binding) so GET
 * /api/sessions and chat/send stay aligned when `k` does not match the stored key.
 */
export function getStoreEntryForWebchatId(
  store: Record<string, unknown>,
  sessionId: string,
  preferredKey: string | null | undefined
): { resolvedKey: string | null; entry: Record<string, unknown> | undefined } {
  const resolvedKey = resolveSessionKeyFromStore(
    store,
    sessionId,
    preferredKey
  );
  const entry = resolvedKey
    ? (store[resolvedKey] as Record<string, unknown> | undefined)
    : undefined;
  if (
    entry &&
    typeof entry.projectId === "string" &&
    entry.projectId.trim()
  ) {
    return { resolvedKey, entry };
  }
  const hit = Object.entries(store).find(
    ([, v]) =>
      v &&
      typeof v === "object" &&
      (v as { sessionId?: string }).sessionId === sessionId &&
      typeof (v as { projectId?: string }).projectId === "string" &&
      (v as { projectId: string }).projectId.trim()
  );
  if (hit) {
    return {
      resolvedKey: hit[0],
      entry: store[hit[0]] as Record<string, unknown>,
    };
  }
  if (entry) {
    return { resolvedKey, entry };
  }
  return { resolvedKey: null, entry: undefined };
}

export async function patchSessionLabel(
  sessionKey: string,
  label: string,
  sessionId?: string
): Promise<void> {
  if (!label) return;
  const store = await readSessionsStore();
  const actualKey = resolveSessionKey(store as Record<string, unknown>, sessionKey);
  const key = actualKey || sessionKey;
  const cur = (store[key] as Record<string, unknown>) || {};
  store[key] = {
    ...cur,
    label,
    updatedAt: Date.now(),
    ...(sessionId ? { sessionId } : {}),
  };
  await writeSessionsStore(store);
}

export async function deleteSessionKeyFromStore(resolvedKey: string): Promise<void> {
  const store = await readSessionsStore();
  if (!store[resolvedKey]) return;
  delete store[resolvedKey];
  await writeSessionsStore(store);
}

/** Merge assistant reply into stored transcript (client already had user turns). */
export async function appendAssistantReply(
  sessionId: string,
  sessionKey: string,
  clientMessages: ChatMessage[],
  assistantText: string,
  meta?: {
    model?: string | null;
    modelIdRaw?: string | null;
    costUsd?: number | null;
    promptCostUsd?: number | null;
    completionCostUsd?: number | null;
    toolCostUsd?: number | null;
    costSource?: ChatCostSource | null;
    costBasis?: ChatCostBasis | null;
    nousToolCostDisclaimer?: boolean;
    usageTokens?: ChatMessage["usageTokens"];
    validatorModel?: string | null;
    /** Raw OpenRouter (etc.) model ids that ran on this turn (main + tool-routed + validator). */
    toolModels?: string[] | null;
    inferenceBreakdown?: InferenceBreakdownEntry[] | null;
    /** Hermes gateway `X-Hermes-Session-Id` for this turn — used to repair missing `/api/images/` on load. */
    hermesGatewaySessionId?: string | null;
  }
): Promise<void> {
  let modelToSave = meta?.model ?? null;
  if (modelToSave && isHermesGatewayModelLabel(modelToSave)) {
    modelToSave = null;
  }
  if (modelToSave == null) {
    modelToSave = await readEffectiveHermesMainModelId();
  }

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: assistantText,
    timestamp: Date.now(),
    ...(modelToSave != null ? { model: modelToSave } : {}),
    ...(meta?.modelIdRaw && String(meta.modelIdRaw).trim()
      ? { modelIdRaw: String(meta.modelIdRaw).trim() }
      : {}),
    ...(typeof meta?.costUsd === "number" && Number.isFinite(meta.costUsd)
      ? { costUsd: meta.costUsd }
      : {}),
    ...(typeof meta?.promptCostUsd === "number" && Number.isFinite(meta.promptCostUsd)
      ? { promptCostUsd: meta.promptCostUsd }
      : {}),
    ...(typeof meta?.completionCostUsd === "number" &&
    Number.isFinite(meta.completionCostUsd)
      ? { completionCostUsd: meta.completionCostUsd }
      : {}),
    ...(typeof meta?.toolCostUsd === "number" && Number.isFinite(meta.toolCostUsd)
      ? { toolCostUsd: meta.toolCostUsd }
      : {}),
    ...(meta?.costSource ? { costSource: meta.costSource } : {}),
    ...(meta?.costBasis ? { costBasis: meta.costBasis } : {}),
    ...(meta?.nousToolCostDisclaimer ? { nousToolCostDisclaimer: true } : {}),
    ...(meta?.usageTokens ? { usageTokens: meta.usageTokens } : {}),
    ...(meta?.validatorModel && String(meta.validatorModel).trim()
      ? { validatorModel: String(meta.validatorModel).trim() }
      : {}),
    ...(Array.isArray(meta?.toolModels) && meta.toolModels.length > 0
      ? { toolModels: meta.toolModels }
      : {}),
    ...(Array.isArray(meta?.inferenceBreakdown) && meta.inferenceBreakdown.length > 0
      ? { inferenceBreakdown: meta.inferenceBreakdown }
      : {}),
  };
  const merged = [...clientMessages, assistantMsg];
  await saveSessionMessages(sessionId, merged);

  const store = await readSessionsStore();
  const key = resolveSessionKey(store as Record<string, unknown>, sessionKey) || sessionKey;
  const cur = (store[key] as Record<string, unknown>) || {};
  const gw = meta?.hermesGatewaySessionId?.trim() || null;
  store[key] = {
    ...cur,
    sessionId,
    updatedAt: Date.now(),
    ...(gw ? { hermesGatewaySessionId: gw } : {}),
  };
  await writeSessionsStore(store);
}

/** Build OpenAI-style messages for Hermes (text only; images as path hints in last user). */
export function clientMessagesToOpenAI(
  messages: ChatMessage[],
  lastUserExpanded: string,
  systemPreamble?: string | null
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const isLastUser = i === messages.length - 1 && m.role === "user";
    if (isLastUser) {
      out.push({ role: "user", content: lastUserExpanded });
    } else {
      const text = getTextContent(m.content).trim();
      if (!text) continue;
      out.push({ role: m.role, content: text });
    }
  }
  const sys = systemPreamble?.trim();
  const globalRules = HERMESCHAT_GLOBAL_ASSISTANT_RULES.trim();
  const combinedSystem = sys
    ? `${globalRules}\n\n${sys}`
    : globalRules;
  return [{ role: "system", content: combinedSystem }, ...out];
}
