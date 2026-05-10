import { getHermesArchitectBaseUrl } from "@/lib/hermes-config";
import {
  dismissSharedIngestJobError,
  getSharedIngestJobForDisplay,
  getSharedIngestLastSnapshot,
  listSharedIngestJobsForSlug,
  readIngestWorkerHeartbeat,
} from "@/lib/shared-ingest-job-store";
import { readProject } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import {
  maybeRunSharedVaultAutoIngest,
  reconcileSharedVaultIngestSuccess,
} from "@/lib/shared-vault-auto-ingest";
import { buildSharedVaultGapHints } from "@/lib/vault-ingest-gap";

const WORKER_HEARTBEAT_STALE_MS = 60_000;

async function getSharedIngestGatewayHealthOk(): Promise<boolean | null> {
  const base = getHermesArchitectBaseUrl()?.trim();
  if (!base) return null;
  const u = base.replace(/\/$/, "");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3_000);
  try {
    const res = await fetch(`${u}/health`, { method: "GET", signal: ac.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function getIngestServiceWorkerFields(): Promise<{
  workerOk: boolean;
  workerMessage: string | null;
  workerLastHeartbeat: number | null;
  /** Legacy field name for older clients. */
  architectReachable: boolean | null;
  sharedIngestGatewayReachable: boolean | null;
}> {
  const hb = await readIngestWorkerHeartbeat();
  const now = Date.now();
  const gatewayOk = await getSharedIngestGatewayHealthOk();
  if (!hb) {
    return {
      workerOk: false,
      workerMessage:
        "No heartbeat from the shared ingest service. Ensure the shared ingest worker is running and shares the ingest coord directory with this Chat service.",
      workerLastHeartbeat: null,
      architectReachable: gatewayOk,
      sharedIngestGatewayReachable: gatewayOk,
    };
  }
  if (now - hb.ts > WORKER_HEARTBEAT_STALE_MS) {
    return {
      workerOk: false,
      workerMessage:
        "Ingest service heartbeat is stale. Queued work may be stalled; check the shared ingest worker container.",
      workerLastHeartbeat: hb.ts,
      architectReachable: gatewayOk,
      sharedIngestGatewayReachable: gatewayOk,
    };
  }
  return {
    workerOk: true,
    workerMessage: null,
    workerLastHeartbeat: hb.ts,
    architectReachable: gatewayOk,
    sharedIngestGatewayReachable: gatewayOk,
  };
}

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const project = await readProject(slug);
    if (!project) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (project.visibility !== "shared") {
      return Response.json({
        jobs: [] as unknown[],
        gapHints: null,
        lastIngestSnapshot: null,
        workerOk: true,
        workerMessage: null,
        workerLastHeartbeat: null,
        architectReachable: null,
        sharedIngestGatewayReachable: null,
      });
    }

    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId")?.trim();
    if (jobId) {
      const job = await getSharedIngestJobForDisplay(jobId);
      if (!job || job.projectSlug !== slug) {
        return Response.json({ job: null, gapHints: null, lastIngestSnapshot: null });
      }
      const lastIngestSnapshot = await getSharedIngestLastSnapshot(slug);
      const svc = await getIngestServiceWorkerFields();
      return Response.json({ job, gapHints: null, lastIngestSnapshot, ...svc });
    }

    await reconcileSharedVaultIngestSuccess(slug);
    const forceScan =
      new URL(req.url).searchParams.get("forceScan") === "1" ||
      new URL(req.url).searchParams.get("forceScan") === "true";
    await maybeRunSharedVaultAutoIngest(slug, Date.now(), { forceScan });
    const jobs = await listSharedIngestJobsForSlug(slug);
    const gapHints = await buildSharedVaultGapHints(slug);
    const lastIngestSnapshot = await getSharedIngestLastSnapshot(slug);
    const svc = await getIngestServiceWorkerFields();
    return Response.json({ jobs, gapHints, lastIngestSnapshot, ...svc });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const project = await readProject(slug);
    if (!project) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (project.visibility !== "shared") {
      return Response.json({ error: "Only shared ingest jobs can be dismissed here" }, { status: 400 });
    }

    const url = new URL(req.url);
    let jobId = url.searchParams.get("jobId")?.trim() ?? "";
    if (!jobId) {
      const body = (await req.json().catch(() => ({}))) as { jobId?: unknown };
      jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    }
    if (!jobId) {
      return Response.json({ error: "jobId is required" }, { status: 400 });
    }

    const dismissed = await dismissSharedIngestJobError(jobId, slug);
    return Response.json({ ok: true, dismissed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
