import {
  readSessionsStore,
  resolveSessionKey,
  writeSessionsStore,
} from "@/lib/hermes-chat-store";
import {
  parseCreativeStudioPayload,
  type CreativeStudioSessionPayload,
} from "@/lib/creative-studio-session";
import {
  cleanupCreateKanbanBoard,
  listCreateKanbanBoards,
  type CreateKanbanBoard,
} from "@/lib/hermes-kanban";

function withoutLiveKanban(
  meta: CreativeStudioSessionPayload
): CreativeStudioSessionPayload {
  const {
    kanbanBoardSlug: _kanbanBoardSlug,
    kanbanBoardName: _kanbanBoardName,
    kanbanRootTaskId: _kanbanRootTaskId,
    kanbanTaskIds: _kanbanTaskIds,
    ...rest
  } = meta;
  return rest;
}

export async function finalizeCreateKanbanForSession(args: {
  sessionKey: string;
  expectedBoardSlug?: string | null;
}): Promise<void> {
  const store = await readSessionsStore();
  const resolvedKey = resolveSessionKey(store, args.sessionKey) || args.sessionKey;
  const entry = store[resolvedKey] as Record<string, unknown> | undefined;
  if (!entry || entry.chatType !== "creative_studio") return;

  const meta = parseCreativeStudioPayload(entry.creativeStudio);
  const boardSlug = meta?.kanbanBoardSlug?.trim();
  if (!meta || !boardSlug) return;
  const expected = args.expectedBoardSlug?.trim();
  if (expected && expected !== boardSlug) return;

  const result = await cleanupCreateKanbanBoard(boardSlug);
  const base = result.ok ? withoutLiveKanban(meta) : meta;
  const nextMeta: CreativeStudioSessionPayload = {
    ...base,
    ...(result.snapshot ? { kanbanSnapshot: result.snapshot } : {}),
    kanbanCleanupStatus: result.status,
    ...(result.ok ? { kanbanCleanedAt: result.cleanedAt } : {}),
    ...(result.error ? { kanbanCleanupError: result.error } : {}),
  };

  store[resolvedKey] = {
    ...entry,
    creativeStudio: nextMeta,
    updatedAt: Date.now(),
  };
  await writeSessionsStore(store);
}

let lastJanitorStartedAt = 0;
let janitorInFlight: Promise<void> | null = null;

function janitorIntervalMs(): number {
  const raw = Number.parseInt(process.env.CREATE_KANBAN_JANITOR_INTERVAL_MS || "", 10);
  if (Number.isFinite(raw) && raw >= 60_000) return Math.min(raw, 24 * 60 * 60 * 1000);
  return 10 * 60 * 1000;
}

function staleBoardMinAgeMs(): number {
  const raw = Number.parseInt(process.env.CREATE_KANBAN_STALE_MIN_AGE_MS || "", 10);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 7 * 24 * 60 * 60 * 1000);
  return 2 * 60 * 60 * 1000;
}

function boardCreatedAtMs(board: CreateKanbanBoard): number | null {
  const raw = board.created_at;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function isOldEnoughToSweep(board: CreateKanbanBoard, now: number): boolean {
  const createdAt = boardCreatedAtMs(board);
  if (createdAt == null) return true;
  return now - createdAt >= staleBoardMinAgeMs();
}

export function maybeRunCreateKanbanJanitor(): void {
  const now = Date.now();
  if (janitorInFlight) return;
  if (now - lastJanitorStartedAt < janitorIntervalMs()) return;
  lastJanitorStartedAt = now;
  janitorInFlight = sweepCreateKanbanBoards()
    .catch((err) => {
      console.warn("[create-kanban-janitor] sweep failed:", err);
    })
    .finally(() => {
      janitorInFlight = null;
    });
}

export async function sweepCreateKanbanBoards(): Promise<void> {
  const [store, boards] = await Promise.all([
    readSessionsStore(),
    listCreateKanbanBoards(),
  ]);
  if (boards.length === 0) return;

  const referenced = new Map<
    string,
    {
      key: string;
      entry: Record<string, unknown>;
      meta: CreativeStudioSessionPayload;
    }
  >();
  for (const [key, rawEntry] of Object.entries(store)) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;
    if (entry.chatType !== "creative_studio") continue;
    const meta = parseCreativeStudioPayload(entry.creativeStudio);
    const boardSlug = meta?.kanbanBoardSlug?.trim();
    if (!meta || !boardSlug) continue;
    referenced.set(boardSlug, { key, entry, meta });
  }

  let mutated = false;
  const now = Date.now();
  for (const board of boards) {
    const slug = board.slug.trim();
    const ref = referenced.get(slug);
    if (!ref && !isOldEnoughToSweep(board, now)) continue;

    const result = await cleanupCreateKanbanBoard(slug);
    if (!result.ok) continue;

    if (ref) {
      const nextMeta: CreativeStudioSessionPayload = {
        ...withoutLiveKanban(ref.meta),
        ...(result.snapshot ? { kanbanSnapshot: result.snapshot } : {}),
        kanbanCleanupStatus: result.status,
        kanbanCleanedAt: result.cleanedAt,
      };
      store[ref.key] = {
        ...ref.entry,
        creativeStudio: nextMeta,
        updatedAt: Date.now(),
      };
      mutated = true;
    }
  }

  if (mutated) {
    await writeSessionsStore(store);
  }
}
