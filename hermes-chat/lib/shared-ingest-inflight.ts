/** Avoid duplicate `runArchitectIngestAfterSharedUpload` for the same jobId (poll resume vs upload). */
const inFlight = new Set<string>();

/** Reaper resets queued jobs: allow a new worker; stale in-process runs should be replaced. */
export function clearSharedIngestInFlight(jobId: string): void {
  inFlight.delete(jobId);
}
