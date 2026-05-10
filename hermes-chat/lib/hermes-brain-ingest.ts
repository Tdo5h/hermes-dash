import { createHash } from "crypto";
import path from "path";
import type { OrgWebsiteCrawlResult } from "@/lib/org-website-crawl";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import { rebuildPeopleProfilesForProject } from "@/lib/hermes-brain-profiles";
import {
  listVaultUploadedFiles,
  resolveProjectRoot,
  writeProjectArtifactFile,
} from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import type { WorkspaceVisibility } from "@/lib/project-paths";
import {
  HERMES_BRAIN_DOCUMENTS_PATH,
  HERMES_BRAIN_MANIFEST_PATH,
  HERMES_BRAIN_RETRIEVAL_ROUTER_PATH,
  HERMES_BRAIN_WEBSITE_CRAWLS_PATH,
  type HermesBrainDocumentRecord,
  type HermesBrainEvidenceKind,
  type HermesBrainEvidenceRef,
  type HermesBrainPathRef,
  type HermesBrainRetrievalLane,
  type HermesBrainRetrievalRouter,
  type HermesBrainRetrievalRouterDocument,
  type HermesBrainVisibility,
  type HermesBrainWebsiteCrawlRecord,
} from "@/lib/hermes-brain-schema";
import {
  ensureHermesBrainDirs,
  makeHermesBrainId,
  readHermesBrainJson,
  readHermesBrainJsonl,
  readHermesBrainManifest,
  writeHermesBrainJson,
  writeHermesBrainJsonl,
  writeHermesBrainManifest,
} from "@/lib/hermes-brain-store";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";

type RecordHermesBrainIngestRunParams = {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  fileName: string;
  relativePath: string;
  assetRole?: VaultAssetRole;
  runId?: string;
  completedAt?: string;
  outputPaths?: string[];
  sourceSha256?: string;
  summary?: string;
  skipPeopleProfileRebuild?: boolean;
};

type RecordHermesBrainIngestRunResult = {
  documentRecordId: string;
  sourceRunId: string;
  routerPath: string;
};

function brainVisibility(
  projectSlug: string,
  visibility: WorkspaceVisibility
): HermesBrainVisibility {
  if (projectSlug === getOrgGlobalSlug()) return "org_global";
  return visibility;
}

function readableRoot(projectSlug: string, visibility: WorkspaceVisibility): string {
  const brainVis = brainVisibility(projectSlug, visibility);
  if (brainVis === "shared" || brainVis === "org_global") {
    return `/vault-shared/${projectSlug}/`;
  }
  return `projects/${projectSlug}/`;
}

function toReadableVaultPath(
  projectSlug: string,
  visibility: WorkspaceVisibility,
  rawPath: string
): string {
  const raw = rawPath.trim().replace(/\\/g, "/");
  const root = readableRoot(projectSlug, visibility);
  const projectPrefix = `projects/${projectSlug}/`;
  if ((visibility === "shared" || projectSlug === getOrgGlobalSlug()) && raw.startsWith(projectPrefix)) {
    return `${root}${raw.slice(projectPrefix.length)}`;
  }
  if (raw.startsWith("/vault-shared/") || raw.startsWith("projects/")) return raw;
  if (raw.startsWith("/")) return raw;
  return `${root}${raw.replace(/^\/+/, "")}`;
}

function sourceNameFrom(fileName: string, relativePath: string): string {
  return (
    path.posix.basename(fileName.replace(/\\/g, "/")) ||
    path.posix.basename(relativePath.replace(/\\/g, "/")) ||
    "source"
  );
}

function stemFrom(fileName: string): string {
  const base = sourceNameFrom(fileName, fileName);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((x) => x.trim()).map((x) => x.trim()))];
}

