import { readBuildArtifactForDownload } from "@/lib/builds-artifact-file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentDispositionAttachment(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `attachment; filename="${safe}"`;
}

function contentDispositionInline(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `inline; filename="${safe}"`;
}

function allowsInlineDisposition(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".json") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".log")
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const rawName = url.searchParams.get("name") ?? url.searchParams.get("file") ?? "";
  if (!id) {
    return Response.json({ error: "id query required" }, { status: 400 });
  }
  if (!rawName.trim()) {
    return Response.json(
      { error: "Missing name (or file) query parameter" },
      { status: 400 }
    );
  }

  const wantInline =
    url.searchParams.get("disposition") === "inline" ||
    url.searchParams.get("inline") === "1";

  const result = await readBuildArtifactForDownload(id, rawName);
  if (!result.ok) {
    if (result.reason === "invalid") {
      return Response.json({ error: "Invalid file path" }, { status: 400 });
    }
    if (result.reason === "too_large") {
      return Response.json({ error: "File too large" }, { status: 413 });
    }
    if (result.reason === "no_folder") {
      return Response.json(
        {
          error:
            "No local project folder for this build (external URL only). Download is unavailable.",
        },
        { status: 400 }
      );
    }
    if (result.reason === "missing_build") {
      return Response.json({ error: "Build not found" }, { status: 404 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const useInline = wantInline && allowsInlineDisposition(result.fileName);
  const disposition = useInline
    ? contentDispositionInline(result.fileName)
    : contentDispositionAttachment(result.fileName);

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mime,
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
