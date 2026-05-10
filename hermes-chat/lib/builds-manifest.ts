import { readdir, readFile, stat } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";

export const BUILDS_MANIFEST_GATEWAY_PATH = "/opt/data/builds/manifest.json";
type RawApp = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  path?: unknown;
  entry?: unknown;
  url?: unknown;
  thumbnail?: unknown;
  thumbnailUrl?: unknown;
  preview?: unknown;
  image?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
};

function fallbackBuildOpenVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_BUILD_ID?.trim() ||
    process.env.BUILD_ID?.trim() ||
    "dev"
  );
}

function normalizeBuildManifestPath(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^file:\/+/i, "/")
    .replace(/^\/opt\/data\/builds\/?/i, "")
    .replace(/^\/app\/builds\/?/i, "")
    .replace(/^\/usr\/share\/nginx\/html\/?/i, "")
    .replace(/^\/+/, "")
    .replace(/^(?:opt\/data\/|app\/)?builds\/+/i, "")
    .replace(/^usr\/share\/nginx\/html\/?/i, "")
    .replace(/^builds\/+/i, "");
  return normalized.replace(/\/+$/, "") || null;
}

function safeManifestEntryPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s || s.includes("..") || s.startsWith(".")) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return null;
  const safePart = /^[a-zA-Z0-9._-]+$/;
  if (!parts.every((part) => safePart.test(part) && !part.startsWith("."))) {
    return null;
  }
  return parts.join("/");
}

function pathRelativeForApi(a: RawApp): string | null {
  const base = normalizeBuildManifestPath(
    typeof a.path === "string" ? a.path : null
  );
  const entry = safeManifestEntryPath(a.entry);
  if (!base) return entry;
  if (!entry || /\.html?$/i.test(base)) return base;
  return `${base.replace(/\/+$/, "")}/${entry}`;
}

export function resolveBuildOpenUrl(
  app: RawApp,
  version: string | number | null = null
): string | null {
  const url = typeof app.url === "string" ? app.url.trim() : "";
  if (url && /^https?:\/\//i.test(url)) return url;

  const base = (
    process.env.BUILDS_BASE_URL || process.env.NEXT_PUBLIC_BUILDS_BASE_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!base) return null;

  const pathRaw = pathRelativeForApi(app);
  if (!pathRaw) return `${base}/`;

  if (/\.html?$/i.test(pathRaw)) {
    return appendBuildOpenCacheBuster(`${base}/${pathRaw}`, version);
  }
  const withSlash = pathRaw.endsWith("/") ? pathRaw : `${pathRaw}/`;
  return appendBuildOpenCacheBuster(`${base}/${withSlash}index.html`, version);
}

function appendBuildOpenCacheBuster(url: string, version: string | number | null): string {
  const separator = url.includes("?") ? "&" : "?";
  const v =
    version != null && String(version).trim()
      ? String(version).trim()
      : fallbackBuildOpenVersion();
  return `${url}${separator}v=${encodeURIComponent(v)}`;
}

/**
 * From manifest `path` (e.g. `my-app/` or `my-app/index.html`), derive the first
 * folder segment under the gateway builds tree: `/opt/data/builds/<segment>/`.
 */
export function appFolderAndGatewayFromManifestPath(
  pathStr: string | undefined
): { appFolder: string | null; gatewayAppDir: string | null } {
  if (!pathStr || typeof pathStr !== "string") {
    return { appFolder: null, gatewayAppDir: null };
  }
  const s = normalizeBuildManifestPath(pathStr);
  if (!s) return { appFolder: null, gatewayAppDir: null };
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0) return { appFolder: null, gatewayAppDir: null };
  if (/\.html?$/i.test(parts[parts.length - 1]!)) {
    parts.pop();
  }
  if (parts.length === 0) return { appFolder: null, gatewayAppDir: null };
  const slug = parts[0]!;
  return {
    appFolder: slug,
    gatewayAppDir: `/opt/data/builds/${slug}/`,
  };
}

function parseManifestApps(raw: string): RawApp[] {
  const j = JSON.parse(raw) as { apps?: RawApp[] };
  return Array.isArray(j.apps) ? j.apps : [];
}