function roleDefaultPaths(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  fileName: string;
  relativePath: string;
  assetRole: VaultAssetRole;
}): string[] {
  const root = readableRoot(params.projectSlug, params.visibility);
  const sourceName = sourceNameFrom(params.fileName, params.relativePath);
  const stem = stemFrom(sourceName);
  const extractionPaths = [
    `${root}extracted/${sourceName}.md`,
    `${root}extracted/${sourceName}.meta.json`,
    `${root}extracted/${sourceName}.extraction_map.json`,
    `${root}extracted/${sourceName}.quality.json`,
  ];
  const out = [
    `${root}LOG.md`,
    `${root}INDEX.md`,
    `${root}SCHEMA.md`,
    `${root}index/ingest_manifest.json`,
    toReadableVaultPath(params.projectSlug, params.visibility, params.relativePath),
    `${root}brain/manifest.json`,
    `${root}brain/documents.jsonl`,
    `${root}brain/retrieval/router.json`,
  ];
  if (params.assetRole === "output_template") {
    out.push(
      ...extractionPaths,
      `${root}templates/${stem}/outline.md`,
      `${root}templates/${stem}/structure.yaml`
    );
  } else if (params.assetRole === "scoring_criteria") {
    out.push(
      ...extractionPaths,
      `${root}scoring/${stem}/extracted.md`,
      `${root}scoring/${stem}/BLURB.md`,
      `${root}scoring/${stem}/meta.json`
    );
  } else if (params.assetRole === "company_branding") {
    out.push(...extractionPaths, `${root}branding/BRAND_KIT.md`);
  } else {
    out.push(...extractionPaths, `${root}segments/${sourceName}.md.jsonl`);
  }
  return uniqueStrings(out);
}

function evidenceKindForPath(p: string): HermesBrainEvidenceKind {
  if (p.includes("/sources/")) return "source";
  if (p.includes("/extracted/")) return "extracted";
  if (p.includes("/segments/")) return "segment";
  if (p.includes("/templates/")) return "template";
  if (p.includes("/scoring/")) return "scoring";
  if (p.includes("/branding/")) return "branding";
  if (p.includes("/wiki/")) return "wiki";
  if (p.includes("/brain/")) return "brain";
  return "brain";
}

function evidenceRefs(paths: string[]): HermesBrainEvidenceRef[] {
  return uniqueStrings(paths).map((p) => ({
    kind: evidenceKindForPath(p),
    path: p,
    confidence: "medium",
  }));
}

function pathRefs(paths: string[]): HermesBrainPathRef[] {
  return uniqueStrings(paths).map((p) => ({ path: p }));
}

function roleLanes(assetRole: VaultAssetRole): HermesBrainRetrievalLane[] {
  if (assetRole === "output_template") return ["router", "document", "specialist"];
  if (assetRole === "scoring_criteria") return ["router", "document", "specialist"];
  if (assetRole === "company_branding") return ["router", "specialist", "org_global"];
  if (assetRole === "org_global") return ["router", "exact", "semantic", "graph", "org_global"];
  return ["router", "exact", "semantic", "graph", "document"];
}

function roleReason(assetRole: VaultAssetRole): string {
  if (assetRole === "output_template") {
    return "Use this for document shape, section order, headings, and tone patterns.";
  }
  if (assetRole === "scoring_criteria") {
    return "Use this when drafting, reviewing, or checking work against requirements, standards, checklists, grading rules, or decision criteria.";
  }
  if (assetRole === "company_branding") {
    return "Use this for brand voice, official naming, visual direction, and shared-facing style.";
  }
  if (assetRole === "org_global") {
    return "Use this as organization-wide context for what this group is, how it talks, and what it does.";
  }
  return "Use this as vault knowledge; read all relevant paths before answering from one match.";
}

function mustReadFirstPaths(projectSlug: string, visibility: WorkspaceVisibility): HermesBrainPathRef[] {
  const root = readableRoot(projectSlug, visibility);
  return pathRefs([
    `${root}LOG.md`,
    `${root}INDEX.md`,
    `${root}brain/retrieval/router.json`,
    `${root}brain/manifest.json`,
    `${root}brain/documents.jsonl`,
    `${root}index/coreference.json`,
    `${root}SCHEMA.md`,
  ]);
}

function specialistPaths(paths: string[]): string[] {
  return paths.filter(
    (p) => p.includes("/templates/") || p.includes("/scoring/") || p.includes("/branding/")
  );
}

function evidenceUsefulPaths(paths: string[]): string[] {
  return paths.filter(
    (p) =>
      p.includes("/sources/") ||
      p.includes("/extracted/") ||
      p.includes("/segments/") ||
      p.includes("/wiki/") ||
      p.includes("/templates/") ||
      p.includes("/scoring/") ||
      p.includes("/branding/")
  );
}

