import { randomUUID } from "crypto";
import type { VaultAssetRole } from "@/lib/ingest-message";
import type {
  SharedIngestPhaseKey,
  SharedIngestReaderTask,
  SharedIngestReviewTask,
  SharedIngestSwarmTaskStatus,
} from "@/lib/shared-ingest-job-store";
import type { HermesPrivateReingestJobPublic } from "@/lib/workspace-vault-ingest-jobs";

type PrivateReingestJobRecord = {
  jobId: string;
  projectSlug: string;
  relativePath: string;
  fileName: string;
  status: "running" | "done" | "error";
  activeRunId?: string;
  phaseKey: SharedIngestPhaseKey;
  phaseLabel: string;
  updatedAt: number;
  errorMessage?: string;
  assetRole?: VaultAssetRole;
  reingestVerify?: boolean;
  touchedPaths?: string[];
  swarmRunId?: string;
  readerTasks?: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
  swarmOutputPaths?: string[];
  /** Workspace chat session id — sidebar vault row + nested chat orbs (same idea as architect `sourceWebchatId`). */
  sourceWebchatId?: string;
};

const PRIVATE_REINGEST_JOBS_GLOBAL_KEY = "__hermesPrivateReingestJobs";

type HermesPrivateReingestGlobal = typeof globalThis & {
  [PRIVATE_REINGEST_JOBS_GLOBAL_KEY]?: Map<string, PrivateReingestJobRecord>;
};

const globalJobState = globalThis as HermesPrivateReingestGlobal;
const jobs =
  globalJobState[PRIVATE_REINGEST_JOBS_GLOBAL_KEY] ??
  new Map<string, PrivateReingestJobRecord>();
globalJobState[PRIVATE_REINGEST_JOBS_GLOBAL_KEY] = jobs;

function toBarPublic(j: PrivateReingestJobRecord): HermesPrivateReingestJobPublic | null {
  if (j.status === "done") return null;
  return {
    ingestKind: "hermes_private",
    jobId: j.jobId,
    projectSlug: j.projectSlug,
    relativePath: j.relativePath,
    fileName: j.fileName,
    status: j.status === "error" ? "error" : "running",
    phaseKey: j.phaseKey,
    phaseLabel: j.phaseLabel,
    errorMessage: j.errorMessage,
    assetRole: j.assetRole ?? null,
    reingestVerify: j.reingestVerify === true,
    readerTasks: j.readerTasks,
    challengeTask: j.challengeTask,
    mergeTask: j.mergeTask,
  };
}

export function createPrivateReingestJob(params: {
  projectSlug: string;
  relativePath: string;
  fileName: string;
  assetRole?: VaultAssetRole | null;
  sourceWebchatId?: string | null;
  reingestVerify?: boolean;
}): string {
  const jobId = randomUUID();
  const wid =
    typeof params.sourceWebchatId === "string"
      ? params.sourceWebchatId.trim()
      : "";
  const row: PrivateReingestJobRecord = {
    jobId,
    projectSlug: params.projectSlug,
    relativePath: params.relativePath,
    fileName: params.fileName,
    status: "running",
    phaseKey: "structuring",
    phaseLabel: params.reingestVerify ? "Verifying with Hermes…" : "Starting private ingest…",
    updatedAt: Date.now(),
    ...(params.assetRole != null ? { assetRole: params.assetRole } : {}),
    ...(params.reingestVerify === true ? { reingestVerify: true } : {}),
    ...(wid ? { sourceWebchatId: wid } : {}),
  };
  jobs.set(jobId, row);
  return jobId;
}

function newRunId(): string {
  return `${Date.now().toString(36)}-${randomUUID()}`;
}

