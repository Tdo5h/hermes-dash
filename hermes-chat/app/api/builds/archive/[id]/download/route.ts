import archiver from "archiver";
import { mkdtemp, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { Readable } from "node:stream";
import { promisify } from "util";
import { archivedBuildArchivePath } from "@/lib/builds-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

function asciiFileBaseName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "build";
}

async function extractArchiveToTemp(
  archivePath: string,
  compression: "zstd" | "gzip",
  tempDir: string
) {
  if (compression === "gzip" || archivePath.endsWith(".tar.gz")) {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", tempDir]);
    return;
  }
  await execFileAsync("tar", ["-I", "zstd", "-xf", archivePath, "-C", tempDir]);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buildId = decodeURIComponent(id).trim();
  if (!buildId) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  try {
    const { record, archivePath } = await archivedBuildArchivePath(buildId);
    const st = await stat(archivePath);
    if (!st.isFile()) {
      return Response.json({ error: "Archive file missing" }, { status: 404 });
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hermes-archive-download-"));
    await extractArchiveToTemp(archivePath, record.compression, tempDir);
    const extractedDir = path.join(tempDir, record.appFolder);
    const extractedStat = await stat(extractedDir);
    if (!extractedStat.isDirectory()) {
      throw new Error("Archive did not contain the build folder");
    }

    const zip = archiver("zip", { zlib: { level: 9 } });
    zip.directory(extractedDir, record.appFolder);
    zip.on("end", () => {
      void rm(tempDir, { recursive: true, force: true });
    });
    zip.on("close", () => {
      void rm(tempDir, { recursive: true, force: true });
    });
    zip.on("error", () => {
      void rm(tempDir, { recursive: true, force: true });
    });

    const filename = `${asciiFileBaseName(record.name)}.zip`;
    const filenameStar = encodeURIComponent(`${record.name}.zip`);
    void zip.finalize();
    const webStream = Readable.toWeb(zip);
    return new Response(webStream as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filenameStar}`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not download archive";
    return Response.json(
      { error: msg },
      { status: /not found|missing/i.test(msg) ? 404 : 500 }
    );
  }
}
