import path from "path";
import { mkdir, writeFile, readFile, readdir, stat, unlink, rm } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import {
  projectDirFor,
  getProjectsRoot,
  projectRelativePath,
  type WorkspaceVisibility,
} from "@/lib/project-paths";
import { schemaTemplate, indexTemplate } from "@/lib/vault-templates";
import { getVaultStagingDir } from "@/lib/hermes-config";
import { shouldUseChatDatabase } from "@/lib/db/client";
import {
  listWorkspaceProjectsDb,
  getWorkspaceProjectDb,
  insertWorkspaceProjectDb,
  insertJobDb,
  waitForJobDb,
  listVaultAssetsDb,
  deleteWorkspaceProjectDb,
  listSharedWorkspaceProjectsDb,
  updateWorkspaceProjectNameDb,
} from "@/lib/db/repositories";

const VAULT_MANIFEST_FILE = ".vault-manifest.json";

/** Setgid + group rwx: Hermes agent (10000) can write via gid 1001 before entrypoint chown to 10000:1001. */
const VAULT_DIR_MODE = 0o2775;

export type VaultManifestFileEntry = {
  sha256: string;
  size: number;
  updatedAt: number;
};

export type VaultManifest = {
  files: Record<string, VaultManifestFileEntry>;
};

export type ProjectRecord = {
  slug: string;
  name: string;
  createdAt: number;
  visibility: WorkspaceVisibility;
};

function tenantIdForNewPrivateWorkspace(): string | null {
  const t = process.env.HERMES_CHAT_TENANT_ID?.trim();
  return t || null;
}

/** Absolute root directory for a workspace (uses DB / project.json for visibility). */
export async function resolveProjectRoot(slug: string): Promise<string> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  return projectDirFor(slug, meta.visibility);
}

async function vaultManifestPath(slug: string): Promise<string> {
  const root = await resolveProjectRoot(slug);
  return path.join(root, "sources", VAULT_MANIFEST_FILE);
}

async function readVaultManifest(slug: string): Promise<VaultManifest> {
  try {
    const raw = await readFile(await vaultManifestPath(slug), "utf-8");
    const j = JSON.parse(raw) as { files?: Record<string, VaultManifestFileEntry> };
    if (j.files && typeof j.files === "object") return { files: j.files };
  } catch {
    /* new vault */
  }
  return { files: {} };
}

async function writeVaultManifest(slug: string, m: VaultManifest): Promise<void> {
  await writeFile(await vaultManifestPath(slug), JSON.stringify(m, null, 2), "utf-8");
}

export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return base || "workspace";
}

async function slugExistsOnDisk(slug: string): Promise<boolean> {
  const roots = new Set<string>();
  try {
    roots.add(getProjectsRoot());
  } catch {
    return false;
  }
  const pr = process.env.HERMES_PROJECTS_PRIVATE_FS_ROOT?.trim();
  const sr = process.env.HERMES_PROJECTS_SHARED_FS_ROOT?.trim();
  if (pr) roots.add(pr);
  if (sr) roots.add(sr);
  for (const r of roots) {
    try {
      await stat(path.join(r, slug));
      return true;
    } catch {
      /* */
    }
  }
  return false;
}

async function uniqueSlug(desired: string): Promise<string> {
  let s = desired;
  for (let i = 0; i < 50; i++) {
    if (shouldUseChatDatabase()) {
      const existing = await getWorkspaceProjectDb(s);
      if (!existing) return s;
    } else {
      if (!(await slugExistsOnDisk(s))) return s;
    }
    s = `${desired}-${randomUUID().slice(0, 6)}`;
  }
  return `${desired}-${randomUUID().slice(0, 8)}`;
}

async function writeTree(slug: string, name: string, visibility: WorkspaceVisibility) {
  const root = projectDirFor(slug, visibility);
  await mkdir(path.join(root, "sources"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "extracted"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "entities"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "entities", "people"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "entities", "companies"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "entities", "projects"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "concepts"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "comparisons"), { recursive: true, mode: VAULT_DIR_MODE });
  await mkdir(path.join(root, "wiki", "queries"), { recursive: true, mode: VAULT_DIR_MODE });

  const meta = { name, slug, createdAt: Date.now(), visibility };
  await writeFile(
    path.join(root, "project.json"),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );

  const schemaPath = path.join(root, "SCHEMA.md");
  try {
    await readFile(schemaPath, "utf-8");
  } catch {
    await writeFile(schemaPath, schemaTemplate(name), "utf-8");
  }

  for (const f of ["INDEX.md", "LOG.md"]) {
    const p = path.join(root, f);
    try {
      await readFile(p, "utf-8");
    } catch {
      await writeFile(
        p,
        f === "INDEX.md" ? indexTemplate(name) : `# Log — ${name}\n\n`,
        "utf-8"
      );
    }
  }
}

