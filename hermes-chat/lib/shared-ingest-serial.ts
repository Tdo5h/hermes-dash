import { mkdir, open, stat, unlink } from "fs/promises";
import { join } from "path";

let localExclusiveChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function coordDirFromEnv(): string | null {
  const d =
    process.env.HERMES_SHARED_INGEST_COORD_DIR?.trim() ||
    process.env.HERMES_ARCHITECT_INGEST_COORD_DIR?.trim();
  return d || null;
}

function staleMsFromEnv(): number {
  const raw = process.env.HERMES_ARCHITECT_INGEST_LOCK_STALE_MS?.trim();
  if (!raw) return 7_200_000; // 2h — long multi-stage ingest
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return 7_200_000;
  return Math.min(Math.floor(n), 86_400_000);
}

async function acquireExclusiveLock(
  lockPath: string,
  staleMs: number
): Promise<() => Promise<void>> {
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
        `pid=${process.pid}\nstarted=${new Date().toISOString()}\n`,
        "utf8"
      );
      return release;
    } catch {
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        /* raced: lock removed */
      }
      const backoff = Math.min(250 + Math.floor(Math.random() * 250), 8000);
      await sleep(backoff);
      if (Date.now() - waitStart > 86_400_000) {
        throw new Error(
          "Timeout waiting for shared-wiki ingest lock (24h). Check HERMES_SHARED_INGEST_COORD_DIR and remove a stale lock file if a process crashed."
        );
      }
    }
  }
}

/**
 * Runs one shared-wiki ingest at a time.
 *
 * - With `HERMES_SHARED_INGEST_COORD_DIR` set (shared volume across Chat containers): file lock
 *   serializes uploads from user1, user2, etc.
 * - Without it: in-process FIFO only (single replica / dev).
 */
export async function withSharedIngestExclusive<T>(
  fn: () => Promise<T>
): Promise<T> {
  const coord = coordDirFromEnv();
  if (!coord) {
    const result = localExclusiveChain.then(() => fn());
    localExclusiveChain = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  await mkdir(coord, { recursive: true });
  const lockPath = join(coord, "shared-wiki-ingest.lock");
  const release = await acquireExclusiveLock(lockPath, staleMsFromEnv());
  try {
    return await fn();
  } finally {
    await release();
  }
}
