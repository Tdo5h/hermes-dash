export const PRESET_IDS = ["frontier", "balanced", "economy", "codex"] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export function isPresetId(active: string | undefined): active is PresetId {
  return (PRESET_IDS as readonly string[]).includes(active ?? "");
}

/** Subset of preset bundle fields used for OR id collection (keeps this lib free of UI imports). */
type PresetBundleRow = {
  mainModel?: string;
  mainProvider?: string;
  ingestModel?: string;
  ingestProvider?: string;
  fallbackModel?: string;
  fallbackProvider?: string;
  titleModel?: string;
  titleProvider?: string;
  validatorModel?: string;
  validatorProvider?: string;
  imageGenModel?: string;
  imageGenProvider?: string;
  cheapModel?: string;
  cheapProvider?: string;
  heartbeatModel?: string;
  heartbeatProvider?: string;
};

const FIELD_LABEL: Record<string, string> = {
  mainModel: "Chat model id",
  ingestModel: "Ingest model",
  fallbackModel: "Fallback model",
  titleModel: "Title / summary model",
  validatorModel: "Validator model",
  imageGenModel: "Image model",
  cheapModel: "Cheap model",
  heartbeatModel: "Heartbeat model",
};

export function normOrId(s: string): string {
  return s.replace(/^openrouter\//i, "").trim();
}

export function isOpenRouterProvider(provider: string | undefined): boolean {
  const p = (provider ?? "").trim().toLowerCase();
  return !p || p === "openrouter";
}

export function isCodexProvider(provider: string | undefined): boolean {
  return (provider ?? "").trim().toLowerCase() === "openai-codex";
}

type PresetsShape = {
  presets: Record<string, PresetBundleRow>;
} | null;

/**
 * All non-empty OpenRouter model id fields on every plan row, for pre-save validation.
 * Ingest: only a separate check when the user set ingest explicitly; otherwise it follows main (validated via main).
 */
export function collectOpenRouterFieldEntries(
  presets: PresetsShape,
  planTitle: (id: PresetId) => string
): { normalizedId: string; line: string }[] {
  if (!presets?.presets) return [];
  const out: { normalizedId: string; line: string }[] = [];
  for (const id of PRESET_IDS) {
    const b = presets.presets[id] || {};
    const title = planTitle(id);
    const add = (
      fieldKey: keyof typeof FIELD_LABEL,
      raw: string | undefined,
      provider?: string
    ) => {
      if (!isOpenRouterProvider(provider)) return;
      const t = normOrId((raw ?? "").trim());
      if (!t) return;
      const label = FIELD_LABEL[fieldKey] ?? String(fieldKey);
      const show = (raw ?? "").trim();
      out.push({
        normalizedId: t,
        line: `${title} — ${label}: "${show}"`,
      });
    };
    const ingestProvider = b.ingestProvider ?? b.mainProvider;
    add("mainModel", b.mainModel, b.mainProvider);
    if ((b.ingestModel ?? "").trim()) {
      add("ingestModel", b.ingestModel, ingestProvider);
    }
    add("fallbackModel", b.fallbackModel, b.fallbackProvider);
    add("titleModel", b.titleModel, b.titleProvider);
    add("validatorModel", b.validatorModel, b.validatorProvider);
    add("imageGenModel", b.imageGenModel, b.imageGenProvider);
    add("cheapModel", b.cheapModel, b.cheapProvider);
    add("heartbeatModel", b.heartbeatModel, b.heartbeatProvider);
  }
  return out;
}

export type OpenRouterValidationResult =
  | { ok: true }
  | { ok: false; reason: "catalog"; message: string }
  | { ok: false; reason: "invalid"; lines: string[] };

/**
 * One catalog fetch: any entry whose id is not in the OpenRouter response is invalid.
 */
export async function validateOpenRouterModelIds(
  entries: { normalizedId: string; line: string }[]
): Promise<OpenRouterValidationResult> {
  if (entries.length === 0) return { ok: true };
  const unique = [...new Set(entries.map((e) => e.normalizedId))];
  const qs = new URLSearchParams();
  qs.set("ids", unique.join(","));
  let r: Response;
  try {
    r = await fetch(`/api/openrouter/model-catalog?${qs.toString()}`, {
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      reason: "catalog",
      message: e instanceof Error ? e.message : "Could not reach model catalog",
    };
  }
  const j = (await r.json().catch(() => null)) as { ok?: boolean; models?: { id: string }[] } | null;
  if (!r.ok || !j || j.ok !== true || !Array.isArray(j.models)) {
    return {
      ok: false,
      reason: "catalog",
      message: "Could not load OpenRouter model list. Try again.",
    };
  }
  const have = new Set(j.models.map((m) => normOrId(m.id)).filter(Boolean));
  const badLines = new Set<string>();
  for (const e of entries) {
    if (!have.has(e.normalizedId)) badLines.add(e.line);
  }
  if (badLines.size === 0) return { ok: true };
  return { ok: false, reason: "invalid", lines: [...badLines] };
}

export function coercePresetId(active: string | undefined): PresetId | null {
  if (isPresetId(active)) return active;
  return null;
}

const TIER: Record<PresetId, number> = {
  economy: 0,
  balanced: 1,
  frontier: 2,
  codex: 3,
};

export type TierAnimMode = "grow" | "shrink" | "neutral";

export function tierChangeMode(prev: PresetId | null, next: PresetId): TierAnimMode {
  const a = prev != null ? TIER[prev] : 1;
  const b = TIER[next];
  if (b > a) return "grow";
  if (b < a) return "shrink";
  return "neutral";
}
