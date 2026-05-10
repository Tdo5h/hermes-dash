import { readFile, writeFile, unlink, stat } from "fs/promises";
import {
  loadSessionMessages,
  readSessionsStore,
  patchSessionLabel,
  resolveSessionKeyFromStore,
  getStoreEntryForWebchatId,
  saveSessionMessages,
} from "@/lib/hermes-chat-store";
import { repairSessionTranscriptApiImages } from "@/lib/markdown-api-image-repair";
import { isLikelyChatSessionId } from "@/lib/session-id";
import { statusFilePath, activeFilePath } from "@/lib/sessions";
import { isHeartbeatNoiseLabel } from "@/lib/heartbeat-noise";
import { purgeChatSessionData } from "@/lib/session-purge";
import { parseBuildEditPayload } from "@/lib/builds-manifest";
import type { BuildEditSessionPayload } from "@/lib/builds-manifest";
import {
  parseCreativeStudioPayload,
  type CreativeStudioSessionPayload,
} from "@/lib/creative-studio-session";

/**
 * Chat sends can run without an artificial timeout while a model/tool call is quiet.
 * Keep the status lock long enough for backgrounded mobile clients to resume with the
 * active orb instead of treating a long create as idle.
 */
const STATUS_FILE_STALE_MS = 30 * 60 * 1000;

