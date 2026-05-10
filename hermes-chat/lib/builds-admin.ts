import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import {
  appFolderAndGatewayFromManifestPath,
  parseBuildEditPayload,
} from "@/lib/builds-manifest";
import { parseCreativeStudioPayload } from "@/lib/creative-studio-session";
import {
  readSessionsStore,
  writeSessionsStore,
} from "@/lib/hermes-chat-store";
import { purgeChatSessionData } from "@/lib/session-purge";

const MAX_NAME_LEN = 200;
const ARCHIVE_DIR_NAME = ".hermes-build-archive";
const ARCHIVE_MANIFEST_FILE = "manifest.json";
const ARCHIVE_FILES_DIR = "files";
const TAR_ZSTD_EXT = ".tar.zst";
const TAR_GZIP_EXT = ".tar.gz";
const execFileAsync = promisify(execFile);

type ManifestFileV1 = {
  apps?: unknown[];
};

type BuildArchiveManifest = {
  version: 1;
  archived: BuildArchiveRecord[];
};

export type BuildArchiveRecord = {
  id: string;
  name: string;
  description?: string;
  path: string | null;
  appFolder: string;
  archivedAt: string;
  archiveFile: string;
  compression: "zstd" | "gzip";
  originalBytes: number;
  archiveBytes: number;
  compressionRatio: number;
  app: RawApp;
};

function getManifestPathOrThrow(): string {
  const p = process.env.BUILDS_MANIFEST_PATH?.trim();
  if (!p) {
    throw new Error("BUILDS_MANIFEST_PATH is not set");
  }
  return path.resolve(p);
}

export function getBuildsRootDirOrThrow(): string {
  return path.dirname(getManifestPathOrThrow());
}

function safeAppFolderFromManifestPath(pathRel: string | null): string | null {
  const { appFolder } = appFolderAndGatewayFromManifestPath(
    pathRel ?? undefined
  );
  if (!appFolder) return null;
  if (
    appFolder.includes("..") ||
    appFolder.includes("/") ||
    appFolder.includes("\\") ||
    appFolder === "." ||
    appFolder.length === 0
  ) {
    return null;
  }
  return appFolder;
}

function resolvedAppDir(
  buildsRoot: string,
  pathRel: string | null
): string | null {
  const folder = safeAppFolderFromManifestPath(pathRel);
  if (!folder) return null;
  const full = path.join(buildsRoot, folder);
  const normRoot = path.normalize(buildsRoot + path.sep);
  const normFull = path.normalize(full + path.sep);
  if (!normFull.startsWith(normRoot)) return null;
  return full;
}

function archiveRootDir(buildsRoot: string): string {
  return path.join(buildsRoot, ARCHIVE_DIR_NAME);
}

function archiveManifestPath(buildsRoot: string): string {
  return path.join(archiveRootDir(buildsRoot), ARCHIVE_MANIFEST_FILE);
}

function archiveFilesDir(buildsRoot: string): string {
  return path.join(archiveRootDir(buildsRoot), ARCHIVE_FILES_DIR);
}

async function readManifest(): Promise<ManifestFileV1> {
  const filePath = getManifestPathOrThrow();
  const text = await readFile(filePath, "utf8");
  const j = JSON.parse(text) as ManifestFileV1;
  if (!j || typeof j !== "object") return { apps: [] };
  if (!Array.isArray(j.apps)) return { ...j, apps: [] };
  return j;
}

async function writeManifest(data: ManifestFileV1): Promise<void> {
  const filePath = getManifestPathOrThrow();
  const out = {
    ...data,
    apps: Array.isArray(data.apps) ? data.apps : [],
  };
  await writeFile(
    filePath,
    `${JSON.stringify(out, null, 2)}\n`,
    "utf8"
  );
}

type RawApp = Record<string, unknown>;

function normalizeArchiveManifest(raw: unknown): BuildArchiveManifest {
  if (!raw || typeof raw !== "object") return { version: 1, archived: [] };
  const maybe = raw as { archived?: unknown };
  return {
    version: 1,
    archived: Array.isArray(maybe.archived)
      ? maybe.archived.filter(isBuildArchiveRecord)
      : [],
  };
}

