import { readProject } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { queueSharedVaultArchitectReingest } from "@/lib/queue-shared-vault-reingest";

export const dynamic = "force-dynamic";

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
      return Response.json({ error: "Vault not found" }, { status: 404 });
    }
    if (project.visibility !== "shared") {
      return Response.json(
        { error: "Re-ingest from vault is only available for shared vaults" },
        { status: 400 }
      );
    }

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
        : typeof o.name === "string" && o.name.trim()
          ? o.name.trim()
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

    const { jobId } = await queueSharedVaultArchitectReingest(slug, key);
    return Response.json({ ok: true, jobId, projectSlug: slug });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    if (/not found|required|Invalid/i.test(msg)) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
