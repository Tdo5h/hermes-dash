import { getIngestEnqueueDefaultProfile } from "@/lib/ingest-enqueue-default-profile";
import { enqueueSharedIngestJob } from "@/lib/shared-ingest-job-store";
import {
  readProject,
  saveProjectFile,
  listVaultUploadedFiles,
  deleteProjectSourceFile,
} from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";

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
    const files = await listVaultUploadedFiles(slug);
    return Response.json({ files });
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

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (parseErr: unknown) {
      const detail = parseErr instanceof Error ? parseErr.message : "Unknown parse error";
      console.error("[project-files] multipart parse failed", {
        slug,
        contentType: ct,
        contentLength: req.headers.get("content-length"),
        detail,
      });
      return Response.json(
        {
          error:
            "Upload body could not be parsed. The request may be incomplete or larger than the server upload limit.",
          detail,
        },
        { status: 400 }
      );
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return Response.json({ error: "Missing file field" }, { status: 400 });
    }

    const shaField = form.get("sha256");
    const sha256 =
      typeof shaField === "string" && shaField.trim() ? shaField.trim() : undefined;

    const assetRoleRaw = form.get("assetRole");
    const assetRole = normalizeVaultAssetRole(
      typeof assetRoleRaw === "string" ? assetRoleRaw : undefined
    );
    const contextRaw = form.get("contextVaultSlug");
    const contextVaultSlug =
      typeof contextRaw === "string" && contextRaw.trim() ? contextRaw.trim() : null;
    const reservedOrg = getOrgGlobalSlug();
    const contextForDb =
      assetRole === "org_global" && slug === reservedOrg ? contextVaultSlug : null;

    const originalName =
      typeof (file as File).name === "string" ? (file as File).name : "upload";
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return Response.json({ error: "Empty file" }, { status: 400 });
    }
    const maxBytes = 80 * 1024 * 1024;
    if (buf.length > maxBytes) {
      return Response.json({ error: "File too large" }, { status: 413 });
    }

    const saved = await saveProjectFile(slug, originalName, buf, {
      ...(sha256 ? { sha256 } : {}),
      assetRole,
      ...(contextForDb ? { contextProjectSlug: contextForDb } : {}),
    });
    const mimeType =
      typeof (file as File).type === "string" && (file as File).type
        ? (file as File).type
        : "application/octet-stream";

    const sourceWebchatField = form.get("sourceWebchatId");
    const sourceWebchatId =
      typeof sourceWebchatField === "string" && sourceWebchatField.trim()
        ? sourceWebchatField.trim()
        : undefined;

    let ingestJobId: string | undefined;
    if (project.visibility === "shared" && !saved.skippedWrite) {
      const { jobId } = await enqueueSharedIngestJob({
        projectSlug: slug,
        relativePath: saved.relativePath,
        fileName: saved.fileName,
        ingestSourceProfile: getIngestEnqueueDefaultProfile(),
        mimeType,
        duplicate: saved.duplicate,
        ...(contextForDb ? { contextVaultSlug: contextForDb } : {}),
        ...(assetRole !== "general_reference" ? { assetRole } : {}),
        ...(sourceWebchatId ? { sourceWebchatId } : {}),
      });
      ingestJobId = jobId;
    }

    return Response.json({
      ...saved,
      mimeType,
      projectSlug: slug,
      projectName: project.name,
      visibility: project.visibility,
      assetRole,
      ...(ingestJobId ? { ingestJobId } : {}),
    });
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
    if (!project) return Response.json({ error: "Workspace not found" }, { status: 404 });

    const url = new URL(req.url);
    const name = url.searchParams.get("name")?.trim() ?? "";
    const relativePath = url.searchParams.get("relativePath")?.trim() ?? "";
    const key = name || relativePath;
    if (!key) {
      return Response.json(
        { error: "Query name= or relativePath= required" },
        { status: 400 }
      );
    }

    await deleteProjectSourceFile(slug, key);
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (/HERMES_DATA_DIR|HERMES_PROJECTS_FS_ROOT|project vault|Set HERMES/i.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
