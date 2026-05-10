import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile, readdir, open, stat, unlink } from "fs/promises";
import { join } from "path";
import { clearSharedIngestInFlight } from "@/lib/shared-ingest-inflight";
import { isMechanicalIngestStreamHeadline } from "@/lib/hermes-sse-stream";
import {
  phaseDisplayLabel,
  STRUCTURING_PHASE_DISPLAY_LINE,
  type SharedIngestPhaseKey,
} from "@/lib/shared-ingest-hero-copy";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";

export type { SharedIngestPhaseKey };

export type SharedIngestJobStatus = "queued" | "running" | "done" | "error";
export type SharedIngestSwarmTaskStatus =
  | "waiting"
  | "running"
  | "done"
  | "error"
  | "skipped";

export type SharedIngestReaderTask = {
  id: string;
  label: string;
  description: string;
  status: SharedIngestSwarmTaskStatus;
  progress: number;
  updatedAt: number;
  detail?: string;
  outputPath?: string;
  score?: number;
  retryCount?: number;
  errorMessage?: string;
};

export type SharedIngestReviewTask = {
  id: string;
  label: string;
  status: SharedIngestSwarmTaskStatus;
  progress: number;
  updatedAt: number;
  detail?: string;
  outputPath?: string;
  score?: number;
  retryRequests?: string[];
  errorMessage?: string;
};

/** Last completed shared ingest — surfaces key paths for chat (supplements INDEX.md). */
export type SharedIngestLastSnapshot = {
  jobId: string;
  projectSlug: string;
  fileName: string;
  /** Gateway paths under `/vault-shared/<slug>/…` for this workspace. */
  touchedPaths: string[];
  completedAt: number;
};

/** Which Chat/DB profile enqueued this job (ingest worker picks DB + notify URL). */
export type IngestSourceProfile = "main" | "bt_user1" | "bt_user2";

export type SharedIngestJob = {
  jobId: string;
  projectSlug: string;
  relativePath: string;
  fileName: string;
  status: SharedIngestJobStatus;
  /** Set when `running`; new id each run so stale work cannot mark done after a reap. */
  activeRunId?: string;
  phaseKey: SharedIngestPhaseKey;
  phaseLabel: string;
  updatedAt: number;
  errorMessage?: string;
  /** Upload intent — drives architect preamble and hero copy. */
  assetRole?: VaultAssetRole;
  /** Set when status is done — paths the assistant should open next (same as last snapshot). */
  touchedPaths?: string[];
  /** User dismissed an old failed job from the UI; keep the record but stop surfacing it. */
  dismissedAt?: number;
  /** Set at enqueue for server-side worker (multi-tenant business-test). */
  ingestSourceProfile?: IngestSourceProfile;
  /**
   * HermesChat workspace session id (webchat uuid) that should show the architect orb
   * in the vault chat list — set after upload via `/ingest-job-attribution` when known.
   */
  sourceWebchatId?: string;
  /** Copied at enqueue so the worker can run without re-deriving. */
  mimeType?: string;
  duplicate?: boolean;
  reingestVerify?: boolean;
  contextVaultSlug?: string;
  /** Real focused-reader swarm state, written by the shared ingest worker. */
  swarmRunId?: string;
  readerTasks?: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
  swarmOutputPaths?: string[];
};

type QueueFile = { order: string[] };

function normalizedJobProfile(job: SharedIngestJob): IngestSourceProfile {
  return job.ingestSourceProfile ?? "main";
}

function profileSet(
  profiles: Iterable<IngestSourceProfile> | undefined
): Set<IngestSourceProfile> | null {
  if (!profiles) return null;
  const set = new Set<IngestSourceProfile>();
  for (const profile of profiles) set.add(profile);
  return set.size > 0 ? set : null;
}

function jobMatchesProfiles(
  job: SharedIngestJob,
  profiles: Set<IngestSourceProfile> | null
): boolean {
  return profiles == null || profiles.has(normalizedJobProfile(job));
}

function isDismissedJob(job: SharedIngestJob): boolean {
  return typeof job.dismissedAt === "number" && job.dismissedAt > 0;
}

function jobSourceKey(job: SharedIngestJob): string {
  const source = job.relativePath.trim() || job.fileName.trim();
  return `${job.projectSlug}\0${source}`;
}

function sameJobSource(a: SharedIngestJob, b: SharedIngestJob): boolean {
  return jobSourceKey(a) === jobSourceKey(b);
}