function isBuildArchiveRecord(raw: unknown): raw is BuildArchiveRecord {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<BuildArchiveRecord>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.appFolder === "string" &&
    typeof r.archivedAt === "string" &&
    typeof r.archiveFile === "string" &&
    typeof r.originalBytes === "number" &&
    typeof r.archiveBytes === "number" &&
    typeof r.compressionRatio === "number" &&
    !!r.app &&
    typeof r.app === "object"
  );
}

async function readArchiveManifest(buildsRoot: string): Promise<BuildArchiveManifest> {
  try {
    const text = await readFile(archiveManifestPath(buildsRoot), "utf8");
    return normalizeArchiveManifest(JSON.parse(text));
  } catch {
    return { version: 1, archived: [] };
  }
}

async function writeArchiveManifest(
  buildsRoot: string,
  manifest: BuildArchiveManifest
): Promise<void> {
  await mkdir(archiveRootDir(buildsRoot), { recursive: true });
  await writeFile(
    archiveManifestPath(buildsRoot),
    `${JSON.stringify({ version: 1, archived: manifest.archived }, null, 2)}\n`,
    "utf8"
  );
}

function archiveFileNameFor(buildId: string, ext: string): string {
  const safeId =
    buildId
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "build";
  return `${safeId}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
}

function archiveFilePath(buildsRoot: string, archiveFile: string): string {
  const filesDir = archiveFilesDir(buildsRoot);
  const full = path.resolve(filesDir, archiveFile);
  const normRoot = path.normalize(filesDir + path.sep);
  const normFull = path.normalize(full);
  if (!normFull.startsWith(normRoot)) {
    throw new Error("Invalid archive path");
  }
  return full;
}

async function directorySizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(full);
    } else if (entry.isFile()) {
      const st = await stat(full);
      total += st.size;
    }
  }
  return total;
}

async function createTarZstdArchive(
  buildsRoot: string,
  appFolder: string,
  archivePathAbs: string
): Promise<void> {
  await execFileAsync("tar", [
    "-I",
    "zstd -19 -T0",
    "-cf",
    archivePathAbs,
    "-C",
    buildsRoot,
    appFolder,
  ]);
}

async function createTarGzipArchive(
  buildsRoot: string,
  appFolder: string,
  archivePathAbs: string
): Promise<void> {
  await execFileAsync("tar", [
    "-czf",
    archivePathAbs,
    "-C",
    buildsRoot,
    appFolder,
  ]);
}

async function extractTarZstdArchive(
  buildsRoot: string,
  archivePathAbs: string
): Promise<void> {
  await execFileAsync("tar", [
    "-I",
    "zstd",
    "-xf",
    archivePathAbs,
    "-C",
    buildsRoot,
  ]);
}

async function extractTarGzipArchive(
  buildsRoot: string,
  archivePathAbs: string
): Promise<void> {
  await execFileAsync("tar", ["-xzf", archivePathAbs, "-C", buildsRoot]);
}

function appIdFromRaw(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const id = (a as RawApp).id;
  return typeof id === "string" ? id.trim() : "";
}

function pathFromRaw(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const p = (a as RawApp).path;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

function nameFromRaw(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const n = (a as RawApp).name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

function webchatSessionIdFromStoreKey(
  key: string,
  entry: Record<string, unknown>
): string | null {
  const sid = entry.sessionId;
  if (typeof sid === "string" && /^[a-f0-9-]{36}$/i.test(sid.trim())) {
    return sid.trim();
  }
  if (key.startsWith("webchat:")) {
    const rest = key.slice("webchat:".length);
    if (/^[a-f0-9-]{36}$/i.test(rest)) return rest;
  }
  const m = key.match(/:webchat:([a-f0-9-]{36})$/i);
  return m?.[1] ?? null;
}

type BuildSessionCleanupHints = {
  name?: string | null;
  pathRel?: string | null;
  appFolder?: string | null;
  gatewayAppDir?: string | null;
};

function cleanComparable(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function equalClean(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = cleanComparable(a);
  const bb = cleanComparable(b);
  return Boolean(aa && bb && aa === bb);
}

function stringField(raw: unknown, field: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function buildEditMatchesBuild(
  entry: Record<string, unknown>,
  buildId: string,
  hints: BuildSessionCleanupHints
): boolean {
  const be = entry.buildEdit;
  if (be != null) {
    const parsed = parseBuildEditPayload(be);
    if (parsed?.buildId === buildId) return true;
    if (stringField(be, "buildId") === buildId) return true;
    if (equalClean(stringField(be, "pathRelative"), hints.pathRel)) return true;
    if (equalClean(stringField(be, "appFolder"), hints.appFolder)) return true;
    if (equalClean(stringField(be, "gatewayAppDir"), hints.gatewayAppDir)) return true;
    if (equalClean(stringField(be, "name"), hints.name)) return true;
  }
  return equalClean(stringField(entry, "label"), hints.name);
}

function creativeStudioMatchesBuild(
  entry: Record<string, unknown>,
  buildId: string,
  hints: BuildSessionCleanupHints
): boolean {
  const csRaw = entry.creativeStudio;
  if (csRaw != null) {
    const parsed = parseCreativeStudioPayload(csRaw);
    if (parsed?.publishedBuildId === buildId) return true;
    if (stringField(csRaw, "publishedBuildId") === buildId) return true;
    if (equalClean(stringField(csRaw, "publishedBuildName"), hints.name)) {
      return true;
    }
  }
  return equalClean(stringField(entry, "label"), hints.name);
}

/** Store keys + session ids tied to this manifest build (edit + linked/legacy create). */
export function findStoreKeysForBuildId(
  store: Record<string, unknown>,
  buildId: string,
  hints: BuildSessionCleanupHints = {}
): { key: string; sessionId: string }[] {
  const want = buildId.trim();
  if (!want) return [];
  const out: { key: string; sessionId: string }[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(store)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const chatType =
      typeof entry.chatType === "string" ? entry.chatType.trim() : "";
    let matches = false;
    if (chatType === "build_edit" || entry.buildEdit != null) {
      matches = buildEditMatchesBuild(entry, want, hints);
    }
    if (!matches && (chatType === "creative_studio" || entry.creativeStudio != null)) {
      matches = creativeStudioMatchesBuild(entry, want, hints);
    }
    if (!matches) continue;
    const sessionId = webchatSessionIdFromStoreKey(key, entry);
    if (!sessionId) continue;
    const dedupeKey = `${key}\0${sessionId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ key, sessionId });
  }
  return out;
}