export type CreateProjectOptions = {
  visibility?: WorkspaceVisibility;
};

function assertExactProjectSlug(slug: string): string {
  const s = slug.trim();
  const safe = s.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe || safe !== s) {
    throw new Error("Project slug must contain only letters, numbers, dots, underscores, or hyphens");
  }
  return safe;
}

export async function createProject(
  displayName: string,
  options?: CreateProjectOptions
): Promise<ProjectRecord> {
  const visibility: WorkspaceVisibility = options?.visibility ?? "private";
  const name = displayName.trim() || "Untitled workspace";
  const slug = await uniqueSlug(slugifyName(name));
  const tenantId = visibility === "shared" ? null : tenantIdForNewPrivateWorkspace();

  if (shouldUseChatDatabase()) {
    const now = Date.now();
    await insertWorkspaceProjectDb({
      slug,
      name,
      createdAt: now,
      treeInitialized: false,
      visibility,
      tenantId,
    });
    const jobId = await insertJobDb("init_workspace", { slug, name, visibility });
    try {
      await waitForJobDb(jobId);
    } catch (e) {
      await deleteWorkspaceProjectDb(slug);
      throw e;
    }
    const meta = await getWorkspaceProjectDb(slug);
    if (!meta) throw new Error("Failed to create project");
    return {
      slug: meta.slug,
      name: meta.name,
      createdAt: meta.createdAt,
      visibility: meta.visibility,
    };
  }
  await writeTree(slug, name, visibility);
  const meta = await readProject(slug);
  if (!meta) throw new Error("Failed to create project");
  return meta;
}

/**
 * Ensure a known workspace slug exists. Use this for reserved system vaults
 * where agents and prompts need a stable path such as `/vault-shared/org-global/`.
 */
export async function ensureProjectSlug(
  slug: string,
  displayName: string,
  options?: CreateProjectOptions
): Promise<ProjectRecord> {
  const visibility: WorkspaceVisibility = options?.visibility ?? "private";
  const safeSlug = assertExactProjectSlug(slug);
  const existing = await readProject(safeSlug);
  if (existing) {
    if (existing.visibility !== visibility) {
      throw new Error(
        `Workspace '${safeSlug}' already exists as ${existing.visibility}, expected ${visibility}.`
      );
    }
    return existing;
  }

  const name = displayName.trim() || safeSlug;
  if (shouldUseChatDatabase()) {
    const now = Date.now();
    try {
      await insertWorkspaceProjectDb({
        slug: safeSlug,
        name,
        createdAt: now,
        treeInitialized: false,
        visibility,
        tenantId: visibility === "shared" ? null : tenantIdForNewPrivateWorkspace(),
      });
    } catch (e) {
      const afterRace = await readProject(safeSlug);
      if (afterRace) {
        if (afterRace.visibility !== visibility) {
          throw new Error(
            `Workspace '${safeSlug}' already exists as ${afterRace.visibility}, expected ${visibility}.`
          );
        }
        return afterRace;
      }
      throw e;
    }

    const jobId = await insertJobDb("init_workspace", {
      slug: safeSlug,
      name,
      visibility,
    });
    try {
      await waitForJobDb(jobId);
    } catch (e) {
      await deleteWorkspaceProjectDb(safeSlug);
      throw e;
    }
    const meta = await readProject(safeSlug);
    if (!meta) throw new Error("Failed to create project");
    return meta;
  }

  await writeTree(safeSlug, name, visibility);
  const meta = await readProject(safeSlug);
  if (!meta) throw new Error("Failed to create project");
  return meta;
}

async function readProjectJsonFromDisk(slug: string): Promise<ProjectRecord | null> {
  for (const vis of ["private", "shared"] as const) {
    const root = projectDirFor(slug, vis);
    try {
      const raw = await readFile(path.join(root, "project.json"), "utf-8");
      const j = JSON.parse(raw) as {
        name?: string;
        slug?: string;
        createdAt?: number;
        visibility?: string;
      };
      const visOut: WorkspaceVisibility = j.visibility === "shared" ? "shared" : "private";
      return {
        slug: j.slug || slug,
        name: j.name || slug,
        createdAt: typeof j.createdAt === "number" ? j.createdAt : Date.now(),
        visibility: visOut,
      };
    } catch {
      /* try next root */
    }
  }
  return null;
}