function firstPath(paths: string[], includes: string): string | undefined {
  return paths.find((p) => p.includes(includes));
}

async function findSourceSha256(
  projectSlug: string,
  relativePath: string,
  fileName: string
): Promise<string | undefined> {
  try {
    const sourceName = sourceNameFrom(fileName, relativePath);
    const rows = await listVaultUploadedFiles(projectSlug);
    const hit = rows.find(
      (r) => r.name === sourceName || r.relativePath === relativePath
    );
    return hit?.sha256;
  } catch {
    return undefined;
  }
}

function shouldUseArtifactBridge(visibility: WorkspaceVisibility): boolean {
  return visibility === "private" && shouldUseChatDatabase();
}

async function ensureHermesBrainDirsForWrites(
  vaultRootAbs: string,
  visibility: WorkspaceVisibility
): Promise<void> {
  if (shouldUseArtifactBridge(visibility)) return;
  await ensureHermesBrainDirs(vaultRootAbs);
}

async function writeBrainJsonForProject<T extends object>(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultRootAbs: string;
  relPath: string;
  value: T;
}): Promise<void> {
  if (shouldUseArtifactBridge(params.visibility)) {
    await writeProjectArtifactFile(
      params.projectSlug,
      params.relPath,
      `${JSON.stringify(params.value, null, 2)}\n`,
      { visibility: params.visibility }
    );
    return;
  }
  await writeHermesBrainJson(params.vaultRootAbs, params.relPath, params.value);
}

async function writeBrainJsonlForProject<T extends object>(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultRootAbs: string;
  relPath: string;
  records: T[];
}): Promise<void> {
  if (shouldUseArtifactBridge(params.visibility)) {
    const body = params.records.map((r) => JSON.stringify(r)).join("\n");
    await writeProjectArtifactFile(
      params.projectSlug,
      params.relPath,
      body ? `${body}\n` : "",
      { visibility: params.visibility }
    );
    return;
  }
  await writeHermesBrainJsonl(params.vaultRootAbs, params.relPath, params.records);
}

async function updateRouter(params: {
  vaultRootAbs: string;
  projectSlug: string;
  visibility: WorkspaceVisibility;
  doc: HermesBrainDocumentRecord;
  fileName: string;
  outputPaths: string[];
}): Promise<void> {
  const existing = await readHermesBrainJson<HermesBrainRetrievalRouter>(
    params.vaultRootAbs,
    HERMES_BRAIN_RETRIEVAL_ROUTER_PATH
  );
  const specialists = specialistPaths(params.outputPaths);
  const evidence = evidenceUsefulPaths(params.outputPaths);
  const primary = uniqueStrings([
    ...mustReadFirstPaths(params.projectSlug, params.visibility).map((p) => p.path),
    ...evidence,
  ]);
  const entry: HermesBrainRetrievalRouterDocument = {
    documentRecordId: params.doc.id,
    sourcePath: params.doc.sourcePath,
    sourceName: sourceNameFrom(params.fileName, params.doc.sourcePath),
    assetRole: params.doc.assetRole,
    updatedAt: params.doc.updatedAt,
    lanes: roleLanes(params.doc.assetRole),
    primaryPaths: pathRefs(primary),
    specialistPaths: pathRefs(specialists),
    evidencePaths: pathRefs(evidence),
    reason: roleReason(params.doc.assetRole),
  };
  const documents = [
    entry,
    ...(existing?.documents ?? []).filter(
      (d) => d.documentRecordId !== entry.documentRecordId
    ),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 300);
  const byAssetRole: Partial<Record<VaultAssetRole, string[]>> = {};
  for (const d of documents) {
    byAssetRole[d.assetRole] = [...(byAssetRole[d.assetRole] ?? []), d.documentRecordId];
  }
  const router: HermesBrainRetrievalRouter = {
    schemaVersion: 1,
    vaultSlug: params.projectSlug,
    visibility: brainVisibility(params.projectSlug, params.visibility),
    generatedAt: new Date().toISOString(),
    mustReadFirst: mustReadFirstPaths(params.projectSlug, params.visibility),
    documents,
    byAssetRole,
    notes: [
      "Read this router before answering or creating from vault knowledge.",
      "Do not stop at the first matching file. Use the relevant document entry, then merge evidence paths, specialist paths, wiki notes, and coreference mentions.",
      "For Create, combine org-global brand/company context with the active project vault facts, templates, review rules, and source-backed evidence.",
    ],
  };
  await writeBrainJsonForProject({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs: params.vaultRootAbs,
    relPath: HERMES_BRAIN_RETRIEVAL_ROUTER_PATH,
    value: router,
  });
}