async function updateSessionStoreForBuildRename(
  buildId: string,
  newName: string
): Promise<void> {
  const store = await readSessionsStore();
  let changed = false;
  for (const [key, raw] of Object.entries(store)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const chatType =
      typeof entry.chatType === "string" ? entry.chatType.trim() : "";
    if (chatType === "build_edit" && entry.buildEdit != null) {
      const p = parseBuildEditPayload(entry.buildEdit);
      if (p?.buildId === buildId) {
        store[key] = {
          ...entry,
          label: newName,
          buildEdit: { ...p, name: newName },
          updatedAt: Date.now(),
        };
        changed = true;
      }
    }
    if (chatType === "creative_studio" && entry.creativeStudio != null) {
      const cs = parseCreativeStudioPayload(entry.creativeStudio);
      if (cs?.publishedBuildId === buildId) {
        store[key] = {
          ...entry,
          creativeStudio: { ...cs, publishedBuildName: newName },
          updatedAt: Date.now(),
        };
        changed = true;
      }
    }
  }
  if (changed) await writeSessionsStore(store);
}

export async function renamePublishedBuildApp(
  buildId: string,
  rawName: string
): Promise<{ name: string }> {
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
  if (!name) {
    throw new Error("name is required");
  }
  const want = buildId.trim();
  if (!want) throw new Error("build id required");

  const manifest = await readManifest();
  const apps = Array.isArray(manifest.apps) ? [...manifest.apps] : [];
  let idx = -1;
  for (let i = 0; i < apps.length; i++) {
    if (appIdFromRaw(apps[i]) === want) {
      idx = i;
      break;
    }
  }
  if (idx < 0) throw new Error("Build not found in manifest");

  const cur = apps[idx] as RawApp;
  apps[idx] = { ...cur, name };
  await writeManifest({ ...manifest, apps });
  await updateSessionStoreForBuildRename(want, name);
  return { name };
}

