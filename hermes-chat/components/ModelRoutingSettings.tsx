"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Brain, Gauge, KeyRound, Leaf, Loader2 } from "lucide-react";
import type { ModelRolesPayload } from "@/lib/hermes-model-roles";
import {
  collectOpenRouterFieldEntries,
  coercePresetId,
  isCodexProvider,
  isOpenRouterProvider,
  normOrId,
  PRESET_IDS,
  type PresetId,
  validateOpenRouterModelIds,
} from "@/lib/or-model-ids";
import { ModelSaveApplyOverlay, waitMinApplyDuration } from "@/components/ModelSaveApplyOverlay";
import { catalogRowsToUsdPer1MByNormId, orPer1mUsdString } from "@/lib/openrouter-pricing";
import { mainChatPriceVsRefLabel, planDisplayLabelForTier } from "@/lib/or-plan-compare";
import { cn } from "@/lib/utils";
import { clearStackPlanDriftIfUserChangedActiveTier } from "@/lib/stack-plan-drift-persist";
import { fetchChatSessions } from "@/lib/sessions";
import { InferencePipelineDialog } from "@/components/InferencePipelineDialog";

const PRESET_META: Record<
  PresetId,
  { title: string; sub: string; Icon: typeof Brain }
> = {
  frontier: {
    title: "Max Frontier",
    sub: "Sharpest answers — best for hard questions",
    Icon: Brain,
  },
  balanced: {
    title: "Balanced",
    sub: "Great default for everyday chat",
    Icon: Gauge,
  },
  economy: {
    title: "Economy",
    sub: "Fast and light on cost",
    Icon: Leaf,
  },
  codex: {
    title: "ChatGPT",
    sub: "Uses your connected ChatGPT account",
    Icon: KeyRound,
  },
};

const DEFAULT_VALIDATOR_MODEL = "moonshotai/kimi-k2.5";
const DEFAULT_CHEAP_BY_PLAN: Record<PresetId, string> = {
  frontier: "x-ai/grok-4.1-fast",
  balanced: "x-ai/grok-4.1-fast",
  economy: "nvidia/nemotron-3-super-120b-a12b:free",
  codex: "gpt-5.4-mini",
};

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_FAST_MODEL = "gpt-5.4-mini";
const CODEX_DEFAULT_EFFORT = "medium";
const CODEX_DEFAULT_SERVICE_TIER = "fast";
const CODEX_DEFAULT_INGEST_READER_EFFORT = "low";
const CODEX_DEFAULT_INGEST_REVIEW_EFFORT = "medium";
const CODEX_DEFAULT_INGEST_MERGE_EFFORT = "medium";

const CODEX_EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

const CODEX_SPEED_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Fast" },
];

function defaultCheapModelForPlan(id: PresetId, mainModel: string | undefined): string {
  if (id === "economy") {
    const t = (mainModel ?? "").trim();
    return t || DEFAULT_CHEAP_BY_PLAN.economy;
  }
  return DEFAULT_CHEAP_BY_PLAN[id];
}

/** All fields are per plan; values apply when this plan is active and you save. */
export type PresetBundle = {
  label?: string;
  mainModel?: string;
  mainProvider?: string;
  mainBaseUrl?: string;
  ingestModel?: string;
  ingestProvider?: string;
  ingestBaseUrl?: string;
  fallbackModel?: string;
  fallbackProvider?: string;
  fallbackBaseUrl?: string;
  titleModel?: string;
  titleProvider?: string;
  imageGenModel?: string;
  imageGenProvider?: string;
  imageGenBaseUrl?: string;
  imageGenUseGateway?: boolean;
  smartRoutingEnabled?: boolean;
  cheapModel?: string;
  cheapProvider?: string;
  cheapBaseUrl?: string;
  validatorEnabled?: boolean;
  validatorModel?: string;
  validatorProvider?: string;
  heartbeatModel?: string;
  heartbeatProvider?: string;
  heartbeatBaseUrl?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  ingestReaderEffort?: string;
  ingestReviewEffort?: string;
  ingestMergeEffort?: string;
  ingestServiceTier?: string;
  auxiliary?: Record<string, unknown> | null;
};

