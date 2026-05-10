function normOrId(s: string): string {
  return s.replace(/^openrouter\//i, "").trim();
}

type ORListModel = { id: string; pricing?: { prompt?: string; completion?: string } };

/** OpenRouter catalog returns USD per token; show per 1M for readability. */
export function orPer1mUsdString(raw: string | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return (n * 1_000_000).toFixed(2);
}

/**
 * Per normalized model id, USD per 1M for input and output (from OpenRouter’s per-token prices).
 * If only one of prompt or completion is present, duplicates it so % comparisons still work
 * (same as treating missing side as the available price).
 */
export function catalogRowsToUsdPer1MByNormId(
  models: { id: string; promptPer1K?: string; completionPer1K?: string }[]
): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const m of models) {
    if (!m.id) continue;
    const k = normOrId(m.id);
    const pin = Number(m.promptPer1K);
    const pout = Number(m.completionPer1K);
    const hasIn = Number.isFinite(pin) && pin >= 0;
    const hasOut = Number.isFinite(pout) && pout >= 0;
    if (!hasIn && !hasOut) continue;
    const inM = hasIn ? pin * 1_000_000 : pout * 1_000_000;
    const outM = hasOut ? pout * 1_000_000 : pin * 1_000_000;
    out[k] = { in: inM, out: outM };
  }
  return out;
}

export type OpenRouterTokenUsage = {
  total_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

/**
 * When the gateway provides token counts but not USD costs, estimate split from OpenRouter list pricing
 * (USD per token) for the resolved model.
 */
export async function estimateOpenRouterUsdCostSplit(
  modelId: string,
  usage: OpenRouterTokenUsage
): Promise<{ promptUsd: number; completionUsd: number; totalUsd: number } | null> {
  const want = normOrId(modelId);
  if (!want) return null;
  if (typeof usage.total_tokens !== "number" || !Number.isFinite(usage.total_tokens) || usage.total_tokens <= 0) {
    return null;
  }

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/models", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: ORListModel[] } | null;
  const m = (body?.data ?? []).find((x) => normOrId(x.id) === want);
  const pTok = m?.pricing?.prompt;
  const cTok = m?.pricing?.completion;
  if (pTok == null || cTok == null) return null;
  const pPerTok = Number(pTok);
  const cPerTok = Number(cTok);
  if (!Number.isFinite(pPerTok) || !Number.isFinite(cPerTok)) return null;

  let pt =
    typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  let ct =
    typeof usage.completion_tokens === "number" && Number.isFinite(usage.completion_tokens)
      ? usage.completion_tokens
      : 0;
  if (pt === 0 && ct === 0) {
    ct = usage.total_tokens;
  } else if (pt + ct !== usage.total_tokens) {
    if (ct === 0 && pt >= 0) ct = Math.max(0, usage.total_tokens - pt);
    else if (pt === 0 && ct >= 0) pt = Math.max(0, usage.total_tokens - ct);
  }

  const promptUsd = pt * pPerTok;
  const completionUsd = ct * cPerTok;
  const totalUsd = promptUsd + completionUsd;
  if (!Number.isFinite(totalUsd) || totalUsd < 0) return null;
  /** Free-tier / zero-price models: still return 0 so the UI can show an explicit $0 line. */
  if (totalUsd === 0) return { promptUsd: 0, completionUsd: 0, totalUsd: 0 };
  return { promptUsd, completionUsd, totalUsd };
}
