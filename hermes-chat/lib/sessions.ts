import type { BuildEditSessionPayload } from "@/lib/builds-manifest";
import type { CreativeStudioSessionPayload } from "@/lib/creative-studio-session";

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Token counts from Hermes/OpenAI-compatible `usage` (when available). Per assistant message / prompt. */
export type ChatUsageTokens = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Native upstream USD when forwarded by the gateway (rare). */
  cost?: number;
  /** Reported USD split when upstream sends it (not derived from tokens). */
  prompt_cost?: number;
  completion_cost?: number;
  /** Full prompt accounting: main agent LLM (est.) + OpenRouter image native rows, etc. */
  hermes_inference_chain?: HermesInferenceChainStep[];
};

/** Billing path for the turn (Nous vs gateway-reported OpenRouter-style accounting). */
export type ChatCostSource = "nous" | "openrouter";

/** Whether USD came from upstream (usage.cost and/or streamed tool USD). No catalog token estimates. */
export type ChatCostBasis = "reported" | "estimated";

/** Gateway-native chain step (LLM aggregate + OpenRouter image sidecars, etc.). */
export type HermesInferenceChainStep = {
  model: string;
  role?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number | null;
  prompt_cost_usd?: number | null;
  completion_cost_usd?: number | null;
  cost_basis?: "estimated" | "reported" | string;
};

/** Per-model attribution for one assistant turn (best-effort until gateway emits subcall costs). */
export type InferenceBreakdownEntry = {
  model: string;
  costUsd?: number | null;
  role?: "main" | "validator" | "tool_stream" | "llm" | "openrouter_image";
  /** When present, footer shows "~" for catalog-estimated rows. */
  costBasis?: "estimated" | "reported" | string;
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string | MessageContentPart[];
  model?: string | null;
  /** Raw model id from gateway response (before display resolution); footer tooltip. */
  modelIdRaw?: string | null;
  /** Main completion cost in USD (storage); UI converts to display currency. */
  costUsd?: number | null;
  /** Reported prompt vs completion USD when upstream sends a split (optional). */
  promptCostUsd?: number | null;
  completionCostUsd?: number | null;
  /**
   * USD from streamed tool progress when the gateway emits `cost_usd` (or similar).
   * Persisted whenever the stream reports a positive total, alongside `usage.cost` / split costs when present.
   */
  toolCostUsd?: number | null;
  costSource?: ChatCostSource | null;
  costBasis?: ChatCostBasis | null;
  /** Short footer note when Nous tools ran but no per-tool USD was streamed. */
  nousToolCostDisclaimer?: boolean;
  /** Populated when the gateway returns usage (stream final chunk or non-stream JSON). */
  usageTokens?: ChatUsageTokens | null;
  timestamp?: number | string | null;
  toolModels?: string[];
  /** When Pass 2 revised this assistant turn, the validator model id. */
  validatorModel?: string | null;
  /** Ordered models involved in this turn (main, validator, tool-routed deduped). */
  inferenceBreakdown?: InferenceBreakdownEntry[];
}

