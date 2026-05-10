import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { recordHermesBrainIngestRun } from "@/lib/hermes-brain-ingest";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import {
  resolveProjectRoot,
  writeProjectArtifactFile,
} from "@/lib/project-service";
import type { WorkspaceVisibility } from "@/lib/project-paths";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";

type LightVaultIngestParams = {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  fileName: string;
  relativePath: string;
  markdown: string;
  assetRole?: VaultAssetRole;
  referencePaths?: string[];
};

type LightVaultIngestResult = {
  mode: "light";
  outputPaths: string[];
  documentRecordId: string;
  sourceRunId: string;
  routerPath: string;
};

function sourceStemFrom(fileName: string, relativePath: string): string {
  const base =
    path.posix.basename(fileName.replace(/\\/g, "/")) ||
    path.posix.basename(relativePath.replace(/\\/g, "/")) ||
    "source.md";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/[^A-Za-z0-9._-]+/g, "_") || "source";
}

function readableRoot(projectSlug: string, visibility: WorkspaceVisibility): string {
  if (visibility === "shared" || projectSlug === getOrgGlobalSlug()) {
    return `/vault-shared/${projectSlug}/`;
  }
  return `projects/${projectSlug}/`;
}

function readablePath(
  projectSlug: string,
  visibility: WorkspaceVisibility,
  relPath: string
): string {
  const raw = relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (raw.startsWith("projects/") || raw.startsWith("/vault-shared/")) return raw;
  return `${readableRoot(projectSlug, visibility)}${raw}`;
}

function compactText(markdown: string): string {
  return markdown
    .replace(/^#\s+Pasted vault ingest\s*$/im, "")
    .replace(/^##\s+Reference images[\s\S]*$/im, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkMarkdown(markdown: string, maxChars = 1500): string[] {
  const pieces = markdown
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }
    if (`${current}\n\n${piece}`.length <= maxChars) {
      current = `${current}\n\n${piece}`;
      continue;
    }
    chunks.push(current);
    current = piece;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [markdown.trim()].filter(Boolean);
}

function segmentJsonl(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  relativePath: string;
  fileName: string;
  markdown: string;
  assetRole: VaultAssetRole;
  updatedAt: string;
}): string {
  const sourcePath = readablePath(
    params.projectSlug,
    params.visibility,
    params.relativePath
  );
  const chunks = chunkMarkdown(params.markdown);
  return chunks
    .map((text, index) =>
      JSON.stringify({
        id: createHash("sha256")
          .update(`${sourcePath}\u001f${index}\u001f${text}`)
          .digest("hex")
          .slice(0, 24),
        text,
        source_path: sourcePath,
        source_name: params.fileName,
        segment_index: index,
        asset_role: params.assetRole,
        updated_at: params.updatedAt,
      })
    )
    .join("\n")
    .concat("\n");
}

async function readArtifactText(
  projectSlug: string,
  relPath: string
): Promise<string | null> {
  try {
    const root = await resolveProjectRoot(projectSlug);
    return await readFile(path.join(root, relPath), "utf8");
  } catch {
    return null;
  }
}

async function appendArtifactOnce(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  relPath: string;
  marker: string;
  fallbackPrefix?: string;
  addition: string;
}): Promise<string | null> {
  const existing = await readArtifactText(params.projectSlug, params.relPath);
  if (existing?.includes(params.marker)) return params.relPath;
  const prefix = existing?.trim()
    ? existing.trimEnd()
    : (params.fallbackPrefix ?? "").trimEnd();
  const next = `${prefix}${prefix ? "\n\n" : ""}${params.addition.trim()}\n`;
  await writeProjectArtifactFile(params.projectSlug, params.relPath, next, {
    visibility: params.visibility,
  });
  return params.relPath;
}

async function upsertBrandKit(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  marker: string;
  markdown: string;
  sourceReadablePath: string;
  referencePaths: string[];
}): Promise<string> {
  const relPath = "branding/BRAND_KIT.md";
  const existing = await readArtifactText(params.projectSlug, relPath);
  if (existing?.includes(params.marker)) return relPath;
  const text = compactText(params.markdown);
  const refs = params.referencePaths.length
    ? params.referencePaths.map((item) => `- ${item}`).join("\n")
    : `- ${params.sourceReadablePath}`;
  const base = existing?.trim()
    ? existing.trimEnd()
    : "# Brand kit\n\nSource-backed brand details for this vault.";
  const addition = [
    `<!-- ${params.marker} -->`,
    "## Quick brand add",
    "",
    text || "Reference image or brand asset added.",
    "",
    "Sources:",
    refs,
  ].join("\n");
  await writeProjectArtifactFile(
    params.projectSlug,
    relPath,
    `${base}\n\n${addition}\n`,
    { visibility: params.visibility }
  );
  return relPath;
}

