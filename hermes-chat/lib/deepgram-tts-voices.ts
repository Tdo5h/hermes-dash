/** Default voice for new sessions / invalid localStorage values */
export const DEFAULT_TTS_VOICE = "aura-2-arcas-en";

const MAX_TTS_TEXT_CHARS = 9000;
export const MAX_TTS_CHUNK_CHARS = 1800;
export const DEFAULT_TTS_SPEED = 0.95;

export { MAX_TTS_TEXT_CHARS };

export type TtsVoiceOption = { value: string; label: string };

/** All models supported by Deepgram Speak v1 (see SpeakV1Model in @deepgram/sdk). */
export const ALLOWED_TTS_MODELS: ReadonlySet<string> = new Set([
  "aura-asteria-en",
  "aura-luna-en",
  "aura-stella-en",
  "aura-athena-en",
  "aura-hera-en",
  "aura-orion-en",
  "aura-arcas-en",
  "aura-perseus-en",
  "aura-angus-en",
  "aura-orpheus-en",
  "aura-helios-en",
  "aura-zeus-en",
  "aura-2-amalthea-en",
  "aura-2-andromeda-en",
  "aura-2-apollo-en",
  "aura-2-arcas-en",
  "aura-2-aries-en",
  "aura-2-asteria-en",
  "aura-2-athena-en",
  "aura-2-atlas-en",
  "aura-2-aurora-en",
  "aura-2-callista-en",
  "aura-2-cordelia-en",
  "aura-2-cora-en",
  "aura-2-delia-en",
  "aura-2-draco-en",
  "aura-2-electra-en",
  "aura-2-harmonia-en",
  "aura-2-helena-en",
  "aura-2-hera-en",
  "aura-2-hermes-en",
  "aura-2-hyperion-en",
  "aura-2-iris-en",
  "aura-2-janus-en",
  "aura-2-juno-en",
  "aura-2-jupiter-en",
  "aura-2-luna-en",
  "aura-2-mars-en",
  "aura-2-minerva-en",
  "aura-2-neptune-en",
  "aura-2-odysseus-en",
  "aura-2-ophelia-en",
  "aura-2-orion-en",
  "aura-2-orpheus-en",
  "aura-2-pandora-en",
  "aura-2-phoebe-en",
  "aura-2-pluto-en",
  "aura-2-saturn-en",
  "aura-2-selene-en",
  "aura-2-thalia-en",
  "aura-2-theia-en",
  "aura-2-vesta-en",
  "aura-2-zeus-en",
  "aura-2-sirio-es",
  "aura-2-nestor-es",
  "aura-2-carina-es",
  "aura-2-celeste-es",
  "aura-2-alvaro-es",
  "aura-2-diana-es",
  "aura-2-aquila-es",
  "aura-2-selena-es",
  "aura-2-estrella-es",
  "aura-2-javier-es",
]);

/** Display name only (e.g. Hermes, Thalia) — no model family or language in UI. */
function labelForModel(id: string): string {
  let rest = id;
  if (rest.startsWith("aura-2-")) {
    rest = rest.slice("aura-2-".length);
  } else if (rest.startsWith("aura-")) {
    rest = rest.slice("aura-".length);
  }
  if (rest.endsWith("-es")) {
    rest = rest.slice(0, -3);
  } else if (rest.endsWith("-en")) {
    rest = rest.slice(0, -3);
  }
  const name = rest
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name || id;
}

/** Sorted: Aura 2 EN, Aura 2 ES, Aura 1 EN */
export const DEEPGRAM_TTS_VOICE_OPTIONS: readonly TtsVoiceOption[] = (() => {
  const ids = [...ALLOWED_TTS_MODELS];
  const score = (id: string) => {
    if (id.startsWith("aura-2-") && id.endsWith("-en")) return 0;
    if (id.startsWith("aura-2-") && id.endsWith("-es")) return 1;
    return 2;
  };
  ids.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return labelForModel(a).localeCompare(labelForModel(b));
  });
  return ids.map((value) => ({ value, label: labelForModel(value) }));
})();

export function isAllowedTtsModel(model: string): boolean {
  return ALLOWED_TTS_MODELS.has(model);
}

export function supportsTtsVoiceControls(model: string): boolean {
  return model.startsWith("aura-2-");
}

export function normalizeTtsSpeed(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(1.5, Math.max(0.7, Math.round(n * 100) / 100));
}
