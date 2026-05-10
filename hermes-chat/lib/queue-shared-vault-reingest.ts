import path from "path";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  clearVaultIngestPauseForManualDb,
  getVaultAssetRoleByPathDb,
} from "@/lib/db/repositories";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import { getIngestEnqueueDefaultProfile } from "@/lib/ingest-enqueue-default-profile";
import { enqueueSharedIngestJob } from "@/lib/shared-ingest-job-store";
import {
  readProject,
  listVaultUploadedFiles,
  mimeTypeForVaultBasename,
  sanitizeVaultSourceBasename,
} from "@/lib/project-service";

/**
 * Enqueue architect ingest for an existing shared-vault source (manual Re-ingest).
 * Bypasses upload `skippedWrite` dead-end.
 */
export async function queueSharedVaultArchitectReingest(
  projectSlug: string,
  fileNameOrRelativePath: string
): Promise<{ jobId: string }> {
  const meta = await readProject(projectSlug);
  if (!meta || meta.visibility !== "shared") {
    throw new Error("Shared vault required");
  }

  const raw = fileNameOrRelativePath.trim();
  const asBasename = sanitizeVaultSourceBasename(raw);
  const files = await listVaultUploadedFiles(projectSlug);
  const row =
    files.find((f) => f.relativePath === raw) ||
    files.find((f) => f.name === raw) ||
    (asBasename ? files.find((f) => f.name === asBasename) : undefined) ||
    files.find((f) => f.relativePath.endsWith(`/sources/${path.posix.basename(raw)}`));

  if (!row) {
    throw new Error("File not found under sources/");
  }

  if (shouldUseChatDatabase()) {
    await clearVaultIngestPauseForManualDb(projectSlug, row.relativePath, Date.now());
  }

  let duplicate = false;
  if (row.sha256) {
    for (const f of files) {
      if (f.relativePath !== row.relativePath && f.sha256 === row.sha256) {
        duplicate = true;
        break;
      }
    }
  }

  const roleStr = shouldUseChatDatabase()
    ? await getVaultAssetRoleByPathDb(projectSlug, row.relativePath)
    : null;
  const assetRole = normalizeVaultAssetRole(roleStr ?? "general_reference");
  const { jobId } = await enqueueSharedIngestJob({
    projectSlug,
    relativePath: row.relativePath,
    fileName: row.name,
    ingestSourceProfile: getIngestEnqueueDefaultProfile(),
    mimeType: mimeTypeForVaultBasename(row.name),
    duplicate,
    reingestVerify: true,
    ...(assetRole !== "general_reference" ? { assetRole } : {}),
  });

  return { jobId };
}