export function shouldUseLightVaultIngest(params: {
  text: string;
  imageCount: number;
  assetRole: VaultAssetRole;
}): boolean {
  if (params.assetRole === "output_template" || params.assetRole === "scoring_criteria") {
    return false;
  }
  const textSize = Buffer.byteLength(params.text.trim(), "utf8");
  return textSize <= 24_000 && params.imageCount <= 8;
}

export async function recordLightVaultIngest(
  params: LightVaultIngestParams
): Promise<LightVaultIngestResult> {
  const assetRole = normalizeVaultAssetRole(params.assetRole ?? "general_reference");
  const now = new Date().toISOString();
  const sourceName = sourceStemFrom(params.fileName, params.relativePath);
  const extractedRel = `extracted/${sourceName}.md`;
  const segmentRel = `segments/${sourceName}.md.jsonl`;
  const sourceReadable = readablePath(
    params.projectSlug,
    params.visibility,
    params.relativePath
  );
  const referenceReadable = (params.referencePaths ?? []).map((item) =>
    readablePath(params.projectSlug, params.visibility, item)
  );
  const marker = `hermes-light-ingest:${createHash("sha256")
    .update(`${params.projectSlug}\u001f${params.relativePath}\u001f${params.markdown}`)
    .digest("hex")
    .slice(0, 24)}`;

  await writeProjectArtifactFile(params.projectSlug, extractedRel, params.markdown, {
    visibility: params.visibility,
  });

  const outputPaths = [sourceReadable, readablePath(params.projectSlug, params.visibility, extractedRel)];

  if (assetRole === "company_branding") {
    const brandRel = await upsertBrandKit({
      projectSlug: params.projectSlug,
      visibility: params.visibility,
      marker,
      markdown: params.markdown,
      sourceReadablePath: sourceReadable,
      referencePaths: referenceReadable,
    });
    outputPaths.push(readablePath(params.projectSlug, params.visibility, brandRel));
  } else {
    await writeProjectArtifactFile(
      params.projectSlug,
      segmentRel,
      segmentJsonl({
        projectSlug: params.projectSlug,
        visibility: params.visibility,
        relativePath: params.relativePath,
        fileName: params.fileName,
        markdown: params.markdown,
        assetRole,
        updatedAt: now,
      }),
      { visibility: params.visibility }
    );
    outputPaths.push(readablePath(params.projectSlug, params.visibility, segmentRel));
  }

  for (const ref of referenceReadable) outputPaths.push(ref);

  const logRel = await appendArtifactOnce({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    relPath: "LOG.md",
    marker,
    fallbackPrefix: "# Vault log",
    addition: `<!-- ${marker} -->\n- ${now}: Quick add saved for ${sourceName}.`,
  });
  if (logRel) outputPaths.push(readablePath(params.projectSlug, params.visibility, logRel));

  const indexRel = await appendArtifactOnce({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    relPath: "INDEX.md",
    marker,
    fallbackPrefix: "# Vault index",
    addition: [
      `<!-- ${marker} -->`,
      "## Quick adds",
      `- ${sourceName}: ${compactText(params.markdown).slice(0, 180) || "Reference image or short note."}`,
      `  - Source: \`${sourceReadable}\``,
      `  - Read: \`${readablePath(params.projectSlug, params.visibility, extractedRel)}\``,
    ].join("\n"),
  });
  if (indexRel) outputPaths.push(readablePath(params.projectSlug, params.visibility, indexRel));

  const brain = await recordHermesBrainIngestRun({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    fileName: params.fileName,
    relativePath: params.relativePath,
    assetRole,
    completedAt: now,
    outputPaths,
    summary: `Quick add: ${compactText(params.markdown).slice(0, 220) || sourceName}`,
    skipPeopleProfileRebuild: true,
  });

  return {
    mode: "light",
    outputPaths,
    ...brain,
  };
}