function visibleErrorJobs(
  jobs: SharedIngestJob[]
): SharedIngestJob[] {
  const latestErrorBySource = new Map<string, SharedIngestJob>();
  for (const job of jobs) {
    if (job.status !== "error" || isDismissedJob(job)) continue;
    const key = jobSourceKey(job);
    const existing = latestErrorBySource.get(key);
    if (!existing || job.updatedAt > existing.updatedAt) {
      latestErrorBySource.set(key, job);
    }
  }

  const visible: SharedIngestJob[] = [];
  for (const errorJob of latestErrorBySource.values()) {
    const superseded = jobs.some(
      (job) =>
        job.jobId !== errorJob.jobId &&
        sameJobSource(job, errorJob) &&
        job.status !== "error" &&
        job.updatedAt >= errorJob.updatedAt
    );
    if (!superseded) visible.push(errorJob);
  }
  return visible.sort((a, b) => b.updatedAt - a.updatedAt);
}

function coordDir(): string | null {
  const d =
    process.env.HERMES_SHARED_INGEST_COORD_DIR?.trim() ||
    process.env.HERMES_ARCHITECT_INGEST_COORD_DIR?.trim();
  return d || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const STATE_LOCK_STALE_MS = 120_000;

async function acquireStateLock(coord: string): Promise<() => Promise<void>> {
  const lockPath = join(coord, "state-mutex.lock");
  const waitStart = Date.now();
  while (true) {
    try {
      const fh = await open(lockPath, "wx");
      const release = async () => {
        try {
          await fh.close();
        } finally {
          await unlink(lockPath).catch(() => {});
        }
      };
      await fh.writeFile(
        `pid=${process.pid}\n${Date.now()}\n`,
        "utf8"
      );
      return release;
    } catch {
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > STATE_LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        /* empty */
      }
      await sleep(50 + Math.floor(Math.random() * 80));
      if (Date.now() - waitStart > 60_000) {
        throw new Error("shared-ingest state lock timeout");
      }
    }
  }
}

async function withStateLock<T>(coord: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireStateLock(coord);
  try {
    return await fn();
  } finally {
    await release();
  }
}

function queuePath(coord: string): string {
  return join(coord, "ingest-queue.json");
}

function jobPath(coord: string, jobId: string): string {
  return join(coord, "jobs", `${jobId}.json`);
}

async function readQueue(coord: string): Promise<QueueFile> {
  try {
    const raw = await readFile(queuePath(coord), "utf-8");
    const j = JSON.parse(raw) as QueueFile;
    if (!j || !Array.isArray(j.order)) return { order: [] };
    return { order: j.order.filter((x) => typeof x === "string") };
  } catch {
    return { order: [] };
  }
}

async function writeQueue(coord: string, q: QueueFile): Promise<void> {
  await writeFile(queuePath(coord), JSON.stringify(q, null, 0), "utf-8");
}

async function readJobFile(
  coord: string,
  jobId: string
): Promise<SharedIngestJob | null> {
  try {
    const raw = await readFile(jobPath(coord, jobId), "utf-8");
    return JSON.parse(raw) as SharedIngestJob;
  } catch {
    return null;
  }
}

async function writeJobFile(coord: string, job: SharedIngestJob): Promise<void> {
  await mkdir(join(coord, "jobs"), { recursive: true });
  await writeFile(jobPath(coord, job.jobId), JSON.stringify(job, null, 0), "utf-8");
}

/** In-process fallback when coord dir unset (single replica). */
const memQueue: string[] = [];
const memJobs = new Map<string, SharedIngestJob>();
const memLastIngestBySlug = new Map<string, SharedIngestLastSnapshot>();

const LAST_INGEST_FILE = "last-ingest-by-slug.json";

function staleRunningMsFromEnv(): number {
  const raw = process.env.HERMES_ARCHITECT_STALE_RUNNING_MS?.trim();
  if (raw === undefined || raw === "") return 5_400_000; // 90m — no phase update while healthy ingest runs
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 300_000) return 5_400_000; // min 5m
  return Math.min(Math.floor(n), 86_400_000);
}

function snapPath(coord: string): string {
  return join(coord, LAST_INGEST_FILE);
}

/**
 * Deterministic “open these next” paths for shared vault architect ingest (aligns with
 * wiki-vault-ingest-pipeline; chunk filenames may differ slightly on disk — still useful as hints).
 */
