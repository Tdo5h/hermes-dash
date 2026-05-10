import { listProjects, listVaultTemplates } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const projects = await listProjects();
    const nested = await Promise.all(
      projects.map((project) => listVaultTemplates(project.slug).catch(() => []))
    );
    const templates = nested
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Response.json({ templates });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_CHAT_DATA_DIR|HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
