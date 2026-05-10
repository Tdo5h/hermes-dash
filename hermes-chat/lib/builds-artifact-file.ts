import { readFile, stat } from "fs/promises";
import path from "path";
import {
  MAX_VAULT_SOURCE_FILE_BYTES,
  mimeTypeForVaultBasename,
} from "@/lib/project-service";
import { findBuildListAppById } from "@/lib/builds-manifest";

/**
 * Safe relative path under a build app folder (e.g. `document.pdf`, `export/deck.pdf`).
 * Rejects `..`, dotfiles, empty segments, and odd characters.
 */
export function sanitizeBuildArtifactRelativePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) return null;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 24) return null;
  const safePart = /^[a-zA-Z0-9._-]+$/;
  for (const p of parts) {
    if (p === "." || p === ".." || p.startsWith(".")) return null;
    if (!safePart.test(p)) return null;
  }
  return parts.join("/");
}

export type ReadBuildArtifactResult =
  | { ok: true; buffer: Buffer; fileName: string; mime: string }
  | {
      ok: false;
      reason: "not_found" | "too_large" | "invalid" | "no_folder" | "missing_build";
    };

export async function readBuildArtifactForDownload(
  buildId: string,
  rawName: string
): Promise<ReadBuildArtifactResult> {
  const rel = sanitizeBuildArtifactRelativePath(rawName);
  if (!rel) return { ok: false, reason: "invalid" };

  const entry = await findBuildListAppById(buildId);
  if (!entry) return { ok: false, reason: "missing_build" };
  if (!entry.appFolder) return { ok: false, reason: "no_folder" };

  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const baseDir = path.resolve(root, entry.appFolder);
  const rootResolved = path.resolve(root);
  const sep = path.sep;
  if (baseDir !== rootResolved && !baseDir.startsWith(rootResolved + sep)) {
    return { ok: false, reason: "invalid" };
  }

  const abs = path.resolve(baseDir, rel);
  if (abs !== baseDir && !abs.startsWith(baseDir + sep)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const st = await stat(abs);
    if (!st.isFile()) return { ok: false, reason: "not_found" };
    if (st.size > MAX_VAULT_SOURCE_FILE_BYTES) {
      return { ok: false, reason: "too_large" };
    }
    const buffer = await readFile(abs);
    const fileName = path.basename(rel);
    return {
      ok: true,
      buffer,
      fileName,
      mime: mimeTypeForVaultBasename(fileName),
    };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}
