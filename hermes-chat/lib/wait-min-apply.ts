/** Minimum duration to match the Save &amp; apply overlay animation (e.g. gateway reload). */
const DURATION_MS = 6000;

export async function waitMinApplyDuration(sinceMs: number) {
  const elapsed = Date.now() - sinceMs;
  if (elapsed < DURATION_MS) {
    await new Promise((r) => setTimeout(r, DURATION_MS - elapsed));
  }
}

export { DURATION_MS };