export function getTextContent(content: string | MessageContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function getImageUrls(content: string | MessageContentPart[]): string[] {
  if (typeof content === "string") return [];
  return content
    .filter((p): p is { type: "image_url"; image_url: { url: string } } => p.type === "image_url")
    .map((p) => p.image_url.url);
}

export type SessionProcessingKind = "architect" | "default";

export interface ChatSession {
  id: string;
  key: string;
  webchatId: string | null;
  label: string;
  updatedAt: number;
  chatType: string;
  /** Set when session is bound to a project vault (workspace); omitted on main Chats list. */
  projectId?: string | null;
  /** `build_edit` only — from manifest, for sidebar grouping. */
  buildId?: string | null;
  /** `build_edit` only — display name from the Builds manifest. */
  buildName?: string | null;
  /** `creative_studio` only — intent id from Create dialog. */
  createIntent?: string | null;
  processing: boolean;
  /**
   * When `processing` is true: architect (shared vault) vs default gateway — drives orb color in the sidebar.
   */
  processingKind?: SessionProcessingKind;
  /** True if any message in the transcript includes an image (from list/search API). */
  hasImages?: boolean;
  /** Count of transcript rows in this session (for sidebar). */
  messageCount?: number;
  /** Count of user prompts / turn anchors in this session (for sidebar). */
  promptCount?: number;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/** Sidebar aggregate of where work is running (from GET /api/sessions). */
export type ChatProcessingSurface = {
  byWebchatId: Record<string, SessionProcessingKind>;
  hasMain: boolean;
  hasBuilds: boolean;
  vaults: Record<string, { hasActive: boolean; kind: SessionProcessingKind }>;
  mainProcessingWebchatIds: string[];
  buildsProcessingWebchatIds: string[];
  vaultProcessingWebchatIds: string[];
};

const EMPTY_PROCESSING_SURFACE: ChatProcessingSurface = {
  byWebchatId: {},
  hasMain: false,
  hasBuilds: false,
  vaults: {},
  mainProcessingWebchatIds: [],
  buildsProcessingWebchatIds: [],
  vaultProcessingWebchatIds: [],
};

export type ChatSessionsPayload = {
  sessions: ChatSession[];
  buildEditSessions: ChatSession[];
  creativeStudioSessions: ChatSession[];
  processingSurface: ChatProcessingSurface;
};

export async function fetchChatSessions(): Promise<ChatSessionsPayload> {
  try {
    const res = await fetch("/api/sessions", { cache: "no-store" });
    if (!res.ok) {
      return {
        sessions: [],
        buildEditSessions: [],
        creativeStudioSessions: [],
        processingSurface: EMPTY_PROCESSING_SURFACE,
      };
    }
    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) {
      return {
        sessions: data as ChatSession[],
        buildEditSessions: [],
        creativeStudioSessions: [],
        processingSurface: EMPTY_PROCESSING_SURFACE,
      };
    }
    const o = data as {
      sessions?: unknown;
      buildEditSessions?: unknown;
      creativeStudioSessions?: unknown;
      processingSurface?: unknown;
    };
    const ps = o.processingSurface as ChatProcessingSurface | undefined;
    return {
      sessions: Array.isArray(o.sessions) ? (o.sessions as ChatSession[]) : [],
      buildEditSessions: Array.isArray(o.buildEditSessions)
        ? (o.buildEditSessions as ChatSession[])
        : [],
      creativeStudioSessions: Array.isArray(o.creativeStudioSessions)
        ? (o.creativeStudioSessions as ChatSession[])
        : [],
      processingSurface:
        ps && typeof ps === "object" && "hasMain" in ps
          ? ps
          : EMPTY_PROCESSING_SURFACE,
    };
  } catch {
    return {
      sessions: [],
      buildEditSessions: [],
      creativeStudioSessions: [],
      processingSurface: EMPTY_PROCESSING_SURFACE,
    };
  }
}

export function statusFilePath(sessionKey: string): string {
  return `/tmp/oc-status-${sessionKey.replace(/:/g, "-")}.json`;
}

export function activeFilePath(sessionId: string): string {
  return `/tmp/oc-active-${sessionId}`;
}

export type SessionBannerKind =
  | "rate_limit"
  | "provider_error"
  | "tool_failure"
  | "transcript_stuck"
  | "stopped";

export type SessionBanner = {
  kind: SessionBannerKind;
  message: string;
  /** Present when kind === "rate_limit" */
  retryAfterSeconds?: number;
};

export interface SessionPollResult {
  messages: ChatMessage[];
  status: string | null;
  /** Longer activity headline while streaming (orb “auto-expand thinking”). */
  statusDetail: string | null;
  partial: string | null;
  label?: string | null;
  resolvedKey?: string | null;
  /** HermesChat workspace (project vault) bound to this session, if any. */
  projectId?: string | null;
  projectLabel?: string | null;
  serverError?: string | null;
  /** False when the last user turn has a finished assistant text reply, or we detected rate-limit / stale — use to clear loading without a mapped assistant row. */
  awaitingReply?: boolean;
  /** True while a reply is still expected (awaiting transcript) or chat/send still holds the status file. Prefer over awaitingReply alone for polling/orb. */
  replyInFlight?: boolean;
  sessionBanner?: SessionBanner | null;
  /** Turn ended without a normal assistant reply (aborted, prompt-error, etc.) — show once. */
  sessionNotice?: string | null;
  /** Session was removed or hidden (e.g. internal heartbeat-only). */
  notFound?: boolean;
  /** Network/server read failed; callers should not treat this as a completed run. */
  fetchFailed?: boolean;
  /** Assistant turn after the last user message included at least one toolCall (for auto thinking/off). */
  assistantUsedTools?: boolean;
  /** When set, this session was opened from Builds → Edit. */
  chatType?: string | null;
  buildEdit?: BuildEditSessionPayload | null;
  creativeStudio?: CreativeStudioSessionPayload | null;
}

export function noticePrefixForBannerKind(
  b: SessionBanner | null | undefined
): string {
  if (!b || b.kind === "rate_limit") return "";
  const map: Partial<Record<SessionBannerKind, string>> = {
    provider_error: "Provider error — ",
    tool_failure: "Tool failure — ",
    stopped: "Reply stopped — ",
    transcript_stuck: "No reply — ",
  };
  return map[b.kind] ?? "";
}

export async function fetchChatMessages(
  sessionId: string,
  sessionKey?: string
): Promise<SessionPollResult> {
  try {
    const keyParam = sessionKey ? `?k=${encodeURIComponent(sessionKey)}` : "";
    const res = await fetch(`/api/sessions/${sessionId}${keyParam}`, { cache: "no-store" });
    if (!res.ok)
      return {
        messages: [],
        status: null,
        statusDetail: null,
        partial: null,
        projectId: null,
        projectLabel: null,
        awaitingReply: false,
        replyInFlight: false,
        sessionNotice: null,
        notFound: res.status === 404,
        fetchFailed: res.status !== 404,
        assistantUsedTools: false,
        chatType: null,
        buildEdit: null,
        creativeStudio: null,
      };
    const data = await res.json();
    const awaiting =
      typeof data.awaitingReply === "boolean" ? data.awaitingReply : false;
    return {
      messages: data.messages || [],
      status: data.status || null,
      statusDetail:
        typeof data.statusDetail === "string" && data.statusDetail.trim()
          ? data.statusDetail.trim()
          : null,
      partial: data.partial || null,
      label: data.label || null,
      resolvedKey: data.resolvedKey || null,
      projectId: data.projectId ?? null,
      projectLabel: data.projectLabel ?? null,
      serverError: data.serverError || null,
      awaitingReply: awaiting,
      replyInFlight:
        typeof data.replyInFlight === "boolean" ? data.replyInFlight : awaiting,
      sessionBanner: data.sessionBanner ?? null,
      sessionNotice: data.sessionNotice ?? null,
      notFound: false,
      fetchFailed: false,
      assistantUsedTools: Boolean(data.assistantUsedTools),
      chatType: data.chatType ?? null,
      buildEdit: data.buildEdit ?? null,
      creativeStudio: data.creativeStudio ?? null,
    };
  } catch {
    return {
      messages: [],
      status: null,
      statusDetail: null,
      partial: null,
      label: null,
      projectId: null,
      projectLabel: null,
      awaitingReply: false,
      replyInFlight: false,
      sessionNotice: null,
      notFound: false,
      fetchFailed: true,
      assistantUsedTools: false,
      chatType: null,
      buildEdit: null,
      creativeStudio: null,
    };
  }
}

export async function searchSessions(query: string): Promise<ChatSession[]> {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function patchChatSessionLabel(
  sessionId: string,
  sessionKey: string,
  label: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, label }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      label?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    if (typeof data.label !== "string") {
      return { ok: false, error: "Invalid response" };
    }
    return { ok: true, label: data.label };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** Build plain-text lines for POST /api/sessions/generate-title; drop short assistant boilerplate. */
function isTranscriptMetaForTitles(text: string, role: string): boolean {
  if (role !== "assistant") return false;
  const t = text.trim();
  if (t.length > 1_200) return false;
  if (/\bmemory\b/i.test(t) && /\d{1,4}[,']?\d*\s*\/\s*\d{1,4}/.test(t)) {
    return true;
  }
  if (
    /replace\s+or\s+remove\s+an?\s+existing/i.test(t) &&
    t.length < 500
  ) {
    return true;
  }
  return false;
}

export function messagesForTitleApi(
  messages: ChatMessage[]
): { role: string; content: string }[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const content = getTextContent(m.content).slice(0, 8_000);
      if (isTranscriptMetaForTitles(content, m.role)) {
        return { role: m.role, content: "" };
      }
      return { role: m.role, content };
    })
    .filter((m) => m.content.trim().length > 0);
}

export async function fetchSessionTitleSuggestions(
  messages: { role: string; content: string }[],
  sessionKey: string
): Promise<string[]> {
  try {
    const res = await fetch("/api/sessions/generate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        sessionKey,
        apply: false,
        suggestionCount: 3,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { titles?: string[] };
    return Array.isArray(data.titles) ? data.titles.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function deleteChatSession(
  sessionId: string,
  sessionKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export const PENDING_HERMESCHAT_SUMMARIZE_KEY = "hermeschat-pending-summarize";

export const HERMESCHAT_SUMMARIZE_PROMPT =
  "Please summarize this chat: main topics, decisions, and any open follow-ups. Be concise.";

export const HERMESCHAT_SUMMARIZE_EVENT = "hermeschat-summarize-chat";
