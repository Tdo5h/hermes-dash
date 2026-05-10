"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Orb } from "@/components/ui/orb";

export default function WorkspaceEntryPage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      router.replace("/chat");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/projects/${encodeURIComponent(slug)}`,
          { cache: "no-store" }
        );
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) {
            setError(d.error || "Vault not available");
            setTimeout(() => router.replace("/chat"), 2800);
          }
          return;
        }
        if (cancelled) return;
        router.replace(
          `/chat/workspace/${encodeURIComponent(slug)}/draft`
        );
      } catch {
        if (!cancelled) {
          setError("Could not open vault");
          setTimeout(() => router.replace("/chat"), 2800);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  return (
    <div className="flex h-full min-h-[50dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      {!error ? (
        <div className="size-20 shrink-0">
          <Orb
            agentState="thinking"
            colors={["#a3c4f3", "#6b8cce"]}
            className="size-full"
          />
        </div>
      ) : null}
      <div className="max-w-sm text-sm leading-snug text-muted-foreground">
        {error ? (
          <>
            <p className="font-medium text-destructive/90">{error}</p>
            <p className="mt-2 text-xs">Redirecting to chats…</p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">Opening vault</p>
            <p className="mt-1 text-xs">
              Preparing your vault chat
              {slug ? ` (${slug})` : ""}…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
