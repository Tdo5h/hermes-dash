import { listProjects, createProject } from "@/lib/project-service";
import { getProjectVaultConfigError, type WorkspaceVisibility } from "@/lib/project-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const projects = await listProjects();
    return Response.json(projects);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      visibility?: string;
    };
    const name = typeof body.name === "string" ? body.name : "";
    let visibility: WorkspaceVisibility | undefined;
    if (body.visibility === "shared") visibility = "shared";
    else if (body.visibility === "private") visibility = "private";
    const project = await createProject(name, visibility ? { visibility } : undefined);
    return Response.json(project);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
