import path from "path";
import { projectDirFor } from "@/lib/project-paths";
import { readProject, listVaultUploadedFiles, type ProjectRecord } from "@/lib/project-service";
import {
  hasExtractedMarkdownForSource,
  listSharedSourcesMissingExtracted,
  resolveLegacySharedExtractedDir,
} from "@/lib/vault-ingest-gap";
import {
  enqueueSharedIngestJob,
  listSharedIngestJobsForSlug,
} from "@/lib/shared-ingest-job-store";
import { getIngestEnqueueDefaultProfile } from "@/lib/ingest-enqueue-default-profile";
import { mimeTypeForVaultBasename } from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  getVaultIngestAutoStateDb,
  getVaultAssetRoleByPathDb,
  bumpVaultIngestAutoAttemptDb,
  insertJobDb,
  markVaultIngestLogAppendedDb,
  resetVaultIngestAfterSuccessDb,
} from "@/lib/db/repositories";
import { sharedVaultAutoIngestEnv } from "@/lib/shared-vault-ingest-config";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";

export { sharedVaultAutoIngestEnv } from "@/lib/shared-vault-ingest-config";

const lastScanBySlug = new Map<string, number>();

/** Clear per-file auto-ingest counters when extracted peer exists (disk is source of truth). */
export async function reconcileSharedVaultIngestSuccess(
  projectSlug: string,
  now = Date.now()
): Promise<void> {
  if (!shouldUseChatDatabase()) return;
  const project = await readProject(projectSlug);
  if (!project || project.visibility !== "shared") return;

  const files = await listVaultUploadedFiles(projectSlug);
  const root = projectDirFor(projectSlug, "shared");
  const extractedDir = path.join(root, "extracted");
  const legacyExtractedDir = await resolveLegacySharedExtractedDir(
    projectSlug,
    extractedDir
  );

  for (const f of files) {
    if (!path.parse(f.name).name) continue;
    let ok = await hasExtractedMarkdownForSource(extractedDir, f.name);
    if (!ok && legacyExtractedDir) {
      ok = await hasExtractedMarkdownForSource(legacyExtractedDir, f.name);
    }
    if (ok) {
      await resetVaultIngestAfterSuccessDb(projectSlug, f.relativePath, now);
    }
  }
}

export type MaybeRunSharedVaultAutoIngestOptions = {
  /** Bypass scan throttle (e.g. first poll after opening chat). */
  forceScan?: boolean;
};

/**
 * Throttled scan + bounded auto-enqueue for shared vaults (Postgres deployments).
 * Call from GET shared-ingest-status.
 */
export async function maybeRunSharedVaultAutoIngest(
  projectSlug: string,
  now = Date.now(),
  options?: MaybeRunSharedVaultAutoIngestOptions
): Promise<{ scanned: boolean; enqueued: string[] }> {
  const cfg = sharedVaultAutoIngestEnv();
  const enqueued: string[] = [];
  if (!shouldUseChatDatabase() || !cfg.enabled) {
    return { scanned: false, enqueued };
  }

  const project = await readProject(projectSlug);
  if (!project || project.visibility !== "shared") {
    return { scanned: false, enqueued };
  }

  const last = lastScanBySlug.get(projectSlug) ?? 0;
  const bypassThrottle = options?.forceScan === true;
  if (!bypassThrottle && now - last < cfg.scanThrottleMs) {
    return { scanned: false, enqueued };
  }
  lastScanBySlug.set(projectSlug, now);

  const gaps = await listSharedSourcesMissingExtracted(projectSlug);
  if (gaps.length === 0) {
    return { scanned: true, enqueued };
  }

  const jobs = await listSharedIngestJobsForSlug(projectSlug);
  const activePaths = new Set<string>();
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") {
      activePaths.add(j.relativePath);
    }
  }

  const files = await listVaultUploadedFiles(projectSlug);
  const byPath = new Map(files.map((f) => [f.relativePath, f]));

  for (const g of gaps) {
    const state = await getVaultIngestAutoStateDb(projectSlug, g.relativePath);
    if (state?.pausedUntil != null && state.pausedUntil > now) {
      continue;
    }
    const attempts = state?.autoAttemptCount ?? 0;
    if (attempts >= cfg.maxAttempts) {
      if (!state?.logLineAppendedAt) {
        const line = `HermesChat auto-ingest gave up after ${cfg.maxAttempts} attempt(s) for sources/${g.name} (no extracted/${g.name}.md or legacy extracted stem). Re-ingest from vault files or fix shared ingest.`;
        try {
          await insertJobDb("append_shared_vault_log", {
            projectSlug,
            line,
          });
          await markVaultIngestLogAppendedDb(projectSlug, g.relativePath, now);
        } catch (e) {
          console.error("[shared-vault-auto-ingest] LOG append job:", e);
        }
      }
      continue;
    }

    if (
      state?.lastAutoAttemptAt != null &&
      now - state.lastAutoAttemptAt < cfg.cooldownMs
    ) {
      continue;
    }

    if (activePaths.has(g.relativePath)) {
      continue;
    }

    const row = byPath.get(g.relativePath);
    if (!row) continue;

    const hex = row.sha256;
    let duplicate = false;
    if (hex) {
      for (const f of files) {
        if (f.relativePath !== g.relativePath && f.sha256 === hex) {
          duplicate = true;
          break;
        }
      }
    }

    await bumpVaultIngestAutoAttemptDb(projectSlug, g.relativePath, now);
    const roleStr = await getVaultAssetRoleByPathDb(projectSlug, row.relativePath);
    const assetRole = normalizeVaultAssetRole(roleStr ?? "general_reference");
    const { jobId } = await enqueueSharedIngestJob({
      projectSlug,
      relativePath: row.relativePath,
      fileName: row.name,
      ingestSourceProfile: getIngestEnqueueDefaultProfile(),
      mimeType: mimeTypeForVaultBasename(row.name),
      duplicate,
      ...(assetRole !== "general_reference" ? { assetRole } : {}),
    });
    enqueued.push(g.relativePath);
    activePaths.add(g.relativePath);
  }

  return { scanned: true, enqueued };
}