export async function loadRawManifestApps(): Promise<RawApp[]> {
  const filePath = process.env.BUILDS_MANIFEST_PATH?.trim();
  const manifestUrl = process.env.BUILDS_MANIFEST_URL?.trim();

  if (filePath) {
    const text = await readFile(filePath, "utf8");
    return parseManifestApps(text);
  }
  if (manifestUrl) {
    const r = await fetch(manifestUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      throw new Error(`Manifest returned ${r.status}`);
    }
    return parseManifestApps(await r.text());
  }
  return [];
}

export type BuildListApp = {
  id: string;
  name: string;
  description?: string;
  openUrl: string;
  emailHtmlUrl: string | null;
  emailComposeUrl: string | null;
  path: string | null;
  appFolder: string | null;
  gatewayAppDir: string | null;
  thumbnailUrl: string | null;
  thumbnailKind: "image" | "fallback";
  createdAt: number | null;
  updatedAt: number | null;
};

function sanitizeManifestAssetPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^\/+/, "");
  if (!s || s.includes("..") || s.startsWith(".")) return null;
  if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(s)) return null;
  return s;
}

function buildAssetUrl(
  appPath: string | null,
  assetRel: string,
  version: string | number | null = null
): string | null {
  const base = (
    process.env.BUILDS_BASE_URL || process.env.NEXT_PUBLIC_BUILDS_BASE_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!base) return null;
  const folder =
    appPath
      ?.trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/^builds\/+/i, "")
      .replace(/index\.html?$/i, "")
      .replace(/\/?$/, "/") ?? "";
  const rel = assetRel.replace(/^\/+/, "");
  return appendBuildOpenCacheBuster(`${base}/${folder}${rel}`, version);
}

function buildArtifactUrl(
  appPath: string | null,
  assetRel: string,
  version: string | number | null = null
): string | null {
  const base = (
    process.env.BUILDS_BASE_URL || process.env.NEXT_PUBLIC_BUILDS_BASE_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!base) return null;
  const folder =
    appPath
      ?.trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/^builds\/+/i, "")
      .replace(/index\.html?$/i, "")
      .replace(/\/?$/, "/") ?? "";
  const rel = assetRel.replace(/^\/+/, "");
  if (!folder || !rel || rel.includes("..") || rel.startsWith(".")) return null;
  return appendBuildOpenCacheBuster(`${base}/${folder}${rel}`, version);
}

function explicitThumbnailFromManifest(
  a: RawApp,
  appPath: string | null,
  version: string | number | null = null
): string | null {
  const directUrl =
    typeof a.thumbnailUrl === "string" && /^https?:\/\//i.test(a.thumbnailUrl.trim())
      ? a.thumbnailUrl.trim()
      : null;
  if (directUrl) return directUrl;
  const asset =
    sanitizeManifestAssetPath(a.thumbnail) ??
    sanitizeManifestAssetPath(a.preview) ??
    sanitizeManifestAssetPath(a.image);
  return asset ? buildAssetUrl(appPath, asset, version) : null;
}

const THUMBNAIL_NAME_SCORE = [
  /thumbnail|thumb|preview|cover/i,
  /hero|banner/i,
  /background|bg/i,
  /logo|badge|brand/i,
];

async function findBuildThumbnailUrl(
  appFolder: string | null,
  appPath: string | null,
  version: string | number | null = null
): Promise<string | null> {
  if (!appFolder) return null;
  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const dir = path.join(root, appFolder);
  const candidates: { rel: string; score: number }[] = [];

  async function walk(current: string, relBase: string, depth: number) {
    if (depth > 3 || candidates.length > 80) return;
    let entries: Dirent<string>[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(png|jpe?g|webp|gif|svg)$/i.test(entry.name)) {
        continue;
      }
      const scoreIndex = THUMBNAIL_NAME_SCORE.findIndex((re) => re.test(rel));
      const score =
        (scoreIndex >= 0 ? 100 - scoreIndex * 12 : 24) -
        depth * 4 -
        (rel.includes("/") ? 1 : 0);
      candidates.push({ rel, score });
    }
  }

  await walk(dir, "", 0);
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return best ? buildAssetUrl(appPath, best.rel, version) : null;
}

