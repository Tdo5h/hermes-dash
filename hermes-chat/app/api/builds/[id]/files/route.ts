import { readdir, stat } from "fs/promises";
import path from "path";
import { findBuildListAppById } from "@/lib/builds-manifest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BuildFileRow = {
  name: string;
  path: string;
  size: number;
  href: string;
  downloadHref: string;
};

const MAX_FILES = 80;
const MAX_DEPTH = 4;

function safeRel(parts: string[]): string | null {
  const joined = parts.join("/").replace(/\\/g, "/");
  if (!joined || joined.startsWith("/") || joined.includes("\0")) return null;
  const normalized = path.posix.normalize(joined);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function skipFile(rel: string): boolean {
  const base = path.posix.basename(rel);
  if (!base || base.startsWith(".")) return true;
  if (/^(read_me_first|start-local-server)\b/i.test(base)) return true;
  if (/\.map$/i.test(base)) return true;
  return false;
}

function scorePrimary(rel: string): number {
  const lower = rel.toLowerCase();
  const base = path.posix.basename(lower);
  if (base === "email.html") return 1000;
  if (base === "document.pdf") return 950;
  if (base === "index.html") return 900;
  if (/\.(mp4|webm)$/i.test(lower)) return 850;
  if (/\.(gif)$/i.test(lower)) return 820;
  if (/(poster|preview|cover|hero|thumbnail).*\.(png|jpe?g|webp|svg)$/i.test(lower)) return 790;
  if (/\.(png|jpe?g|webp|svg)$/i.test(lower)) return 720;
  if (/\.(html?|pdf)$/i.test(lower)) return 700;
  if (/\.(txt|md)$/i.test(lower)) return 300;
  return 100;
}

async function collectFiles(root: string, dir: string, depth = 0): Promise<BuildFileRow[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: BuildFileRow[] = [];
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const rel = safeRel([path.relative(root, abs).replace(/\\/g, "/")]);
    if (!rel) continue;
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(root, abs, depth + 1)));
      continue;
    }
    if (!entry.isFile() || skipFile(rel)) continue;
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({
      name: path.posix.basename(rel),
      path: rel,
      size: st.size,
      href: `/api/builds/static/__BUILD__/${rel
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      downloadHref: `/api/builds/file?id=__BUILD__&name=${encodeURIComponent(
        rel
      )}&disposition=attachment`,
    });
  }
  return out.slice(0, MAX_FILES);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buildId = decodeURIComponent(id).trim();
  if (!buildId) {
    return Response.json({ error: "Build id required" }, { status: 400 });
  }

  const app = await findBuildListAppById(buildId);
  if (!app) {
    return Response.json({ error: "Build not found" }, { status: 404 });
  }
  if (!app.appFolder) {
    return Response.json({ error: "No local build folder" }, { status: 400 });
  }

  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const buildRoot = path.resolve(root, app.appFolder);
  const rootResolved = path.resolve(root);
  if (buildRoot !== rootResolved && !buildRoot.startsWith(`${rootResolved}${path.sep}`)) {
    return Response.json({ error: "Invalid build path" }, { status: 500 });
  }

  const st = await stat(buildRoot).catch(() => null);
  if (!st?.isDirectory()) {
    return Response.json({ error: "Build folder missing" }, { status: 404 });
  }

  const files = (await collectFiles(buildRoot, buildRoot))
    .map((file) => ({
      ...file,
      href: file.href.replace("__BUILD__", encodeURIComponent(buildId)),
      downloadHref: file.downloadHref.replace("__BUILD__", encodeURIComponent(buildId)),
    }))
    .sort((a, b) => {
      const primaryDelta = scorePrimary(b.path) - scorePrimary(a.path);
      if (primaryDelta) return primaryDelta;
      return a.path.localeCompare(b.path);
    });

  const primaryPath = files[0]?.path ?? null;

  return Response.json(
    {
      id: app.id,
      name: app.name,
      description: app.description ?? null,
      emailComposeUrl: app.emailComposeUrl,
      primaryPath,
      files,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
