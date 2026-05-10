import { prepareCreateEmail } from "@/lib/create-email-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorJson(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const buildId = url.searchParams.get("id")?.trim() || "";
  if (!buildId) return errorJson("Build id required.");

  const email = await prepareCreateEmail(buildId);
  if (!email) return errorJson("Email build not found or missing email.html.", 404);

  return Response.json(
    {
      id: email.buildId,
      name: email.buildName,
      subject: email.subject,
      preheader: email.preheader,
      html: email.html,
      clipboardHtml: email.clipboardHtml,
      richClipboardHtml: email.richClipboardHtml,
      text: email.text,
      textPreview: email.text.slice(0, 1800),
      htmlBytes: email.htmlBytes,
      clipboardHtmlBytes: email.clipboardHtmlBytes,
      richClipboardHtmlBytes: email.richClipboardHtmlBytes,
      textBytes: email.textBytes,
      imageCount: email.imageCount,
      warnings: email.warnings,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
