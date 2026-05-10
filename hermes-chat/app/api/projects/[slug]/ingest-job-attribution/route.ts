import { patchSharedIngestJobSourceWebchat } from "@/lib/shared-ingest-job-store";
import { getProjectVaultConfigError } from "@/lib/project-paths";

export const dynamic = "force-dynamic";

/**
 * After a shared vault file upload, associate the ingest job with the workspace session
 * that will show the architect hero / sidebar orb (POST /files may not have known the id yet).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body as { jobId?: unknown; sourceWebchatId?: unknown };
  const jobId = typeof o.jobId === "string" ? o.jobId.trim() : "";
  const sourceWebchatId =
    typeof o.sourceWebchatId === "string" ? o.sourceWebchatId.trim() : "";
  if (!jobId || !sourceWebchatId) {
    return Response.json(
      { error: "jobId and sourceWebchatId required" },
      { status: 400 }
    );
  }
  const ok = await patchSharedIngestJobSourceWebchat(
    jobId,
    slug,
    sourceWebchatId
  );
  return Response.json({ ok });
}