export function buildSharedIngestTouchedPathsHint(params: {
  projectSlug: string;
  fileName: string;
  assetRole?: VaultAssetRole;
}): string[] {
  const role = normalizeVaultAssetRole(params.assetRole ?? "general_reference");
  const base = params.fileName.replace(/^.*[\\/]/, "");
  const root = `/vault-shared/${params.projectSlug}/`;
  const out: string[] = [
    `${root}SCHEMA.md`,
    `${root}INDEX.md`,
    `${root}LOG.md`,
    `${root}index/ingest_manifest.json`,
    `${root}sources/${base}`,
  ];
  if (role === "scoring_criteria") {
    const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    out.push(
      `${root}extracted/${base}.md`,
      `${root}scoring/${stem}/extracted.md`,
      `${root}scoring/${stem}/BLURB.md`
    );
    return [...new Set(out)];
  }
  if (role === "output_template") {
    const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    out.push(
      `${root}extracted/${base}.md`,
      `${root}templates/${stem}/outline.md`,
      `${root}templates/${stem}/structure.yaml`
    );
    return [...new Set(out)];
  }
  if (role === "company_branding") {
    out.push(
      `${root}extracted/${base}.md`,
      `${root}branding/BRAND_KIT.md`
    );
    return [...new Set(out)];
  }
  out.push(`${root}extracted/${base}.md`, `${root}segments/${base}.md.jsonl`);
  return [...new Set(out)];
}

async function readLastIngestFile(
  coord: string
): Promise<Record<string, SharedIngestLastSnapshot>> {
  try {
    const raw = await readFile(snapPath(coord), "utf-8");
    const j = JSON.parse(raw) as Record<string, SharedIngestLastSnapshot>;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

async function writeLastIngestEntry(
  coord: string,
  snap: SharedIngestLastSnapshot
): Promise<void> {
  const cur = await readLastIngestFile(coord);
  cur[snap.projectSlug] = snap;
  await writeFile(snapPath(coord), JSON.stringify(cur, null, 0), "utf-8");
}

async function persistLastIngestSnapshot(snap: SharedIngestLastSnapshot): Promise<void> {
  memLastIngestBySlug.set(snap.projectSlug, snap);
  const root = coordDir();
  if (!root) return;
  await mkdir(root, { recursive: true });
  await writeLastIngestEntry(root, snap);
}

/** Latest completed ingest snapshot for a shared workspace (for vault file bar / status API). */
export async function getSharedIngestLastSnapshot(
  projectSlug: string
): Promise<SharedIngestLastSnapshot | null> {
  const root = coordDir();
  if (!root) {
    return memLastIngestBySlug.get(projectSlug) ?? null;
  }
  const all = await readLastIngestFile(root);
  return all[projectSlug] ?? null;
}

export async function enqueueSharedIngestJob(params: {
  projectSlug: string;
  relativePath: string;
  fileName: string;
  assetRole?: VaultAssetRole;
  ingestSourceProfile?: IngestSourceProfile;
  mimeType?: string;
  duplicate?: boolean;
  reingestVerify?: boolean;
  contextVaultSlug?: string;
  /** When the uploader is already in a workspace chat (same tab). */
  sourceWebchatId?: string;
}): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  const now = Date.now();
  const role =
    params.assetRole !== undefined
      ? normalizeVaultAssetRole(params.assetRole)
      : undefined;
  const job: SharedIngestJob = {
    jobId,
    projectSlug: params.projectSlug,
    relativePath: params.relativePath,
    fileName: params.fileName,
    status: "queued",
    phaseKey: "unknown",
    phaseLabel: phaseDisplayLabel("unknown", "queued"),
    updatedAt: now,
    ...(role && role !== "general_reference" ? { assetRole: role } : {}),
    ...(params.ingestSourceProfile
      ? { ingestSourceProfile: params.ingestSourceProfile }
      : {}),
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    ...(params.duplicate === true ? { duplicate: true } : {}),
    ...(params.reingestVerify === true ? { reingestVerify: true } : {}),
    ...(params.contextVaultSlug?.trim()
      ? { contextVaultSlug: params.contextVaultSlug.trim() }
      : {}),
    ...(params.sourceWebchatId?.trim()
      ? { sourceWebchatId: params.sourceWebchatId.trim() }
      : {}),
  };

  const root = coordDir();
  if (!root) {
    memJobs.set(jobId, job);
    memQueue.push(jobId);
    return { jobId };
  }

  await mkdir(root, { recursive: true });
  await withStateLock(root, async () => {
    const q = await readQueue(root);
    q.order.push(jobId);
    await writeQueue(root, q);
    await writeJobFile(root, job);
  });
  return { jobId };
}

/**
 * Link a queued/running ingest job to the HermesChat workspace session that should show the
 * architect orb (set after POST /files when the client has created or picked a session).
 */
export async function patchSharedIngestJobSourceWebchat(
  jobId: string,
  projectSlug: string,
  sourceWebchatId: string
): Promise<boolean> {
  const wid = sourceWebchatId.trim();
  if (!wid) return false;
  const root = coordDir();
  if (!root) {
    const j = memJobs.get(jobId);
    if (!j || j.projectSlug !== projectSlug) return false;
    if (j.status !== "queued" && j.status !== "running") return false;
    j.sourceWebchatId = wid;
    j.updatedAt = Date.now();
    memJobs.set(jobId, j);
    return true;
  }
  return withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j || j.projectSlug !== projectSlug) return false;
    if (j.status !== "queued" && j.status !== "running") return false;
    j.sourceWebchatId = wid;
    j.updatedAt = Date.now();
    await writeJobFile(root, j);
    return true;
  });
}