function timestampFromRaw(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n < 10_000_000_000 ? n * 1000 : n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function findBuildTimestamps(
  appFolder: string | null,
  a: RawApp
): Promise<{ createdAt: number | null; updatedAt: number | null }> {
  const explicitCreated =
    timestampFromRaw(a.createdAt) ?? timestampFromRaw(a.publishedAt);
  const explicitUpdated = timestampFromRaw(a.updatedAt);
  if (!appFolder) {
    return {
      createdAt: explicitCreated,
      updatedAt: explicitUpdated ?? explicitCreated,
    };
  }

  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const dir = path.join(root, appFolder);
  let createdAt = explicitCreated;
  let updatedAt = explicitUpdated;
  let seen = 0;

  async function absorb(full: string) {
    if (seen > 240) return;
    seen += 1;
    const st = await stat(full).catch(() => null);
    if (!st) return;
    const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
    createdAt = createdAt == null ? born : Math.min(createdAt, born);
    updatedAt = updatedAt == null ? st.mtimeMs : Math.max(updatedAt, st.mtimeMs);
  }

  async function walk(current: string, depth: number) {
    if (depth > 2 || seen > 240) return;
    await absorb(current);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    const visibleEntries = entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 120);
    await Promise.all(
      visibleEntries
        .filter((entry) => entry.isFile())
        .map((entry) => absorb(path.join(current, entry.name)))
    );
    for (const entry of visibleEntries) {
      if (entry.isDirectory()) await walk(path.join(current, entry.name), depth + 1);
    }
  }

  await walk(dir, 0);
  return {
    createdAt,
    updatedAt: updatedAt ?? createdAt,
  };
}

async function buildFileExists(appFolder: string | null, relPath: string): Promise<boolean> {
  if (!appFolder || !relPath || relPath.includes("..") || relPath.startsWith(".")) {
    return false;
  }
  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const st = await stat(path.join(root, appFolder, relPath)).catch(() => null);
  return Boolean(st?.isFile());
}

function firstSubjectFromOptions(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const subject = line.match(/^subject\s*:\s*(.+)$/i)?.[1]?.trim();
    if (subject) return subject;
    const numbered = line.match(/^\d+[\).]\s*(.+)$/)?.[1]?.trim();
    if (numbered) return numbered;
    if (!/^subject options:?$/i.test(line) && !/^preheader:?$/i.test(line)) {
      break;
    }
  }
  return "";
}

function parsePlainTextEmail(raw: string): { subject: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const subject =
    text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ||
    firstSubjectFromOptions(text) ||
    "";
  const marker = text.match(/(?:^|\n)Plain-text email:\s*\n/i);
  if (marker?.index != null) {
    return {
      subject,
      body: text.slice(marker.index + marker[0].length).trim(),
    };
  }
  const body = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^Subject:\s*/i.test(t)) return false;
      if (/^Preheader:\s*/i.test(t)) return false;
      if (/^Subject options:?$/i.test(t)) return false;
      if (/^\d+[\).]\s*/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject, body };
}

function mailtoUrl(subject: string, body: string): string | null {
  const cleanBody = body.trim();
  if (!cleanBody) return null;
  const cleanSubject = subject.trim() || "A quick note";
  return `mailto:?subject=${encodeURIComponent(cleanSubject)}&body=${encodeURIComponent(
    cleanBody
  )}`;
}

async function buildEmailComposeUrl(appFolder: string | null): Promise<string | null> {
  if (!appFolder) return null;
  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const plainPath = path.join(root, appFolder, "plain-text.txt");
  const text = await readFile(plainPath, "utf8").catch(() => "");
  if (!text.trim()) return null;
  const parsed = parsePlainTextEmail(text);
  return mailtoUrl(parsed.subject, parsed.body);
}

/**
 * Public list item for /api/builds and edit-session resolution.
 */
