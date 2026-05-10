"use client";

const KEY_DISMISSED = "oc-push-dismissed";
const KEY_HAD_SUBSCRIPTION = "oc-push-had-subscription";
const SESSION_REENABLE_SNOOZE = "oc-push-reenable-snooze";

export type PushClientStatus =
  | "unsupported"
  | "blocked"
  | "prompt"
  | "disabled"
  | "enabled";

function vapidKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function pushClientSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined" &&
    Boolean(vapidKey())
  );
}

export async function getPushClientStatus(): Promise<PushClientStatus> {
  if (!pushClientSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "enabled";
  return Notification.permission === "default" ? "prompt" : "disabled";
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      clientId: getPushClientId(),
    }),
  });
}

export function getPushClientId(): string {
  const key = "oc-push-client-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return "client-unknown";
  }
}

export async function getCurrentPushSubscriptionEndpoint(): Promise<string | null> {
  if (!pushClientSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint || null;
}

export async function ensurePushSubscription(): Promise<PushSubscription> {
  if (!pushClientSupported()) {
    throw new Error("Push notifications are not available on this device.");
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") {
    throw new Error("Notifications are not enabled for this browser.");
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await postSubscription(existing);
    markPushSubscribed();
    return existing;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey()),
  });
  await postSubscription(sub);
  markPushSubscribed();
  return sub;
}

export async function unsubscribePushNotifications(): Promise<void> {
  if (!pushClientSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = sub?.endpoint || "";
  if (sub) await sub.unsubscribe();
  if (endpoint) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  }
  try {
    localStorage.setItem(KEY_HAD_SUBSCRIPTION, "0");
    sessionStorage.removeItem(SESSION_REENABLE_SNOOZE);
  } catch {
    /* ignore */
  }
}

export function markPushSubscribed(): void {
  try {
    localStorage.setItem(KEY_HAD_SUBSCRIPTION, "1");
    localStorage.setItem(KEY_DISMISSED, "1");
    sessionStorage.removeItem(SESSION_REENABLE_SNOOZE);
  } catch {
    /* ignore */
  }
}

export function pushPromptStorageKeys() {
  return {
    dismissed: KEY_DISMISSED,
    hadSubscription: KEY_HAD_SUBSCRIPTION,
    reenableSnooze: SESSION_REENABLE_SNOOZE,
  } as const;
}