/** Shared-root only: used when Postgres is split per tenant but `/vault-shared` is common. */
async function readProjectJsonFromSharedRoot(
  slug: string,
  sharedRoot: string
): Promise<ProjectRecord | null> {
  try {
    const raw = await readFile(path.join(sharedRoot, slug, "project.json"), "utf-8");
    const j = JSON.parse(raw) as {
      name?: string;
      slug?: string;
      createdAt?: number;
      visibility?: string;
    };
    const visOut: WorkspaceVisibility = j.visibility === "shared" ? "shared" : "private";
    if (visOut !== "shared") return null;
    return {
      slug: j.slug || slug,
      name: j.name || slug,
      createdAt: typeof j.createdAt === "number" ? j.createdAt : Date.now(),
      visibility: "shared",
    };
  } catch {
    return null;
  }
}

/**
 * Discover shared workspaces present on `HERMES_PROJECTS_SHARED_FS_ROOT` (multi-tenant Chat DBs
 * may not list rows created on another instance).
 */
export async function discoverSharedProjectsOnDisk(): Promise<ProjectRecord[]> {
  const sr = process.env.HERMES_PROJECTS_SHARED_FS_ROOT?.trim();
  if (!sr) return [];
  let names: string[] = [];
  try {
    names = await readdir(sr);
  } catch {
    return [];
  }
  const out: ProjectRecord[] = [];
  for (const slug of names) {
    if (slug.startsWith(".")) continue;
    try {
      const st = await stat(path.join(sr, slug));
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = await readProjectJsonFromSharedRoot(slug, sr);
    if (meta) out.push(meta);
  }
  return out;
}

type WorkspaceRow = ProjectRecord & { tenantId?: string | null };

function mergeDbWithDiskShared(
  dbRows: WorkspaceRow[],
  diskShared: ProjectRecord[]
): WorkspaceRow[] {
  const bySlug = new Map<string, WorkspaceRow>();
  for (const r of dbRows) {
    bySlug.set(r.slug, { ...r });
  }
  for (const d of diskShared) {
    if (!bySlug.has(d.slug)) {
      bySlug.set(d.slug, {
        slug: d.slug,
        name: d.name,
        createdAt: d.createdAt,
        visibility: "shared",
        tenantId: null,
      });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function readProject(slug: string): Promise<ProjectRecord | null> {
  if (shouldUseChatDatabase()) {
    const row = await getWorkspaceProjectDb(slug);
    if (row) {
      return {
        slug: row.slug,
        name: row.name,
        createdAt: row.createdAt,
        visibility: row.visibility,
      };
    }
  }
  return readProjectJsonFromDisk(slug);
}

export async function listProjects(): Promise<ProjectRecord[]> {
  if (shouldUseChatDatabase()) {
    const dbRows = await listWorkspaceProjectsDb();
    const diskShared = await discoverSharedProjectsOnDisk();
    return mergeDbWithDiskShared(dbRows as WorkspaceRow[], diskShared);
  }
  const root = getProjectsRoot();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: ProjectRecord[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const p = await readProject(name).catch(() => null);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export type VaultSourceFileRow = {
  name: string;
  relativePath: string;
  size: number;
  sha256?: string;
  /** From Postgres vault_assets when available; for legacy manifest-only, often absent. */
  assetRole?: string | null;
};

export type VaultTemplateRow = {
  id: string;
  name: string;
  sourceStem: string;
  vaultSlug: string;
  vaultName: string;
  outlinePath: string;
  structurePath: string;
  updatedAt: number;
};

function vaultPathUnderSources(name: string, relativePath: string): string {
  const rel = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const marker = "/sources/";
  const markerIndex = rel.indexOf(marker);
  if (markerIndex >= 0) return rel.slice(markerIndex + marker.length);
  if (rel.startsWith("sources/")) return rel.slice("sources/".length);
  return name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function isVisibleVaultUploadedSourceFile(
  row: Pick<VaultSourceFileRow, "name" | "relativePath">
): boolean {
  const underSources = vaultPathUnderSources(row.name, row.relativePath);
  if (!underSources || underSources.startsWith(".")) return false;
  const parts = underSources.split("/").filter(Boolean);
  if (parts.length !== 1) return false;
  const fileName = parts[0]?.toLowerCase() ?? "";
  if (!fileName || fileName.startsWith(".")) return false;
  return !fileName.endsWith(".py");
}

/**
 * One `sources/` tree: regular files only (excludes dotfiles), sorted by path.
 * `relativePath` uses the canonical `projects/<slug>/sources/...` form for DB/API.
 */
async function readdirSourceFilesInDir(
  sourcesDir: string,
  slug: string
): Promise<Pick<VaultSourceFileRow, "name" | "relativePath" | "size">[]> {
  const out: Pick<VaultSourceFileRow, "name" | "relativePath" | "size">[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      try {
        const st = await stat(full);
        if (st.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!st.isFile()) continue;
        const relUnderSources = path.relative(sourcesDir, full).replace(/\\/g, "/");
        if (!relUnderSources || relUnderSources.startsWith("../")) continue;
        out.push({
          name: relUnderSources,
          relativePath: projectRelativePath(slug, "sources", relUnderSources),
          size: st.size,
        });
      } catch {
        /* skip */
      }
    }
  }

  await walk(sourcesDir, 0);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Every regular file under `sources/` (excludes dotfiles). Truth for what can be downloaded.
 * Shared vaults: if `HERMES_PROJECTS_SHARED_FS_ROOT` (e.g. `/vault-shared`) is empty for this
 * slug but a legacy tree exists under the default projects root (uploads from before the split
 * mount), list from the legacy `sources/` so the file bar and ingest gap logic stay correct.
 */
async function listVaultSourcesOnDisk(slug: string): Promise<
  Pick<VaultSourceFileRow, "name" | "relativePath" | "size">[]
> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");

  const primary = path.join(projectDirFor(slug, meta.visibility), "sources");
  const primaryList = await readdirSourceFilesInDir(primary, slug);
  const primaryVisibleUploadCount = primaryList.filter(
    isVisibleVaultUploadedSourceFile
  ).length;

  if (
    meta.visibility === "shared" &&
    (primaryList.length === 0 || primaryVisibleUploadCount === 0)
  ) {
    let legacy: string;
    try {
      legacy = path.join(getProjectsRoot(), slug, "sources");
    } catch {
      return primaryList;
    }
    if (path.resolve(legacy) !== path.resolve(primary)) {
      const legacyList = await readdirSourceFilesInDir(legacy, slug);
      if (
        legacyList.some(isVisibleVaultUploadedSourceFile) ||
        primaryList.length === 0
      ) {
        if (legacyList.length > 0) return legacyList;
      }
    }
  }

  return primaryList;
}

export async function listVaultUploadedFiles(slug: string): Promise<VaultSourceFileRow[]> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");

  const onDisk = (await listVaultSourcesOnDisk(slug)).filter(
    isVisibleVaultUploadedSourceFile
  );

  if (shouldUseChatDatabase()) {
    const dbRows = (await listVaultAssetsDb(slug)).filter(
      isVisibleVaultUploadedSourceFile
    );
    const diskByPath = new Map(onDisk.map((r) => [r.relativePath, r]));
    const seen = new Set<string>();
    const rows: VaultSourceFileRow[] = [];

    for (const db of dbRows) {
      const disk = diskByPath.get(db.relativePath);
      rows.push({
        name: disk?.name ?? db.name,
        relativePath: db.relativePath,
        size: disk?.size ?? db.size,
        ...(db.sha256 ? { sha256: db.sha256 } : {}),
        ...(db.assetRole != null && String(db.assetRole).trim()
          ? { assetRole: String(db.assetRole).trim() }
          : {}),
      });
      seen.add(db.relativePath);
    }

    if (dbRows.length > 0) {
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    const dbByName = new Map(dbRows.map((r) => [r.name, r]));
    const dbByPath = new Map(dbRows.map((r) => [r.relativePath, r]));
    for (const e of onDisk) {
      if (seen.has(e.relativePath)) continue;
      const db = dbByPath.get(e.relativePath) ?? dbByName.get(e.name);
      rows.push({
        ...e,
        ...(db?.sha256 ? { sha256: db.sha256 } : {}),
        ...(db?.assetRole != null && String(db.assetRole).trim()
          ? { assetRole: String(db.assetRole).trim() }
          : {}),
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  const manifest = await readVaultManifest(slug);
  const manifestPaths = new Set(Object.keys(manifest.files));
  const rows = manifestPaths.size > 0
    ? onDisk.filter((e) => manifestPaths.has(e.relativePath))
    : onDisk;
  return rows.map((e) => {
    const mf = manifest.files[e.relativePath];
    return {
      ...e,
      ...(mf?.sha256 ? { sha256: mf.sha256 } : {}),
    };
  });
}

export async function listVaultTemplates(slug: string): Promise<VaultTemplateRow[]> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");

  const templatesRoot = path.join(projectDirFor(slug, meta.visibility), "templates");
  let entries: string[] = [];
  try {
    entries = await readdir(templatesRoot);
  } catch {
    return [];
  }

  const out: VaultTemplateRow[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = path.join(templatesRoot, entry);
    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) continue;
      const outline = path.join(dir, "outline.md");
      const structure = path.join(dir, "structure.yaml");
      const [outlineStat, structureStat] = await Promise.all([
        stat(outline).catch(() => null),
        stat(structure).catch(() => null),
      ]);
      if (!outlineStat?.isFile() || !structureStat?.isFile()) continue;
      const updatedAt = Math.max(outlineStat.mtimeMs, structureStat.mtimeMs);
      out.push({
        id: `${slug}:${entry}`,
        name: entry.replace(/[-_]+/g, " ").trim() || entry,
        sourceStem: entry,
        vaultSlug: slug,
        vaultName: meta.name || slug,
        outlinePath:
          meta.visibility === "shared"
            ? `/vault-shared/${slug}/templates/${entry}/outline.md`
            : projectRelativePath(slug, "templates", entry, "outline.md"),
        structurePath:
          meta.visibility === "shared"
            ? `/vault-shared/${slug}/templates/${entry}/structure.yaml`
            : projectRelativePath(slug, "templates", entry, "structure.yaml"),
        updatedAt,
      });
    } catch {
      /* skip partial template */
    }
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProjectFile(
  slug: string,
  originalName: string,
  buffer: Buffer,
  opts?: { sha256?: string; assetRole?: string; contextProjectSlug?: string | null }
): Promise<{
  relativePath: string;
  fileName: string;
  duplicate: boolean;
  duplicatePath: string | null;
  skippedWrite: boolean;
}> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");

  if (shouldUseChatDatabase()) {
    const stagingRoot = getVaultStagingDir();
    if (!stagingRoot?.trim()) {
      throw new Error("VAULT_STAGING_DIR is not set (required for vault uploads with DATABASE_URL)");
    }
    const hex =
      typeof opts?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(opts.sha256.trim())
        ? opts.sha256.trim().toLowerCase()
        : createHash("sha256").update(buffer).digest("hex");
    const stagingId = randomUUID();
    await mkdir(stagingRoot, { recursive: true });
    const stagingPath = path.join(stagingRoot, stagingId);
    await writeFile(stagingPath, buffer);
    const jobId = await insertJobDb("materialize_upload", {
      projectSlug: slug,
      stagingId,
      originalName,
      sha256: hex,
      sizeBytes: buffer.length,
      visibility: meta.visibility,
      ...(typeof opts?.assetRole === "string" && opts.assetRole.trim()
        ? { assetRole: opts.assetRole.trim() }
        : {}),
      ...(opts?.contextProjectSlug != null && String(opts.contextProjectSlug).trim()
        ? { contextProjectSlug: String(opts.contextProjectSlug).trim() }
        : {}),
    });
    try {
      const result = await waitForJobDb(jobId);
      await unlink(stagingPath).catch(() => {});
      if (!result) throw new Error("Bridge returned no result");
      return {
        fileName: String(result.fileName ?? ""),
        relativePath: String(result.relativePath ?? ""),
        duplicate: Boolean(result.duplicate),
        duplicatePath:
          result.duplicatePath != null ? String(result.duplicatePath) : null,
        skippedWrite: Boolean(result.skippedWrite),
      };
    } catch (e) {
      await unlink(stagingPath).catch(() => {});
      throw e;
    }
  }

  const base = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const dest = path.join(await resolveProjectRoot(slug), "sources", base);
  await mkdir(path.dirname(dest), { recursive: true, mode: VAULT_DIR_MODE });

  const hex =
    typeof opts?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(opts.sha256.trim())
      ? opts.sha256.trim().toLowerCase()
      : createHash("sha256").update(buffer).digest("hex");

  const manifest = await readVaultManifest(slug);
  const relativePath = projectRelativePath(slug, "sources", base);

  let duplicatePath: string | null = null;
  for (const [p, entry] of Object.entries(manifest.files)) {
    if (entry.sha256 === hex) {
      duplicatePath = p;
      break;
    }
  }
  const duplicate = duplicatePath !== null;

  const prevEntry = manifest.files[relativePath];
  const samePathSameHash = prevEntry?.sha256 === hex;
  let skippedWrite = false;
  if (samePathSameHash) {
    skippedWrite = true;
  } else {
    await writeFile(dest, buffer);
  }

  manifest.files[relativePath] = {
    sha256: hex,
    size: buffer.length,
    updatedAt: Date.now(),
  };
  await writeVaultManifest(slug, manifest);

  return {
    fileName: base,
    relativePath,
    duplicate,
    duplicatePath,
    skippedWrite,
  };
}

function normalizeVaultArtifactRelPath(raw: string): string {
  const rel = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.startsWith("./") || rel.startsWith("../")) {
    throw new Error("Invalid vault artifact path");
  }
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid vault artifact path");
  }
  if (!parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("Unsafe vault artifact path segment");
  }
  const normalized = parts.join("/");
  const allowed =
    normalized.startsWith("brain/") ||
    normalized.startsWith("index/") ||
    normalized.startsWith("templates/") ||
    normalized.startsWith("scoring/") ||
    normalized.startsWith("branding/") ||
    normalized.startsWith("segments/") ||
    normalized.startsWith("extracted/") ||
    normalized.startsWith("wiki/") ||
    ["INDEX.md", "LOG.md", "SCHEMA.md", "vault_profile.yaml"].includes(normalized);
  if (!allowed) {
    throw new Error("Vault artifact path is not writable through this path");
  }
  return normalized;
}

export async function writeProjectArtifactFile(
  slug: string,
  relativePath: string,
  content: string,
  opts?: { visibility?: WorkspaceVisibility }
): Promise<{ relativePath: string; sizeBytes: number }> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  const rel = normalizeVaultArtifactRelPath(relativePath);
  const visibility = opts?.visibility ?? meta.visibility;
  if (visibility !== meta.visibility) {
    throw new Error("Project visibility mismatch");
  }

  if (shouldUseChatDatabase()) {
    const jobId = await insertJobDb("write_vault_artifact", {
      projectSlug: slug,
      visibility,
      relativePath: rel,
      content,
    });
    const result = await waitForJobDb(jobId, 30_000);
    return {
      relativePath: String(result?.relativePath ?? rel),
      sizeBytes: Number(result?.sizeBytes ?? Buffer.byteLength(content, "utf8")),
    };
  }

  const root = await resolveProjectRoot(slug);
  const dest = path.join(root, rel);
  const resolved = path.resolve(dest);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error("Vault artifact path escaped workspace");
  }
  await mkdir(path.dirname(dest), { recursive: true, mode: VAULT_DIR_MODE });
  await writeFile(dest, content, "utf-8");
  return { relativePath: rel, sizeBytes: Buffer.byteLength(content, "utf8") };
}

/** Same cap as multipart upload in `app/api/projects/[slug]/files/route.ts`. */
export const MAX_VAULT_SOURCE_FILE_BYTES = 80 * 1024 * 1024;

/**
 * Resolve a download name to a single basename under sources/ (no directories, no dotfiles).
 * Accepts `foo.md` or a POSIX relative path ending in a basename (e.g. Hermes `projects/slug/sources/foo.md`).
 */
export function sanitizeVaultSourceBasename(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  if (!base || base === "." || base === "..") return null;
  if (base.startsWith(".")) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

const MAX_VAULT_SOURCES_REL_SEGMENTS = 64;

/**
 * Safe POSIX relative path under `sources/` (for nested vault assets like extracted/…_docx_media/*.png).
 * Each segment matches basename-safe chars; no traversal or dot-file segments.
 */
export function sanitizeVaultSourcesRelativePath(raw: string): string | null {
  let s = raw.trim().replace(/\\/g, "/");
  while (s.startsWith("/")) s = s.slice(1);
  while (s.startsWith("./")) s = s.slice(2);
  if (!s || s.includes("..")) return null;
  if (s.toLowerCase().startsWith("sources/")) {
    s = s.slice("sources/".length);
  }
  const segments = s.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.length > MAX_VAULT_SOURCES_REL_SEGMENTS
  ) {
    return null;
  }
  for (const seg of segments) {
    if (seg.startsWith(".")) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return null;
  }
  return segments.join("/");
}

function resolveVaultSourceRelativePath(
  slug: string,
  nameOrRelativePath: string
): string | null {
  const raw = nameOrRelativePath.trim().replace(/\\/g, "/");
  const marker = "/sources/";
  if (raw.includes(marker)) {
    const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "");
    const expected = `projects/${safe}/sources/`;
    const idx = raw.indexOf(expected);
    if (idx >= 0) return raw.slice(idx);
    if (raw.startsWith("projects/") && raw.includes(`/sources/`)) {
      return raw;
    }
  }
  const base = sanitizeVaultSourceBasename(raw);
  if (!base) return null;
  return projectRelativePath(slug, "sources", base);
}

/** Remove a file from `sources/` (bridge job when using Postgres). */
export async function deleteProjectSourceFile(
  slug: string,
  nameOrRelativePath: string
): Promise<void> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  const rel = resolveVaultSourceRelativePath(slug, nameOrRelativePath);
  if (!rel?.includes("/sources/")) throw new Error("Invalid source path");

  if (shouldUseChatDatabase()) {
    const jobId = await insertJobDb("delete_vault_source", {
      projectSlug: slug,
      relativePath: rel,
      visibility: meta.visibility,
    });
    await waitForJobDb(jobId, 60_000);
    return;
  }

  const base = path.posix.basename(rel);
  const dest = path.join(await resolveProjectRoot(slug), "sources", base);
  await unlink(dest).catch(() => {});
  const manifest = await readVaultManifest(slug);
  if (manifest.files[rel]) {
    delete manifest.files[rel];
    await writeVaultManifest(slug, manifest);
  }
}

/**
 * Remove a vault source and derived ingest outputs (see hermes-bridge `undo_vault_ingest`).
 * Requires Postgres + bridge; shared and private vaults.
 */
export async function undoVaultIngest(
  slug: string,
  nameOrRelativePath: string,
  options?: { dryRun?: boolean }
): Promise<Record<string, unknown>> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  const rel = resolveVaultSourceRelativePath(slug, nameOrRelativePath);
  if (!rel?.includes("/sources/")) throw new Error("Invalid source path");

  if (!shouldUseChatDatabase()) {
    throw new Error(
      "Undo ingest requires a Postgres-backed vault and hermes-bridge (DATABASE_URL)."
    );
  }

  const jobId = await insertJobDb("undo_vault_ingest", {
    projectSlug: slug,
    relativePath: rel,
    visibility: meta.visibility,
    ...(options?.dryRun ? { dryRun: true } : {}),
  });
  const result = await waitForJobDb(jobId, 120_000);
  if (!result) throw new Error("Bridge job returned no result");
  return result;
}

export function mimeTypeForVaultBasename(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".md":
    case ".markdown":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".doc":
      return "application/msword";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

export type ReadProjectSourceFileResult =
  | { ok: true; buffer: Buffer; fileName: string; mime: string }
  | { ok: false; reason: "not_found" | "too_large" | "invalid" };

function isStrictDescendantFile(rootAbs: string, fileAbs: string): boolean {
  const rel = path.relative(rootAbs, fileAbs);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** DB / project.json if present; else any existing on-disk slug dir (private, then shared). */
async function resolveProjectRootForDownload(slug: string): Promise<string | null> {
  const meta = await readProject(slug);
  if (meta) return projectDirFor(slug, meta.visibility);
  for (const vis of ["private", "shared"] as const) {
    const root = projectDirFor(slug, vis);
    try {
      const st = await stat(root);
      if (st.isDirectory()) return root;
    } catch {
      /* try other root */
    }
  }
  return null;
}

/**
 * For shared vaults after split-FS, sources may still live under the default projects root
 * until migrated to `HERMES_PROJECTS_SHARED_FS_ROOT`. Try the canonical root first, then legacy.
 */
async function projectRootsForFileDownload(slug: string): Promise<string[]> {
  const primary = await resolveProjectRootForDownload(slug);
  if (!primary) return [];
  const meta = await readProject(slug);
  if (meta?.visibility !== "shared") return [primary];
  let legacy: string;
  try {
    legacy = path.join(getProjectsRoot(), slug);
  } catch {
    return [primary];
  }
  if (path.resolve(legacy) === path.resolve(primary)) return [primary];
  try {
    const st = await stat(legacy);
    if (st.isDirectory()) return [primary, legacy];
  } catch {
    /* */
  }
  return [primary];
}

/** Read a file strictly under `sources/<relativeUnderSources>` (nested paths allowed). */
async function readProjectVaultSourcesNestedFile(
  slug: string,
  relativeUnderSources: string
): Promise<ReadProjectSourceFileResult> {
  const projectRoots = await projectRootsForFileDownload(slug);
  if (projectRoots.length === 0) return { ok: false, reason: "not_found" };

  const baseName = path.posix.basename(relativeUnderSources);

  for (const projectRoot of projectRoots) {
    const resolvedProject = path.resolve(projectRoot);
    const sourcesRoot = path.join(projectRoot, "sources");
    const resolvedSources = path.resolve(sourcesRoot);
    const fullPath = path.resolve(
      path.join(sourcesRoot, ...relativeUnderSources.split("/"))
    );
    if (
      !isStrictDescendantFile(resolvedSources, fullPath) ||
      !isStrictDescendantFile(resolvedProject, fullPath)
    ) {
      continue;
    }

    let st;
    try {
      st = await stat(fullPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_VAULT_SOURCE_FILE_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    const buffer = await readFile(fullPath);
    return {
      ok: true,
      buffer,
      fileName: baseName,
      mime: mimeTypeForVaultBasename(baseName),
    };
  }

  return { ok: false, reason: "not_found" };
}

/** Prefer sources/; also allow same basename at project root (agents often write there). */
export async function readProjectSourceFileForDownload(
  slug: string,
  rawName: string
): Promise<ReadProjectSourceFileResult> {
  const nested = sanitizeVaultSourcesRelativePath(rawName);
  if (nested?.includes("/")) {
    return readProjectVaultSourcesNestedFile(slug, nested);
  }

  const base =
    nested ??
    sanitizeVaultSourceBasename(rawName);
  if (!base) return { ok: false, reason: "invalid" };

  const projectRoots = await projectRootsForFileDownload(slug);
  if (projectRoots.length === 0) return { ok: false, reason: "not_found" };

  for (const projectRoot of projectRoots) {
    const resolvedProject = path.resolve(projectRoot);
    const sourcesRoot = path.join(projectRoot, "sources");
    const resolvedSources = path.resolve(sourcesRoot);
    const candidates = [
      path.join(sourcesRoot, base),
      path.join(projectRoot, base),
    ];

    for (const fullPath of candidates) {
      const resolvedFile = path.resolve(fullPath);
      const underSources =
        isStrictDescendantFile(resolvedSources, resolvedFile) &&
        isStrictDescendantFile(resolvedProject, resolvedFile);
      const underProjectOnly =
        isStrictDescendantFile(resolvedProject, resolvedFile) &&
        resolvedFile === path.join(resolvedProject, base);
      if (!underSources && !underProjectOnly) {
        continue;
      }

      let st;
      try {
        st = await stat(resolvedFile);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > MAX_VAULT_SOURCE_FILE_BYTES) {
        return { ok: false, reason: "too_large" };
      }

      const buffer = await readFile(resolvedFile);
      return {
        ok: true,
        buffer,
        fileName: base,
        mime: mimeTypeForVaultBasename(base),
      };
    }
  }

  return { ok: false, reason: "not_found" };
}

const MAX_PROJECT_NAME_LEN = 200;

/**
 * Rename display name only; slug and URLs are unchanged. Updates DB (when enabled) and project.json on disk.
 */
export async function renameProject(
  slug: string,
  displayName: string
): Promise<ProjectRecord> {
  const name = displayName.trim().slice(0, MAX_PROJECT_NAME_LEN) || "Untitled workspace";
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  if (shouldUseChatDatabase()) {
    await updateWorkspaceProjectNameDb(slug, name);
  }
  try {
    const root = await resolveProjectRoot(slug);
    const pj = path.join(root, "project.json");
    const raw = await readFile(pj, "utf-8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    j.name = name;
    j.slug = meta.slug;
    await writeFile(pj, JSON.stringify(j, null, 2), "utf-8");
  } catch {
    /* no project.json on disk yet */
  }
  return { ...meta, name };
}

/**
 * Remove vault tree (bridge job when using DB) and DB rows. Destructive.
 */
export async function deleteProject(slug: string): Promise<void> {
  const meta = await readProject(slug);
  if (!meta) throw new Error("Project not found");
  if (shouldUseChatDatabase()) {
    const jobId = await insertJobDb("delete_workspace", {
      slug,
      visibility: meta.visibility,
    });
    await waitForJobDb(jobId);
    await deleteWorkspaceProjectDb(slug);
  } else {
    const root = projectDirFor(slug, meta.visibility);
    await rm(root, { recursive: true, force: true });
  }
}
