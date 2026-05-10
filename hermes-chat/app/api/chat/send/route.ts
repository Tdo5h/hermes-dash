import { sendPushToAll } from "@/lib/push";
import {
  statusFilePath,
  type ChatMessage,
  type ChatCostBasis,
  type ChatCostSource,
} from "@/lib/sessions";
import { saveBase64Image, imageIdToPath } from "@/lib/images";
import { isHeartbeatNoiseLabel } from "@/lib/heartbeat-noise";
import {
  getHermesBaseUrl,
  getHermesToken,
  getHermesArchitectBaseUrl,
  getHermesArchitectToken,
  getChatModel,
  getTitleChatModel,
  getIngestChatModel,
  getValidatorEnabled,
  getValidatorChatModel,
  getValidatorSamplePercent,
  getValidatorMinReplyCharsAfterTools,
  resolveAssistantDisplayModel,
  readHermesModelProviderFromConfig,
  readEffectiveHermesMainModelId,
} from "@/lib/hermes-config";
import {
  shouldValidatePass1,
  VALIDATOR_SYSTEM_PROMPT,
  buildValidatorUserPayload,
  parseValidatorResponse,
} from "@/lib/validator-pass2";
import { normalizeIngestModelOverride } from "@/lib/ingest-model-override";
import { isHermesGatewayModelLabel } from "@/lib/model-display";
import { buildInferenceBreakdown } from "@/lib/inference-breakdown";
import { estimateOpenRouterUsdCostSplit } from "@/lib/openrouter-pricing";
import {
  patchSessionLabel,
  appendAssistantReply,
  clientMessagesToOpenAI,
  loadSessionMessages,
  mergeIncomingMessagesPreservingMeta,
  readSessionsStore,
  saveSessionMessages,
  writeSessionsStore,
} from "@/lib/hermes-chat-store";
import { writeFile, unlink } from "fs/promises";
import {
  appendAssistantFromChunkJson,
  assistantMessageBodyToMarkdown,
  accumulateHermesChunkUsage,
  headlineFromToolCallName,
  headlineFromToolCallNameExpanded,
  headlineFromToolProgress,
  headlineFromToolProgressExpanded,
  hasNonEmptyReasoningInChunkJson,
  normalizeHermesInferenceChain,
  parseUsageAndModelFromChunkJson,
  sseEventsFromReader,
  toolNameHintFromChunkJson,
  toolProgressPayloadUsd,
  type HermesToolProgressPayload,
  type HermesChunkUsage,
} from "@/lib/hermes-sse-stream";
import {
  enrichReplyWithLastSessionToolImage,
  mirrorToolImagePathsInMarkdown,
} from "@/lib/hermes-session-enrich";
import {
  mirrorDataImageUrlsInMarkdown,
  mirrorEphemeralProviderImageUrlsInMarkdown,
  mirrorFalUrlsInMarkdown,
} from "@/lib/fal-mirror";
import {
  repairMissingApiImageRefs,
  rewriteVaultRelativeImagesInMarkdown,
} from "@/lib/markdown-api-image-repair";
import {
  getProjectIdForSession,
  getBuildEditForSession,
  getCreativeStudioForSession,
} from "@/lib/workspace-thread";
import { finalizeCreateKanbanForSession } from "@/lib/create-kanban-cleanup";
import { readProject, listVaultUploadedFiles } from "@/lib/project-service";
import {
  activeWorkspaceSystemPrompt,
  creativeStudioReferenceVaultAppendix,
} from "@/lib/project-prompt";
import { activeBuildEditSystemPrompt } from "@/lib/build-edit-prompt";
import { activeCreativeStudioSystemPrompt } from "@/lib/creative-studio-session";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  registerChatSendAbort,
  unregisterChatSendAbort,
  consumeUserStop,
} from "@/lib/chat-send-abort";
import { withSharedIngestExclusive } from "@/lib/shared-ingest-serial";
import { getAgentDisplayName } from "@/lib/agent-display-name";

/**
 * Route segment limit (mainly Vercel). POST returns 202 immediately; work runs in `processChatSend`.
 * Self-hosted Docker: real limit is whatever Node/proxy allows, not this number.
 */
export const maxDuration = 800;
export const dynamic = "force-dynamic";

/** Data URIs, provider ephemeral image URLs, legacy fal.media links, session-file repair, then vault paths → project file URLs. */
async function mirrorRemoteImagesAndRepairApiRefs(
  reply: string,
  hermesSessionId: string | null,
  projectSlug?: string | null
): Promise<string> {
  let out = await mirrorDataImageUrlsInMarkdown(reply);
  out = await mirrorEphemeralProviderImageUrlsInMarkdown(out);
  out = await mirrorFalUrlsInMarkdown(out);
  out = await repairMissingApiImageRefs(out, hermesSessionId);
  const slug = projectSlug?.trim();
  if (slug) {
    out = rewriteVaultRelativeImagesInMarkdown(out, slug);
  }
  return out;
}

/**
 * Second step after the first reply: LLM renames the chat (draft was already set from the user’s first message via `draftTitleFromUserInput`).
 * Keep titles plain and descriptive — avoid coined portmanteaus or brand-like single tokens that read as gibberish in the sidebar.
 */
const TITLE_PROMPT =
  "Write one concise chat title in plain English (4-8 words). Name the central user goal, problem, or outcome using the user's request and the assistant's reply. Prefer concrete project/topic nouns over generic labels. Good style: Image Routing Fix, Timesheet Workflow Repair, Chat Divider Design. Bad style: Chat Help, App Improvements, Troubleshooting, General Discussion. Use normal words and spacing. Do not invent portmanteaus, merged words, or CamelCase product-style names unless they are real proper nouns from the topic. No quotes. No trailing punctuation.";

