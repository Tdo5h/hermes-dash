import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sendPushToAll } from "@/lib/push";
import {
  loadSessionMessages,
  saveSessionMessages,
  readSessionsStore,
  writeSessionsStore,
} from "@/lib/hermes-chat-store";
import type { ChatMessage } from "@/lib/sessions";
import {
  cronSessionDisplayTitle,
  stripCronDeliveryWrapper,
} from "@/lib/cron-display-name";

function authorize(req: Request): boolean {
  const token = process.env.PUSH_WEBHOOK_TOKEN;
  if (!token) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${token}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unnamed"
  );
}

function pickString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Unwrap one level: some gateways nest the event under payload/event/data. */
function unwrapCronBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const inner = obj.payload ?? obj.event ?? obj.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return obj;
}

function isCronPayload(body: unknown): body is { message: string; name?: string; status?: string } {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.message === "string" && !obj.title;
}

/** Hermes / gateway: stable job id + body text (summary or message). */
function isHermesCronEventPayload(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  const jobId = pickString(obj, "jobId", "job_id");
  const text = pickString(obj, "summary", "message", "text");
  return jobId !== undefined && text !== undefined;
}

/**
 * Stable chat per job: `jobId` (UUID from Hermes) keys the session; `jobName` drives the sidebar title.
 */
async function appendCronMessage(params: {
  jobId: string;
  jobName?: string | null;
  message: string;
}): Promise<{
  sessionKey: string;
  sessionId: string;
  slug: string;
  displayTitle: string;
}> {
  const slug = slugify(params.jobId);
  const sessionId = `cron-${slug}`;
  const sessionKey = `webchat:cron-${slug}`;
  const now = Date.now();
  const displayTitle = cronSessionDisplayTitle(params.jobId, params.jobName);
  const stripped = stripCronDeliveryWrapper(params.message);
  // Sidebar / push already carry the job name — body is only the brief (mobile-friendly).
  const bodyText = stripped.length > 0 ? stripped : displayTitle;

  const existing = await loadSessionMessages(sessionId);
  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: bodyText,
    timestamp: now,
  };
  await saveSessionMessages(sessionId, [...existing, assistantMsg]);

  const store = await readSessionsStore();
  if (!store[sessionKey]) {
    store[sessionKey] = {
      sessionId,
      updatedAt: now,
      label: `Cron: ${displayTitle}`,
      chatType: "cron",
    };
  } else {
    const cur = (store[sessionKey] as Record<string, unknown>) || {};
    store[sessionKey] = {
      ...cur,
      sessionId,
      updatedAt: now,
      label: `Cron: ${displayTitle}`,
    };
  }
  await writeSessionsStore(store);

  return { sessionKey, sessionId, slug, displayTitle };
}

function extractPayload(body: unknown): {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: "chat" | "vault" | "create" | "cron" | "system";
} {
  if (!body || typeof body !== "object") {
    return { title: "HermesChat", body: "New notification" };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.title === "string" || typeof obj.body === "string") {
    const kind =
      obj.kind === "chat" ||
      obj.kind === "vault" ||
      obj.kind === "create" ||
      obj.kind === "cron" ||
      obj.kind === "system"
        ? obj.kind
        : undefined;
    return {
      title: (obj.title as string) || "HermesChat",
      body: (obj.body as string) || "New notification",
      url: (obj.url as string) || "/chat",
      ...(typeof obj.tag === "string" && obj.tag.trim()
        ? { tag: obj.tag.trim() }
        : {}),
      ...(kind ? { kind } : {}),
    };
  }

  if (typeof obj.message === "string") {
    const name = (obj.name as string) || "Cron Job";
    const msg = obj.message as string;
    const truncated = msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
    return {
      title: `${name}`,
      body: truncated,
      url: "/chat",
      kind: "cron",
      tag: `cron-${slugify(name)}`,
    };
  }

  const fallback = JSON.stringify(body).slice(0, 200);
  return { title: "HermesChat", body: fallback, kind: "system" };
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await req.json();
    const body = unwrapCronBody(raw);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Hermes-style first so { jobId, message } does not fall through to legacy { message }.
    if (isHermesCronEventPayload(body)) {
      const message = pickString(body, "summary", "message", "text")!;
      const jobId = pickString(body, "jobId", "job_id") || "unknown";
      const jobName = pickString(body, "name", "title", "jobName", "job_name");

      const { sessionId: cronSessionWebchatId, displayTitle, slug } =
        await appendCronMessage({ jobId, jobName, message });

      const pushBody = stripCronDeliveryWrapper(message);
      const truncated =
        pushBody.length > 200 ? pushBody.slice(0, 200) + "..." : pushBody;

      const result = await sendPushToAll({
        title: displayTitle,
        body: truncated || displayTitle,
        url: `/chat/${cronSessionWebchatId}`,
        kind: "cron",
        tag: `cron-${slug}`,
      });

      return NextResponse.json({
        ok: true,
        cronChat: cronSessionWebchatId,
        ...result,
      });
    }

    if (isCronPayload(body)) {
      const legacy = body as { message: string; name?: string; status?: string };
      const message = legacy.message;
      const jobName = legacy.name || "Cron Job";

      const { sessionId: cronSessionWebchatId, displayTitle } =
        await appendCronMessage({
          jobId: jobName,
          jobName,
          message,
        });

      const pushBody = stripCronDeliveryWrapper(message);
      const truncated =
        pushBody.length > 200 ? pushBody.slice(0, 200) + "..." : pushBody;

      const result = await sendPushToAll({
        title: displayTitle,
        body: truncated || displayTitle,
        url: `/chat/${cronSessionWebchatId}`,
        kind: "cron",
        tag: `cron-${slugify(jobName)}`,
      });

      return NextResponse.json({
        ok: true,
        cronChat: cronSessionWebchatId,
        ...result,
      });
    }

    const payload = extractPayload(body);
    const result = await sendPushToAll(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
