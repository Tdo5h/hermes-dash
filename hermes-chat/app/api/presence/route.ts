import { NextResponse } from "next/server";
import { upsertPushPresence } from "@/lib/push-presence";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clientId =
      typeof body?.clientId === "string" && body.clientId.trim()
        ? body.clientId.trim()
        : "";
    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }
    upsertPushPresence({
      clientId,
      path: typeof body.path === "string" ? body.path : "/chat",
      visibilityState:
        typeof body.visibilityState === "string" ? body.visibilityState : "unknown",
      focused: body.focused === true,
      subscriptionEndpoint:
        typeof body.subscriptionEndpoint === "string"
          ? body.subscriptionEndpoint
          : null,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
