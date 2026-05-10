"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelRolesPayload } from "@/lib/hermes-model-roles";
import { OpenRouterCreditsLine } from "@/components/OpenRouterCreditsLine";
import {
  HERMES_MODEL_ROUTING_FORM_ID,
  ModelRoutingSettings,
} from "@/components/ModelRoutingSettings";
import { coercePresetId } from "@/lib/or-model-ids";
import { planDisplayLabelForTier } from "@/lib/or-plan-compare";

export default function ModelRolesPage() {
  const [data, setData] = useState<ModelRolesPayload | null>(null);
  const [activePlanLine, setActivePlanLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hermes/stack", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return null;
        try {
          return (await r.json()) as {
            presets?: {
              active?: string;
              presets?: Record<string, { label?: string; mainModel?: string }>;
            };
          };
        } catch {
          return null;
        }
      })
      .then((j) => {
        if (cancelled) return;
        if (!j) {
          setActivePlanLine("Active plan: unavailable");
          return;
        }
        const bundles = j.presets?.presets;
        if (!j.presets || !bundles) {
          setActivePlanLine("Active plan: unavailable");
          return;
        }
        const pre = j.presets;
        const t = coercePresetId(pre.active);
        if (!t) {
          setActivePlanLine("Active plan: unknown (check stack)");
          return;
        }
        const name = planDisplayLabelForTier(t, { presets: bundles });
        const main = (bundles[t]?.mainModel ?? "").trim() || "—";
        setActivePlanLine(`Active plan: ${name} — ${main}`);
      })
      .catch(() => {
        if (!cancelled) setActivePlanLine("Active plan: unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hermes/model-roles", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          return {
            ok: false as const,
            detail: "config_read_failed" as const,
            message: text ? `${r.status} ${text.slice(0, 200)}` : `HTTP ${r.status}`,
          };
        }
        try {
          return (await r.json()) as ModelRolesPayload;
        } catch (e) {
          return {
            ok: false as const,
            detail: "config_parse_failed" as const,
            message: e instanceof Error ? e.message : String(e),
          };
        }
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setData({
            ok: false,
            detail: "config_read_failed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="main-chat-depth flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--sidebar-depth-canvas)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] px-3 py-2">
        <Link
          href="/chat"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          aria-label="Back to chat"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-medium tracking-tight">Models &amp; API</h1>
	          <p
	            className="text-[10px] leading-snug text-muted-foreground [overflow-wrap:break-word]"
	            data-hermes-tip={activePlanLine ?? undefined}
	          >
            {activePlanLine === null
              ? "Loading active plan…"
              : activePlanLine}
          </p>
          <OpenRouterCreditsLine className="mt-1" />
        </div>
        {data?.ok ? (
          <button
            type="submit"
            form={HERMES_MODEL_ROUTING_FORM_ID}
            className="shrink-0 rounded-lg border border-sidebar-primary/50 bg-sidebar-primary/15 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-sidebar-primary/25"
          >
            Save &amp; apply
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {data === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !data.ok ? (
          <p className="text-xs leading-snug text-muted-foreground">
            {data.detail === "no_hermes_data_dir"
              ? "This page needs the Hermes data directory configured on the server."
              : data.detail === "config_parse_failed"
                ? `Could not read config${data.message ? `: ${data.message}` : ""}.`
                : `Could not load settings${data.message ? `: ${data.message}` : ""}.`}
          </p>
        ) : (
          <ModelRoutingSettings roles={data} />
        )}
      </div>
    </div>
  );
}
