import webPush from "web-push";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { getHermesChatDataDir } from "@/lib/hermes-config";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  listPushSubscriptionsDb,
  addPushSubscriptionDb,
  removePushSubscriptionDb,
} from "@/lib/db/repositories";
import { hasVisibleHermesClient } from "@/lib/push-presence";

const SUBS_FILE = path.join(getHermesChatDataDir(), "push-subscriptions.json");

const vapidConfigured = Boolean(
  process.env.VAPID_SUBJECT?.trim() &&
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim()
);

/** web-push throws at import if setVapidDetails gets empty keys — breaks /api/chat/send when push is optional. */
if (vapidConfigured) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type HermesPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: "chat" | "vault" | "create" | "cron" | "system";
  requireInteraction?: boolean;
};

function readSubscriptionsFs(): PushSubscriptionRecord[] {
  if (!existsSync(SUBS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(SUBS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeSubscriptionsFs(subs: PushSubscriptionRecord[]) {
  const dir = path.dirname(SUBS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

export async function addSubscription(sub: PushSubscriptionRecord) {
  if (shouldUseChatDatabase()) {
    const subs = await listPushSubscriptionsDb();
    if (subs.some((s) => s.endpoint === sub.endpoint)) return;
    await addPushSubscriptionDb(sub);
    return;
  }
  const subs = readSubscriptionsFs();
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  subs.push(sub);
  writeSubscriptionsFs(subs);
}

export async function removeSubscription(endpoint: string) {
  if (shouldUseChatDatabase()) {
    await removePushSubscriptionDb(endpoint);
    return;
  }
  const subs = readSubscriptionsFs().filter((s) => s.endpoint !== endpoint);
  writeSubscriptionsFs(subs);
}

export async function sendPushToAll(payload: HermesPushPayload) {
  return sendPushToSubset(payload, null);
}

/**
 * When `endpoints` is non-null, only subscriptions whose `endpoint` is in the set are notified
 * (e.g. triggering browser). When null or empty filter, behaves like broadcast for this Chat DB.
 */
export async function sendPushToSubset(
  payload: HermesPushPayload,
  endpoints: string[] | null
) {
  if (!vapidConfigured) {
    return { sent: 0, failed: 0, total: 0 };
  }
  if (hasVisibleHermesClient()) {
    return { sent: 0, failed: 0, total: 0, skippedVisible: true };
  }
  let subs = shouldUseChatDatabase()
    ? await listPushSubscriptionsDb()
    : readSubscriptionsFs();
  if (endpoints != null && endpoints.length > 0) {
    const allow = new Set(endpoints);
    subs = subs.filter((s) => allow.has(s.endpoint));
  }
  if (subs.length === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }
  const message = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush.sendNotification(sub, message).catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          void removeSubscription(sub.endpoint);
        }
        throw err;
      })
    )
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  return { sent, failed, total: subs.length };
}
