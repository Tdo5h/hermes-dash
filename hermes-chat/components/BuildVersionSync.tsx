"use client";

import { useEffect, useRef } from "react";

const STORAGE_KEY = "oc-app-build-id";
const DEBOUNCE_MS = 1500;

async function syncBuildIdFromServer(): Promise<void> {
  const embedded = process.env.NEXT_PUBLIC_APP_BUILD_ID;
  try {
    const r = await fetch("/api/build-id", { cache: "no-store" });
    if (!r.ok) {
      syncFromEmbedded(embedded);
      return;
    }
    const data = (await r.json()) as { buildId?: string };
    const buildId = data.buildId;
    if (!buildId) {
      syncFromEmbedded(embedded);
      return;
    }
    applyBuildId(buildId);
  } catch {
    syncFromEmbedded(embedded);
  }
}

function syncFromEmbedded(embedded: string | undefined) {
  if (!embedded) return;
  applyBuildId(embedded);
}

function applyBuildId(buildId: string) {
  if (typeof window === "undefined") return;
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored === null) {
    sessionStorage.setItem(STORAGE_KEY, buildId);
    return;
  }
  if (stored !== buildId) {
    sessionStorage.setItem(STORAGE_KEY, buildId);
    const p = window.location.protocol;
    if (p === "http:" || p === "https:") {
      window.location.reload();
    }
  }
}

/**
 * After a new deploy, compares server build id with sessionStorage and hard-reloads once
 * so HTML/RSC and client bundles stay aligned (notably on iOS PWAs after long background).
 */
export function BuildVersionSync() {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void syncBuildIdFromServer();

    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void syncBuildIdFromServer();
      }, DEBOUNCE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) schedule();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return null;
}