export async function recordHermesBrainIngestRun(
  params: RecordHermesBrainIngestRunParams
): Promise<RecordHermesBrainIngestRunResult> {
  const assetRole = normalizeVaultAssetRole(params.assetRole ?? "general_reference");
  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  await ensureHermesBrainDirsForWrites(vaultRootAbs, params.visibility);

  const now = params.completedAt ?? new Date().toISOString();
  const sourcePath = toReadableVaultPath(
    params.projectSlug,
    params.visibility,
    params.relativePath
  );
  const outputPaths = uniqueStrings(
    (params.outputPaths?.length
      ? params.outputPaths
      : roleDefaultPaths({
          projectSlug: params.projectSlug,
          visibility: params.visibility,
          fileName: params.fileName,
          relativePath: params.relativePath,
          assetRole,
        })).map((p) => toReadableVaultPath(params.projectSlug, params.visibility, p))
  );
  const sourceRunId =
    params.runId ??
    makeHermesBrainId("run", [params.projectSlug, sourcePath, assetRole, now]);
  const documentRecordId = makeHermesBrainId("doc", [
    params.projectSlug,
    sourcePath,
    assetRole,
  ]);

  const existingDocs = await readHermesBrainJsonl<HermesBrainDocumentRecord>(
    vaultRootAbs,
    HERMES_BRAIN_DOCUMENTS_PATH
  );
  const existingDoc = existingDocs.find((d) => d.id === documentRecordId);
  const sourceSha256 =
    params.sourceSha256 ??
    (await findSourceSha256(params.projectSlug, params.relativePath, params.fileName));

  const extractedPath = firstPath(outputPaths, "/extracted/");
  const segmentPath = firstPath(outputPaths, "/segments/");
  const templatePath = firstPath(outputPaths, "/templates/");
  const scoringPath = firstPath(outputPaths, "/scoring/");
  const brandingPath = firstPath(outputPaths, "/branding/");

  const doc: HermesBrainDocumentRecord = {
    id: documentRecordId,
    kind: "document",
    vaultSlug: params.projectSlug,
    visibility: brainVisibility(params.projectSlug, params.visibility),
    createdAt: existingDoc?.createdAt ?? now,
    updatedAt: now,
    sourceRunId,
    sourcePath,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    assetRole,
    title: sourceNameFrom(params.fileName, params.relativePath),
    summary:
      params.summary ??
      `Ingested ${sourceNameFrom(params.fileName, params.relativePath)} as ${assetRole}.`,
    ...(extractedPath ? { extractedPath } : {}),
    ...(segmentPath ? { segmentPath } : {}),
    ...(templatePath ? { templatePath } : {}),
    ...(scoringPath ? { scoringPath } : {}),
    ...(brandingPath ? { brandingPath } : {}),
    entityIds: existingDoc?.entityIds ?? [],
    factIds: existingDoc?.factIds ?? [],
    relationshipIds: existingDoc?.relationshipIds ?? [],
    evidence: evidenceRefs(outputPaths),
  };

  const nextDocs = existingDocs.filter((d) => d.id !== doc.id);
  nextDocs.push(doc);
  await writeBrainJsonlForProject({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs,
    relPath: HERMES_BRAIN_DOCUMENTS_PATH,
    records: nextDocs,
  });

  const manifest = (await readHermesBrainManifest(vaultRootAbs)) ?? {
    schemaVersion: 1 as const,
    vaultSlug: params.projectSlug,
    visibility: brainVisibility(params.projectSlug, params.visibility),
    generatedAt: now,
    sourceRuns: [],
  };
  manifest.generatedAt = now;
  manifest.visibility = brainVisibility(params.projectSlug, params.visibility);
  const sourceRun = {
    runId: sourceRunId,
    sourcePath,
    assetRole,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    documentRecordId,
    outputPaths,
    completedAt: now,
  };
  const existingRunIdx = manifest.sourceRuns.findIndex((r) => r.runId === sourceRunId);
  if (existingRunIdx >= 0) manifest.sourceRuns[existingRunIdx] = sourceRun;
  else manifest.sourceRuns.push(sourceRun);
  manifest.sourceRuns = manifest.sourceRuns
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 500);
  if (shouldUseArtifactBridge(params.visibility)) {
    await writeBrainJsonForProject({
      projectSlug: params.projectSlug,
      visibility: params.visibility,
      vaultRootAbs,
      relPath: HERMES_BRAIN_MANIFEST_PATH,
      value: manifest,
    });
  } else {
    await writeHermesBrainManifest(vaultRootAbs, manifest);
  }

  await updateRouter({
    vaultRootAbs,
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    doc,
    fileName: params.fileName,
    outputPaths,
  });

  if (!params.skipPeopleProfileRebuild) {
    await rebuildPeopleProfilesForProject({
      projectSlug: params.projectSlug,
      visibility: params.visibility,
    }).catch(() => {
      // Profile registry is a secondary index. Ingest records should still land
      // even if the wiki entity pass is temporarily incomplete.
    });
  }

  return {
    documentRecordId,
    sourceRunId,
    routerPath: toReadableVaultPath(
      params.projectSlug,
      params.visibility,
      HERMES_BRAIN_RETRIEVAL_ROUTER_PATH
    ),
  };
}

