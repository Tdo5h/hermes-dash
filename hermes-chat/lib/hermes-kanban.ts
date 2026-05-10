import { hermesGatewayAdminFetch } from "@/lib/hermes-gateway-admin";
import type { CreativeStudioIntent } from "@/lib/creative-studio-session";

export type CreateKanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: string;
  priority?: number;
  created_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
  latest_summary?: string | null;
  last_failure_error?: string | null;
  worker_pid?: number | null;
  current_run_id?: number | null;
};

export type CreateKanbanSession = {
  boardSlug: string;
  boardName: string;
  rootTaskId?: string;
  taskIds: string[];
};

export type CreateKanbanBoard = {
  slug: string;
  name?: string | null;
  description?: string | null;
  created_at?: number | null;
  archived?: boolean;
};

export type CreateKanbanSnapshot = {
  boardSlug: string;
  tasks: CreateKanbanTask[];
  cleanedAt?: string;
  cleanupStatus?: CreateKanbanCleanupStatus;
};

export type CreateKanbanCleanupStatus =
  | "deleted"
  | "archived"
  | "skipped"
  | "failed";

export type CreateKanbanCleanupResult = {
  boardSlug: string;
  ok: boolean;
  status: CreateKanbanCleanupStatus;
  cleanedAt: string;
  snapshot: CreateKanbanSnapshot | null;
  error?: string;
};

function createKanbanEnabled(): boolean {
  const raw = process.env.CREATE_KANBAN_ENABLED?.trim().toLowerCase();
  return raw == null || raw === "" || raw === "1" || raw === "true" || raw === "yes";
}

function createKanbanWorkerProfile(): string {
  return process.env.CREATE_KANBAN_WORKER_PROFILE?.trim() || "default";
}

export function createKanbanBoardSlug(sessionId: string): string {
  const compact = sessionId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `create-${compact.slice(0, 24) || "session"}`;
}

