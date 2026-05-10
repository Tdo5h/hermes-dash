import { readProjectSourceFileForDownload } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";

export const dynamic = "force-dynamic";

function contentDispositionAttachment(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `attachment; filename="${safe}"`;
}

function contentDispositionInline(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `inline; filename="${safe}"`;
}

/** Browser viewing (not download) — previews and chat inline images. */
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }

  const url = new URL(req.url);
  const rawName = url.searchParams.get("name") ?? url.searchParams.get("file") ?? "";
  if (!rawName.trim()) {
    return Response.json({ error: "Missing name (or file) query parameter" }, { status: 400 });
  }

  const wantInline =
    url.searchParams.get("disposition") === "inline" ||
    url.searchParams.get("inline") === "1";

  try {
    const result = await readProjectSourceFileForDownload(slug, rawName);
    if (!result.ok) {
      if (result.reason === "invalid") {
        return Response.json({ error: "Invalid file name" }, { status: 400 });
      }
      if (result.reason === "too_large") {
        return Response.json({ error: "File too large" }, { status: 413 });
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
