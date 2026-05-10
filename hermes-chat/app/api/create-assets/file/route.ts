import { readFile } from "fs/promises";
import path from "path";
import { getHermesChatDataDir } from "@/lib/hermes-config";

export const dynamic = "force-dynamic";

type CreateAssetMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

function safeId(raw: string): string | null {
  const id = raw.trim();
  return /^[a-f0-9-]{36}$/i.test(id) ? id : null;
}

function contentDispositionInline(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `inline; filename="${safe}"`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = safeId(url.searchParams.get("id") ?? "");
  if (!id) return Response.json({ error: "Invalid id" }, { status: 400 });

  const dir = path.join(getHermesChatDataDir(), "create-assets", id);
  try {
    const meta = JSON.parse(
      await readFile(path.join(dir, "meta.json"), "utf8")
    ) as CreateAssetMeta;
    const buffer = await readFile(path.join(dir, meta.name));
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Disposition": contentDispositionInline(meta.name),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