function createTaskBody(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

async function postKanban<T>(path: string, body: unknown): Promise<T | null> {
  const res = await hermesGatewayAdminFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 8_000,
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function getKanban<T>(path: string): Promise<T | null> {
  const res = await hermesGatewayAdminFetch(path, {
    method: "GET",
    timeoutMs: 8_000,
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function deleteKanban<T>(path: string): Promise<T | null> {
  const res = await hermesGatewayAdminFetch(path, {
    method: "DELETE",
    timeoutMs: 12_000,
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

function isCreateBoardSlug(slug: string): boolean {
  return /^create-[a-z0-9][a-z0-9_-]{1,80}$/.test(slug);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupWaitMs(): number {
  const raw = Number.parseInt(process.env.CREATE_KANBAN_CLEANUP_WAIT_MS || "", 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 180_000);
  return 75_000;
}

function cleanupPollMs(): number {
  const raw = Number.parseInt(process.env.CREATE_KANBAN_CLEANUP_POLL_MS || "", 10);
  if (Number.isFinite(raw) && raw >= 500) return Math.min(raw, 10_000);
  return 2_500;
}

function taskIsBuildLane(task: CreateKanbanTask): boolean {
  const title = task.title.toLowerCase();
  return title.includes("build") || title.includes("artifact");
}

function taskIsRunning(task: CreateKanbanTask): boolean {
  return (
    task.status === "running" ||
    typeof task.worker_pid === "number" ||
    typeof task.current_run_id === "number"
  );
}

function hasActiveWorker(snapshot: CreateKanbanSnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.tasks.some((task) => {
    if (taskIsBuildLane(task)) return false;
    if (taskIsRunning(task)) return true;
    if (!task.assignee) return false;
    return task.status === "todo" || task.status === "ready";
  });
}

function hasRunningTask(snapshot: CreateKanbanSnapshot | null): boolean {
  return Boolean(snapshot?.tasks.some(taskIsRunning));
}

export async function ensureCreateKanbanSession(args: {
  sessionId: string;
  intent: CreativeStudioIntent;
  label: string;
  seedPrompt?: string;
  referenceVaultName?: string;
}): Promise<CreateKanbanSession | null> {
  if (!createKanbanEnabled()) return null;

  const boardSlug = createKanbanBoardSlug(args.sessionId);
  const boardName = `Create ${args.label}`;
  const workerProfile = createKanbanWorkerProfile();
  const board = await postKanban<{ board?: unknown }>("/api/kanban/boards", {
    slug: boardSlug,
    name: boardName,
    description: `Hermes Create board for chat ${args.sessionId}`,
    icon: "*",
    color: "#60a5fa",
  });
  if (!board) return null;

  const taskIds: string[] = [];
  const root = await postKanban<{ task?: CreateKanbanTask }>(
    `/api/kanban/boards/${encodeURIComponent(boardSlug)}/tasks`,
    {
      title: "Create orchestration plan",
      body: createTaskBody([
        "Worker card: produce a concise execution plan for the Create run. Do not build the final artifact from this card.",
        `Intent: ${args.label} (${args.intent})`,
        args.referenceVaultName ? `Reference vault: ${args.referenceVaultName}` : "",
        args.seedPrompt ? `Seed request: ${args.seedPrompt.slice(0, 1200)}` : "",
        "Complete with the route, parallelizable context reads, build lane, and QA gates the parent Hermes run should use.",
      ]),
      assignee: workerProfile,
      triage: false,
      priority: 100,
      maxRuntimeSeconds: 600,
      idempotencyKey: `creative:${args.sessionId}:root`,
      createdBy: "hermes-chat-create",
    }
  );
  const rootTaskId = root?.task?.id;
  if (rootTaskId) taskIds.push(rootTaskId);

  const seeded = [
    {
      key: "route",
      title: "Route brief and Design DNA",
      body: createTaskBody([
        "Worker card: inspect the Create brief, output format, candidate Open Design skills, and selected Design DNA.",
        "Complete with the recommended route, slide/deck structure implications, constraints, and gotchas. Do not create the final artifact.",
      ]),
      priority: 80,
      assignee: workerProfile,
      triage: false,
      maxRuntimeSeconds: 600,
    },
    {
      key: "context",
      title: "Gather vault and asset context",
      body: createTaskBody([
        "Worker card: read only the selected vault/files/images/templates named in the brief, when present.",
        "Complete with concise source facts, asset constraints, missing inputs, and anything the build lane must not invent. Do not create the final artifact.",
      ]),
      priority: 70,
      assignee: workerProfile,
      triage: false,
      maxRuntimeSeconds: 900,
    },
    {
      key: "build",
      title: "Build primary artifact",
      body: "Main Hermes lane: create the user-facing artifact in Builds or via the selected tool, honoring the chosen route and the user's prompt. This card tracks the parent run; it is not auto-dispatched as a worker to avoid competing final artifacts.",
      priority: 60,
      triage: true,
    },
    {
      key: "qa",
      title: "QA, polish, and publish links",
      body: createTaskBody([
        "Worker card: prepare a targeted QA checklist from the brief, selected route, and medium.",
        "Complete with concrete checks for mobile/layout/content/export/link verification. Do not claim final QA until the parent build exists.",
      ]),
      priority: 50,
      assignee: workerProfile,
      triage: false,
      maxRuntimeSeconds: 600,
    },
  ];

  for (const item of seeded) {
    const created = await postKanban<{ task?: CreateKanbanTask }>(
      `/api/kanban/boards/${encodeURIComponent(boardSlug)}/tasks`,
      {
        title: item.title,
        body: item.body,
        ...(item.assignee ? { assignee: item.assignee } : {}),
        triage: item.triage,
        priority: item.priority,
        parents: [],
        idempotencyKey: `creative:${args.sessionId}:${item.key}`,
        createdBy: "hermes-chat-create",
        ...(item.maxRuntimeSeconds ? { maxRuntimeSeconds: item.maxRuntimeSeconds } : {}),
      }
    );
    if (created?.task?.id) taskIds.push(created.task.id);
  }

  return { boardSlug, boardName, rootTaskId, taskIds };
}

export async function readCreateKanbanSnapshot(
  boardSlug: string
): Promise<CreateKanbanSnapshot | null> {
  const slug = boardSlug.trim();
  if (!slug || !createKanbanEnabled() || !isCreateBoardSlug(slug)) return null;
  const data = await getKanban<{ tasks?: CreateKanbanTask[] }>(
    `/api/kanban/boards/${encodeURIComponent(slug)}/tasks?limit=100`
  );
  if (!data) return null;
  return {
    boardSlug: slug,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
  };
}

export async function listCreateKanbanBoards(): Promise<CreateKanbanBoard[]> {
  if (!createKanbanEnabled()) return [];
  const data = await getKanban<{ boards?: CreateKanbanBoard[] }>(
    "/api/kanban/boards"
  );
  if (!data || !Array.isArray(data.boards)) return [];
  return data.boards.filter(
    (board) =>
      typeof board.slug === "string" &&
      isCreateBoardSlug(board.slug) &&
      board.archived !== true
  );
}

export async function waitForCreateKanbanSnapshotIdle(
  boardSlug: string
): Promise<CreateKanbanSnapshot | null> {
  const deadline = Date.now() + cleanupWaitMs();
  let snapshot = await readCreateKanbanSnapshot(boardSlug).catch(() => null);
  while (hasActiveWorker(snapshot) && Date.now() < deadline) {
    await wait(cleanupPollMs());
    snapshot = await readCreateKanbanSnapshot(boardSlug).catch(() => snapshot);
  }
  return snapshot;
}

export async function cleanupCreateKanbanBoard(
  boardSlug: string
): Promise<CreateKanbanCleanupResult> {
  const slug = boardSlug.trim();
  const cleanedAt = new Date().toISOString();
  if (!slug || !isCreateBoardSlug(slug)) {
    return {
      boardSlug: slug,
      ok: false,
      status: "failed",
      cleanedAt,
      snapshot: null,
      error: "Refusing to clean up a non-Create Kanban board.",
    };
  }

  const snapshot = await waitForCreateKanbanSnapshotIdle(slug).catch(() => null);
  if (hasRunningTask(snapshot)) {
    return {
      boardSlug: slug,
      ok: false,
      status: "skipped",
      cleanedAt,
      snapshot,
      error: "Kanban board still has a running worker; cleanup deferred.",
    };
  }

  const deleted = await deleteKanban<{
    deleted?: boolean;
    archived?: boolean;
    error?: string;
  }>(`/api/kanban/boards/${encodeURIComponent(slug)}?delete=1`);
  if (!deleted) {
    return {
      boardSlug: slug,
      ok: false,
      status: "failed",
      cleanedAt,
      snapshot,
      error: "Gateway did not delete the Create Kanban board.",
    };
  }

  return {
    boardSlug: slug,
    ok: true,
    status: deleted.deleted ? "deleted" : deleted.archived ? "archived" : "deleted",
    cleanedAt,
    snapshot: snapshot
      ? {
          ...snapshot,
          cleanedAt,
          cleanupStatus: deleted.deleted ? "deleted" : "archived",
        }
      : null,
  };
}
