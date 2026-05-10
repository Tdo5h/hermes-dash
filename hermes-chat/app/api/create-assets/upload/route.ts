import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getHermesChatDataDir } from "@/lib/hermes-config";

export const dynamic = "force-dynamic";

const MAX_CREATE_ASSET_BYTES = 80 * 1024 * 1024;

function safeFileName(raw: string): string {
  const base = path.basename(raw || "upload").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base && base !== "." && base !== ".." ? base.slice(0, 160) : "upload";
}

function createAssetDir(id: string): string {
  return path.join(getHermesChatDataDir(), "create-assets", id);
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "Missing file field" }, { status: 400 });
  }

  const originalName =
    typeof (file as File).name === "string" ? (file as File).name : "upload";
  const name = safeFileName(originalName);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return Response.json({ error: "Empty file" }, { status: 400 });
  }
  if (buffer.length > MAX_CREATE_ASSET_BYTES) {
    return Response.json({ error: "File too large" }, { status: 413 });
  }

  const id = randomUUID();
  const dir = createAssetDir(id);
  const mimeType =
    typeof (file as File).type === "string" && (file as File).type
      ? (file as File).type
      : "application/octet-stream";

  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await writeFile(filePath, buffer);
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        id,
        name,
        mimeType,
        size: buffer.length,
        createdAt: Date.now(),
      },
      null,
      2
    )
  );

  return Response.json({
    id,
    name,
    mimeType,
    size: buffer.length,
    url: `/api/create-assets/file?id=${encodeURIComponent(id)}`,
    toolPath: filePath,
  });
}
