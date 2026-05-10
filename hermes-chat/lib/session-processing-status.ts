import { readFile, readdir, stat, unlink } from "fs/promises";
import path from "path";

const STALE_MS = 30 * 60 * 1000;

export type ActiveProcessingEntry = {
  webchatId: string;
  ingestViaArchitect: boolean;
};

/**
 * Per active webchat id: `ingestViaArchitect` when the status file was written from
 * shared-vault → architect completion routing (see /api/chat/send writeStatusFile).
 */
export async function getActiveProcessingDetails(): Promise<
  Map<string, ActiveProcessingEntry>
> {
  const tmpFiles = await readdir("/tmp").catch(() => [] as string[]);
  const statusFiles = tmpFiles.filter(
    (f) =>
      f.startsWith("oc-status-") &&
      f.includes("webchat-") &&
      f.endsWith(".json")
  );

  const out = new Map<string, ActiveProcessingEntry>();
  for (const f of statusFiles) {
    const fullPath = path.join("/tmp", f);
    let webchatId: string;
    const webchatIdx = f.indexOf("webchat-");
    if (webchatIdx >= 0) webchatId = f.slice(webchatIdx + 8, -5);
    else continue;

    try {
      const s = await stat(fullPath);
      if (Date.now() - s.mtimeMs > STALE_MS) {
        await unlink(fullPath).catch(() => {});
        continue;
      }
      const raw = await readFile(fullPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        error?: string;
        ingestViaArchitect?: boolean;
      };
      if (parsed.error && String(parsed.error).trim().length > 0) {
        continue;
      }
      out.set(webchatId, {
        webchatId,
        ingestViaArchitect: parsed.ingestViaArchitect === true,
      });
    } catch {
      continue;
    }
  }
  return out;
}
