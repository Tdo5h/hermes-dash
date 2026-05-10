import { createHash } from "crypto";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import { getIngestEnqueueDefaultProfile } from "@/lib/ingest-enqueue-default-profile";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import {
  recordLightVaultIngest,
  shouldUseLightVaultIngest,
} from "@/lib/hermes-light-ingest";
import { readProject, saveProjectFile } from "@/lib/project-service";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { enqueueSharedIngestJob } from "@/lib/shared-ingest-job-store";

export const dynamic = "force-dynamic";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function extForMime(m: string): string {
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "bin";
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

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const project = await readProject(slug);
  if (!project) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  const form = await req.formData();
  const textField = form.get("text");
  const text = typeof textField === "string" ? textField : "";
  const assetRole = normalizeVaultAssetRole(form.get("assetRole"));
  const contextRaw = form.get("contextVaultSlug");
  const contextVaultSlug =
    typeof contextRaw === "string" && contextRaw.trim() ? contextRaw.trim() : null;
  const reservedOrg = getOrgGlobalSlug();
  const contextForDb =
    assetRole === "org_global" && slug === reservedOrg ? contextVaultSlug : null;

  const rawImages = form.getAll("image");
  const blobs: Blob[] = [];
  for (const x of rawImages) {
    if (x instanceof Blob && x.size > 0) blobs.push(x);
  }

  if (!text.trim() && blobs.length === 0) {
    return Response.json({ error: "Add text and/or at least one image" }, { status: 400 });
  }
  if (blobs.length > MAX_IMAGES) {
    return Response.json({ error: `At most ${MAX_IMAGES} images` }, { status: 400 });
  }

  for (const b of blobs) {
    if (b.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "An image exceeds 20 MB" }, { status: 413 });
    }
    const mime = (b as File).type || "";
    if (!mime.startsWith("image/")) {
      return Response.json({ error: "Only image/* files are allowed" }, { status: 400 });
    }
  }

  const imageHashes: string[] = [];
  const refLines: string[] = [];
  const referencePaths: string[] = [];
  for (const blob of blobs) {
    const buf = Buffer.from(await blob.arrayBuffer());
    const hash = createHash("sha256").update(buf).digest("hex");
    imageHashes.push(hash);
    const ext = extForMime((blob as File).type || "image/png");
    const origName = `paste-img-${hash.slice(0, 16)}.${ext}`;
    const savedRef = await saveProjectFile(slug, origName, buf, {
      sha256: hash,
      assetRole,
      ...(contextForDb ? { contextProjectSlug: contextForDb } : {}),
    });
    const refPath = savedRef.duplicatePath || savedRef.relativePath;
    referencePaths.push(refPath);
    refLines.push(`- \`${refPath}\` (${savedRef.fileName})`);
  }

  const bodyCore = text.trim() ? text.trim() : "_Reference images only — see section below._";
  const sections = ["# Pasted vault ingest", "", bodyCore];
  if (refLines.length > 0) {
    sections.push("", "## Reference images (paths on gateway)", ...refLines);
  }
  const mdContent = sections.join("\n");

  const base = createHash("sha256")
    .update(`${assetRole}\u001f${text.trim()}\u001f${imageHashes.join("\u001f")}`)
    .digest("hex")
    .slice(0, 16);
  const mainName = `paste-${base}.md`;
  const savedMain = await saveProjectFile(
    slug,
    mainName,
    Buffer.from(mdContent, "utf-8"),
    {
      assetRole,
      ...(contextForDb ? { contextProjectSlug: contextForDb } : {}),
    }
  );

  const sourceWebchatField = form.get("sourceWebchatId");
  const sourceWebchatId =
    typeof sourceWebchatField === "string" && sourceWebchatField.trim()
      ? sourceWebchatField.trim()
      : undefined;

  let ingestJobId: string | undefined;
  let ingestMode: "light" | "full" = "full";
  let lightOutputPaths: string[] | undefined;
  if (
    !savedMain.skippedWrite &&
    shouldUseLightVaultIngest({
      text,
      imageCount: blobs.length,
      assetRole,
    })
  ) {
    const light = await recordLightVaultIngest({
      projectSlug: slug,
      visibility: project.visibility,
      fileName: savedMain.fileName,
      relativePath: savedMain.relativePath,
      markdown: mdContent,
      assetRole,
      referencePaths,
    });
    ingestMode = light.mode;
    lightOutputPaths = light.outputPaths;
  } else if (project.visibility === "shared" && !savedMain.skippedWrite) {
    const { jobId } = await enqueueSharedIngestJob({
      projectSlug: slug,
      relativePath: savedMain.relativePath,
      fileName: savedMain.fileName,
      ingestSourceProfile: getIngestEnqueueDefaultProfile(),
      mimeType: "text/markdown",
      duplicate: savedMain.duplicate,
      ...(contextForDb ? { contextVaultSlug: contextForDb } : {}),
      ...(assetRole !== "general_reference" ? { assetRole } : {}),
      ...(sourceWebchatId ? { sourceWebchatId } : {}),
    });
    ingestJobId = jobId;
  }

  return Response.json({
    ...savedMain,
    mimeType: "text/markdown",
    projectSlug: slug,
    projectName: project.name,
    visibility: project.visibility,
    assetRole,
    ingestMode,
    ...(lightOutputPaths ? { outputPaths: lightOutputPaths } : {}),
    ...(ingestJobId ? { ingestJobId } : {}),
  });
}
