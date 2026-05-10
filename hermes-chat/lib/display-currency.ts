/**
 * Display currency for OpenRouter-anchored USD costs (storage stays USD; UI converts for display).
 */

export const DISPLAY_CURRENCY_STORAGE_KEY = "hermes_display_currency";

/** Preset list includes common codes plus NZD and AUD. */
export const DISPLAY_CURRENCY_PRESETS = [
  { value: "USD", label: "US Dollar (USD)" },
  { value: "NZD", label: "New Zealand Dollar (NZD)" },
  { value: "AUD", label: "Australian Dollar (AUD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British Pound (GBP)" },
  { value: "CAD", label: "Canadian Dollar (CAD)" },
  { value: "JPY", label: "Japanese Yen (JPY)" },
  { value: "CHF", label: "Swiss Franc (CHF)" },
  { value: "INR", label: "Indian Rupee (INR)" },
] as const;

const ISO4217_RE = /^[A-Z]{3}$/i;

export function normalizeDisplayCurrencyCode(raw: string | null | undefined): string {
  const t = (raw ?? "USD").trim().toUpperCase();
  if (ISO4217_RE.test(t)) return t;
  return "USD";
}

export function readDisplayCurrencyCode(): string {
  if (typeof window === "undefined") return "USD";
  try {
    return normalizeDisplayCurrencyCode(localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY));
  } catch {
    return "USD";
  }
}

export const DISPLAY_CURRENCY_EVENT = "hermes_display_currency_change";

export function writeDisplayCurrencyCode(code: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, normalizeDisplayCurrencyCode(code));
    window.dispatchEvent(new Event(DISPLAY_CURRENCY_EVENT));
  } catch {
    /* ignore */
  }
}

export type UsdBaseRates = Record<string, number> | null;

/**
 * `rates` = open.er-api.com `data.rates` for base `USD` (how many of each per 1 USD).
 * `costUsd` is the native USD amount.
 */
export function costUsdInDisplayCurrency(
  costUsd: number,
  displayCode: string,
  rates: UsdBaseRates
): { amount: number; code: string; usedUsdFallback: boolean } {
  const code = normalizeDisplayCurrencyCode(displayCode);
  if (code === "USD" || !Number.isFinite(costUsd)) {
    return { amount: costUsd, code: "USD", usedUsdFallback: false };
  }
  if (!rates || typeof rates[code] !== "number" || !Number.isFinite(rates[code]) || rates[code]! <= 0) {
    return { amount: costUsd, code: "USD", usedUsdFallback: true };
  }
  return { amount: costUsd * rates[code]!, code, usedUsdFallback: false };
}

export function formatDisplayMoney(amount: number, code: string): string {
  if (!Number.isFinite(amount) || amount < 0) return "—";
  if (code === "JPY") {
    return `~${Math.round(amount).toLocaleString("en-US")} ${code}`;
  }
  /** Always dollars + cents (two fraction digits) for display. */
  if (amount === 0) {
    return `~$0.00 ${code}`;
  }
  const s = amount.toFixed(2);
  return `~$${s} ${code}`;
}

/**
 * One formatted cost with currency label always present.
 */
export function formatMoneyLine(
  costUsd: number,
  displayCode: string,
  rates: UsdBaseRates
): { line: string; usedUsdFallback: boolean } {
  const { amount, code, usedUsdFallback } = costUsdInDisplayCurrency(
    costUsd,
    displayCode,
    rates
  );
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return { line: "—", usedUsdFallback: false };
  }
  return { line: formatDisplayMoney(amount, code), usedUsdFallback };
}
