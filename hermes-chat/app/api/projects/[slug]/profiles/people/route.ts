import {
  listCreatePeopleProfiles,
  upsertManualCreatePeopleProfile,
} from "@/lib/hermes-brain-profiles";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { readProject } from "@/lib/project-service";

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

    const profiles = await listCreatePeopleProfiles({
      projectSlug: slug,
      visibility: project.visibility,
      vaultName: project.name || slug,
    });

    return Response.json({ profiles });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

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
    if (!project) return Response.json({ error: "Workspace not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      kind?: unknown;
      company?: unknown;
      role?: unknown;
      email?: unknown;
      phone?: unknown;
      notes?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const profile = await upsertManualCreatePeopleProfile({
      projectSlug: slug,
      visibility: project.visibility,
      vaultName: project.name || slug,
      input: {
        name,
        kind: body.kind === "company" ? "company" : "clients",
        company: typeof body.company === "string" ? body.company : "",
        role: typeof body.role === "string" ? body.role : "",
        email: typeof body.email === "string" ? body.email : "",
        phone: typeof body.phone === "string" ? body.phone : "",
        notes: typeof body.notes === "string" ? body.notes : "",
      },
    });

    return Response.json({ profile });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
