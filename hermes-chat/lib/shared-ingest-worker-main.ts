 /**
 * Long-running shared-vault ingest worker.
 * Start: `npx tsx lib/shared-ingest-worker-main.ts` (see shared-ingest-worker Dockerfile).
 */
import {
  getHermesArchitectBaseUrl,
  getHermesArchitectToken,
} from "@/lib/hermes-config";
import { runSharedIngestForJob } from "@/lib/shared-upload-ingest";
import {
  getNextQueuedJobGlobally,
  reapStaleRunningSharedIngestJobs,
  writeIngestWorkerHeartbeat,
} from "@/lib/shared-ingest-job-store";
import { getIngestWorkerSupportedProfiles } from "@/lib/ingest-worker-profile";

const HEARTBEAT_MS = 15_000;
const IDLE_SLEEP_MS = 2_000;
const VERSION = "1";

/** Set while a job runs so the background ticker keeps `ts` fresh (long ingests block the main loop). */
let heartbeatActiveJobId: string | null = null;

function getSharedIngestCoordDir(): string | null {
  return (
    process.env.HERMES_SHARED_INGEST_COORD_DIR?.trim() ||
    process.env.HERMES_ARCHITECT_INGEST_COORD_DIR?.trim() ||
    null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function startBackgroundHeartbeat(): void {
  const tick = () => {
    void writeIngestWorkerHeartbeat({
      ts: Date.now(),
      lastJobId: heartbeatActiveJobId,
      version: VERSION,
    }).catch((e) => {
      console.error("[shared-ingest-worker] heartbeat:", e);
    });
  };
  tick();
  setInterval(tick, HEARTBEAT_MS);
}

async function loop(): Promise<void> {
  if (!getSharedIngestCoordDir()) {
    throw new Error("HERMES_SHARED_INGEST_COORD_DIR is required for the ingest worker");
  }
  if (!getHermesArchitectBaseUrl()?.trim() || !getHermesArchitectToken()?.trim()) {
    console.warn(
      "[shared-ingest-worker] shared ingest gateway URL / token not set — worker will mark jobs in error until configured"
    );
  }
  const supportedProfiles = getIngestWorkerSupportedProfiles();
  console.log(
    `[shared-ingest-worker] consuming profiles: ${supportedProfiles.join(", ")}`
  );
  startBackgroundHeartbeat();
  for (;;) {
    const now = Date.now();
    await reapStaleRunningSharedIngestJobs(now, {
      profiles: supportedProfiles,
    }).catch((e) => {
      console.error("[shared-ingest-worker] reap:", e);
    });
    const job = await getNextQueuedJobGlobally({ profiles: supportedProfiles });
    if (!job) {
      heartbeatActiveJobId = null;
      await sleep(IDLE_SLEEP_MS);
      continue;
    }
    heartbeatActiveJobId = job.jobId;
    try {
      await runSharedIngestForJob(job, { pushTarget: "http" });
    } catch (e) {
      console.error("[shared-ingest-worker] job failed:", job.jobId, e);
    } finally {
      heartbeatActiveJobId = null;
    }
  }
}

void loop().catch((e) => {
  console.error("[shared-ingest-worker] fatal:", e);
  process.exit(1);
});
