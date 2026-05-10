"use client";

import { useEffect } from "react";

/**
 * When Serwist is disabled at build (e.g. loopback multi-tenant ports), strip any prior
 * registration so an old sw.js cannot keep intercepting navigations (no-response flakes).
 */
export function UnregisterSerwistIfDisabled() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISABLE_SERWIST !== "true") return;
    void (async () => {
      if (typeof navigator !== "undefined" && navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    })();
  }, []);

  return null;
}
