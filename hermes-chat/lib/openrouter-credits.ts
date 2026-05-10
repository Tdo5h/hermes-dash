/** Web UI: buy or top up account credits. Sign-in redirects to this page when needed. */
export const OPENROUTER_CREDITS_TOP_UP_URL =
  "https://openrouter.ai/settings/credits" as const;

export type OpenRouterCreditsPayload =
  | { ok: true; remaining: number; totalCredits: number; totalUsage: number }
  | {
      ok: false;
      detail: string;
      status?: number;
      message?: string;
    };

export function formatOpenRouterUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