type PresetsFile = {
  active: string;
  presets: Record<string, PresetBundle>;
};

/** Linked from `app/chat/models/page.tsx` header via `form="…"`. */
export const HERMES_MODEL_ROUTING_FORM_ID = "hermes-model-routing-save";

function fmt(s: string | null | undefined): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t || "—";
}

function collectOrCatalogIds(presets: PresetsFile | null): string[] {
  if (!presets?.presets) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | undefined) => {
    const t = normOrId((s ?? "").trim());
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const id of PRESET_IDS) {
    const b = presets.presets[id] || {};
    if (isOpenRouterProvider(b.mainProvider)) add(b.mainModel);
    if (isOpenRouterProvider(b.imageGenProvider)) add(b.imageGenModel);
    if (isOpenRouterProvider(b.heartbeatProvider)) add(b.heartbeatModel);
    const ingest =
      (b.ingestModel ?? "").trim() || (b.mainModel ?? "").trim() || undefined;
    if (isOpenRouterProvider(b.ingestProvider ?? b.mainProvider)) add(ingest);
  }
  return out;
}

export function ModelRoutingSettings(_props: {
  roles: ModelRolesPayload & { ok: true };
}) {
  const [stackLoading, setStackLoading] = useState(true);
  const [stackErr, setStackErr] = useState<string | null>(null);
  const [allowEdits, setAllowEdits] = useState(false);
  const [presets, setPresets] = useState<PresetsFile | null>(null);
  const [active, setActive] = useState<PresetId>("balanced");
  const [saving, setSaving] = useState<null | "presets">(null);
  const [applyKey, setApplyKey] = useState(0);
  const [orInvalidLines, setOrInvalidLines] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** OpenRouter list pricing by normalized id (USD per 1M in/out as strings). */
  const [orPriceById, setOrPriceById] = useState<Record<string, { in: string; out: string }>>(
    {}
  );
  /** Parsed USD/1M for main-model % comparisons. */
  const [orPriceNumById, setOrPriceNumById] = useState<Record<string, { in: number; out: number }>>(
    {}
  );
  const [orPriceLoading, setOrPriceLoading] = useState(false);
  /** Server `presets.active` tier when stack last loaded in this form (detect active-plan dropdown edits). */
  const stackTierBaselineRef = useRef<PresetId | null>(null);
  const [inferenceSaveConfirmOpen, setInferenceSaveConfirmOpen] = useState(false);

  const loadStack = useCallback(async (opts?: { silent?: boolean; retryAfterGatewayReload?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const retry = Boolean(opts?.retryAfterGatewayReload);
    if (!silent) {
      setStackLoading(true);
      setStackErr(null);
    }
    const fail = (m: string) => {
      if (!silent) setStackErr(m);
    };
    const delays = retry ? [0, 600, 1200, 2500, 4000, 6000] : [0];
    let lastErr = "Failed to load stack";
    for (let i = 0; i < delays.length; i++) {
      if ((delays[i] ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, delays[i]!));
      }
      try {
        const r = await fetch("/api/hermes/stack", { cache: "no-store" });
        const raw = await r.text();
        let j: {
          allowEdits?: boolean;
          ok?: boolean;
          presets?: PresetsFile;
          error?: string;
        } = {};
        if (raw.trim()) {
          try {
            j = JSON.parse(raw) as typeof j;
          } catch {
            lastErr = "Bad response from server (not JSON). Try again.";
            if (i === delays.length - 1) fail(lastErr);
            continue;
          }
        } else if (!r.ok) {
          lastErr = `HTTP ${r.status} (empty body)`;
          if (i === delays.length - 1) fail(lastErr);
          continue;
        }
        if (!r.ok) {
          lastErr = (typeof j.error === "string" && j.error) || `HTTP ${r.status}`;
          if (i === delays.length - 1) fail(lastErr);
          continue;
        }
        setAllowEdits(Boolean(j.allowEdits));
        if (j.presets && j.presets.presets) {
          setPresets(j.presets);
          const nextActive = coercePresetId(j.presets.active);
          if (nextActive) {
            setActive(nextActive);
            stackTierBaselineRef.current = nextActive;
          }
        }
        if (!silent) setStackLoading(false);
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "Failed to load stack";
        if (i === delays.length - 1) {
          fail(lastErr);
        }
      }
    }
    if (!silent) setStackLoading(false);
  }, []);

  useEffect(() => {
    void loadStack();
  }, [loadStack]);

  useEffect(() => {
    if (!presets?.presets || stackLoading) return;
    const idList = collectOrCatalogIds(presets);
    if (idList.length === 0) {
      setOrPriceById({});
      setOrPriceNumById({});
      return;
    }
    let cancelled = false;
    setOrPriceLoading(true);
    void (async () => {
      try {
        const r = await fetch(
          `/api/openrouter/model-catalog?ids=${encodeURIComponent(idList.join(","))}`,
          { cache: "no-store" }
        );
        const j = (await r.json().catch(() => null)) as {
          ok?: boolean;
          models?: { id: string; promptPer1K?: string; completionPer1K?: string }[];
        } | null;
        const next: Record<string, { in: string; out: string }> = {};
        const nextNum: Record<string, { in: number; out: number }> = {};
        if (r.ok && j?.ok && Array.isArray(j.models)) {
          for (const m of j.models) {
            if (!m.id) continue;
            const k = normOrId(m.id);
            next[k] = {
              in: orPer1mUsdString(m.promptPer1K),
              out: orPer1mUsdString(m.completionPer1K),
            };
          }
          Object.assign(nextNum, catalogRowsToUsdPer1MByNormId(j.models));
        }
        if (!cancelled) {
          setOrPriceById(next);
          setOrPriceNumById(nextNum);
        }
      } catch {
        if (!cancelled) {
          setOrPriceById({});
          setOrPriceNumById({});
        }
      } finally {
        if (!cancelled) setOrPriceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presets, stackLoading]);

  function updateBundle<K extends keyof PresetBundle>(
    id: PresetId,
    field: K,
    value: PresetBundle[K]
  ) {
    setPresets((p) => {
      if (!p) return p;
      const next = { ...p, presets: { ...p.presets } };
      const cur = next.presets[id] || {};
      next.presets[id] = { ...cur, [field]: value };
      return next;
    });
  }

  function setValidatorEnabledForPlan(id: PresetId, enabled: boolean) {
    setPresets((p) => {
      if (!p) return p;
      const next = { ...p, presets: { ...p.presets } };
      const cur = next.presets[id] || {};
      const nextRow: PresetBundle = { ...cur, validatorEnabled: enabled };
      if (enabled && !(String(cur.validatorModel ?? "").trim())) {
        nextRow.validatorModel = id === "codex" ? CODEX_FAST_MODEL : DEFAULT_VALIDATOR_MODEL;
        if (id === "codex") nextRow.validatorProvider = "openai-codex";
      }
      next.presets[id] = nextRow;
      return next;
    });
  }

  function setSmartRoutingEnabledForPlan(id: PresetId, enabled: boolean) {
    setPresets((p) => {
      if (!p) return p;
      const next = { ...p, presets: { ...p.presets } };
      const cur = next.presets[id] || {};
      const nextRow: PresetBundle = { ...cur, smartRoutingEnabled: enabled };
      if (enabled && !(String(cur.cheapModel ?? "").trim())) {
        nextRow.cheapModel = defaultCheapModelForPlan(id, cur.mainModel);
      }
      if (id === "codex") {
        nextRow.cheapProvider = "openai-codex";
        nextRow.cheapBaseUrl = CODEX_BASE_URL;
      }
      next.presets[id] = nextRow;
      return next;
    });
  }

  const stopSelect = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  async function postStack(body: Record<string, unknown>) {
    const r = await fetch("/api/hermes/stack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as {
      ok?: boolean;
      data?: { ok?: boolean; error?: string; reloaded?: boolean; warning?: string };
      error?: string;
    };
    if (!r.ok) {
      const gw = j.data;
      const err =
        (typeof gw === "object" && gw && "error" in gw && (gw as { error?: string }).error) ||
        j.error;
      throw new Error(err || `HTTP ${r.status}`);
    }
    if (j.data && typeof j.data === "object" && j.data.ok === false) {
      const err = (j.data as { error?: string }).error;
      if (err) throw new Error(err);
    }
    return j;
  }

  const executeSaveAndApplyPresets = useCallback(async () => {
    if (!presets) return;
    const t0 = Date.now();
    const baselineBeforeSave = stackTierBaselineRef.current;
    const tierSaving = active;
    setInferenceSaveConfirmOpen(false);
    setApplyKey((k) => k + 1);
    setSaving("presets");
    try {
      await postStack({
        presets: presets.presets,
        active,
        applyActivePreset: true,
        reload: true,
      });
      setMsg("Applied. Plan is written to the stack; gateway and heartbeat updated. Refreshing…");
      await loadStack({ silent: true, retryAfterGatewayReload: true });
      clearStackPlanDriftIfUserChangedActiveTier({
        tierInFormWhenSaving: tierSaving,
        tierBaselineFromLastLoad: baselineBeforeSave,
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      await waitMinApplyDuration(t0);
      setSaving(null);
    }
  }, [presets, active, loadStack]);

  async function onSaveAndApply() {
    if (!allowEdits) {
      setMsg("Changes are locked (HERMES_ALLOW_STACK_MODEL_EDITS).");
      return;
    }
    if (!presets) return;
    setOrInvalidLines(null);
    setMsg(null);
    const entries = collectOpenRouterFieldEntries(presets, (id) => planDisplayLabelForTier(id, presets));
    const vr = await validateOpenRouterModelIds(entries);
    if (!vr.ok) {
      if (vr.reason === "invalid") {
        setOrInvalidLines(vr.lines);
      } else {
        setMsg(vr.message);
      }
      return;
    }
    const chatPayload = await fetchChatSessions();
    const lists = [
      ...chatPayload.sessions,
      ...chatPayload.buildEditSessions,
      ...chatPayload.creativeStudioSessions,
    ];
    const anyProcessing = lists.some((s) => s.processing);
    if (anyProcessing) {
      setInferenceSaveConfirmOpen(true);
      return;
    }
    await executeSaveAndApplyPresets();
  }

  const orCells = (raw: string | undefined, provider?: string) => {
    if (!isOpenRouterProvider(provider)) return { in: "—" as const, out: "—" as const };
    const t = (raw ?? "").trim();
    if (!t) return { in: "—" as const, out: "—" as const };
    const k = normOrId(t);
    if (orPriceLoading) return { in: "…" as const, out: "…" as const };
    return orPriceById[k] ?? { in: "—" as const, out: "—" as const };
  };

  return (
    <>
      <InferencePipelineDialog
        open={inferenceSaveConfirmOpen}
        onOpenChange={setInferenceSaveConfirmOpen}
        variant="confirm"
        title="Replies still in progress"
        description={
          <>
            At least one chat session still has work in flight. Saving writes stack settings and{" "}
            <span className="font-medium text-foreground">reloads the Hermes gateway</span> —
            in-flight generations may be interrupted or lost.
          </>
        }
        onConfirm={() => void executeSaveAndApplyPresets()}
        confirmLabel="Save anyway"
        cancelLabel="Cancel"
      />
      <ModelSaveApplyOverlay
        open={saving === "presets"}
        applyKey={applyKey}
        zClassName="z-50"
      />
      {orInvalidLines && orInvalidLines.length > 0 ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="or-invalid-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-4 shadow-lg">
            <h2
              id="or-invalid-title"
              className="text-sm font-semibold leading-tight text-foreground"
            >
              Fix OpenRouter model id
            </h2>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              These model ids are not in the current OpenRouter catalog. Update the slot to a valid
              id from the model list, then save again.
            </p>
            <ul className="mt-3 max-h-[40vh] list-disc space-y-1.5 overflow-y-auto pl-4 text-[11px] leading-snug text-foreground/90">
              {orInvalidLines.map((line, i) => (
                <li key={`${i}-${line.slice(0, 64)}`} className="[overflow-wrap:anywhere] break-words">
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-border/70 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => setOrInvalidLines(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <form
        id={HERMES_MODEL_ROUTING_FORM_ID}
        className="w-full min-w-0 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSaveAndApply();
        }}
      >
      {stackLoading && saving !== "presets" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : stackErr ? (
        <p className="text-xs leading-snug text-muted-foreground">
          Could not load settings ({stackErr}). Check the gateway and token.
        </p>
      ) : null}
      {!stackLoading && !stackErr ? (
        <>
          {msg ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[12px] leading-snug text-foreground/90">
              {msg}
            </p>
          ) : null}
          {!allowEdits ? (
            <p className="text-[11px] leading-snug text-amber-200/80">
              Changes are locked. Your host must set{" "}
              <code className="rounded bg-muted px-1">HERMES_ALLOW_STACK_MODEL_EDITS=1</code> on HermesChat
              and restart.
            </p>
          ) : null}

          <div className="space-y-2.5">
            {PRESET_IDS.filter((id) => presets?.presets?.[id]).map((id) => {
              const b = presets?.presets?.[id] || {};
              const { Icon, title, sub } = PRESET_META[id];
              const vsBadge = mainChatPriceVsRefLabel(
                id,
                active,
                presets,
                orPriceNumById,
                orPriceLoading
              );
              const ingestProvider = b.ingestProvider ?? b.mainProvider;
              const ingestResolved =
                (b.ingestModel ?? "").trim() || (b.mainModel ?? "").trim() || undefined;
              const modelRows: { label: string; line: string; raw?: string; provider?: string }[] = [
                { label: "Main", line: fmt(b.mainModel), raw: b.mainModel, provider: b.mainProvider },
                { label: "Image", line: fmt(b.imageGenModel), raw: b.imageGenModel, provider: b.imageGenProvider },
                {
                  label: "Heartbeat",
                  line: fmt(b.heartbeatModel),
                  raw: b.heartbeatModel,
                  provider: b.heartbeatProvider,
                },
                { label: "Ingest", line: fmt(ingestResolved), raw: ingestResolved, provider: ingestProvider },
              ];
              const isCodexPlan = id === "codex" || isCodexProvider(b.mainProvider);
              const textModelLabel = isCodexPlan ? "ChatGPT model id" : "Model id";
              const textModelPlaceholder = isCodexPlan ? "e.g. gpt-5.5" : "openai/…";
              return (
                <div
                  key={id}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-card/40 px-3 py-2.5 transition-[box-shadow,border-color]",
                    active === id
                      ? "border-sidebar-primary border-2 ring-2 ring-sidebar-primary/40"
                      : "border-border/80 hover:border-border"
                  )}
                  onClick={() => setActive(id)}
                  role="presentation"
                >
                  <div className="mb-2 flex items-start gap-2">
                    <Icon className="mt-0.5 size-[18px] shrink-0 text-sidebar-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-tight">
                            {b.label || title}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {sub}
                          </div>
                        </div>
                        {vsBadge ? (
                          <div className="max-w-[min(12rem,48%)] shrink-0 text-right text-[11px] font-medium leading-snug text-sidebar-primary sm:max-w-[14rem] sm:text-xs">
                            {vsBadge}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-2 w-full min-w-0 max-w-full rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2.5 sm:px-3">
                        <p className="text-sm font-semibold text-foreground/90">Models &amp; live pricing</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground md:hidden">
                          USD per 1M tokens (OpenRouter). Model id on its own line below.
                        </p>
                        {/** md+: 4-col table. &lt;md: stacked rows — grid crushed the model column on narrow phones. */}
                        <div
                          className="mt-2.5 hidden w-full min-w-0 [grid-template-columns:6rem_minmax(0,1fr)_5.5rem_5.5rem] items-baseline gap-x-3 md:grid"
                          role="row"
                        >
                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Role
                          </div>
                          <div className="min-w-0 pr-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Model
                          </div>
                          <div className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            In/1M
                          </div>
                          <div className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Out/1M
                          </div>
                        </div>
                        <ul className="w-full min-w-0 max-w-full divide-y divide-border/50" role="list">
                          {modelRows.map((row, rowIdx) => {
                            const c = orCells(row.raw, row.provider);
                            const inCell =
                              c.in === "—" || c.in === "…" ? c.in : `~$${c.in}`;
                            const outCell =
                              c.out === "—" || c.out === "…" ? c.out : `~$${c.out}`;
                            return (
                              <li key={row.label} className="min-w-0">
                                {/** Mobile: full-width model id; no 4-up grid. */}
                                <div
                                  className={cn("py-2.5 md:hidden", rowIdx === 0 ? "pt-0.5" : "")}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="shrink-0 text-sm font-medium leading-snug text-foreground/85">
                                      {row.label}
                                    </div>
                                    <div className="min-w-0 text-right text-[11px] leading-tight text-foreground/90">
                                      <div className="whitespace-nowrap font-medium tabular-nums">
                                        In/1M {inCell}
                                      </div>
                                      <div className="whitespace-nowrap font-medium tabular-nums">
                                        Out/1M {outCell}
                                      </div>
                                    </div>
                                  </div>
                                  <p className="mt-1.5 w-full min-w-0 max-w-full break-words font-mono text-[13px] leading-snug text-foreground/90">
                                    {row.line}
                                  </p>
                                </div>
                                {/** Desktop: 4-col grid */}
                                <div
                                  className={cn(
                                    "hidden w-full min-w-0 [grid-template-columns:6rem_minmax(0,1fr)_5.5rem_5.5rem] items-start gap-x-3 py-2.5 md:grid",
                                    rowIdx === 0 ? "md:pt-2" : "md:pt-2.5"
                                  )}
                                >
                                  <div className="pt-0.5 text-sm font-medium leading-snug text-foreground/85">
                                    {row.label}
                                  </div>
                                  <p className="min-w-0 max-w-full break-words font-mono text-sm leading-relaxed text-foreground/90">
                                    {row.line}
                                  </p>
                                  <p className="pt-0.5 text-right text-sm font-medium tabular-nums text-foreground/90 sm:whitespace-nowrap">
                                    {inCell}
                                  </p>
                                  <p className="pt-0.5 text-right text-sm font-medium tabular-nums text-foreground/90 sm:whitespace-nowrap">
                                    {outCell}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <details className="mt-1 border-t border-border/40 pt-2">
                    <summary className="cursor-pointer text-[12px] font-medium text-foreground/90">
                      Models &amp; services for this plan
                    </summary>
                    <div className="mt-2 space-y-2.5 text-[12px]">
                      <p className="text-[10px] text-muted-foreground">
                        When this plan is active, Save &amp; apply writes these values to the gateway
                        config, HermesChat data files, and the heartbeat job (for this plan).
                      </p>

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Main chat
                      </p>
                      <LabeledInput
                        label="Display name (card title)"
                        value={b.label || ""}
                        onChange={(v) => updateBundle(id, "label", v)}
                        disabled={!allowEdits}
                        mono
                        small
                        placeholder="Optional"
                        stop
                      />
                      <LabeledInput
                        label={textModelLabel}
                        value={b.mainModel || ""}
                        onChange={(v) => updateBundle(id, "mainModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                        placeholder={textModelPlaceholder}
                      />
                      {isCodexPlan ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <LabeledSelect
                            label="Intelligence"
                            value={(b.reasoningEffort || CODEX_DEFAULT_EFFORT).toLowerCase()}
                            onChange={(v) => updateBundle(id, "reasoningEffort", v)}
                            disabled={!allowEdits}
                            options={CODEX_EFFORT_OPTIONS}
                            stop
                          />
                          <LabeledSelect
                            label="Speed"
                            value={(b.serviceTier || CODEX_DEFAULT_SERVICE_TIER).toLowerCase()}
                            onChange={(v) => updateBundle(id, "serviceTier", v)}
                            disabled={!allowEdits}
                            options={CODEX_SPEED_OPTIONS}
                            stop
                          />
                        </div>
                      ) : null}

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Ingest (wiki / vault)
                      </p>
                      <LabeledInput
                        label="Ingest model (empty = same as chat model)"
                        value={b.ingestModel || ""}
                        onChange={(v) => updateBundle(id, "ingestModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                        placeholder={isCodexPlan ? "Optional — e.g. gpt-5.5" : "Optional — e.g. stronger model for ingest"}
                      />
                      {isCodexPlan ? (
                        <div className="space-y-2 rounded-lg border border-border/50 bg-background/35 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <p className="text-[11px] font-medium text-foreground/90">
                              Brain speed
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Fast readers, medium checks by default.
                            </p>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <LabeledSelect
                              label="Ingest speed"
                              value={(b.ingestServiceTier || CODEX_DEFAULT_SERVICE_TIER).toLowerCase()}
                              onChange={(v) => updateBundle(id, "ingestServiceTier", v)}
                              disabled={!allowEdits}
                              options={CODEX_SPEED_OPTIONS}
                              stop
                            />
                            <LabeledSelect
                              label="Readers"
                              value={(b.ingestReaderEffort || CODEX_DEFAULT_INGEST_READER_EFFORT).toLowerCase()}
                              onChange={(v) => updateBundle(id, "ingestReaderEffort", v)}
                              disabled={!allowEdits}
                              options={CODEX_EFFORT_OPTIONS}
                              stop
                            />
                            <LabeledSelect
                              label="Challenge"
                              value={(b.ingestReviewEffort || CODEX_DEFAULT_INGEST_REVIEW_EFFORT).toLowerCase()}
                              onChange={(v) => updateBundle(id, "ingestReviewEffort", v)}
                              disabled={!allowEdits}
                              options={CODEX_EFFORT_OPTIONS}
                              stop
                            />
                            <LabeledSelect
                              label="Merge"
                              value={(b.ingestMergeEffort || CODEX_DEFAULT_INGEST_MERGE_EFFORT).toLowerCase()}
                              onChange={(v) => updateBundle(id, "ingestMergeEffort", v)}
                              disabled={!allowEdits}
                              options={CODEX_EFFORT_OPTIONS}
                              stop
                            />
                          </div>
                        </div>
                      ) : null}

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Fallback
                      </p>
                      <LabeledInput
                        label={isCodexPlan ? "Fallback model (ChatGPT)" : "Fallback model"}
                        value={b.fallbackModel || ""}
                        onChange={(v) => updateBundle(id, "fallbackModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                      />

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Titles &amp; validation (HermesChat)
                      </p>
                      <LabeledInput
                        label={isCodexPlan ? "Title / summary model (ChatGPT)" : "Title / summary model (OpenRouter id)"}
                        value={b.titleModel || ""}
                        onChange={(v) => updateBundle(id, "titleModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                        placeholder={isCodexPlan ? `e.g. ${CODEX_FAST_MODEL}` : "e.g. x-ai/grok-4.1-fast"}
                      />
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground/90">
                        <input
                          type="checkbox"
                          className="rounded border border-border/60"
                          checked={Boolean(b.validatorEnabled)}
                          onChange={(e) => setValidatorEnabledForPlan(id, e.target.checked)}
                          onClick={stopSelect}
                          disabled={!allowEdits}
                        />
                        Validator (pass 2) — on when this box is checked
                      </label>
                      <LabeledInput
                        label={isCodexPlan ? "Validator model (ChatGPT)" : "Validator model"}
                        value={b.validatorModel || ""}
                        onChange={(v) => updateBundle(id, "validatorModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                      />

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Image generation
                      </p>
                      <LabeledInput
                        label={isCodexPlan ? "Image model (ChatGPT)" : "Image model"}
                        value={b.imageGenModel || ""}
                        onChange={(v) => {
                          updateBundle(id, "imageGenModel", v);
                          if (isCodexPlan) {
                            updateBundle(id, "imageGenProvider", "openai-codex");
                            updateBundle(id, "imageGenBaseUrl", CODEX_BASE_URL);
                          }
                        }}
                        disabled={!allowEdits}
                        mono
                        stop
                        placeholder={isCodexPlan ? "gpt-5.5" : "openai/gpt-5-image"}
                      />

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Smart routing (cheap pass)
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground/90">
                        <input
                          type="checkbox"
                          className="rounded border border-border/60"
                          checked={Boolean(b.smartRoutingEnabled)}
                          onChange={(e) => setSmartRoutingEnabledForPlan(id, e.target.checked)}
                          onClick={stopSelect}
                          disabled={!allowEdits}
                        />
                        Smart routing — on when this box is checked
                      </label>
                      <LabeledInput
                        label={isCodexPlan ? "Cheap model (ChatGPT)" : "Cheap model (OpenRouter id)"}
                        value={b.cheapModel || ""}
                        onChange={(v) => updateBundle(id, "cheapModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                      />

                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Heartbeat (cron — updated when this plan is active and applied)
                      </p>
                      <LabeledInput
                        label={isCodexPlan ? "Heartbeat model (ChatGPT)" : "Heartbeat model"}
                        value={b.heartbeatModel || ""}
                        onChange={(v) => updateBundle(id, "heartbeatModel", v)}
                        disabled={!allowEdits}
                        mono
                        stop
                      />
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      </form>
    </>
  );
}

function LabeledInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  mono?: boolean;
  small?: boolean;
  stop?: boolean;
}) {
  const { stop, ...rest } = props;
  return (
    <div>
      <label className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/90">
        {rest.label}
      </label>
      <input
        className={cn(
          "mt-0.5 w-full rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-foreground",
          rest.mono ? "font-mono" : "",
          rest.small ? "text-[11px]" : "text-[12px]"
        )}
        value={rest.value}
        onChange={(e) => rest.onChange(e.target.value)}
        onClick={stop ? (e) => e.stopPropagation() : undefined}
        onPointerDown={stop ? (e) => e.stopPropagation() : undefined}
        disabled={rest.disabled}
        placeholder={rest.placeholder}
      />
    </div>
  );
}

function LabeledSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  options: { value: string; label: string }[];
  stop?: boolean;
}) {
  const { stop, ...rest } = props;
  return (
    <div>
      <label className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/90">
        {rest.label}
      </label>
      <select
        className="mt-0.5 w-full rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 text-[12px] text-foreground"
        value={rest.value}
        onChange={(e) => rest.onChange(e.target.value)}
        onClick={stop ? (e) => e.stopPropagation() : undefined}
        onPointerDown={stop ? (e) => e.stopPropagation() : undefined}
        disabled={rest.disabled}
      >
        {rest.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