/** Slugs + session ids with architect queue work (for sidebar tab pips / vault orbs). */
export async function getSidebarActivityFromIngestQueue(): Promise<{
  slugSet: Set<string>;
  webchatIds: string[];
}> {
  const slugSet = new Set<string>();
  const webchatIds: string[] = [];
  const seenW = new Set<string>();
  const visit = (j: SharedIngestJob | null) => {
    if (!j) return;
    if (j.status !== "queued" && j.status !== "running") return;
    slugSet.add(j.projectSlug);
    const w = j.sourceWebchatId?.trim();
    if (w && !seenW.has(w)) {
      seenW.add(w);
      webchatIds.push(w);
    }
  };
  const root = coordDir();
  if (!root) {
    for (const j of memJobs.values()) {
      visit(j);
    }
    return { slugSet, webchatIds };
  }
  const q = await readQueue(root);
  for (const id of q.order) {
    visit(await readJobFile(root, id));
  }
  return { slugSet, webchatIds };
}

/** Active jobs in this vault that name a workspace session (for GET …/chats processing flags). */
export async function getSourceWebchatsForActiveJobsInSlug(
  projectSlug: string
): Promise<Set<string>> {
  const out = new Set<string>();
  const visit = (j: SharedIngestJob | null) => {
    if (!j) return;
    if (j.projectSlug !== projectSlug) return;
    if (j.status !== "queued" && j.status !== "running") return;
    const w = j.sourceWebchatId?.trim();
    if (w) out.add(w);
  };
  const root = coordDir();
  if (!root) {
    for (const j of memJobs.values()) {
      visit(j);
    }
    return out;
  }
  const q = await readQueue(root);
  for (const id of q.order) {
    visit(await readJobFile(root, id));
  }
  return out;
}

function newIngestRunId(): string {
  return randomUUID();
}

/**
 * @returns The run id for this attempt — pass to `markSharedIngestJobDone` / `markSharedIngestJobError`.
 */
export async function markSharedIngestJobRunning(
  jobId: string
): Promise<string | null> {
  const runId = newIngestRunId();
  const root = coordDir();
  if (!root) {
    const j = memJobs.get(jobId);
    if (j) {
      if (j.status === "error" || j.status === "done") {
        return null;
      }
      j.status = "running";
      j.activeRunId = runId;
      j.phaseKey = "structuring";
      j.phaseLabel = phaseDisplayLabel("structuring", "running");
      j.updatedAt = Date.now();
      memJobs.set(jobId, j);
      return runId;
    }
    return null;
  }
  let out: string | null = null;
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j) return;
    if (j.status === "error" || j.status === "done") {
      return;
    }
    j.status = "running";
    j.activeRunId = runId;
    j.phaseKey = "structuring";
    j.phaseLabel = phaseDisplayLabel("structuring", "running");
    j.updatedAt = Date.now();
    await writeJobFile(root, j);
    out = runId;
  });
  return out;
}

export async function updateSharedIngestJobPhase(
  jobId: string,
  phaseKey: SharedIngestPhaseKey,
  phaseLabel?: string
): Promise<void> {
  const label = phaseLabel ?? phaseDisplayLabel(phaseKey, "running");
  const root = coordDir();
  if (!root) {
    const j = memJobs.get(jobId);
    if (j && j.status === "running") {
      j.phaseKey = phaseKey;
      j.phaseLabel = label;
      j.updatedAt = Date.now();
      memJobs.set(jobId, j);
    }
    return;
  }
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j || j.status !== "running") return;
    j.phaseKey = phaseKey;
    j.phaseLabel = label;
    j.updatedAt = Date.now();
    await writeJobFile(root, j);
  });
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

async function patchSharedIngestJob(
  jobId: string,
  patcher: (job: SharedIngestJob, now: number) => void,
  options?: { runId?: string | null }
): Promise<void> {
  const root = coordDir();
  const now = Date.now();
  if (!root) {
    const j = memJobs.get(jobId);
    if (!j) return;
    if (
      options?.runId != null &&
      j.activeRunId != null &&
      options.runId !== j.activeRunId
    ) {
      return;
    }
    patcher(j, now);
    j.updatedAt = now;
    memJobs.set(jobId, j);
    return;
  }
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j) return;
    if (
      options?.runId != null &&
      j.activeRunId != null &&
      options.runId !== j.activeRunId
    ) {
      return;
    }
    patcher(j, now);
    j.updatedAt = now;
    await writeJobFile(root, j);
  });
}

