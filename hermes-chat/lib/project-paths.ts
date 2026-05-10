import path from "path";
import { getHermesDataDir } from "@/lib/hermes-config";

/** Workspace visibility for filesystem layout and prompts. */
export type WorkspaceVisibility = "private" | "shared";

/**
 * Writable project tree on the HermesChat server. Prefer `HERMES_PROJECTS_FS_ROOT` in Docker
 * (e.g. `/vault-projects`) so Next.js does not traverse a mode-700 `HERMES_DATA_DIR` to reach
 * `projects/`. Same host path as the gateway’s `HERMES_HOME/projects/` when using a single tree.
 *
 * Optional split mounts (same paths on Chat + Hermes + bridge):
 * - `HERMES_PROJECTS_PRIVATE_FS_ROOT` — private workspace slug directories
 * - `HERMES_PROJECTS_SHARED_FS_ROOT` — shared workspace slug directories
 * When unset, both use `getProjectsRoot()` (legacy single tree).
 */
export function getProjectsRoot(): string {
  const direct = process.env.HERMES_PROJECTS_FS_ROOT?.trim();
  if (direct) return direct;
  const root = getHermesDataDir();
  if (!root) {
    throw new Error(
      "Set HERMES_PROJECTS_FS_ROOT or HERMES_DATA_DIR for project vaults"
    );
  }
  return path.join(root, "projects");
}

function resolveFilesystemRoot(visibility: WorkspaceVisibility): string {
  const sharedRoot = process.env.HERMES_PROJECTS_SHARED_FS_ROOT?.trim();
  const privateRoot = process.env.HERMES_PROJECTS_PRIVATE_FS_ROOT?.trim();
  if (visibility === "shared" && sharedRoot) return sharedRoot;
  if (visibility === "private" && privateRoot) return privateRoot;
  return getProjectsRoot();
}

/** Absolute directory for a workspace slug (private vs shared roots when env split is configured). */
export function projectDirFor(slug: string, visibility: WorkspaceVisibility): string {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) throw new Error("Invalid project slug");
  return path.join(resolveFilesystemRoot(visibility), safe);
}

/** For API routes: null if vault storage is configured. */
export function getProjectVaultConfigError(): string | null {
  try {
    getProjectsRoot();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Project vault not configured";
  }
}

/** Relative path from Hermes HERMES_HOME for ingest messages (POSIX-style for the agent). */
export function projectRelativePath(slug: string, ...segments: string[]): string {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
  const parts = ["projects", safe, ...segments.map((s) => s.replace(/\\/g, "/"))];
  return parts.join("/");
}
