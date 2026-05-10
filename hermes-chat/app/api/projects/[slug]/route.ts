import { readProject, renameProject, deleteProject } from "@/lib/project-service";
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
    const p = await readProject(slug);
    if (!p) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(p);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

const MAX_NAME_LEN = 200;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const raw = typeof body.name === "string" ? body.name : "";
    if (!raw.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    if (raw.length > MAX_NAME_LEN) {
      return Response.json(
        { error: `name must be at most ${MAX_NAME_LEN} characters` },
        { status: 400 }
      );
    }
    const p = await renameProject(slug, raw);
    return Response.json(p);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "Project not found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
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
    const existing = await readProject(slug);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.visibility === "shared") {
      const body = (await req.json().catch(() => ({}))) as { confirmName?: unknown };
      const c =
        typeof body.confirmName === "string" ? body.confirmName.trim() : "";
      if (c !== existing.name.trim()) {
        return Response.json(
          { error: "confirmName must match the vault name exactly" },
          { status: 400 }
        );
      }
    }
    await deleteProject(slug);
    return new Response(null, { status: 204 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "Project not found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
