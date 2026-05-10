import { userStopChatSend } from "@/lib/chat-send-abort";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sessionKey =
    typeof body?.sessionKey === "string" ? body.sessionKey.trim() : "";
  if (!sessionKey) {
    return Response.json({ error: "sessionKey required" }, { status: 400 });
  }
  const stopped = userStopChatSend(sessionKey);
  return Response.json({ ok: true, stopped });
}
