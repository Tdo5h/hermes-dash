import { readProject, undoVaultIngest } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";

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

  let body: { relativePath?: string; dryRun?: boolean } = {};
  try {
    body = (await req.json()) as { relativePath?: string; dryRun?: boolean };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const relativePath =
    typeof body.relativePath === "string" ? body.relativePath.trim() : "";
  if (!relativePath) {
    return Response.json({ error: "relativePath required" }, { status: 400 });
  }

  try {
    const project = await readProject(slug);
    if (!project) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }

    const result = await undoVaultIngest(slug, relativePath, {
      dryRun: body.dryRun === true,
    });
    return Response.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