function hasAssistantAfterLastUser(messages: { role?: string; content?: unknown }[]) {
  let lastUser = -1;
  let lastAssistant = -1;
  messages.forEach((m, index) => {
    if (m.role === "user") lastUser = index;
    if (m.role === "assistant") {
      const text =
        typeof m.content === "string"
          ? m.content.trim()
          : Array.isArray(m.content)
            ? JSON.stringify(m.content).trim()
            : "";
      if (text) lastAssistant = index;
    }
  });
  return lastUser >= 0 && lastAssistant > lastUser;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const clientKey = url.searchParams.get("k");

  writeFile(activeFilePath(id), String(Date.now())).catch(() => {});

  let isProcessing = false;
  let serverError: string | null = null;
  let sessionLabel: string | null = null;
  let resolvedKey: string | null = null;
  /** From status file while chat/send is streaming (activity headline + partial reply). */
  let processingStatus: string | null = null;
  /** Longer activity line for orb “auto-expand thinking” (see textDetail in status file). */
  let processingStatusDetail: string | null = null;
  let processingPartial: string | null = null;
  /** Status file marked stopped by user — consumed once on this GET. */
  let userStoppedKey: string | null = null;
  let processingStatusFile: string | null = null;

  const STOP_NOTICE = "Generation was stopped.";

  const candidateKeys = clientKey
    ? [clientKey, `webchat:${id}`]
    : [`webchat:${id}`];

  for (const candidate of candidateKeys) {
    try {
      const sFile = statusFilePath(candidate);
      const statusRaw = await readFile(sFile, "utf-8");
      const statusData = JSON.parse(statusRaw) as {
        error?: string;
        text?: string;
        textDetail?: string;
        partial?: string;
        stopped?: boolean;
      };
      if (statusData.stopped === true) {
        await unlink(sFile).catch(() => {});
        userStoppedKey = candidate;
        break;
      }
      if (statusData.error) {
        serverError = statusData.error;
      } else {
        try {
          const st = await stat(sFile);
          if (Date.now() - st.mtimeMs > STATUS_FILE_STALE_MS) {
            await unlink(sFile).catch(() => {});
            isProcessing = false;
          } else {
            isProcessing = true;
            processingStatusFile = sFile;
            const head = statusData.text?.trim();
            processingStatus = head || "Thinking";
            const d = statusData.textDetail?.trim();
            processingStatusDetail = d || null;
            const p = statusData.partial?.trim();
            processingPartial = p ? p : null;
          }
        } catch {
          isProcessing = true;
          processingStatusFile = sFile;
          const head = statusData.text?.trim();
          processingStatus = head || "Thinking";
          const d = statusData.textDetail?.trim();
          processingStatusDetail = d || null;
          const p = statusData.partial?.trim();
          processingPartial = p ? p : null;
        }
      }
      break;
    } catch {
      // try next candidate
    }
  }

  const store = await readSessionsStore();
  const { resolvedKey: rk, entry: matchedEntry } = getStoreEntryForWebchatId(
    store,
    id,
    clientKey
  );
  resolvedKey = rk;

  if (matchedEntry?.label && typeof matchedEntry.label === "string") {
    sessionLabel = matchedEntry.label;
  }

  const sessionProjectId =
    matchedEntry && typeof matchedEntry.projectId === "string"
      ? matchedEntry.projectId
      : null;
  const sessionProjectLabel =
    matchedEntry && typeof matchedEntry.projectLabel === "string"
      ? matchedEntry.projectLabel
      : null;

  const sessionChatType =
    matchedEntry && typeof (matchedEntry as { chatType?: string }).chatType === "string"
      ? String((matchedEntry as { chatType: string }).chatType).trim() || null
      : null;
  let sessionBuildEdit: BuildEditSessionPayload | null = null;
  if (sessionChatType === "build_edit" && matchedEntry) {
    sessionBuildEdit = parseBuildEditPayload(
      (matchedEntry as { buildEdit?: unknown }).buildEdit
    );
  }
  let sessionCreativeStudio: CreativeStudioSessionPayload | null = null;
  if (sessionChatType === "creative_studio" && matchedEntry) {
    sessionCreativeStudio = parseCreativeStudioPayload(
      (matchedEntry as { creativeStudio?: unknown }).creativeStudio
    );
  }

  if (isHeartbeatNoiseLabel(sessionLabel)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  let messages = await loadSessionMessages(id);
  const hermesGatewaySessionId =
    matchedEntry &&
    typeof (matchedEntry as { hermesGatewaySessionId?: unknown }).hermesGatewaySessionId ===
      "string"
      ? (matchedEntry as { hermesGatewaySessionId: string }).hermesGatewaySessionId.trim() ||
        null
      : null;
  if (hermesGatewaySessionId || sessionProjectId) {
    const repaired = await repairSessionTranscriptApiImages(
      messages,
      hermesGatewaySessionId,
      sessionProjectId
    );
    if (repaired.mutated) {
      await saveSessionMessages(id, repaired.messages);
      messages = repaired.messages;
    }
  }

  if (isProcessing && hasAssistantAfterLastUser(messages)) {
    isProcessing = false;
    processingStatus = null;
    processingStatusDetail = null;
    processingPartial = null;
    if (processingStatusFile) await unlink(processingStatusFile).catch(() => {});
  }

  if (userStoppedKey) {
    return Response.json({
      messages,
      status: null,
      partial: null,
      label: sessionLabel,
      resolvedKey,
      sessionBanner: { kind: "stopped", message: STOP_NOTICE },
      sessionNotice: STOP_NOTICE,
      awaitingReply: false,
      replyInFlight: false,
      assistantUsedTools: false,
      projectId: sessionProjectId,
      projectLabel: sessionProjectLabel,
      chatType: sessionChatType,
      buildEdit: sessionBuildEdit,
      creativeStudio: sessionCreativeStudio,
    });
  }

  if (serverError) {
    return Response.json({
      messages,
      status: null,
      partial: null,
      label: sessionLabel,
      resolvedKey,
      serverError,
      awaitingReply: false,
      replyInFlight: false,
      assistantUsedTools: false,
      projectId: sessionProjectId,
      projectLabel: sessionProjectLabel,
      chatType: sessionChatType,
      buildEdit: sessionBuildEdit,
      creativeStudio: sessionCreativeStudio,
    });
  }

  if (isProcessing) {
    return Response.json({
      messages,
      status: processingStatus ?? "Thinking",
      statusDetail: processingStatusDetail,
      partial: processingPartial,
      label: sessionLabel,
      resolvedKey,
      awaitingReply: true,
      replyInFlight: true,
      assistantUsedTools: false,
      projectId: sessionProjectId,
      projectLabel: sessionProjectLabel,
      chatType: sessionChatType,
      buildEdit: sessionBuildEdit,
      creativeStudio: sessionCreativeStudio,
    });
  }

  if (!resolvedKey && messages.length === 0) {
    /** New chat: client navigated to /chat/[uuid] before first send — no row in sessions store yet. */
    if (isLikelyChatSessionId(id)) {
      const provisionalKey = `webchat:${id}`;
      return Response.json({
        messages: [],
        status: null,
        partial: null,
        label: null,
        resolvedKey: provisionalKey,
        awaitingReply: false,
        replyInFlight: false,
        assistantUsedTools: false,
        projectId: null,
        projectLabel: null,
        chatType: null,
        buildEdit: null,
        creativeStudio: null,
      });
    }
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({
    messages,
    status: null,
    partial: null,
    label: sessionLabel,
    resolvedKey,
    awaitingReply: false,
    replyInFlight: false,
    assistantUsedTools: false,
    projectId: sessionProjectId,
    projectLabel: sessionProjectLabel,
    chatType: sessionChatType,
    buildEdit: sessionBuildEdit,
    creativeStudio: sessionCreativeStudio,
  });
}

function normalizeChatLabel(raw: string, maxLen = 120): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (cleaned.length <= maxLen) return cleaned;
  const clipped = cleaned.slice(0, maxLen);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 12 ? clipped.slice(0, lastSpace) : clipped).trim();
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { label?: unknown; sessionKey?: unknown };
  try {
    body = (await req.json()) as { label?: unknown; sessionKey?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawLabel = typeof body.label === "string" ? body.label : "";
  const sessionKeyRaw =
    typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";
  const label = normalizeChatLabel(rawLabel);
  if (!label) {
    return Response.json({ error: "label required" }, { status: 400 });
  }
  if (!sessionKeyRaw) {
    return Response.json({ error: "sessionKey required" }, { status: 400 });
  }

  const store = await readSessionsStore();
  const resolvedKey = resolveSessionKeyFromStore(store, id, sessionKeyRaw);
  if (!resolvedKey || !store[resolvedKey]) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  const entry = store[resolvedKey] as { sessionId?: string };
  const sid =
    typeof entry.sessionId === "string" ? entry.sessionId.trim() : "";
  if (sid && sid !== id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await patchSessionLabel(resolvedKey, label, id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not save label";
    return Response.json({ error: msg }, { status: 500 });
  }

  return Response.json({ ok: true, label });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { sessionKey?: unknown };
  try {
    body = (await req.json()) as { sessionKey?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sessionKeyRaw =
    typeof body.sessionKey === "string" ? body.sessionKey.trim() : "";
  if (!sessionKeyRaw) {
    return Response.json({ error: "sessionKey required" }, { status: 400 });
  }

  const store = await readSessionsStore();
  const resolvedKey = resolveSessionKeyFromStore(store, id, sessionKeyRaw);
  if (!resolvedKey || !store[resolvedKey]) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  const entry = store[resolvedKey] as { sessionId?: string };
  const sid =
    typeof entry.sessionId === "string" ? entry.sessionId.trim() : "";
  if (sid && sid !== id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await purgeChatSessionData(id, resolvedKey);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not delete";
    return Response.json({ error: msg }, { status: 500 });
  }

  return Response.json({ ok: true });
}