export async function rawAppToListEntry(a: RawApp): Promise<BuildListApp | null> {
  const id = typeof a.id === "string" ? a.id.trim() : "";
  const name =
    typeof a.name === "string" && a.name.trim()
      ? a.name.trim()
      : typeof a.title === "string"
        ? a.title.trim()
        : "";
  const description =
    typeof a.description === "string" ? a.description.trim() : undefined;
  const pathRel = pathRelativeForApi(a);
  const { appFolder, gatewayAppDir } = appFolderAndGatewayFromManifestPath(
    pathRel ?? undefined
  );
  const { createdAt, updatedAt } = await findBuildTimestamps(appFolder, a);
  const artifactVersion = String(
    Math.round(updatedAt ?? createdAt ?? timestampFromRaw(a.updatedAt) ?? Date.now())
  );
  const openUrl = resolveBuildOpenUrl(a, artifactVersion);
  if (!id || !name || !openUrl) return null;
  const hasEmailHtml = await buildFileExists(appFolder, "email.html");
  const emailHtmlUrl = hasEmailHtml
    ? buildArtifactUrl(pathRel, "email.html", artifactVersion)
    : null;
  const emailComposeUrl = hasEmailHtml
    ? await buildEmailComposeUrl(appFolder)
    : null;

  const thumbnailUrl =
    explicitThumbnailFromManifest(a, pathRel, artifactVersion) ??
    (await findBuildThumbnailUrl(appFolder, pathRel, artifactVersion));

  return {
    id,
    name,
    ...(description ? { description } : {}),
    openUrl,
    emailHtmlUrl,
    emailComposeUrl,
    path: pathRel,
    appFolder,
    gatewayAppDir,
    thumbnailUrl,
    thumbnailKind: thumbnailUrl ? "image" : "fallback",
    createdAt,
    updatedAt,
  };
}

/**
 * All list entries from the current manifest (same filtering as GET /api/builds).
 */
export async function loadBuildListApps(): Promise<BuildListApp[]> {
  const rawApps = await loadRawManifestApps();
  const entries = await Promise.all(rawApps.map((a) => rawAppToListEntry(a)));
  return entries
    .filter((x): x is BuildListApp => x !== null)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
}

export type BuildEditSessionPayload = {
  buildId: string;
  name: string;
  openUrl: string;
  pathRelative: string | null;
  appFolder: string | null;
  gatewayAppDir: string | null;
  manifestPath: string;
};

export function listEntryToBuildEditPayload(
  entry: BuildListApp
): BuildEditSessionPayload {
  return {
    buildId: entry.id,
    name: entry.name,
    openUrl: entry.openUrl,
    pathRelative: entry.path,
    appFolder: entry.appFolder,
    gatewayAppDir: entry.gatewayAppDir,
    manifestPath: BUILDS_MANIFEST_GATEWAY_PATH,
  };
}

/** Parse structured build-edit metadata from session store / API JSON. */
export function parseBuildEditPayload(
  be: unknown
): BuildEditSessionPayload | null {
  if (!be || typeof be !== "object") return null;
  const o = be as Record<string, unknown>;
  const buildId = typeof o.buildId === "string" ? o.buildId.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const openUrl = typeof o.openUrl === "string" ? o.openUrl.trim() : "";
  const manifestPath =
    typeof o.manifestPath === "string" ? o.manifestPath.trim() : "";
  if (!buildId || !name || !openUrl || !manifestPath) return null;
  return {
    buildId,
    name,
    openUrl,
    pathRelative:
      typeof o.pathRelative === "string" && o.pathRelative.trim()
        ? o.pathRelative.trim()
        : null,
    appFolder:
      typeof o.appFolder === "string" && o.appFolder.trim()
        ? o.appFolder.trim()
        : null,
    gatewayAppDir:
      typeof o.gatewayAppDir === "string" && o.gatewayAppDir.trim()
        ? o.gatewayAppDir.trim()
        : null,
    manifestPath,
  };
}

/**
 * Find a build by id or return null.
 */
export async function findBuildListAppById(
  id: string
): Promise<BuildListApp | null> {
  const want = id.trim();
  if (!want) return null;
  const normalizedWant = normalizeBuildManifestPath(want) ?? want;
  const apps = await loadBuildListApps();
  return (
    apps.find((a) => a.id === want) ??
    apps.find((a) => a.appFolder === normalizedWant) ??
    apps.find((a) => a.path === normalizedWant) ??
    null
  );
}
