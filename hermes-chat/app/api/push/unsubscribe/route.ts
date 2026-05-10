import { NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const endpoint =
      typeof body?.endpoint === "string" && body.endpoint.trim()
        ? body.endpoint.trim()
        : "";
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    }

    await removeSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