export async function initializeSharedIngestSwarm(
  jobId: string,
  params: {
    runId: string;
    readerTasks: Array<{
      id: string;
      label: string;
      description: string;
    }>;
  }
): Promise<void> {
  await patchSharedIngestJob(
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

export async function updateSharedIngestReaderTask(
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
  await patchSharedIngestJob(
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
        ...(patch.progress !== undefined
          ? { progress: clampProgress(patch.progress) }
          : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined
          ? { outputPath: patch.outputPath }
          : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.retryCount !== undefined
          ? { retryCount: patch.retryCount }
          : {}),
        ...(patch.errorMessage !== undefined
          ? { errorMessage: patch.errorMessage }
          : {}),
        updatedAt: now,
      };
      j.readerTasks = [
        ...tasks.slice(0, idx),
        next,
        ...tasks.slice(idx + 1),
      ];
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export async function updateSharedIngestChallengeTask(
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
  await patchSharedIngestJob(
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
        ...(patch.progress !== undefined
          ? { progress: clampProgress(patch.progress) }
          : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined
          ? { outputPath: patch.outputPath }
          : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.retryRequests !== undefined
          ? { retryRequests: patch.retryRequests }
          : {}),
        ...(patch.errorMessage !== undefined
          ? { errorMessage: patch.errorMessage }
          : {}),
        updatedAt: now,
      };
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export async function updateSharedIngestMergeTask(
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
  await patchSharedIngestJob(
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
        ...(patch.progress !== undefined
          ? { progress: clampProgress(patch.progress) }
          : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
        ...(patch.outputPath !== undefined
          ? { outputPath: patch.outputPath }
          : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.errorMessage !== undefined
          ? { errorMessage: patch.errorMessage }
          : {}),
        updatedAt: now,
      };
      if (patch.outputPath) {
        j.swarmOutputPaths = [...new Set([...(j.swarmOutputPaths ?? []), patch.outputPath])];
      }
    },
    options
  );
}

export async function markSharedIngestJobDone(
  jobId: string,
  doneSnapshot?: {
    projectSlug: string;
    fileName: string;
    touchedPaths: string[];
    /** Must match the job’s `activeRunId` for this attempt (or omit for legacy). */
    runId?: string | null;
  }
): Promise<void> {
  const root = coordDir();
  if (doneSnapshot?.touchedPaths?.length) {
    const snap: SharedIngestLastSnapshot = {
      jobId,
      projectSlug: doneSnapshot.projectSlug,
      fileName: doneSnapshot.fileName,
      touchedPaths: doneSnapshot.touchedPaths,
      completedAt: Date.now(),
    };
    await persistLastIngestSnapshot(snap);
  }
  if (!root) {
    const j = memJobs.get(jobId);
    if (j) {
      if (j.status !== "running") {
        return;
      }
      if (
        doneSnapshot?.runId != null &&
        doneSnapshot.runId !== j.activeRunId
      ) {
        return;
      }
      j.status = "done";
      j.updatedAt = Date.now();
      j.activeRunId = undefined;
      if (doneSnapshot?.touchedPaths?.length) {
        j.touchedPaths = doneSnapshot.touchedPaths;
      }
      memJobs.set(jobId, j);
    }
    const i = memQueue.indexOf(jobId);
    if (i >= 0) memQueue.splice(i, 1);
    return;
  }
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j || j.status !== "running") {
      return;
    }
    if (
      doneSnapshot?.runId != null &&
      doneSnapshot.runId !== j.activeRunId
    ) {
      return;
    }
    j.status = "done";
    j.phaseLabel = "Complete";
    j.updatedAt = Date.now();
    j.activeRunId = undefined;
    if (doneSnapshot?.touchedPaths?.length) {
      j.touchedPaths = doneSnapshot.touchedPaths;
    }
    await writeJobFile(root, j);
    const q = await readQueue(root);
    q.order = q.order.filter((id) => id !== jobId);
    await writeQueue(root, q);
  });
}

