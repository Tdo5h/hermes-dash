import { coercePresetId, type PresetId } from "./or-model-ids";
import { formatOpenRouterUsd } from "./openrouter-credits";

export function parseStackActiveTier(
  a: string | undefined
): PresetId | null {
  return coercePresetId(a);
}

/** USD floor before we treat balance as "low" for this stack tier (higher tier = more headroom). */
export function openRouterLowBalanceThresholdUsd(
  tier: PresetId | null
): number {
  if (tier === "economy") return 1;
  if (tier === "frontier") return 3;
  if (tier === "balanced") return 2;
  if (tier === "codex") return 0;
  return 2;
}

export function isOpenRouterLowBalance(
  remaining: number,
  tier: PresetId | null
): boolean {
  if (tier === "codex") return false;
  if (!Number.isFinite(remaining)) return false;
  return remaining < openRouterLowBalanceThresholdUsd(tier);
}

/** One line for the empty composer: remaining balance + plan buffer + CTA. */
export function buildOpenRouterLowBalanceInputLine(
  remaining: number,
  tier: PresetId | null,
  planLabel: string
): string {
  const t = openRouterLowBalanceThresholdUsd(tier);
  return `${formatOpenRouterUsd(remaining)} left — below $${t} for ${planLabel} — add OpenRouter credit.`;
}

/** Short settings subline, e.g. "Under $3 for your plan — add credits soon." */
export function openRouterUnderThresholdHintUsd(threshold: number): string {
  return `Under $${threshold} for your plan — add credits soon.`;
}
