import { getOrCreateWorkspaceThread } from "@/lib/workspace-thread";
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
    const t = await getOrCreateWorkspaceThread(slug);
    return Response.json(t);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("not found")) {
      return Response.json({ error: msg }, { status: 404 });
    }
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
