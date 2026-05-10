import { isOpenRouterProvider, normOrId, type PresetId } from "./or-model-ids";

const DEFAULT_TITLES: Record<PresetId, string> = {
  frontier: "Max Frontier",
  balanced: "Balanced",
  economy: "Economy",
  codex: "ChatGPT",
};

type PresetLike = { label?: string; mainModel?: string; mainProvider?: string };
export type PresetsForCompare = { presets?: Record<string, PresetLike> } | null;

/** Card title: custom label or default tier name. */
export function planDisplayLabelForTier(
  planId: PresetId,
  presets: PresetsForCompare
): string {
  const lab = presets?.presets?.[planId]?.label?.trim();
  if (lab) return lab;
  return DEFAULT_TITLES[planId];
}

/** Average of input + output $/1M (OpenRouter list, USD per token × 1e6) for a plan’s main chat model. */
export function mainModelAvgUsdPer1M(
  planId: PresetId,
  presets: PresetsForCompare,
  nums: Record<string, { in: number; out: number }>
): number | null {
  const row = presets?.presets?.[planId];
  if (!isOpenRouterProvider(row?.mainProvider)) return null;
  const raw = row?.mainModel;
  const t = normOrId((raw ?? "").trim());
  if (!t) return null;
  const p = nums[t];
  if (!p) return null;
  if (!Number.isFinite(p.in) || !Number.isFinite(p.out) || p.in < 0 || p.out < 0) return null;
  return (p.in + p.out) / 2;
}

/**
 * % cheaper / pricier (main model only) vs a reference plan — same copy as the Models & API cards.
 * @param comparePlanId  Tier being considered (e.g. alternate in one-off send)
 * @param refPlanId  Reference (e.g. current stack `active` tier)
 */
export function mainChatPriceVsRefLabel(
  comparePlanId: PresetId,
  refPlanId: PresetId,
  presets: PresetsForCompare,
  nums: Record<string, { in: number; out: number }>,
  priceLoading: boolean
): string | null {
  if (priceLoading) return null;
  if (comparePlanId === refPlanId) return null;
  if (!presets?.presets) return null;
  const refC = mainModelAvgUsdPer1M(refPlanId, presets, nums);
  const curC = mainModelAvgUsdPer1M(comparePlanId, presets, nums);
  if (refC == null || curC == null || refC <= 0) return null;
  const ratio = curC / refC;
  const name = planDisplayLabelForTier(refPlanId, presets);
  if (Math.abs(ratio - 1) < 0.01) {
    return `~Same vs ${name}`;
  }
  if (ratio < 1) {
    return `${((1 - ratio) * 100).toFixed(0)}% cheaper vs ${name}`;
  }
  return `${((ratio - 1) * 100).toFixed(0)}% pricier vs ${name}`;
}
