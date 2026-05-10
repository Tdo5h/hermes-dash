"use client";

import { useEffect, useState } from "react";
import { Brain, Gauge, KeyRound, Leaf } from "lucide-react";
import { mainChatPriceVsRefLabel } from "@/lib/or-plan-compare";
import {
  coercePresetId,
  isOpenRouterProvider,
  normOrId,
  PRESET_IDS,
  type PresetId,
} from "@/lib/or-model-ids";
import { catalogRowsToUsdPer1MByNormId, orPer1mUsdString } from "@/lib/openrouter-pricing";

export type OneOffTier = PresetId;

const TIER_ICONS: Record<OneOffTier, typeof Brain> = {
  frontier: Brain,
  balanced: Gauge,
  economy: Leaf,
  codex: KeyRound,
};

const TIER_TITLE: Record<OneOffTier, string> = {
  frontier: "Max Frontier",
  balanced: "Balanced",
  economy: "Economy",
  codex: "ChatGPT",
};

type PresetRow = {
  label?: string;
  mainModel?: string;
  mainProvider?: string;
  mainBaseUrl?: string;
};
type PresetsFileShape = { active: string; presets: Record<string, PresetRow> };

export type OneOffPlanPick = {
  tier: OneOffTier;
  modelId: string;
  allowEdits: boolean;
  /** `presets` field for stack POST (record of tier → bundle) */
  presetBundles: Record<string, PresetRow>;
  /** Plan that was active when this sheet opened (revert to this) */
  revertTo: OneOffTier;
  pickedTitle: string;
  revertTitle: string;
};

function coerceTier(a: string | undefined): OneOffTier {
  return coercePresetId(a) ?? "balanced";
}

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (pick: OneOffPlanPick) => void;
};

export function OneOffModelPickerSheet({ open, onClose, onPick }: Props) {
  const [loading, setLoading] = useState(true);
  const [allowEdits, setAllowEdits] = useState(false);
  const [stackFile, setStackFile] = useState<PresetsFileShape | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  /** USD/1M numeric (OpenRouter per-token × 1e6) for main-model % compare vs current plan. */
  const [orPriceNumById, setOrPriceNumById] = useState<
    Record<string, { in: number; out: number }>
  >({});
  const [priceLoading, setPriceLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setStackFile(null);
    setOrPriceNumById({});
    setPriceLoading(true);
    void (async () => {
      try {
        const r = await fetch("/api/hermes/stack", { cache: "no-store" });
        if (!r.ok) {
          const t = await r.text();
          if (!cancelled) setErr(t.slice(0, 200) || `HTTP ${r.status}`);
          return;
        }
        const j = (await r.json()) as {
          allowEdits?: boolean;
          presets?: PresetsFileShape;
        };
        if (!cancelled) setAllowEdits(Boolean(j.allowEdits));
        const p = j.presets;
        if (!p?.presets) {
          if (!cancelled) setErr("No model presets in stack");
          return;
        }
        if (!cancelled) {
          setStackFile({
            active: p.active,
            presets: p.presets,
          });
        }
        const ids: string[] = [];
        for (const k of PRESET_IDS) {
          const row = p.presets[k];
          if (!isOpenRouterProvider(row?.mainProvider)) continue;
          const m = row?.mainModel?.trim();
          if (m) ids.push(m);
        }
        if (ids.length > 0) {
          const cr = await fetch(
            `/api/openrouter/model-catalog?ids=${encodeURIComponent(ids.join(","))}`,
            { cache: "no-store" }
          );
          if (cr.ok) {
            const cj = (await cr.json().catch(() => null)) as {
              ok?: boolean;
              models?: { id: string; promptPer1K?: string; completionPer1K?: string }[];
            } | null;
            if (cj && cj.ok !== false && Array.isArray(cj.models)) {
              const map: Record<string, string> = {};
              for (const m of cj.models) {
                const pin = m.promptPer1K;
                const cin = m.completionPer1K;
                const bits: string[] = [];
                if (pin != null && pin !== "")
                  bits.push(`in ~$${orPer1mUsdString(pin)}/1M`);
                if (cin != null && cin !== "")
                  bits.push(`out ~$${orPer1mUsdString(cin)}/1M`);
                if (m.id) {
                  const norm = normOrId(m.id);
                  map[norm] = bits.length > 0 ? bits.join(" · ") : "—";
                }
              }
              const nextNum = catalogRowsToUsdPer1MByNormId(cj.models);
              if (!cancelled) {
                setHints(map);
                setOrPriceNumById(nextNum);
              }
            }
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPriceLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const allTiers: OneOffTier[] = PRESET_IDS.filter((t) => stackFile?.presets?.[t]);
  const current = stackFile ? coerceTier(stackFile.active) : "balanced";
  const alternateTiers = allTiers.filter((t) => t !== current);
  const choices = alternateTiers.filter((t) => {
    const m = stackFile?.presets?.[t]?.mainModel?.trim();
    return Boolean(m);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex min-h-0 items-center justify-center bg-black/45 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose plan for this message"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[min(90dvh,36rem)] overflow-y-auto rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] p-4 text-sidebar-foreground shadow-xl">
        <h2 className="text-base font-semibold leading-tight text-foreground">
          Send this message on another plan.
        </h2>
        {err ? <p className="mt-2 text-xs text-destructive/90">{err}</p> : null}
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : choices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No other plans with a main model. Check Models &amp; API.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {choices.map((key) => {
              const p = stackFile?.presets?.[key];
              const m = p?.mainModel?.trim() ?? "";
              if (!m || !stackFile) return null;
              const provider = p?.mainProvider;
              const mNorm = normOrId(m);
              const Icon = TIER_ICONS[key];
              const label = p?.label?.trim() || TIER_TITLE[key];
              const vsBadge = mainChatPriceVsRefLabel(
                key,
                current,
                { presets: stackFile.presets },
                orPriceNumById,
                priceLoading
              );
              return (
                <li key={key}>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const rev = current;
                      onPick({
                        tier: key,
                        modelId: m,
                        allowEdits,
                        presetBundles: stackFile.presets,
                        revertTo: rev,
                        pickedTitle: label,
                        revertTitle: TIER_TITLE[rev] ?? TIER_TITLE.balanced,
                      });
                      onClose();
                    }}
                    className="neu-raised flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-3 text-left text-sm text-sidebar-foreground hover:text-sidebar-foreground"
                  >
                    <span className="flex min-w-0 flex-1 items-start gap-2">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{label}</span>
                        {vsBadge ? (
                          <span className="mt-0.5 block text-[11px] font-medium leading-snug text-sidebar-primary">
                            {vsBadge}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block break-all font-mono text-[10px] text-muted-foreground">
                          {m}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 self-start text-right text-[10px] leading-tight text-muted-foreground">
                      {isOpenRouterProvider(provider) ? hints[mNorm] ?? "—" : "ChatGPT"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
