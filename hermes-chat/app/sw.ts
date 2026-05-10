/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, Serwist, NetworkFirst, NetworkOnly } from "serwist";

declare const self: ServiceWorkerGlobalScope & SerwistGlobalConfig & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

/**
 * PWA cache policy:
 * - API responses are never served from the service worker cache. Chat, vault,
 *   ingest, creation, archive, skill, and notification state must be live.
 * - Static Next chunks still get an offline fallback, but prefer network so a
 *   new deploy replaces old UI promptly.
 */
const runtimeCaching = [
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    method: "GET" as const,
    handler: new NetworkOnly({ networkTimeoutSeconds: 12 }),
  },
  ...defaultCache
    .filter((entry) => {
      const matcherSource = String(entry.matcher);
      return !(
        (entry.matcher instanceof RegExp &&
          entry.matcher.source.includes("\\/api\\/")) ||
        matcherSource.includes("/api/") ||
        matcherSource.includes('startsWith("/api') ||
        matcherSource.includes("startsWith('/api")
      );
    })
    .map((entry) => {
      if (
        entry.matcher instanceof RegExp &&
        entry.matcher.source.includes("_next\\/static")
      ) {
        return {
          ...entry,
          handler: new NetworkFirst({
            cacheName: "next-static-js-assets",
            networkTimeoutSeconds: 4,
            plugins: [
              new ExpirationPlugin({
                maxEntries: 64,
                maxAgeSeconds: 24 * 60 * 60,
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        };
      }
      return entry;
    }),
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

/** Must match string in app/chat/layout.tsx (push notification deep link). */
const HERMES_PUSH_NAV_TYPE = "HERMES_PUSH_NAV";

/**
 * Wake open tabs when a push arrives (e.g. cron → /api/push/send) so the sidebar and
 * transcript refetch without requiring a manual refresh. Must match layout.tsx.
 */
const HERMES_PUSH_SYNC_TYPE = "HERMES_PUSH_SYNC";

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    self.caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.includes("apis"))
          .map((key) => self.caches.delete(key))
      )
    )
  );
});

type HermesPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  kind?: "chat" | "vault" | "create" | "cron" | "system";
  requireInteraction?: boolean;
};

function normalizePushPayload(raw: unknown): Required<Pick<HermesPushPayload, "title" | "body" | "url">> &
  Omit<HermesPushPayload, "title" | "body" | "url"> {
  const fallback = { title: "Hermes", body: "New update", url: "/chat" };
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : fallback.title,
    body: typeof obj.body === "string" && obj.body.trim() ? obj.body.trim() : fallback.body,
    url: typeof obj.url === "string" && obj.url.trim() ? obj.url.trim() : fallback.url,
    tag: typeof obj.tag === "string" && obj.tag.trim() ? obj.tag.trim() : undefined,
    kind:
      obj.kind === "chat" ||
      obj.kind === "vault" ||
      obj.kind === "create" ||
      obj.kind === "cron" ||
      obj.kind === "system"
        ? obj.kind
        : undefined,
    requireInteraction: obj.requireInteraction === true,
  };
}

function samePath(clientUrl: string, pathWithQuery: string): boolean {
  try {
    const u = new URL(clientUrl);
    return `${u.pathname}${u.search}${u.hash}` === pathWithQuery;
  } catch {
    return false;
  }
}

function pushTarget(raw: string): { absolute: string; pathWithQuery: string } {
  try {
    const u = new URL(raw, self.location.origin);
    if (!u.searchParams.has("fromPush")) u.searchParams.set("fromPush", "1");
    if (!u.searchParams.has("pushId")) {
      u.searchParams.set("pushId", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    const absolute = u.href;
    return { absolute, pathWithQuery: `${u.pathname}${u.search}${u.hash}` };
  } catch {
    const u = new URL("/chat", self.location.origin);
    u.searchParams.set("fromPush", "1");
    u.searchParams.set("pushId", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return { absolute: u.href, pathWithQuery: `${u.pathname}${u.search}${u.hash}` };
  }
}

self.addEventListener("push", (event: PushEvent) => {
  let payload = normalizePushPayload(null);
  try {
    if (event.data) payload = normalizePushPayload(event.data.json());
  } catch {
    if (event.data) payload = normalizePushPayload({ body: event.data.text() });
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          try {
            (client as WindowClient).postMessage({
              type: HERMES_PUSH_SYNC_TYPE,
              url: payload.url || "/chat",
              title: payload.title,
            });
          } catch {
            /* ignore */
          }
        }

        const anyVisible = clients.some(
          (c) => (c as WindowClient).visibilityState === "visible"
        );
        if (anyVisible) return;

        const options: NotificationOptions & {
          renotify?: boolean;
          timestamp?: number;
        } = {
          body: payload.body,
          icon: "/icon-192x192.png",
          badge: "/icon-192x192.png",
          tag: payload.tag || `hermes-${payload.kind || "update"}`,
          renotify: true,
          timestamp: Date.now(),
          requireInteraction: payload.requireInteraction === true,
          data: { url: payload.url || "/chat" },
        };
        return self.registration.showNotification(payload.title, options);
      })
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const raw = (event.notification.data?.url as string) || "/chat";
  const { absolute, pathWithQuery } = pushTarget(raw);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const origin = self.location.origin;
        const sameOrigin = windowClients.filter((client) => {
          try {
            return new URL(client.url).origin === origin;
          } catch {
            return false;
          }
        }) as WindowClient[];
        const exact = sameOrigin.find((client) => samePath(client.url, pathWithQuery));
        if (exact) {
          return exact.focus().then((wc) => {
            wc.postMessage({ type: HERMES_PUSH_NAV_TYPE, path: pathWithQuery });
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                try {
                  wc.postMessage({ type: HERMES_PUSH_NAV_TYPE, path: pathWithQuery });
                } catch {
                  /* ignore */
                }
                resolve();
              }, 250);
            });
          });
        }
        /**
         * iOS Home Screen apps can focus an existing PWA without delivering postMessage.
         * Prefer opening the exact target URL when it is not already mounted; the URL then
         * becomes the durable route handoff and the React app can refresh on mount.
         */
        return self.clients.openWindow(absolute).then((client) => {
          if (client) {
            try {
              client.postMessage({ type: HERMES_PUSH_NAV_TYPE, path: pathWithQuery });
            } catch {
              /* ignore */
            }
            return;
          }
          const visible = sameOrigin.find((c) => c.visibilityState === "visible");
          const fallback = visible ?? sameOrigin[0];
          if (!fallback) return;
          return fallback.focus().then((wc) => {
            wc.postMessage({ type: HERMES_PUSH_NAV_TYPE, path: pathWithQuery });
          });
        });
      })
  );
});