/** Reject opaque one-word CamelCase tokens (e.g. model-invented labels like WePuncture); fall back to the user-text draft. */
function isLikelyBadChatTitle(t: string): boolean {
  const s = t.trim();
  if (s.length < 3) return true;
  if (
    /^(chat|conversation|discussion|help|assistance|request|question|support|troubleshooting|general discussion|app improvements|ui updates|code changes|code review)$/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\s/.test(s)) return false;
  if (/[a-z][A-Z]/.test(s)) return true;
  if (/^[A-Z][a-z]+[A-Z]/.test(s)) return true;
  return false;
}

function normalizeTitle(raw: string, maxLen = 72): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?]+$/g, "");
  if (cleaned.length <= maxLen) return cleaned;
  const clipped = cleaned.slice(0, maxLen);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trim();
}

/** Vault file upload or plain-text ingest — still get draft + LLM sidebar title. */
function isIngestInstruction(text: string): boolean {
  if (/\[metadata:\s*action=reingest_verify\b/i.test(text)) return true;
  if (!/\[metadata:\s*action=ingest(?:_plain)?\b/i.test(text)) return false;
  return (
    /Please ingest this document/i.test(text) ||
    /Please ingest this text/i.test(text)
  );
}

/** Plain text from the last user message (ignores image parts). */
function userMessagePlainTextForRouting(msg: ChatMessage): string {
  const c = msg.content;
  if (Array.isArray(c)) {
    let t = "";
    for (const part of c) {
      if (part.type === "text") t += part.text || "";
    }
    return t;
  }
  return (c as string) || "";
}

function draftTitleFromIngestMessage(userMessage: string): string {
  const fileMatch = userMessage.match(/^File:\s*(.+)$/m);
  if (fileMatch?.[1]) {
    const name = fileMatch[1].trim();
    const base = name.replace(/\.[^./\\]+$/, "").trim();
    if (base) return normalizeTitle(base, 64);
    if (name) return normalizeTitle(name, 64);
  }
  const pastedBlock = userMessage.match(
    /^Pasted content:\s*\n+([\s\S]+?)(?=\n\nPlease ingest|\n\n\[metadata:)/im
  );
  if (pastedBlock?.[1]) {
    const lines = pastedBlock[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const first = lines[0];
    if (first) return normalizeTitle(first, 64);
  }
  return "Vault ingest";
}

function draftTitleFromUserInput(userMessage: string): string {
  const text = userMessage.replace(/\s+/g, " ").trim();
  if (!text) return "New chat";
  return normalizeTitle(text, 64);
}

async function writeStatusFile(
  filePath: string,
  status: string | null,
  text: string,
  opts?: {
    partial?: string;
    error?: string;
    stopped?: boolean;
    /** Shared-vault work routed to the shared ingest gateway — sidebar uses ingest orbs. */
    ingestViaArchitect?: boolean;
    /** Longer activity line for orb when “auto-expand thinking” is on (see GET /api/sessions). */
    textDetail?: string;
  }
) {
  try {
    const obj: Record<string, unknown> = { status, text };
    if (opts?.partial !== undefined) obj.partial = opts.partial;
    if (opts?.error) obj.error = opts.error;
    if (opts?.stopped) obj.stopped = true;
    if (opts?.ingestViaArchitect === true) obj.ingestViaArchitect = true;
    if (opts?.textDetail !== undefined && opts.textDetail !== "")
      obj.textDetail = opts.textDetail;
    await writeFile(filePath, JSON.stringify(obj));
  } catch {}
}

/**
 * Optional cap on how long we wait for Hermes `/v1/chat/completions` (streaming + non-stream retry).
 * Unset / empty / 0 = no artificial timeout — the run continues until Hermes closes the stream,
 * the connection drops, or the process exits (provider rate limits / errors surface as HTTP or stream end).
 * Set e.g. 300000 for five minutes if you need a bound behind a flaky proxy.
 */
function hermesGatewayCompletionTimeoutMs(): number | null {
  const raw = process.env.HERMES_CHAT_GATEWAY_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 2147483647);
}

function extractHermesErrorDetail(errText: string): string {
  let detail = errText.replace(/\s+/g, " ").trim().slice(0, 600);
  try {
    const j = JSON.parse(errText) as {
      error?: { message?: string; code?: number } | string;
      message?: string;
    };
    const inner =
      typeof j.error === "object" && j.error?.message
        ? j.error.message
        : typeof j.error === "string"
          ? j.error
          : j.message;
    if (typeof inner === "string" && inner.trim()) {
      detail = inner.trim().slice(0, 600);
    }
  } catch {
    /* use raw detail */
  }
  return detail;
}

/** Map Hermes 401/403 and auth-shaped bodies to an actionable SETUP hint. */
function userMessageForHermesHttpError(httpStatus: number, detail: string): string {
  const usageLimit =
    httpStatus === 429 &&
    /usage limit|usage_limit_reached|rate limit|rate-limited/i.test(detail);
  if (usageLimit) {
    return "ChatGPT's 5-hour usage window is exhausted. Hermes tried the configured ChatGPT fallback, but that fallback is in the same account limit bucket, so it is also blocked until the 5-hour reset shown under replies.";
  }

  const authFail =
    httpStatus === 401 ||
    httpStatus === 403 ||
    /\b401\b|Missing Authentication|Authentication header|Invalid API|Unauthorized/i.test(
      detail
    );
  if (authFail) {
    return "Hermes returned an authentication error. Set HERMES_TOKEN in hermes-stack/.env (and hermes-chat/.env.local with the same value) to match API_SERVER_KEY in hermes-data/.env, then restart the chat container (docker compose --profile chat up -d chat).";
  }
  return (
    detail ||
    "Sorry, something went wrong while processing your request. Please try again."
  );
}

function completionErrorUserMessage(httpStatus: number, detail: string): string {
  return userMessageForHermesHttpError(httpStatus, detail);
}

function friendlyGatewayFailureReply(reply: string): string {
  if (
    /API call failed after \d+ retries/i.test(reply) &&
    /HTTP 429/i.test(reply) &&
    /usage limit has been reached/i.test(reply)
  ) {
    return "ChatGPT's 5-hour usage window is exhausted. Hermes tried the configured ChatGPT fallback, but that fallback uses the same ChatGPT account window, so it is also blocked until the reset shown under replies.";
  }
  return reply;
}

function pushExcerpt(text: string, fallback: string): string {
  const cleaned = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

async function sendChatPush(
  chatSessionId: string,
  body: string,
  logLabel: string,
  opts?: { error?: boolean }
) {
  try {
    const agent = getAgentDisplayName();
    const store = await readSessionsStore().catch(() => ({}));
    const title =
      Object.values(store).find(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          (entry as { sessionId?: unknown }).sessionId === chatSessionId
      ) as { label?: unknown } | undefined;
    const label =
      typeof title?.label === "string" && title.label.trim()
        ? title.label.trim().replace(/^Chat:\s*/i, "")
        : "Chat";
    const pushId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `/chat/${chatSessionId}?fromPush=1&pushId=${encodeURIComponent(pushId)}&kind=${opts?.error ? "error" : "reply"}`;
    const pushResult = await sendPushToAll({
      title: opts?.error ? `${agent} needs attention` : `${agent} replied`,
      body: opts?.error
        ? pushExcerpt(body, "Something needs attention.")
        : `${label}: ${pushExcerpt(body, "Reply ready.")}`,
      url,
      kind: "chat",
      tag: `chat-${chatSessionId}`,
    });
    console.log("[chat/send] push (" + logLabel + "):", JSON.stringify(pushResult));
  } catch (e) {
    console.error("[chat/send] push failed (ignored):", logLabel, e);
  }
}

async function generateAndPatchTitle(
  base: string,
  token: string,
  userMessage: string,
  assistantReply: string,
  sessionKey: string,
  draftFallback: string
) {
  const cleanExcerpt = (text: string, maxLen: number) => {
    const cleaned = text.replace(/\[metadata:[^\]]+\]/gi, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxLen) return cleaned;
    const clipped = cleaned.slice(0, maxLen);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
  };
  const preview =
    `Title this first chat turn for the sidebar. Pick the specific main point a user would recognize later.\n\n` +
    `user: ${cleanExcerpt(userMessage, 1_000)}\n` +
    `assistant: ${cleanExcerpt(assistantReply, 1_000)}`;
  const modelId = getTitleChatModel();

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        messages: [
          {
            role: "system",
            content: TITLE_PROMPT,
          },
          { role: "user", content: preview },
        ],
      }),
    });

    const data = await res.json();
    const raw = normalizeTitle(data.choices?.[0]?.message?.content || "");
    const fallback = normalizeTitle(draftFallback, 72);
    const title =
      raw &&
      !isHeartbeatNoiseLabel(raw) &&
      !isLikelyBadChatTitle(raw)
        ? raw
        : fallback;

    if (title && !isHeartbeatNoiseLabel(title)) {
      await patchSessionLabel(sessionKey, title);
    }
  } catch {
    // best-effort title generation
    try {
      const fb = normalizeTitle(draftFallback, 72);
      if (fb && !isHeartbeatNoiseLabel(fb)) {
        await patchSessionLabel(sessionKey, fb);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Parse SSE chunks; if nothing extracted, try whole body as non-stream JSON (some gateways ignore stream:true). */
function extractAssistantTextFromCompletionResponse(
  rawBytes: Uint8Array
): string {
  const raw = new TextDecoder().decode(rawBytes);
  let accText = "";
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const payload = trimmed.slice(6);
    if (payload === "[DONE]") continue;
    accText = appendAssistantFromChunkJson(payload, accText);
  }
  if (accText.trim()) return accText;
  const t = raw.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as {
        choices?: {
          message?: { content?: unknown; images?: unknown };
        }[];
      };
      const md = assistantMessageBodyToMarkdown(j.choices?.[0]?.message);
      if (md.trim()) return md;
    } catch {
      /* ignore */
    }
  }
  return "";
}

