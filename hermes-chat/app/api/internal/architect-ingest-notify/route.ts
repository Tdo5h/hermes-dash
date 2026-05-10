import { NextResponse } from "next/server";
import { getHermesChatArchitectNotifyToken } from "@/lib/hermes-config";
import { sendPushToSubset } from "@/lib/push";

function authorizeArchitectNotify(req: Request): boolean {
  const t = getHermesChatArchitectNotifyToken();
  if (!t) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${t}`;
}

/**
 * Optional callback when an external worker completes shared ingest
 * and cannot rely on the Chat server awaiting the completion stream.
 */
export async function POST(req: Request) {
  if (!authorizeArchitectNotify(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const b = body as {
    title?: unknown;
    body?: unknown;
    url?: unknown;
    tag?: unknown;
    kind?: unknown;
    subscriptionEndpoint?: unknown;
  };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (!title || !text) {
    return NextResponse.json({ error: "title and body required" }, { status: 400 });
  }
  const url = typeof b.url === "string" && b.url.trim() ? b.url.trim() : undefined;
  const tag = typeof b.tag === "string" && b.tag.trim() ? b.tag.trim() : undefined;
  const kind =
    b.kind === "chat" ||
    b.kind === "vault" ||
    b.kind === "create" ||
    b.kind === "cron" ||
    b.kind === "system"
      ? b.kind
      : undefined;
  const ep =
    typeof b.subscriptionEndpoint === "string" && b.subscriptionEndpoint.trim()
      ? b.subscriptionEndpoint.trim()
      : null;

  const result = await sendPushToSubset(
    { title, body: text, ...(url ? { url } : {}), ...(tag ? { tag } : {}), ...(kind ? { kind } : {}) },
    ep ? [ep] : null
  );
  return NextResponse.json({ ok: true, ...result });
}