export async function markSharedIngestJobError(
  jobId: string,
  message: string,
  options?: { runId?: string | null }
): Promise<void> {
  const root = coordDir();
  if (!root) {
    const j = memJobs.get(jobId);
    if (j) {
      if (j.status === "done") {
        return;
      }
      if (
        j.status === "running" &&
        options?.runId != null &&
        j.activeRunId !== options.runId
      ) {
        return;
      }
      j.status = "error";
      j.errorMessage = message.slice(0, 500);
      j.updatedAt = Date.now();
      j.activeRunId = undefined;
      memJobs.set(jobId, j);
    }
    const i = memQueue.indexOf(jobId);
    if (i >= 0) memQueue.splice(i, 1);
    return;
  }
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j || j.status === "done") {
      return;
    }
    if (
      j.status === "running" &&
      options?.runId != null &&
      j.activeRunId !== options.runId
    ) {
      return;
    }
    j.status = "error";
    j.errorMessage = message.slice(0, 500);
    j.updatedAt = Date.now();
    j.activeRunId = undefined;
    await writeJobFile(root, j);
    const q = await readQueue(root);
    q.order = q.order.filter((id) => id !== jobId);
    await writeQueue(root, q);
  });
}

export async function dismissSharedIngestJobError(
  jobId: string,
  projectSlug: string
): Promise<boolean> {
  const root = coordDir();
  if (!root) {
    const j = memJobs.get(jobId);
    if (!j || j.projectSlug !== projectSlug || j.status !== "error") return false;
    j.dismissedAt = Date.now();
    j.updatedAt = Date.now();
    memJobs.set(jobId, j);
    return true;
  }
  let dismissed = false;
  await withStateLock(root, async () => {
    const j = await readJobFile(root, jobId);
    if (!j || j.projectSlug !== projectSlug || j.status !== "error") return;
    j.dismissedAt = Date.now();
    j.updatedAt = Date.now();
    await writeJobFile(root, j);
    dismissed = true;
  });
  return dismissed;
}

/** `queued` + `running` for this slug in the global order (excludes `done` and `error` still in the queue file). */
export async function countActiveSharedIngestJobsForSlug(
  projectSlug: string
): Promise<number> {
  const root = coordDir();
  if (!root) {
    let n = 0;
    for (const id of memQueue) {
      const j = memJobs.get(id);
      if (!j || j.projectSlug !== projectSlug) continue;
      if (j.status === "queued" || j.status === "running") n += 1;
    }
    return n;
  }
  const q = await readQueue(root);
  let n = 0;
  for (const id of q.order) {
    const j = await readJobFile(root, id);
    if (!j || j.projectSlug !== projectSlug) continue;
    if (j.status === "queued" || j.status === "running") n += 1;
  }
  return n;
}

/**
 * If a job stays `running` with no `updatedAt` refresh (crashed/hung), unblock the queue
 * by moving it back to `queued` so `resume` can re-schedule.
 * Returns reaped `jobId`s.
 */
export async function reapStaleRunningSharedIngestJobs(
  now = Date.now(),
  options?: { profiles?: Iterable<IngestSourceProfile> }
): Promise<string[]> {
  const staleMs = staleRunningMsFromEnv();
  const allowedProfiles = profileSet(options?.profiles);
  const reaped: string[] = [];
  const root = coordDir();
  if (!root) {
    for (const [jobId, j] of memJobs) {
      if (j.status !== "running") continue;
      if (!jobMatchesProfiles(j, allowedProfiles)) continue;
      if (now - j.updatedAt < staleMs) continue;
      j.status = "queued";
      j.activeRunId = undefined;
      j.phaseKey = "unknown";
      j.phaseLabel = phaseDisplayLabel("unknown", "queued");
      j.updatedAt = now;
      memJobs.set(jobId, j);
      clearSharedIngestInFlight(jobId);
      reaped.push(jobId);
    }
    return reaped;
  }
  await withStateLock(root, async () => {
    const q = await readQueue(root);
    for (const id of q.order) {
      const j = await readJobFile(root, id);
      if (!j || j.status !== "running") continue;
      if (!jobMatchesProfiles(j, allowedProfiles)) continue;
      if (now - j.updatedAt < staleMs) continue;
      j.status = "queued";
      j.activeRunId = undefined;
      j.phaseKey = "unknown";
      j.phaseLabel = phaseDisplayLabel("unknown", "queued");
      j.updatedAt = now;
      await writeJobFile(root, j);
      clearSharedIngestInFlight(id);
      reaped.push(id);
    }
  });
  return reaped;
}

/** First `queued` job in global FIFO (for the architect ingest worker). */
export async function getNextQueuedJobGlobally(options?: {
  profiles?: Iterable<IngestSourceProfile>;
}): Promise<SharedIngestJob | null> {
  const allowedProfiles = profileSet(options?.profiles);
  const root = coordDir();
  if (!root) {
    for (const id of memQueue) {
      const j = memJobs.get(id);
      if (j?.status === "queued" && jobMatchesProfiles(j, allowedProfiles)) {
        return j;
      }
    }
    return null;
  }
  const q = await readQueue(root);
  for (const id of q.order) {
    const j = await readJobFile(root, id);
    if (j?.status === "queued" && jobMatchesProfiles(j, allowedProfiles)) {
      return j;
    }
  }
  return null;
}

