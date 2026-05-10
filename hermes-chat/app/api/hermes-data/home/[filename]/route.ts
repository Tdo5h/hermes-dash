import path from "path";
import { stat, readFile } from "fs/promises";
import { getHermesDataDir } from "@/lib/hermes-config";
import {
  MAX_VAULT_SOURCE_FILE_BYTES,
  mimeTypeForVaultBasename,
} from "@/lib/project-service";

export const dynamic = "force-dynamic";

const ALLOWED_HOME_EXT = new Set([".md", ".txt", ".json", ".csv"]);

function contentDispositionAttachment(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `attachment; filename="${safe}"`;
}

/**
 * Single file under Hermes HERMES_HOME/home/ (e.g. agent-written drafts).
 * Basename only — no subdirectories. Requires HERMES_DATA_DIR mounted and readable.
 */
function safeHomeBasename(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[/\\]/.test(trimmed)) return null;
  const base = path.basename(trimmed);
  if (base !== trimmed) return null;
  if (base.startsWith(".")) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_HOME_EXT.has(ext)) return null;
  return base;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const root = getHermesDataDir();
  if (!root) {
    return Response.json(
      { error: "HERMES_DATA_DIR is not set — home file download unavailable" },
      { status: 503 }
    );
  }

  const { filename: rawParam } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawParam);
  } catch {
    return Response.json({ error: "Invalid filename" }, { status: 400 });
  }

  const base = safeHomeBasename(decoded);
  if (!base) {
    return Response.json({ error: "Invalid file name" }, { status: 400 });
  }

  const homeDir = path.join(root, "home");
  const fullPath = path.join(homeDir, base);
  const resolvedFile = path.resolve(fullPath);
  const resolvedRoot = path.resolve(homeDir);
  const rel = path.relative(resolvedRoot, resolvedFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  let st;
  try {
    st = await stat(resolvedFile);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!st.isFile()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (st.size > MAX_VAULT_SOURCE_FILE_BYTES) {
    return Response.json({ error: "File too large" }, { status: 413 });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(resolvedFile);
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : "";
    if (code === "EACCES" || code === "EPERM") {
      return Response.json(
        { error: "Cannot read Hermes home — check container mount and permissions" },
        { status: 503 }
      );
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const mime = mimeTypeForVaultBasename(base);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": contentDispositionAttachment(base),
      "Cache-Control": "private, no-store",
    },
  });
}
