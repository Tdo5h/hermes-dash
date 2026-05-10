/**
 * Turn job id/slug like `btc-price-test` into readable "BTC Price Test" for labels and headers.
 */
export function formatCronJobDisplayName(raw: string): string {
  const s = raw.trim();
  if (!s) return "Cron job";
  const words = s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === "btc") return "BTC";
      if (lower === "usd") return "USD";
      if (lower === "ha" || lower === "nz") return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  return words.join(" ");
}

const UUID_LIKE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Short label when we only have a job id (Hermes omitted `name`). */
export function shortCronJobIdLabel(jobId: string): string {
  const id = jobId.trim();
  if (!id) return "Cron job";
  if (UUID_LIKE.test(id)) return `Job ${id.slice(0, 8)}`;
  if (/^[a-f0-9-]{16,}$/i.test(id)) return `Job ${id.replace(/-/g, "").slice(0, 8)}`;
  return formatCronJobDisplayName(id);
}

/**
 * Sidebar / push title: prefer human `name` from Hermes; never use raw UUID as the visible title when `name` exists.
 */
export function cronSessionDisplayTitle(jobId: string, name?: string | null): string {
  const n = name?.trim();
  if (n) return formatCronJobDisplayName(n);
  return shortCronJobIdLabel(jobId);
}

/**
 * Strip the gateway's default cron delivery wrapper so the message body is only the brief
 * (job name lives in the sidebar / push title).
 */
export function stripCronDeliveryWrapper(text: string): string {
  let s = text.trim();
  if (!s) return s;
  // Multiline: Cronjob Response: … \n (job_id: …) \n ----- \n\n
  s = s.replace(
    /^\s*Cronjob Response:\s*[^\n]+\s*\n\s*\(?job_id:\s*[^)\n]+\)?\s*\n\s*-+\s*\n+/im,
    ""
  );
  // One-line header: Cronjob Response: Title (job_id: …) — title may contain spaces before "("
  s = s.replace(
    /^\s*Cronjob Response:\s*.+\(\s*job_id:\s*[^)]+\)\s*\n*/i,
    ""
  );
  s = s.replace(/\n\nTo stop or manage this job,[\s\S]*$/i, "").trim();
  return s.trim();
}