export type IngestWorkerHeartbeat = {
  ts: number;
  version?: string;
  lastJobId: string | null;
};

export async function writeIngestWorkerHeartbeat(
  next: IngestWorkerHeartbeat
): Promise<void> {
  const root = coordDir();
  if (!root) {
    return;
  }
  const dir = join(root, "worker");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "heartbeat.json"),
    JSON.stringify({
      ts: next.ts,
      version: next.version ?? "1",
      lastJobId: next.lastJobId,
    }),
    "utf-8"
  );
}

export async function readIngestWorkerHeartbeat(): Promise<IngestWorkerHeartbeat | null> {
  const root = coordDir();
  if (!root) {
    return null;
  }
  try {
    const raw = await readFile(join(root, "worker", "heartbeat.json"), "utf-8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.ts !== "number" || !Number.isFinite(j.ts)) {
      return null;
    }
    return {
      ts: j.ts,
      version: typeof j.version === "string" ? j.version : "1",
      lastJobId: typeof j.lastJobId === "string" ? j.lastJobId : null,
    };
  } catch {
    return null;
  }
}

/** Job + queue context for UI (hero, single-job poll). */
export async function getSharedIngestJobForDisplay(
  jobId: string
): Promise<SharedIngestJobPublic | null> {
  const root = coordDir();
  const job = root
    ? await readJobFile(root, jobId)
    : memJobs.get(jobId) ?? null;
  if (!job) return null;
  if (job.status === "error" && isDismissedJob(job)) return null;

  if (job.status === "done" || job.status === "error") {
    return {
      ...job,
      globalQueueIndex: -1,
      slugQueuePosition: 0,
      isQueuedWaiting: false,
    };
  }

  if (!root) {
    const order = [...memQueue];
    let runningId: string | null = null;
    for (const id of order) {
      const j = memJobs.get(id);
      if (j?.status === "running") {
        runningId = id;
        break;
      }
    }
    const qpMap = assignSlugQueuePositions(order, (id) => memJobs.get(id), job.projectSlug);
    return decorateJob(job, order, runningId, qpMap.get(jobId) ?? 0);
  }

  const q = await readQueue(root);
  let runningId: string | null = null;
  const jobCache = new Map<string, SharedIngestJob | null>();
  for (const id of q.order) {
    const j = await readJobFile(root, id);
    jobCache.set(id, j);
    if (j?.status === "running") runningId = id;
  }
  const qpMap = assignSlugQueuePositions(
    q.order,
    (id) => jobCache.get(id) ?? null,
    job.projectSlug
  );
  const idx = q.order.indexOf(jobId);
  const orderForDecorate = idx >= 0 ? q.order : [...q.order, jobId];
  return decorateJob(
    job,
    orderForDecorate,
    runningId,
    qpMap.get(jobId) ?? 0
  );
}

export type SharedIngestJobPublic = SharedIngestJob & {
  /** Index in global FIFO, or -1 if not in queue (e.g. error orphan) */
  globalQueueIndex: number;
  /** 1-based among this workspace’s queued jobs only; 0 if running / error */
  slugQueuePosition: number;
  /** Queued and another job is currently running on the architect */
  isQueuedWaiting: boolean;
};

function decorateJob(
  job: SharedIngestJob,
  order: string[],
  runningId: string | null,
  slugQueuePosition: number
): SharedIngestJobPublic {
  const idx = order.indexOf(job.jobId);
  const isQueuedWaiting =
    job.status === "queued" &&
    runningId !== null &&
    runningId !== job.jobId;
  return {
    ...job,
    globalQueueIndex: idx,
    slugQueuePosition: job.status === "queued" ? slugQueuePosition : 0,
    isQueuedWaiting,
  };
}

function assignSlugQueuePositions(
  order: string[],
  getJob: (id: string) => SharedIngestJob | null | undefined,
  projectSlug: string
): Map<string, number> {
  const qp = new Map<string, number>();
  let n = 1;
  for (const id of order) {
    const j = getJob(id);
    if (
      j &&
      j.projectSlug === projectSlug &&
      j.status === "queued"
    ) {
      qp.set(id, n++);
    }
  }
  return qp;
}