export async function touchPublishedBuildApp(
  buildId: string,
  at = Date.now()
): Promise<{ updatedAt: number }> {
  const want = buildId.trim();
  if (!want) throw new Error("build id required");

  const manifest = await readManifest();
  const apps = Array.isArray(manifest.apps) ? [...manifest.apps] : [];
  const idx = apps.findIndex((app) => appIdFromRaw(app) === want);
  if (idx < 0) throw new Error("Build not found in manifest");

  const cur = apps[idx] as RawApp;
  const touched = { ...cur, updatedAt: at };
  const nextApps = [touched, ...apps.slice(0, idx), ...apps.slice(idx + 1)];
  await writeManifest({ ...manifest, apps: nextApps });
  return { updatedAt: at };
}

export type DeletePublishedBuildResult = {
  deletedSessions: number;
};

export async function deletePublishedBuildApp(
  buildId: string,
  opts: { name?: string | null } = {}
): Promise<DeletePublishedBuildResult> {
  const want = buildId.trim();
  if (!want) throw new Error("build id required");

  const buildsRoot = getBuildsRootDirOrThrow();
  const manifest = await readManifest();
  const apps = Array.isArray(manifest.apps) ? [...manifest.apps] : [];
  let pathRel: string | null = null;
  let deletedApp: RawApp | null = null;
  const next = apps.filter((a) => {
    if (appIdFromRaw(a) !== want) return true;
    pathRel = pathFromRaw(a);
    deletedApp = a as RawApp;
    return false;
  });
  if (next.length < apps.length) {
    await writeManifest({ ...manifest, apps: next });
  }
  /** Orphan sidebar groups: manifest row already gone — still purge linked chats. */

  const dir = resolvedAppDir(buildsRoot, pathRel);
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }

  const { appFolder, gatewayAppDir } = appFolderAndGatewayFromManifestPath(
    pathRel ?? undefined
  );
  const store = await readSessionsStore();
  const targets = findStoreKeysForBuildId(store, want, {
    name: nameFromRaw(deletedApp) ?? opts.name ?? null,
    pathRel,
    appFolder,
    gatewayAppDir,
  });
  for (const { key, sessionId } of targets) {
    await purgeChatSessionData(sessionId, key);
  }
  return { deletedSessions: targets.length };
}

export async function listArchivedBuildApps(): Promise<BuildArchiveRecord[]> {
  const buildsRoot = getBuildsRootDirOrThrow();
  const manifest = await readArchiveManifest(buildsRoot);
  return [...manifest.archived].sort(
    (a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt)
  );
}

