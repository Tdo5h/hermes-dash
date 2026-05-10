import path from "path";
import { access, stat } from "fs/promises";
import { projectDirFor, getProjectsRoot } from "@/lib/project-paths";
import { readProject, listVaultUploadedFiles } from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { getVaultIngestAutoStateDb, listVaultAssetsDb } from "@/lib/db/repositories";
import { sharedVaultAutoIngestEnv } from "@/lib/shared-vault-ingest-config";
import type { SharedVaultGapHint } from "@/lib/shared-vault-gap-types";

export type { SharedVaultGapHint } from "@/lib/shared-vault-gap-types";

/**
 * Pre-split shared vaults use `projectDirFor(…, "shared")/extracted`; legacy trees may still live under
 * `getProjectsRoot()/slug/extracted`. Returns the legacy dir if distinct and on disk, else null.
 */
export async function resolveLegacySharedExtractedDir(
  projectSlug: string,
  canonicalExtractedDir: string
): Promise<string | null> {
  try {
    const leg = path.join(getProjectsRoot(), projectSlug, "extracted");
    if (path.resolve(leg) === path.resolve(canonicalExtractedDir)) return null;
    try {
      const st = await stat(leg);
      if (st.isDirectory()) return leg;
    } catch {
      return null;
    }
  } catch {
    /* getProjectsRoot unset */
  }
  return null;
}

/**
 * `extract.py` writes `extracted/<sourcesBasename>.md` (e.g. `foo.pdf` → `foo.pdf.md`).
 * Legacy vaults may only have `extracted/<stem>.md` (`foo.md`).
 */
export async function hasExtractedMarkdownForSource(
  extractedDir: string,
  sourceBasename: string
): Promise<boolean> {
  const canonical = path.join(extractedDir, `${sourceBasename}.md`);
  try {
    await access(canonical);
    return true;
  } catch {
    /* try legacy */
  }
  const stem = path.parse(sourceBasename).name;
  if (!stem) return false;
  const legacy = path.join(extractedDir, `${stem}.md`);
  try {
    await access(legacy);
    return true;
  } catch {
    return false;
  }
}

/**
 * Heuristic: source `foo.pdf` is "ingested" if `extracted/foo.pdf.md` or legacy `extracted/foo.md` exists.
 */
export async function listSharedSourcesMissingExtracted(
  projectSlug: string
): Promise<{ name: string; relativePath: string }[]> {
  const meta = await readProject(projectSlug);
  if (!meta || meta.visibility !== "shared") return [];

  const files = await listVaultUploadedFiles(projectSlug);
  const registeredSourcePaths =
    shouldUseChatDatabase() ? new Set((await listVaultAssetsDb(projectSlug)).map((f) => f.relativePath)) : null;
  const root = projectDirFor(projectSlug, "shared");
  const extractedDir = path.join(root, "extracted");
  const legacyExtractedDir = await resolveLegacySharedExtractedDir(projectSlug, extractedDir);

  const out: { name: string; relativePath: string }[] = [];
  for (const f of files) {
    // Shared-vault auto ingest must only act on files the user explicitly put
    // through HermesChat's upload/paste ingest flow. Assistant/tool-created
    // files may appear on disk under sources/, but they do not get a
    // materialized vault_assets row and must not wake the architect worker.
    if (registeredSourcePaths && !registeredSourcePaths.has(f.relativePath)) continue;
    if (!path.parse(f.name).name) continue;
    let ok = await hasExtractedMarkdownForSource(extractedDir, f.name);
    if (!ok && legacyExtractedDir) {
      ok = await hasExtractedMarkdownForSource(legacyExtractedDir, f.name);
    }
    if (!ok) out.push({ name: f.name, relativePath: f.relativePath });
  }
  return out;
}

/** UI chips for sources without extracted/*.md (shared vaults). */
export async function buildSharedVaultGapHints(
  projectSlug: string,
  now = Date.now()
): Promise<SharedVaultGapHint[] | null> {
  const meta = await readProject(projectSlug);
  if (!meta || meta.visibility !== "shared") return null;

  const cfg = sharedVaultAutoIngestEnv();
  const gaps = await listSharedSourcesMissingExtracted(projectSlug);
  const hints: SharedVaultGapHint[] = [];

  for (const g of gaps) {
    let kind: SharedVaultGapHint["kind"] = "missing_extracted";
    let detail: string | undefined;
    if (shouldUseChatDatabase()) {
      const st = await getVaultIngestAutoStateDb(projectSlug, g.relativePath);
      if (st?.pausedUntil != null && st.pausedUntil > now) {
        kind = "circuit_paused";
        detail = st.lastError ?? undefined;
      } else if ((st?.autoAttemptCount ?? 0) >= cfg.maxAttempts) {
        kind = "auto_exhausted";
        detail = st?.lastError ?? undefined;
      }
    }
    hints.push({
      relativePath: g.relativePath,
      name: g.name,
      kind,
      detail,
    });
  }

  return hints;
}