export async function listSharedIngestJobsForSlug(
  projectSlug: string
): Promise<SharedIngestJobPublic[]> {
  const root = coordDir();
  if (!root) {
    const order = [...memQueue];
    const allJobs = [...memJobs.values()].filter((j) => j.projectSlug === projectSlug);
    let runningId: string | null = null;
    for (const id of order) {
      const j = memJobs.get(id);
      if (j?.status === "running") {
        runningId = id;
        break;
      }
    }
    const qpMap = assignSlugQueuePositions(order, (id) => memJobs.get(id), projectSlug);
    const out: SharedIngestJobPublic[] = [];
    for (const id of order) {
      const j = memJobs.get(id);
      if (!j || j.projectSlug !== projectSlug) continue;
      if (j.status === "done") continue;
      if (j.status === "error" && isDismissedJob(j)) continue;
      out.push(
        decorateJob(j, order, runningId, qpMap.get(id) ?? 0)
      );
    }
    for (const j of visibleErrorJobs(allJobs)) {
      if (!out.some((o) => o.jobId === j.jobId)) {
        out.push(decorateJob(j, order, runningId, 0));
      }
    }
    return out;
  }

  await mkdir(join(root, "jobs"), { recursive: true });
  const q = await readQueue(root);
  let runningId: string | null = null;
  for (const id of q.order) {
    const j = await readJobFile(root, id);
    if (j?.status === "running") {
      runningId = id;
      break;
    }
  }

  const jobCache = new Map<string, SharedIngestJob | null>();
  for (const id of q.order) {
    jobCache.set(id, await readJobFile(root, id));
  }
  const qpMap = assignSlugQueuePositions(
    q.order,
    (id) => jobCache.get(id) ?? null,
    projectSlug
  );

  const out: SharedIngestJobPublic[] = [];
  const allJobsById = new Map<string, SharedIngestJob>();
  for (const [id, job] of jobCache) {
    if (job?.projectSlug === projectSlug) {
      allJobsById.set(id, job);
    }
  }
  try {
    const files = await readdir(join(root, "jobs"));
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/, "");
      if (allJobsById.has(id)) continue;
      const j = await readJobFile(root, id);
      if (j?.projectSlug === projectSlug) {
        allJobsById.set(id, j);
      }
    }
  } catch {
    /* empty */
  }

  for (const id of q.order) {
    const j = jobCache.get(id);
    if (!j || j.projectSlug !== projectSlug) continue;
    if (j.status === "done") continue;
    if (j.status === "error" && isDismissedJob(j)) continue;
    out.push(decorateJob(j, q.order, runningId, qpMap.get(id) ?? 0));
  }

  for (const j of visibleErrorJobs([...allJobsById.values()])) {
    if (!out.some((o) => o.jobId === j.jobId)) {
      out.push(decorateJob(j, q.order, runningId, 0));
    }
  }

  return out;
}

/** Map stream headline / tool hint to phase (heuristic). */
export function guessPhaseFromActivity(text: string): {
  key: SharedIngestPhaseKey;
  label: string;
} {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  const t = raw.toLowerCase();
  if (t === "working" || t === "running command" || t === "running code") {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  if (
    t === STRUCTURING_PHASE_DISPLAY_LINE.toLowerCase() ||
    t === "processing your upload"
  ) {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  if (isMechanicalIngestStreamHeadline(raw)) {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  if (
    /deep\s+read|careful\s+read|reading\s+your\s+document|process(ing)?\s+your\s+upload/i.test(
      t
    )
  ) {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  if (
    /refin|periodic|global.*pass|cron/i.test(t)
  ) {
    return {
      key: "periodic_refinement",
      label: phaseDisplayLabel("periodic_refinement", "running"),
    };
  }
  if (/merge|dedup|anti-?drift|drift|hygiene|index\.md|log\.md|consisten/i.test(t)) {
    return {
      key: "merge_antidrift",
      label: phaseDisplayLabel("merge_antidrift", "running"),
    };
  }
  if (/relationship|link|wikilink|connect|graph/i.test(t)) {
    return {
      key: "relationships",
      label: phaseDisplayLabel("relationships", "running"),
    };
  }
  if (/reason|infer|complex|synthes/i.test(t)) {
    return {
      key: "reasoning",
      label: phaseDisplayLabel("reasoning", "running"),
    };
  }
  if (/entity|metadata|people|company|concept|wiki\/entities|companies\/|people\/|projects\//i.test(t)) {
    return {
      key: "entity_metadata",
      label: phaseDisplayLabel("entity_metadata", "running"),
    };
  }
  if (
    /structur|extract|section|intake|sources\/|markdown|read_file|write_file|\.(md|json|jsonl|yaml|yml)\b/i.test(t)
  ) {
    return {
      key: "structuring",
      label: phaseDisplayLabel("structuring", "running"),
    };
  }
  return {
    key: "unknown",
    label: phaseDisplayLabel("unknown", "running"),
  };
}
