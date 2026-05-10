import { NextResponse } from "next/server";
import { addSubscription, type PushSubscriptionRecord } from "@/lib/push";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sub: PushSubscriptionRecord = {
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    };

    if (!sub.endpoint || !sub.keys.p256dh || !sub.keys.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    await addSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