export async function archivePublishedBuildApp(
  buildId: string
): Promise<BuildArchiveRecord> {
  const want = buildId.trim();
  if (!want) throw new Error("build id required");

  const buildsRoot = getBuildsRootDirOrThrow();
  const manifest = await readManifest();
  const apps = Array.isArray(manifest.apps) ? [...manifest.apps] : [];
  const idx = apps.findIndex((a) => appIdFromRaw(a) === want);
  if (idx < 0) throw new Error("Build not found in manifest");

  const app = apps[idx] as RawApp;
  const pathRel = pathFromRaw(app);
  const appFolder = safeAppFolderFromManifestPath(pathRel);
  const dir = resolvedAppDir(buildsRoot, pathRel);
  if (!appFolder || !dir) {
    throw new Error("This build has no local folder to archive");
  }

  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) {
    throw new Error("Build folder missing");
  }

  const archiveManifest = await readArchiveManifest(buildsRoot);
  if (archiveManifest.archived.some((r) => r.id === want)) {
    throw new Error("Build is already archived");
  }

  const originalBytes = await directorySizeBytes(dir);
  await mkdir(archiveFilesDir(buildsRoot), { recursive: true });
  let compression: "zstd" | "gzip" = "zstd";
  let archiveFile = archiveFileNameFor(want, TAR_ZSTD_EXT);
  let archivePathAbs = archiveFilePath(buildsRoot, archiveFile);
  try {
    await createTarZstdArchive(buildsRoot, appFolder, archivePathAbs);
  } catch {
    await rm(archivePathAbs, { force: true });
    compression = "gzip";
    archiveFile = archiveFileNameFor(want, TAR_GZIP_EXT);
    archivePathAbs = archiveFilePath(buildsRoot, archiveFile);
    await createTarGzipArchive(buildsRoot, appFolder, archivePathAbs);
  }
  const archiveBytes = (await stat(archivePathAbs)).size;

  const nextApps = apps.filter((_, i) => i !== idx);
  await writeManifest({ ...manifest, apps: nextApps });
  await rm(dir, { recursive: true, force: true });

  const record: BuildArchiveRecord = {
    id: want,
    name: typeof app.name === "string" && app.name.trim() ? app.name.trim() : want,
    ...(typeof app.description === "string" && app.description.trim()
      ? { description: app.description.trim() }
      : {}),
    path: pathRel,
    appFolder,
    archivedAt: new Date().toISOString(),
    archiveFile,
    compression,
    originalBytes,
    archiveBytes,
    compressionRatio:
      originalBytes > 0 ? Math.max(0, 1 - archiveBytes / originalBytes) : 0,
    app,
  };
  archiveManifest.archived = [record, ...archiveManifest.archived];
  await writeArchiveManifest(buildsRoot, archiveManifest);
  return record;
}

export async function restoreArchivedBuildApp(
  buildId: string
): Promise<BuildArchiveRecord> {
  const want = buildId.trim();
  if (!want) throw new Error("build id required");

  const buildsRoot = getBuildsRootDirOrThrow();
  const archiveManifest = await readArchiveManifest(buildsRoot);
  const idx = archiveManifest.archived.findIndex((r) => r.id === want);
  if (idx < 0) throw new Error("Build not found in archive");
  const record = archiveManifest.archived[idx]!;

  const liveManifest = await readManifest();
  const apps = Array.isArray(liveManifest.apps) ? [...liveManifest.apps] : [];
  if (apps.some((a) => appIdFromRaw(a) === want)) {
    throw new Error("A live build with this id already exists");
  }

  const restoreDir = resolvedAppDir(buildsRoot, record.path);
  if (!restoreDir) throw new Error("Invalid archived build path");
  const existing = await stat(restoreDir).catch(() => null);
  if (existing) {
    throw new Error("A build folder already exists at the restore path");
  }

  const archivePathAbs = archiveFilePath(buildsRoot, record.archiveFile);
  const archiveStat = await stat(archivePathAbs).catch(() => null);
  if (!archiveStat?.isFile()) {
    throw new Error("Archive file missing");
  }

  if (record.compression === "gzip" || record.archiveFile.endsWith(TAR_GZIP_EXT)) {
    await extractTarGzipArchive(buildsRoot, archivePathAbs);
  } else {
    await extractTarZstdArchive(buildsRoot, archivePathAbs);
  }
  await writeManifest({ ...liveManifest, apps: [...apps, record.app] });
  archiveManifest.archived.splice(idx, 1);
  await writeArchiveManifest(buildsRoot, archiveManifest);
  await rm(archivePathAbs, { force: true });
  return record;
}

export async function archivedBuildArchivePath(
  buildId: string
): Promise<{ record: BuildArchiveRecord; archivePath: string }> {
  const want = buildId.trim();
  if (!want) throw new Error("build id required");
  const buildsRoot = getBuildsRootDirOrThrow();
  const archiveManifest = await readArchiveManifest(buildsRoot);
  const record = archiveManifest.archived.find((r) => r.id === want);
  if (!record) throw new Error("Build not found in archive");
  return { record, archivePath: archiveFilePath(buildsRoot, record.archiveFile) };
}
