"use client";

import { useEffect, useState } from "react";
import {
  type OpenRouterCreditsPayload,
  formatOpenRouterUsd,
} from "@/lib/openrouter-credits";
import { cn } from "@/lib/utils";

type Props = { className?: string };

function openRouterDetailText(d: OpenRouterCreditsPayload & { ok: false }): string {
  if (d.detail === "no_key")
    return "Set OPENROUTER_API_KEY in the stack .env (HermesChat reads it server-side).";
  if (d.detail === "forbidden")
    return "This key cannot read credits. Use a management key or set OPENROUTER_MANAGEMENT_KEY.";
  if (d.detail === "unauthorized") return "Invalid or expired OpenRouter key.";
  if (d.detail === "fetch_failed") return "Could not load credits.";
  return d.message || "Could not load credits. See OpenRouter status or key settings.";
}

/**
 * Fetches and shows: **OpenRouter credits** and remaining balance only (no purchased/used).
 */
export function OpenRouterCreditsLine({ className }: Props) {
  const [st, setSt] = useState<OpenRouterCreditsPayload | "loading" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSt("loading");
    void fetch("/api/openrouter/credits", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: OpenRouterCreditsPayload) => {
        if (!cancelled) setSt(d);
      })
      .catch(() => {
        if (!cancelled) setSt({ ok: false, detail: "fetch_failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p
      className={cn("text-[10px] leading-snug text-muted-foreground", className)}
      role="status"
    >
      <span className="font-medium text-foreground/85">OpenRouter credits</span>
      {st === null || st === "loading" ? (
        " …"
      ) : st.ok ? (
        <>
          {" "}
          —{" "}
          <span className="font-mono text-foreground/90">
            {formatOpenRouterUsd(st.remaining)}
          </span>{" "}
          remaining
        </>
      ) : (
        <> — {openRouterDetailText(st)}</>
      )}
    </p>
  );
}
