import { listVaultTemplates, readProject } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const project = await readProject(slug);
    if (!project) return Response.json({ error: "Workspace not found" }, { status: 404 });
    const templates = await listVaultTemplates(slug);
    return Response.json({ templates });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
