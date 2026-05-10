/** Max length for catalog model ids sent on ingest turns. */
const INGEST_MODEL_OVERRIDE_MAX_LEN = 128;

/**
 * Allowed chars: provider segments (alphanumeric, dot, underscore, hyphen, colon) and slashes.
 * Strips optional `openrouter/` prefix for compatibility (Hermes accepts bare ids).
 */
const INGEST_MODEL_OVERRIDE_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9/._:-]*[a-zA-Z0-9])?$/;

/**
 * Normalize a client or JSON body override for vault/wiki ingest model routing.
 * Returns null if missing or invalid (caller falls back to env / default chat model).
 */
export function normalizeIngestModelOverride(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/^openrouter\//i, "").trim();
  if (!t || t.length > INGEST_MODEL_OVERRIDE_MAX_LEN) return null;
  if (!INGEST_MODEL_OVERRIDE_RE.test(t)) return null;
  return t;
}