const PARTIAL_STATUS_THROTTLE_MS = 80;
const firstTurnSendInFlight = new Set<string>();

function pushOrderedModelIds(acc: string[], id: string | null | undefined) {
  const t = (id ?? "").trim();
  if (!t || isHermesGatewayModelLabel(t)) return;
  if (!acc.includes(t)) acc.push(t);
}

async function consumeHermesStreamingCompletion(
  body: ReadableStream<Uint8Array>,
  sFile: string,
  ingestViaArchitect: boolean
): Promise<{
  text: string;
  responseModel?: string;
  /** Raw model id from every SSE chunk that reported `model` (dedupe, order). */
  modelsTouched: string[];
  usage?: HermesChunkUsage;
  toolCostsUsdFromStream: number;
  sawToolProgress: boolean;
}> {
  const reader = body.getReader();
  let partialAcc = "";
  let activityHeadline = "";
  let activityHeadlineExpanded = "";
  let lastPartialFlush = 0;
  let lastToolProgressSig = "";
  let reasoningActivityApplied = false;
  let responseModel: string | undefined;
  const modelsTouched: string[] = [];
  let usage: HermesChunkUsage | undefined;
  let toolCostsUsdFromStream = 0;
  let sawToolProgress = false;

  async function writeLiveStatus(forcePartial = false) {
    const now = Date.now();
    if (
      !forcePartial &&
      partialAcc &&
      now - lastPartialFlush < PARTIAL_STATUS_THROTTLE_MS
    ) {
      return;
    }
    lastPartialFlush = now;
    const detail =
      activityHeadlineExpanded.trim() || activityHeadline.trim() || "";
    await writeStatusFile(sFile, "Thinking", activityHeadline, {
      partial: partialAcc,
      ...(detail ? { textDetail: detail } : {}),
      ...(ingestViaArchitect ? { ingestViaArchitect: true } : {}),
    });
  }

  try {
    for await (const ev of sseEventsFromReader(reader)) {
      const { event, data } = ev;
      if (data === "[DONE]") continue;

      if (event === "hermes.tool.progress") {
        sawToolProgress = true;
        try {
          const payload = JSON.parse(data) as HermesToolProgressPayload;
          toolCostsUsdFromStream += toolProgressPayloadUsd(payload);
          const subModel =
            typeof payload.model === "string" ? payload.model.trim() : "";
          if (subModel) pushOrderedModelIds(modelsTouched, subModel);
          const sig = `${(payload.tool || "").trim()}\0${(payload.label || "").trim()}`;
          if (sig !== lastToolProgressSig) {
            lastToolProgressSig = sig;
            const h = headlineFromToolProgress(payload);
            if (h && h !== activityHeadline) {
              activityHeadline = h;
              activityHeadlineExpanded = headlineFromToolProgressExpanded(payload);
              await writeLiveStatus(true);
            }
          }
        } catch {
          /* ignore */
        }
        continue;
      }

      if (data.trim().startsWith("{")) {
        const hint = toolNameHintFromChunkJson(data);
        if (hint) {
          const th = headlineFromToolCallName(hint);
          if (th && th !== activityHeadline) {
            activityHeadline = th;
            activityHeadlineExpanded = headlineFromToolCallNameExpanded(hint) || "";
            await writeLiveStatus(true);
          }
        }
        const um = parseUsageAndModelFromChunkJson(data);
        if (um.model) {
          responseModel = um.model;
          pushOrderedModelIds(modelsTouched, um.model);
        }
        if (um.usage) usage = accumulateHermesChunkUsage(usage, um.usage);
        if (
          !reasoningActivityApplied &&
          partialAcc.length === 0 &&
          hasNonEmptyReasoningInChunkJson(data)
        ) {
          reasoningActivityApplied = true;
          if (activityHeadline !== "Working through the problem") {
            activityHeadline = "Working through the problem";
            activityHeadlineExpanded = "Working through the problem";
            await writeLiveStatus(true);
          }
        }
        const before = partialAcc.length;
        partialAcc = appendAssistantFromChunkJson(data, partialAcc);
        if (partialAcc.length !== before) {
          await writeLiveStatus();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  {
    const detail =
      activityHeadlineExpanded.trim() || activityHeadline.trim() || "";
    await writeStatusFile(sFile, "Thinking", activityHeadline, {
      partial: partialAcc,
      ...(detail ? { textDetail: detail } : {}),
      ...(ingestViaArchitect ? { ingestViaArchitect: true } : {}),
    });
  }
  return {
    text: partialAcc,
    responseModel,
    modelsTouched,
    usage,
    toolCostsUsdFromStream,
    sawToolProgress,
  };
}

async function processChatSend(params: {
  sessionKey: string;
  chatMessages: ChatMessage[];
  lastUserMessage: ChatMessage;
  chatSessionId: string;
  isFirstMessage: boolean;
  baseUrl: string;
  modelId: string;
  /** Single-message model override (normal chat only; not ingest). */
  oneOffModelId?: string | null;
  token: string;
}): Promise<void> {
  const {
    sessionKey,
    chatMessages,
    lastUserMessage,
    chatSessionId,
    isFirstMessage,
    baseUrl,
    modelId,
    oneOffModelId,
    token,
  } = params;

  const sFile = statusFilePath(sessionKey);
  let hadError = false;

  try {
    const existingTranscript = await loadSessionMessages(chatSessionId);
    const mergedTranscript = mergeIncomingMessagesPreservingMeta(
      existingTranscript,
      chatMessages
    );

    try {
      await saveSessionMessages(chatSessionId, mergedTranscript);
    } catch (persistErr: unknown) {
      hadError = true;
      console.error("[chat/send] saveSessionMessages (early):", persistErr);
      const hint =
        persistErr instanceof Error ? persistErr.message : String(persistErr);
      await writeStatusFile(sFile, null, "", {
        error: `Could not save messages (${hint.slice(0, 200)}). Check HERMES_CHAT_DATA_DIR permissions.`,
      });
      return;
    }

    const imageFilePaths: string[] = [];
    const addImageFilePath = (imageId: string) => {
      const clean = imageId.trim();
      if (!clean || clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
        return;
      }
      const filePath = imageIdToPath(clean);
      if (!imageFilePaths.includes(filePath)) {
        imageFilePaths.push(filePath);
      }
    };
    let textContent = "";

    if (Array.isArray(lastUserMessage.content)) {
      for (const part of lastUserMessage.content) {
        if (part.type === "image_url" && part.image_url?.url) {
          const url: string = part.image_url.url;
          if (url.startsWith("/api/images/")) {
            const imageId = url.replace("/api/images/", "");
            addImageFilePath(imageId);
          } else if (url.startsWith("data:image/")) {
            try {
              const { filePath } = await saveBase64Image(url);
              imageFilePaths.push(filePath);
            } catch {}
          }
        } else if (part.type === "text") {
          textContent += part.text || "";
        }
      }
    } else {
      textContent = (lastUserMessage.content as string) || "";
    }

    for (const m of textContent.matchAll(
      /\/api\/images\/([a-fA-F0-9-]{36}\.[a-zA-Z0-9]{1,12})/g
    )) {
      addImageFilePath(m[1] || "");
    }

    let messageText = textContent;
    if (imageFilePaths.length > 0) {
      const mediaTags = imageFilePaths
        .map((fp) => `[media attached: ${fp}]`)
        .join("\n");
      messageText = mediaTags + (textContent ? `\n\n${textContent}` : "");
      console.log("[chat/send] attached", imageFilePaths.length, "images via file paths");
    }

    const ingestAuto = isIngestInstruction(textContent);
    const oneOff = oneOffModelId?.trim() || null;
    const streamModelId = oneOff && !ingestAuto ? oneOff : modelId;

    if (isFirstMessage && (textContent || imageFilePaths.length > 0)) {
      const draftLabel = ingestAuto
        ? draftTitleFromIngestMessage(textContent)
        : draftTitleFromUserInput(textContent || "Image chat");
      try {
        await patchSessionLabel(sessionKey, draftLabel, chatSessionId);
      } catch (persistErr: unknown) {
        hadError = true;
        console.error("[chat/send] patchSessionLabel:", persistErr);
        const hint =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        await writeStatusFile(sFile, null, "", {
          error: `Could not save this chat on the server (${hint.slice(0, 200)}). Check HERMES_CHAT_DATA_DIR exists and is writable.`,
        });
        return;
      }
    }

    const completionTimeoutMs = hermesGatewayCompletionTimeoutMs();
    const runAbort = registerChatSendAbort(sessionKey);
    const timeoutId =
      completionTimeoutMs != null
        ? setTimeout(() => runAbort.abort(), completionTimeoutMs)
        : null;

    const buildEditMeta = await getBuildEditForSession(sessionKey);
    const creativeStudioMeta = await getCreativeStudioForSession(sessionKey);
    const { projectId: boundProjectId } = await getProjectIdForSession(sessionKey);
    let projBound: Awaited<ReturnType<typeof readProject>> = null;
    let systemPreamble: string | null = null;
    if (buildEditMeta) {
      systemPreamble = activeBuildEditSystemPrompt(buildEditMeta);
    } else if (boundProjectId) {
      projBound = await readProject(boundProjectId);
      if (projBound) {
        let uploadedFiles: { relativePath: string; name: string }[] = [];
        try {
          const rows = await listVaultUploadedFiles(projBound.slug);
          uploadedFiles = rows.map((r) => ({
            relativePath: r.relativePath,
            name: r.name,
          }));
        } catch (vaultErr) {
          console.warn("[chat/send] listVaultUploadedFiles:", vaultErr);
        }
        systemPreamble = activeWorkspaceSystemPrompt({
          projectSlug: projBound.slug,
          projectName: projBound.name,
          uploadedFiles,
          workspaceVisibility: projBound.visibility,
        });
      }
    } else if (creativeStudioMeta) {
      systemPreamble = activeCreativeStudioSystemPrompt(creativeStudioMeta);
      const refSlug = creativeStudioMeta.referenceVaultSlug?.trim();
      if (refSlug) {
        try {
          const refProj = await readProject(refSlug);
          if (refProj) {
            let uploadedFiles: { relativePath: string; name: string }[] = [];
            try {
              const rows = await listVaultUploadedFiles(refProj.slug);
              uploadedFiles = rows.map((r) => ({
                relativePath: r.relativePath,
                name: r.name,
              }));
            } catch (vaultErr) {
              console.warn("[chat/send] listVaultUploadedFiles ref vault:", vaultErr);
            }
            systemPreamble += creativeStudioReferenceVaultAppendix({
              projectSlug: refProj.slug,
              projectName: refProj.name,
              workspaceVisibility: refProj.visibility,
              uploadedFiles,
            });
          }
        } catch (e) {
          console.warn("[chat/send] creative studio reference vault:", e);
        }
      }
    }

    let completionBase = baseUrl;
    let completionToken = token;
    if (boundProjectId && ingestAuto && projBound?.visibility === "shared") {
      const ab = getHermesArchitectBaseUrl();
      const atk = getHermesArchitectToken();
      if (!ab?.trim() || !atk?.trim()) {
        hadError = true;
        const errMsg =
          "Shared vault ingest is not configured on this Chat service.";
        await writeStatusFile(sFile, null, "", {
          error: errMsg,
          ingestViaArchitect: true,
        });
        await sendChatPush(chatSessionId, errMsg, "error-http", { error: true });
        if (timeoutId != null) clearTimeout(timeoutId);
        unregisterChatSendAbort(sessionKey);
        return;
      }
      completionBase = ab.replace(/\/$/, "");
      completionToken = atk.trim();
      if (process.env.NODE_ENV !== "production") {
        console.info("[chat/send] routing shared ingest", { completionBase });
      }
    }

    const useSharedArchitectExclusive =
      Boolean(boundProjectId && ingestAuto && projBound?.visibility === "shared");

    await writeStatusFile(sFile, "Thinking", "", {
      partial: "",
      ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
    });

    const openAiMessages = clientMessagesToOpenAI(
      mergedTranscript,
      messageText,
      systemPreamble
    );

    try {
      const runArchitectIngestCompletion = async (): Promise<void> => {
      const res = await fetch(`${completionBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${completionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: streamModelId,
          messages: openAiMessages,
          stream: true,
          stream_tool_progress: true,
          stream_options: { include_usage: true },
        }),
        signal: runAbort.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "no body");
        console.error("[chat/send] stream error:", res.status, errText);
        hadError = true;
        const detail = extractHermesErrorDetail(errText);
        const errMsg = completionErrorUserMessage(res.status, detail);
        await writeStatusFile(sFile, null, "", {
          error: errMsg,
          ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
        });
        await sendChatPush(chatSessionId, errMsg, "error-http", { error: true });
        return;
      }

      const hermesSessionId = res.headers.get("x-hermes-session-id")?.trim() ?? null;
      let gatewaySessionIdForPersist: string | null = hermesSessionId;
      const streamResult = await consumeHermesStreamingCompletion(
        res.body,
        sFile,
        useSharedArchitectExclusive
      );
      let reply = await mirrorToolImagePathsInMarkdown(streamResult.text);
      reply = await mirrorEphemeralProviderImageUrlsInMarkdown(reply);
      reply = await enrichReplyWithLastSessionToolImage(
        reply,
        hermesSessionId
      );
      reply = await mirrorRemoteImagesAndRepairApiRefs(
        reply,
        hermesSessionId,
        projBound?.slug ?? null
      );
      let usageFromApi = streamResult.usage;
      let responseModel = streamResult.responseModel;
      const toolCostsUsdFromStream = streamResult.toolCostsUsdFromStream;
      let modelFromStreamRetry: string | undefined;

      if (!reply.trim()) {
        console.warn(
          "[chat/send] empty parse from stream; retrying with stream:false"
        );
        const res2 = await fetch(`${completionBase}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${completionToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: streamModelId,
            messages: openAiMessages,
            stream: false,
          }),
          signal: runAbort.signal,
        });
        if (!res2.ok) {
          const errText = await res2.text().catch(() => "no body");
          console.error("[chat/send] stream:false retry error:", res2.status, errText);
          hadError = true;
          const detail = extractHermesErrorDetail(errText);
          const errMsg = completionErrorUserMessage(res2.status, detail);
          await writeStatusFile(sFile, null, "", {
            error: errMsg,
            ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
          });
          await sendChatPush(chatSessionId, errMsg, "error-http-retry", { error: true });
          return;
        }
        const data = (await res2.json().catch(() => null)) as {
          choices?: {
            message?: { content?: unknown; images?: unknown };
          }[];
          model?: string;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            cost?: number;
            prompt_cost?: number;
            completion_cost?: number;
          };
        } | null;
        const mdRetry = assistantMessageBodyToMarkdown(
          data?.choices?.[0]?.message
        );
        if (mdRetry.trim()) reply = mdRetry;
        {
          const sidRetry =
            res2.headers.get("x-hermes-session-id")?.trim() ?? hermesSessionId;
          gatewaySessionIdForPersist = sidRetry;
          reply = await mirrorToolImagePathsInMarkdown(reply);
          reply = await mirrorEphemeralProviderImageUrlsInMarkdown(reply);
          reply = await enrichReplyWithLastSessionToolImage(reply, sidRetry);
          reply = await mirrorRemoteImagesAndRepairApiRefs(
            reply,
            sidRetry,
            projBound?.slug ?? null
          );
        }
        if (data?.usage && typeof data.usage.total_tokens === "number") {
          const u = data.usage;
          const costUsdNative =
            typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : undefined;
          const promptCost =
            typeof u.prompt_cost === "number" && Number.isFinite(u.prompt_cost)
              ? u.prompt_cost
              : undefined;
          const completionCost =
            typeof u.completion_cost === "number" && Number.isFinite(u.completion_cost)
              ? u.completion_cost
              : undefined;
          const hic = normalizeHermesInferenceChain(
            (u as { hermes_inference_chain?: unknown }).hermes_inference_chain
          );
          usageFromApi = {
            prompt_tokens: u.prompt_tokens ?? 0,
            completion_tokens: u.completion_tokens ?? 0,
            total_tokens: u.total_tokens ?? 0,
            ...(costUsdNative !== undefined ? { cost: costUsdNative } : {}),
            ...(promptCost !== undefined ? { prompt_cost: promptCost } : {}),
            ...(completionCost !== undefined ? { completion_cost: completionCost } : {}),
            ...(hic ? { hermes_inference_chain: hic } : {}),
          };
        }
        if (typeof data?.model === "string" && data.model.trim()) {
          const m = data.model.trim();
          responseModel = m;
          modelFromStreamRetry = m;
        }
      }

      reply = friendlyGatewayFailureReply(reply);
      let replyAfterValidator = reply;
      let validatorModelForMsg: string | null = null;
      let validatorPassSucceeded = false;
      const validatorModelCfg =
        getValidatorEnabled() ? getValidatorChatModel() : null;
      if (validatorModelCfg) {
        const { run, reasons } = shouldValidatePass1({
          lastUserPlain: textContent,
          reply,
          sawToolProgress: streamResult.sawToolProgress,
          sessionKey,
          samplePercent: getValidatorSamplePercent(),
          minReplyCharsAfterTools: getValidatorMinReplyCharsAfterTools(),
        });
        if (run) {
          try {
            const vUser = buildValidatorUserPayload(
              reasons,
              textContent,
              replyAfterValidator
            );
            const vRes = await fetch(`${completionBase}/v1/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${completionToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: validatorModelCfg,
                messages: [
                  { role: "system", content: VALIDATOR_SYSTEM_PROMPT },
                  { role: "user", content: vUser },
                ],
                stream: false,
              }),
              signal: runAbort.signal,
            });
            if (vRes.ok) {
              validatorPassSucceeded = true;
              const vData = (await vRes.json().catch(() => null)) as {
                choices?: { message?: { content?: string } }[];
                model?: string;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  total_tokens?: number;
                  cost?: number;
                  prompt_cost?: number;
                  completion_cost?: number;
                };
              } | null;
              const vc = vData?.choices?.[0]?.message?.content;
              if (typeof vc === "string" && vc.trim()) {
                const parsed = parseValidatorResponse(vc, replyAfterValidator);
                if (!parsed.approved && parsed.text.trim()) {
                  replyAfterValidator = parsed.text;
                  validatorModelForMsg = validatorModelCfg;
                  if (typeof vData?.model === "string" && vData.model.trim()) {
                    responseModel = vData.model.trim();
                  }
                }
                if (vData?.usage && typeof vData.usage.total_tokens === "number") {
                  const u = vData.usage;
                  const costUsdNative =
                    typeof u.cost === "number" && Number.isFinite(u.cost)
                      ? u.cost
                      : undefined;
                  const promptCost =
                    typeof u.prompt_cost === "number" &&
                    Number.isFinite(u.prompt_cost)
                      ? u.prompt_cost
                      : undefined;
                  const completionCost =
                    typeof u.completion_cost === "number" &&
                    Number.isFinite(u.completion_cost)
                      ? u.completion_cost
                      : undefined;
                  const chunk: HermesChunkUsage = {
                    prompt_tokens: u.prompt_tokens ?? 0,
                    completion_tokens: u.completion_tokens ?? 0,
                    total_tokens: u.total_tokens ?? 0,
                    ...(costUsdNative !== undefined ? { cost: costUsdNative } : {}),
                    ...(promptCost !== undefined ? { prompt_cost: promptCost } : {}),
                    ...(completionCost !== undefined
                      ? { completion_cost: completionCost }
                      : {}),
                  };
                  usageFromApi = accumulateHermesChunkUsage(usageFromApi, chunk);
                }
              }
              console.info("[chat/send] validator pass2", {
                reasons,
                revised: Boolean(validatorModelForMsg),
              });
            } else {
              const errT = await vRes.text().catch(() => "");
              console.warn(
                "[chat/send] validator pass2 http",
                vRes.status,
                errT.slice(0, 200)
              );
            }
          } catch (vErr: unknown) {
            console.error("[chat/send] validator pass2:", vErr);
          }
        }
      }
      reply = replyAfterValidator;

      const displayModel = await resolveAssistantDisplayModel({
        responseModel,
        requestModelId: validatorModelForMsg ?? streamModelId,
      });

      const modelProviderRaw = await readHermesModelProviderFromConfig();
      const providerLc = (modelProviderRaw ?? "").trim().toLowerCase();
      /** Stack default is OpenRouter; only explicit `model.provider: nous` gets the Nous footer label. */
      const billingViaOpenRouter = providerLc !== "nous";

      const hadTotalCostUsd =
        !!usageFromApi &&
        typeof usageFromApi.cost === "number" &&
        Number.isFinite(usageFromApi.cost);

      const hadSplitCostUsd =
        !!usageFromApi &&
        ((typeof usageFromApi.prompt_cost === "number" &&
          Number.isFinite(usageFromApi.prompt_cost)) ||
          (typeof usageFromApi.completion_cost === "number" &&
            Number.isFinite(usageFromApi.completion_cost)));

      /** Main completion USD only when gateway reports `usage.cost` (no token-catalog estimates). */
      let costUsd: number | null = null;
      if (usageFromApi && hadTotalCostUsd) {
        costUsd = usageFromApi.cost!;
      }

      let promptCostUsd: number | null = null;
      let completionCostUsd: number | null = null;
      if (usageFromApi) {
        if (
          typeof usageFromApi.prompt_cost === "number" &&
          Number.isFinite(usageFromApi.prompt_cost)
        ) {
          promptCostUsd = usageFromApi.prompt_cost;
        }
        if (
          typeof usageFromApi.completion_cost === "number" &&
          Number.isFinite(usageFromApi.completion_cost)
        ) {
          completionCostUsd = usageFromApi.completion_cost;
        }
      }

      let toolCostUsd: number | null = null;
      if (toolCostsUsdFromStream > 0) {
        toolCostUsd = toolCostsUsdFromStream;
      }

      let costBasis: ChatCostBasis | undefined;
      if (hadTotalCostUsd || hadSplitCostUsd) costBasis = "reported";
      else if (typeof toolCostUsd === "number" && toolCostUsd > 0) {
        costBasis = "reported";
      }

      let costSource: ChatCostSource = billingViaOpenRouter ? "openrouter" : "nous";

      if (
        billingViaOpenRouter &&
        usageFromApi &&
        typeof usageFromApi.total_tokens === "number" &&
        usageFromApi.total_tokens > 0 &&
        !hadTotalCostUsd &&
        !hadSplitCostUsd
      ) {
        const catalogModel =
          displayModel?.trim() ||
          (await readEffectiveHermesMainModelId())?.trim() ||
          null;
        if (catalogModel) {
          const split = await estimateOpenRouterUsdCostSplit(catalogModel, usageFromApi);
          if (split) {
            promptCostUsd = split.promptUsd;
            completionCostUsd = split.completionUsd;
            costUsd = split.totalUsd;
            costBasis = "estimated";
            costSource = "openrouter";
          } else {
            /** Catalog miss or pricing unavailable — still persist $0 so footer shows model + cost line. */
            costUsd = 0;
            costBasis = "estimated";
            costSource = "openrouter";
          }
        }
      }

      const modelIdRaw =
        (typeof responseModel === "string" && responseModel.trim()
          ? responseModel.trim()
          : null) || streamModelId;

      const modelsUsed: string[] = [];
      const pushModelId = (s: string | null | undefined) => {
        const t = (s ?? "").trim();
        if (!t || isHermesGatewayModelLabel(t)) return;
        if (!modelsUsed.includes(t)) modelsUsed.push(t);
      };
      pushModelId(streamModelId);
      for (const m of streamResult.modelsTouched) pushModelId(m);
      if (modelFromStreamRetry) pushModelId(modelFromStreamRetry);
      if (validatorModelForMsg) pushModelId(validatorModelForMsg);
      if (validatorPassSucceeded && validatorModelCfg)
        pushModelId(validatorModelCfg);

      const inferenceBreakdown = buildInferenceBreakdown({
        displayModel,
        validatorModel: validatorModelForMsg,
        toolModels: modelsUsed,
        hermesInferenceChain: usageFromApi?.hermes_inference_chain ?? null,
      });

      try {
        await appendAssistantReply(chatSessionId, sessionKey, mergedTranscript, reply, {
          model: displayModel,
          modelIdRaw,
          costUsd,
          promptCostUsd,
          completionCostUsd,
          toolCostUsd,
          costSource,
          costBasis,
          usageTokens: usageFromApi,
          validatorModel: validatorModelForMsg,
          toolModels: modelsUsed.length > 0 ? modelsUsed : undefined,
          inferenceBreakdown,
          hermesGatewaySessionId: gatewaySessionIdForPersist,
        });
        /** The notification says the reply is ready, so the session API must not still report replyInFlight. */
        await unlink(sFile).catch(() => {});
        await sendChatPush(chatSessionId, reply, "reply");
      } catch (persistErr: unknown) {
        hadError = true;
        console.error("[chat/send] appendAssistantReply:", persistErr);
        const hint =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        await writeStatusFile(sFile, null, "", {
          error: `Could not save the assistant reply (${hint.slice(0, 200)}). Check HERMES_CHAT_DATA_DIR permissions and disk space.`,
          ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
        });
        return;
      }

      if (isFirstMessage) {
        const userText =
          textContent || (imageFilePaths.length > 0 ? "Image chat" : "");
        const draftFallback = ingestAuto
          ? draftTitleFromIngestMessage(textContent)
          : draftTitleFromUserInput(userText);
        if (userText && reply) {
          try {
            await generateAndPatchTitle(
              baseUrl,
              token,
              userText,
              reply,
              sessionKey,
              draftFallback
            );
          } catch (titleErr) {
            console.error("[chat/send] generateAndPatchTitle:", titleErr);
          }
        }
      }

      if (creativeStudioMeta?.kanbanBoardSlug) {
        try {
          await finalizeCreateKanbanForSession({
            sessionKey,
            expectedBoardSlug: creativeStudioMeta.kanbanBoardSlug,
          });
        } catch (kanbanCleanupErr) {
          console.warn("[chat/send] finalize create kanban:", kanbanCleanupErr);
        }
      }
      };

      if (useSharedArchitectExclusive) {
        await withSharedIngestExclusive(runArchitectIngestCompletion);
      } else {
        await runArchitectIngestCompletion();
      }
    } catch (fetchErr: unknown) {
      const isAbort =
        fetchErr instanceof Error && fetchErr.name === "AbortError";
      if (isAbort) {
        const wasUser = consumeUserStop(sessionKey);
        if (wasUser) {
          console.log("[chat/send] aborted by user");
          await writeStatusFile(sFile, null, "", {
            stopped: true,
            ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
          });
        } else {
          hadError = true;
          const userMsg =
            completionTimeoutMs != null
              ? "Sorry, the request took too long and timed out. This can happen with large images or complex tasks. Please try again."
              : "Sorry, something went wrong while processing your request. Please try again.";
          console.error(
            "[chat/send] fetch error:",
            completionTimeoutMs != null ? "timeout" : fetchErr
          );
          await writeStatusFile(sFile, null, "", {
            error: userMsg,
            ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
          });
          await sendChatPush(chatSessionId, userMsg, "error-fetch", { error: true });
        }
      } else {
        hadError = true;
        const userMsg =
          "Sorry, something went wrong while processing your request. Please try again.";
        console.error("[chat/send] fetch error:", fetchErr);
        await writeStatusFile(sFile, null, "", {
          error: userMsg,
          ...(useSharedArchitectExclusive ? { ingestViaArchitect: true } : {}),
        });
        await sendChatPush(chatSessionId, userMsg, "error-fetch", { error: true });
      }
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      unregisterChatSendAbort(sessionKey);
    }
  } catch (err: unknown) {
    hadError = true;
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[chat/send] process error:", err);
    const errMsg = `Sorry, something went wrong: ${detail.slice(0, 280)}`;
    await writeStatusFile(statusFilePath(sessionKey), null, "", { error: errMsg });
    await sendChatPush(chatSessionId, errMsg, "error-after", { error: true });
  } finally {
    if (hadError) {
      /** Short delay so GET /api/sessions/[id] can read serverError from the file at least once; sidebar no longer treats error files as processing. */
      setTimeout(() => unlink(sFile).catch(() => {}), 2000);
    } else {
      await new Promise((r) => setTimeout(r, 800));
      await unlink(sFile).catch(() => {});
    }
  }
}

export async function POST(req: Request) {
  const base = getHermesBaseUrl();
  const token = getHermesToken();
  if (!base || !token) {
    return Response.json(
      { error: "Server misconfiguration: set HERMES_URL and HERMES_TOKEN" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const {
    messages,
    sessionKey,
    chatSessionId: explicitChatId,
    isFirstMessage,
    ingestModelOverride: rawIngestOverride,
    oneOffModelId: rawOneOff,
  } = body as {
    messages?: unknown[] | null;
    sessionKey?: string;
    chatSessionId?: string;
    isFirstMessage?: boolean;
    ingestModelOverride?: unknown;
    oneOffModelId?: unknown;
  };
  const oneOffModelId =
    typeof rawOneOff === "string" && rawOneOff.trim().length > 0
      ? rawOneOff.trim().slice(0, 512)
      : undefined;

  if (!messages?.length || !sessionKey) {
    return Response.json(
      { error: "messages and sessionKey required" },
      { status: 400 }
    );
  }

  const chatMessages = messages as ChatMessage[];
  const baseUrl = base.replace(/\/$/, "");
  const chatSessionId = explicitChatId || sessionKey.replace(/^.*webchat:/, "");
  const lastUserMessage = chatMessages[chatMessages.length - 1];
  const lastPlain = userMessagePlainTextForRouting(lastUserMessage);
  const ingestEnv = getIngestChatModel();
  const clientIngest = normalizeIngestModelOverride(rawIngestOverride);
  const isIngest = isIngestInstruction(lastPlain);
  /** Server `INGEST_CHAT_MODEL` wins over client Settings/wiki model so Docker env is authoritative. */
  const modelId = isIngest
    ? ingestEnv ?? clientIngest ?? getChatModel()
    : getChatModel();

  if (process.env.NODE_ENV !== "production" && isIngest) {
    const source = ingestEnv
      ? "INGEST_CHAT_MODEL"
      : clientIngest
        ? "client"
        : "CHAT_MODEL/default";
    console.info("[chat/send] ingest model", { modelId, source });
  }

  const firstTurnGuardKey = Boolean(isFirstMessage) ? sessionKey : "";
  if (firstTurnGuardKey) {
    if (firstTurnSendInFlight.has(firstTurnGuardKey)) {
      return Response.json({ status: "accepted", duplicate: true }, { status: 202 });
    }
    firstTurnSendInFlight.add(firstTurnGuardKey);
  }

  /** Run in background so the client can poll GET /api/sessions/[id] while Hermes streams. */
  void processChatSend({
    sessionKey,
    chatMessages,
    lastUserMessage,
    chatSessionId,
    isFirstMessage: Boolean(isFirstMessage),
    baseUrl,
    modelId,
    oneOffModelId: oneOffModelId ?? null,
    token,
  })
    .catch((err: unknown) => {
      console.error("[chat/send] unhandled processChatSend rejection:", err);
      const detail = err instanceof Error ? err.message : String(err);
      void writeStatusFile(statusFilePath(sessionKey), null, "", {
        error: `Sorry, something went wrong: ${detail.slice(0, 280)}`,
      });
    })
    .finally(() => {
      if (firstTurnGuardKey) firstTurnSendInFlight.delete(firstTurnGuardKey);
    });

  return Response.json({ status: "accepted" }, { status: 202 });
}
