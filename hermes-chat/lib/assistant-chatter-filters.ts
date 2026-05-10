/**
 * Suppresses rare assistant "status narration" bubbles in vault threads (model-generated noise).
 * Tight patterns + short length only — prefer fixing prompts server-side when possible.
 */
const NARRATION_PATTERNS: RegExp[] = [
  /^all done\b/i,
  /^fully ingested\b/i,
  /^ingestion (is |was )?complete/i,
  /^vault (was |is )?fully ingested/i,
];

const MAX_LEN = 220;

export function shouldSuppressAssistantNarration(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length === 0 || t.length > MAX_LEN) return false;
  return NARRATION_PATTERNS.some((re) => re.test(t));
}