export async function recordHermesBrainWebsiteCrawl(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  crawl: OrgWebsiteCrawlResult;
  companyName?: string | null;
  fileName: string;
  relativePath: string;
  markdown: string;
}): Promise<RecordHermesBrainIngestRunResult> {
  const sourceSha256 = createHash("sha256").update(params.markdown).digest("hex");
  const root = readableRoot(params.projectSlug, params.visibility);
  const ingest = await recordHermesBrainIngestRun({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    fileName: params.fileName,
    relativePath: params.relativePath,
    assetRole: "org_global",
    runId: makeHermesBrainId("run", [
      params.projectSlug,
      params.crawl.startUrl,
      "company_website_crawl",
      params.crawl.crawledAt,
    ]),
    completedAt: params.crawl.crawledAt,
    sourceSha256,
    outputPaths: [
      toReadableVaultPath(params.projectSlug, params.visibility, params.relativePath),
      `${root}${HERMES_BRAIN_WEBSITE_CRAWLS_PATH}`,
      `${root}${HERMES_BRAIN_DOCUMENTS_PATH}`,
      `${root}${HERMES_BRAIN_RETRIEVAL_ROUTER_PATH}`,
    ],
    summary: `Captured public website pages for ${
      params.companyName || params.crawl.origin
    } as organization-wide company context.`,
  });

  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  const websiteRecord: HermesBrainWebsiteCrawlRecord = {
    id: makeHermesBrainId("site", [params.projectSlug, params.crawl.startUrl]),
    kind: "company_website_crawl",
    vaultSlug: params.projectSlug,
    visibility: brainVisibility(params.projectSlug, params.visibility),
    createdAt: params.crawl.crawledAt,
    updatedAt: new Date().toISOString(),
    sourceRunId: ingest.sourceRunId,
    companyName: params.companyName ?? null,
    startUrl: params.crawl.startUrl,
    origin: params.crawl.origin,
    sourcePath: toReadableVaultPath(params.projectSlug, params.visibility, params.relativePath),
    pagesCaptured: params.crawl.pages.length,
    internalLinks: params.crawl.discoveredInternalLinks.slice(0, 300),
    externalLinks: params.crawl.discoveredExternalLinks.slice(0, 300),
    documentRecordId: ingest.documentRecordId,
    evidence: [
      {
        kind: "source",
        path: toReadableVaultPath(params.projectSlug, params.visibility, params.relativePath),
        confidence: "high",
      },
    ],
  };
  const existingWebsiteRecords = await readHermesBrainJsonl<HermesBrainWebsiteCrawlRecord>(
    vaultRootAbs,
    HERMES_BRAIN_WEBSITE_CRAWLS_PATH
  );
  await writeBrainJsonlForProject({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs,
    relPath: HERMES_BRAIN_WEBSITE_CRAWLS_PATH,
    records: [
      ...existingWebsiteRecords.filter((record) => record.id !== websiteRecord.id),
      websiteRecord,
    ],
  });
  return ingest;
}
