import { getProjectVaultConfigError } from "@/lib/project-paths";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { getVaultAssetRoleByPathDb } from "@/lib/db/repositories";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import {
  countActivePrivateReingestJobsForSlug,
  createPrivateReingestJob,
  failPrivateReingestJob,
} from "@/lib/private-reingest-job-store";
import {
  findVaultSourceRow,
  runPrivateVaultReingestHeadless,
} from "@/lib/private-vault-reingest";
import { readProject } from "@/lib/project-service";
import { runVaultCoreferencePassForSlug } from "@/lib/vault-coreference-schedule";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Queues a private-vault verify/repair ingest against Hermes (streams in the background).
 * UI polls `private-reingest-status` and shows the same inline orb + file-row pattern as architect.
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
  try {
    const project = await readProject(slug);
    if (!project) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (project.visibility !== "private") {
      return Response.json(
        { error: "This action is for private vaults. Use the shared vault re-sync for org workspaces." },
        { status: 400 }
      );
    }
    const projectName = project.name;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Expected JSON body" }, { status: 400 });
    }
    const o = body as Record<string, unknown>;
    const fileName =
      typeof o.fileName === "string" && o.fileName.trim()
        ? o.fileName.trim()
        : "";
    const relativePath =
      typeof o.relativePath === "string" && o.relativePath.trim()
        ? o.relativePath.trim()
        : "";
    const key = fileName || relativePath;
    if (!key) {
      return Response.json(
        { error: "Provide fileName or relativePath" },
        { status: 400 }
      );
    }

    const sourceWebchatIdRaw =
      typeof o.sourceWebchatId === "string" && o.sourceWebchatId.trim()
        ? o.sourceWebchatId.trim()
        : typeof o.workspaceSessionId === "string" && o.workspaceSessionId.trim()
          ? o.workspaceSessionId.trim()
          : "";
    const reingestVerify = o.reingestVerify !== false;

    let preloaded: Awaited<ReturnType<typeof findVaultSourceRow>>;
    try {
      preloaded = await findVaultSourceRow(slug, key);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      return Response.json({ error: m }, { status: 400 });
    }

    let assetRole: ReturnType<typeof normalizeVaultAssetRole> | undefined;
    if (shouldUseChatDatabase()) {
      const roleStr = await getVaultAssetRoleByPathDb(
        slug,
        preloaded.row.relativePath
      );
      assetRole = normalizeVaultAssetRole(roleStr ?? "general_reference");
    }

    const jobId = createPrivateReingestJob({
      projectSlug: slug,
      relativePath: preloaded.row.relativePath,
      fileName: preloaded.row.name,
      ...(assetRole != null ? { assetRole } : {}),
      ...(sourceWebchatIdRaw ? { sourceWebchatId: sourceWebchatIdRaw } : {}),
      reingestVerify,
    });

    void (async () => {
      async function notifyIfPrivateIngestCycleIdle(errorMessage?: string) {
        if (countActivePrivateReingestJobsForSlug(slug) > 0) return;
        const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
        const url = site
          ? `${site.replace(/\/$/, "")}/chat/workspace/${encodeURIComponent(slug)}`
          : `/chat/workspace/${encodeURIComponent(slug)}`;
        await sendPushToAll({
          title: errorMessage ? "Vault ingest needs attention" : "Vault ingest complete",
          body: errorMessage
            ? `${projectName}: ${errorMessage.slice(0, 160)}`
            : `${projectName} is ready. All queued private ingest work has finished.`,
          url,
          kind: "vault",
          tag: `vault-private-${slug}`,
        }).catch((pushErr) => {
          console.error("[reingest-hermes] push", pushErr);
        });
      }

      try {
        await runPrivateVaultReingestHeadless(slug, key, preloaded, {
          jobId,
          reingestVerify,
        });
        try {
          await runVaultCoreferencePassForSlug(slug);
        } catch (ce: unknown) {
          console.error("[reingest-hermes] coreference pass", ce);
        }
        await notifyIfPrivateIngestCycleIdle();
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        console.error("[reingest-hermes] background", e);
        failPrivateReingestJob(jobId, m);
        await notifyIfPrivateIngestCycleIdle(m);
      }
    })();

    return Response.json(
      {
        ok: true,
        accepted: true,
        jobId,
        projectSlug: slug,
        fileName: preloaded.row.name,
        relativePath: preloaded.row.relativePath,
        ...(assetRole != null ? { assetRole } : {}),
      },
      { status: 202 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    if (/not found|required|Private workspace/i.test(msg)) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
