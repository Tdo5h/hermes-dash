import { getProjectVaultConfigError } from "@/lib/project-paths";
import {
  getPrivateReingestJob,
  listPrivateReingestJobsForSlug,
  removePrivateReingestJob,
} from "@/lib/private-reingest-job-store";
import { readProject } from "@/lib/project-service";

export const dynamic = "force-dynamic";

/**
 * Poll Hermes private re-verify jobs (in-memory in this Chat process).
 * GET `?jobId=` — single job including `done` / `error` for inline hero dismissal.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  const project = await readProject(slug);
  if (!project) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (project.visibility !== "private") {
    return Response.json({ jobs: [] as unknown[] });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId")?.trim();
  if (jobId) {
    const job = getPrivateReingestJob(jobId);
    if (!job || job.projectSlug !== slug) {
      return Response.json({ job: null });
    }
    return Response.json({
      job: {
        jobId: job.jobId,
        projectSlug: job.projectSlug,
        fileName: job.fileName,
        relativePath: job.relativePath,
        status: job.status,
        phaseKey: job.phaseKey,
        phaseLabel: job.phaseLabel,
        errorMessage: job.errorMessage,
        assetRole: job.assetRole ?? null,
        reingestVerify: job.reingestVerify === true,
        readerTasks: job.readerTasks,
        challengeTask: job.challengeTask,
        mergeTask: job.mergeTask,
      },
    });
  }

  return Response.json({ jobs: listPrivateReingestJobsForSlug(slug) });
}

/** Clear job record after inline hero completes (matches architect dismiss cleanup). */
export async function DELETE(
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
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const jobId =
    typeof o.jobId === "string" && o.jobId.trim() ? o.jobId.trim() : "";
  if (!jobId) {
    return Response.json({ error: "jobId required" }, { status: 400 });
  }
  const job = getPrivateReingestJob(jobId);
  if (job && job.projectSlug === slug) {
    removePrivateReingestJob(jobId);
  }
  return Response.json({ ok: true });
}