function clampProgress(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeTaskStatus(
  status: SharedIngestSwarmTaskStatus | undefined
): SharedIngestSwarmTaskStatus | undefined {
  if (
    status === "waiting" ||
    status === "running" ||
    status === "done" ||
    status === "error" ||
    status === "skipped"
  ) {
    return status;
  }
  return undefined;
}

function patchPrivateJob(
  jobId: string,
  patcher: (job: PrivateReingestJobRecord, now: number) => void,
  options?: { runId?: string | null }
): void {
  const j = jobs.get(jobId);
  if (!j) return;
  if (
    options?.runId != null &&
    j.activeRunId != null &&
    options.runId !== j.activeRunId
  ) {
    return;
  }
  patcher(j, Date.now());
  j.updatedAt = Date.now();
  jobs.set(jobId, j);
}

export function markPrivateIngestJobRunning(jobId: string): string | null {
  const j = jobs.get(jobId);
  if (!j || j.status === "done" || j.status === "error") return null;
  const runId = newRunId();
  j.status = "running";
  j.activeRunId = runId;
  j.phaseKey = "structuring";
  j.phaseLabel = "Structuring for search and citations";
  j.updatedAt = Date.now();
  jobs.set(jobId, j);
  return runId;
}

export function updatePrivateIngestJobPhase(
  jobId: string,
  phaseKey: SharedIngestPhaseKey,
  phaseLabel?: string
): void {
  patchPrivateJob(jobId, (j) => {
    if (j.status !== "running") return;
    j.phaseKey = phaseKey;
    j.phaseLabel = phaseLabel ?? j.phaseLabel;
  });
}

export async function initializePrivateIngestSwarm(
  jobId: string,
  params: {
    runId: string;
    readerTasks: Array<{ id: string; label: string; description: string }>;
  }
): Promise<void> {
  patchPrivateJob(
    jobId,
    (j, now) => {
      j.swarmRunId = params.runId;
      j.readerTasks = params.readerTasks.map((task) => ({
        id: task.id,
        label: task.label,
        description: task.description,
        status: "waiting",
        progress: 0,
        updatedAt: now,
        retryCount: 0,
      }));
      j.challengeTask = {
        id: "challenge",
        label: "Challenge",
        status: "waiting",
        progress: 0,
        updatedAt: now,
      };
      j.mergeTask = {
        id: "merge",
        label: "Merge",
        status: "waiting",
        progress: 0,
        updatedAt: now,
      };
      j.swarmOutputPaths = [];
    },
    { runId: params.runId }
  );
}

export async function updatePrivateIngestReaderTask(
  jobId: string,
  taskId: string,
  patch: Partial<
    Pick<
      SharedIngestReaderTask,
      | "status"
      | "progress"
      | "detail"
      | "outputPath"
      | "score"
      | "retryCount"
      | "errorMessage"
    >
  >,
  options?: { runId?: string | null }
): Promise<void> {
  patchPrivateJob(
    jobId,
    (j, now) => {
      const tasks = j.readerTasks ?? [];
      const idx = tasks.findIndex((task) => task.id === taskId);
      if (idx < 0) return;
      const current = tasks[idx]!;
      const status = normalizeTaskStatus(patch.status);
      const next: SharedIngestReaderTask = {
        ...current,
        ...(status ? { status } : {}),
        ...(patch.progress !== undefined ? { progress: clampProgress(patch.progress) } : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined ? { outputPath: patch.outputPath } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.retryCount !== undefined ? { retryCount: patch.retryCount } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: now,
      };
      j.readerTasks = [...tasks.slice(0, idx), next, ...tasks.slice(idx + 1)];
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export async function updatePrivateIngestChallengeTask(
  jobId: string,
  patch: Partial<
    Pick<
      SharedIngestReviewTask,
      | "status"
      | "progress"
      | "detail"
      | "outputPath"
      | "score"
      | "retryRequests"
      | "errorMessage"
    >
  >,
  options?: { runId?: string | null }
): Promise<void> {
  patchPrivateJob(
    jobId,
    (j, now) => {
      const current =
        j.challengeTask ??
        ({
          id: "challenge",
          label: "Challenge",
          status: "waiting",
          progress: 0,
          updatedAt: now,
        } satisfies SharedIngestReviewTask);
      const status = normalizeTaskStatus(patch.status);
      j.challengeTask = {
        ...current,
        ...(status ? { status } : {}),
        ...(patch.progress !== undefined ? { progress: clampProgress(patch.progress) } : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined ? { outputPath: patch.outputPath } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.retryRequests !== undefined ? { retryRequests: patch.retryRequests } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: now,
      };
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export async function updatePrivateIngestMergeTask(
  jobId: string,
  patch: Partial<
    Pick<
      SharedIngestReviewTask,
      | "status"
      | "progress"
      | "detail"
      | "outputPath"
      | "score"
      | "errorMessage"
    >
  >,
  options?: { runId?: string | null }
): Promise<void> {
  patchPrivateJob(
    jobId,
    (j, now) => {
      const current =
        j.mergeTask ??
        ({
          id: "merge",
          label: "Merge",
          status: "waiting",
          progress: 0,
          updatedAt: now,
        } satisfies SharedIngestReviewTask);
      const status = normalizeTaskStatus(patch.status);
      j.mergeTask = {
        ...current,
        ...(status ? { status } : {}),
        ...(patch.progress !== undefined ? { progress: clampProgress(patch.progress) } : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined ? { outputPath: patch.outputPath } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: now,
      };
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export function completePrivateReingestJob(
  jobId: string,
  params?: { touchedPaths?: string[]; runId?: string | null }
): void {
  const j = jobs.get(jobId);
  if (!j) return;
  if (params?.runId != null && j.activeRunId != null && params.runId !== j.activeRunId) {
    return;
  }
  j.status = "done";
  j.phaseLabel = "Finished";
  j.touchedPaths = params?.touchedPaths ?? j.touchedPaths;
  j.activeRunId = undefined;
  j.updatedAt = Date.now();
}

export function countActivePrivateReingestJobsForSlug(projectSlug: string): number {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.projectSlug === projectSlug && j.status === "running") n += 1;
  }
  return n;
}

export function failPrivateReingestJob(
  jobId: string,
  message: string,
  options?: { runId?: string | null }
): void {
  const j = jobs.get(jobId);
  if (!j) return;
  if (
    j.status === "running" &&
    options?.runId != null &&
    j.activeRunId !== options.runId
  ) {
    return;
  }
  j.status = "error";
  j.errorMessage = message;
  j.phaseLabel = "Verify failed";
  j.activeRunId = undefined;
  j.updatedAt = Date.now();
}

export function getPrivateReingestJob(
  jobId: string
): PrivateReingestJobRecord | undefined {
  return jobs.get(jobId);
}

export function listPrivateReingestJobsForSlug(
  projectSlug: string
): HermesPrivateReingestJobPublic[] {
  const out: HermesPrivateReingestJobPublic[] = [];
  for (const j of jobs.values()) {
    if (j.projectSlug !== projectSlug) continue;
    const pub = toBarPublic(j);
    if (pub) out.push(pub);
  }
  return out;
}

export function removePrivateReingestJob(jobId: string): void {
  jobs.delete(jobId);
}

/** Vault slugs + session ids for GET /api/sessions processingSurface (tab pips, vault row orbs). */
export function getPrivateHermesReingestSidebarActivity(): {
  slugSet: Set<string>;
  webchatIds: string[];
} {
  const slugSet = new Set<string>();
  const webchatIds: string[] = [];
  const seenW = new Set<string>();
  for (const j of jobs.values()) {
    if (j.status !== "running") continue;
    slugSet.add(j.projectSlug);
    const w = j.sourceWebchatId?.trim();
    if (w && !seenW.has(w)) {
      seenW.add(w);
      webchatIds.push(w);
    }
  }
  return { slugSet, webchatIds };
}

/** Active private re-verify jobs in this vault that name a workspace session (GET …/chats processing flags). */
export function getSourceWebchatsForPrivateReingestInSlug(
  projectSlug: string
): Set<string> {
  const out = new Set<string>();
  for (const j of jobs.values()) {
    if (j.projectSlug !== projectSlug) continue;
    if (j.status !== "running") continue;
    const w = j.sourceWebchatId?.trim();
    if (w) out.add(w);
  }
  return out;
}
