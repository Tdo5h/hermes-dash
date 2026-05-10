import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { drainHermesCompletionStreamBody } from "@/lib/hermes-drain-completion-stream";
import type { VaultAssetRole } from "@/lib/ingest-message";
import type { ProjectRecord } from "@/lib/project-service";
import { resolveProjectRoot, writeProjectArtifactFile } from "@/lib/project-service";
import {
  updateSharedIngestChallengeTask,
  updateSharedIngestMergeTask,
  updateSharedIngestReaderTask,
  type SharedIngestJob,
} from "@/lib/shared-ingest-job-store";

type ReaderDefinition = {
  id: string;
  label: string;
  description: string;
  instruction: string;
};

type ContextItem = {
  relPath: string;
  content: string;
  truncated: boolean;
};

type ReaderRunResult = {
  task: ReaderDefinition;
  outputPath: string;
  parsed: unknown | null;
  rawText: string;
  score?: number;
};

export type IngestSwarmStateAdapter = {
  updateReaderTask: typeof updateSharedIngestReaderTask;
  updateChallengeTask: typeof updateSharedIngestChallengeTask;
  updateMergeTask: typeof updateSharedIngestMergeTask;
};

const defaultSwarmState: IngestSwarmStateAdapter = {
  updateReaderTask: updateSharedIngestReaderTask,
  updateChallengeTask: updateSharedIngestChallengeTask,
  updateMergeTask: updateSharedIngestMergeTask,
};

type GatewayConfig = {
  base: string;
  token: string;
  modelId: string;
  signal: AbortSignal;
  readerEffort?: SharedIngestReasoningEffort;
  reviewEffort?: SharedIngestReasoningEffort;
  mergeEffort?: SharedIngestReasoningEffort;
  serviceTier?: SharedIngestServiceTier;
};

export type SharedIngestSwarmResult = {
  outputPaths: string[];
  summary?: string;
};

export type SharedIngestReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type SharedIngestServiceTier = "normal" | "fast";
export type SharedIngestPassKind = "base" | "reader" | "review" | "merge";
export type SharedIngestRequestTuningConfig = {
  readerEffort?: SharedIngestReasoningEffort;
  reviewEffort?: SharedIngestReasoningEffort;
  mergeEffort?: SharedIngestReasoningEffort;
  serviceTier?: SharedIngestServiceTier;
};

const MAX_CONTEXT_CHARS = 92_000;
const MAX_FILE_CHARS = 44_000;
const MAX_READER_OUTPUT_CHARS = 80_000;
const DEFAULT_CONCURRENCY = 4;
const SOURCE_SCAN_CHARS = 24_000;

function effortForPass(
  config: SharedIngestRequestTuningConfig,
  passKind: SharedIngestPassKind
): SharedIngestReasoningEffort | undefined {
  if (passKind === "reader") {
    return config.readerEffort ?? config.reviewEffort;
  }
  if (passKind === "merge") {
    return config.mergeEffort ?? config.reviewEffort;
  }
  return config.reviewEffort ?? config.mergeEffort ?? config.readerEffort;
}

export function sharedIngestRequestTuning(
  config: SharedIngestRequestTuningConfig,
  passKind: SharedIngestPassKind
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const effort = effortForPass(config, passKind);
  if (effort) {
    out.reasoning_effort = effort;
    out.reasoning = { effort };
  }
  if (config.serviceTier) {
    out.service_tier = config.serviceTier;
  }
  return out;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function basenameFrom(fileName: string, relativePath: string): string {
  return (
    path.posix.basename(fileName.replace(/\\/g, "/")) ||
    path.posix.basename(relativePath.replace(/\\/g, "/")) ||
    "source"
  );
}

function stemFrom(fileName: string, relativePath: string): string {
  const base = basenameFrom(fileName, relativePath);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

function safePathPart(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return cleaned || createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function readableVaultPath(project: ProjectRecord, relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  if (project.visibility === "shared") {
    return `/vault-shared/${project.slug}/${clean}`;
  }
  return `projects/${project.slug}/${clean}`;
}

function evidencePathExample(project: ProjectRecord, relPath = "extracted/source.md"): string {
  return readableVaultPath(project, relPath);
}

function extractedRelPath(fileName: string, relativePath: string): string {
  return `extracted/${basenameFrom(fileName, relativePath)}.md`;
}

function sourceRelPath(fileName: string, relativePath: string): string {
  return `sources/${basenameFrom(fileName, relativePath)}`;
}

function roleReaderDefinitions(role: VaultAssetRole): ReaderDefinition[] {
  if (role === "output_template") {
    return [
      {
        id: "text-reader",
        label: "Text",
        description: "Reads the extracted text and section names.",
        instruction:
          "Capture section order, repeated headings, intro/body/close patterns, and any text blocks that define the template shape.",
      },
      {
        id: "structure-reader",
        label: "Structure",
        description: "Finds reusable layout and document flow.",
        instruction:
          "Extract the reusable document structure: page/section order, hierarchy, table/image placement, callouts, and what should be copied versus ignored.",
      },
      {
        id: "style-reader",
        label: "Style",
        description: "Captures tone, typography clues, and visual rhythm.",
        instruction:
          "Describe writing voice, typography clues, spacing rhythm, headings, emphasis, and design choices that Create should reuse without copying private facts.",
      },
      {
        id: "retrieval-reader",
        label: "Search",
        description: "Builds search hints for later Create work.",
        instruction:
          "Create retrieval hints and Create instructions so Hermes can find this template when a user asks for a similar output.",
      },
    ];
  }

  if (role === "scoring_criteria") {
    return [
      {
        id: "text-reader",
        label: "Text",
        description: "Reads the extracted rules text.",
        instruction:
          "Capture the source sections and the exact language that defines rules, requirements, standards, thresholds, or checks.",
      },
      {
        id: "rules-reader",
        label: "Rules",
        description: "Turns guidance into clear checks.",
        instruction:
          "Extract every actionable review rule as a checkable item. Preserve condition, threshold, priority, and evidence path.",
      },
      {
        id: "gap-reader",
        label: "Gaps",
        description: "Finds missing inputs and ambiguity.",
        instruction:
          "Identify ambiguous requirements, missing definitions, conflicts, and questions Hermes should ask before scoring or reviewing work.",
      },
      {
        id: "retrieval-reader",
        label: "Search",
        description: "Builds retrieval routes for review.",
        instruction:
          "Create search aliases, query classes, and must-read paths so Hermes does not answer review questions from the first matching snippet.",
      },
    ];
  }

  if (role === "company_branding" || role === "org_global") {
    return [
      {
        id: "text-reader",
        label: "Text",
        description: "Reads the source for official language.",
        instruction:
          "Extract canonical names, services, products, locations, claims, differentiators, and source-backed wording.",
      },
      {
        id: "company-reader",
        label: "Org",
        description: "Builds the organization profile.",
        instruction:
          "Build an organization profile: what it does, who it serves, language it uses, contact surfaces, locations, and evidence paths.",
      },
      {
        id: "people-reader",
        label: "People",
        description: "Finds people and contact profiles.",
        instruction:
          "Extract every person and role. Separate internal people, external people, partners, suppliers, and unknowns when evidence supports it.",
      },
      {
        id: "brand-reader",
        label: "Brand",
        description: "Captures brand feel and visual cues.",
        instruction:
          "Extract brand voice, colors, imagery, logo/asset references, proof points, and image-generation grounding notes.",
      },
      {
        id: "retrieval-reader",
        label: "Search",
        description: "Builds organization-wide retrieval routes.",
        instruction:
          "Create search aliases, related topics, and must-read evidence paths for later chat answers and Create outputs.",
      },
    ];
  }

  return [
    {
      id: "text-reader",
      label: "Text",
      description: "Reads the extracted document and source map.",
      instruction:
        "Extract a heading map, clean section summaries, important statements, direct quotes, and evidence paths. Use the source scan to sample across the whole document, not only the first excerpt.",
    },
    {
      id: "detail-reader",
      label: "Details",
      description: "Finds reusable facts and decisions.",
      instruction:
        "Extract people, organizations, dates, amounts, decisions, requirements, services, products, and claims as reusable source-backed facts. Prefer direct extracted/source evidence over already-curated wiki notes.",
    },
    {
      id: "table-media-reader",
      label: "Tables",
      description: "Preserves structured tables and media context.",
      instruction:
        "Inspect tables, lists, images, captions, OCR sidecars, and media references. Build a compact table/media inventory with row/column meaning, representative rows, file names, and uncertainty instead of only summarizing that tables exist.",
    },
    {
      id: "relationship-reader",
      label: "Links",
      description: "Connects people, companies, topics, and files.",
      instruction:
        "Map relationships between entities, topics, dates, projects, source documents, and existing wiki/coreference notes.",
    },
    {
      id: "retrieval-reader",
      label: "Search",
      description: "Builds search routes so Hermes reads all relevant evidence.",
      instruction:
        "Create retrieval hints, aliases, query classes, must-read paths, and coverage rules so Hermes does not stop at the first matching snippet.",
    },
  ];
}

export function getSharedIngestSwarmReaderDefinitions(
  role: VaultAssetRole
): ReaderDefinition[] {
  return roleReaderDefinitions(role);
}

function isLikelyTextSource(fileName: string): boolean {
  return /\.(md|markdown|txt|csv|tsv|json|jsonl|yaml|yml|html?|xml|log)$/i.test(fileName);
}

async function readRelFile(
  vaultRootAbs: string,
  relPath: string,
  maxChars: number
): Promise<ContextItem | null> {
  const safeRel = relPath.replace(/^\/+/, "");
  const root = path.resolve(vaultRootAbs);
  const abs = path.resolve(root, safeRel);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  try {
    const raw = await readFile(abs, "utf8");
    const truncated = raw.length > maxChars;
    return {
      relPath: safeRel,
      content: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
    };
  } catch {
    return null;
  }
}

async function readFullRelText(
  vaultRootAbs: string,
  relPath: string
): Promise<string | null> {
  const safeRel = relPath.replace(/^\/+/, "");
  const root = path.resolve(vaultRootAbs);
  const abs = path.resolve(root, safeRel);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

function stripInlineDataUrisForPrompt(text: string): string {
  return text.replace(
    /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n\t ]{512,}/g,
    "[embedded image data omitted; see extraction_map media/OCR layers]"
  );
}

function clipSection(title: string, lines: string[], maxChars: number): string {
  const body = lines.join("\n").trim();
  if (!body) return "";
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n...` : body;
  return `## ${title}\n${clipped}`;
}

function buildMarkdownSourceScan(relPath: string, raw: string): ContextItem | null {
  const text = stripInlineDataUrisForPrompt(raw);
  const lines = text.split(/\r?\n/);
  const headings: string[] = [];
  const mediaRefs: string[] = [];
  const tableBlocks: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (/^#{1,6}\s+\S/.test(trimmed) && headings.length < 220) {
      headings.push(trimmed);
    }
    if (
      mediaRefs.length < 160 &&
      (/!\[[^\]]*\]\([^)]+\)/.test(trimmed) ||
        /extracted\/.*_(?:docx|pptx)_media\//i.test(trimmed) ||
        /\.ocr\.txt\b/i.test(trimmed))
    ) {
      mediaRefs.push(trimmed.slice(0, 500));
    }
    if (!trimmed.startsWith("|")) continue;
    const block: string[] = [];
    let j = i;
    while (j < lines.length && (lines[j] ?? "").trim().startsWith("|")) {
      if (block.length < 10) block.push((lines[j] ?? "").trim());
      j += 1;
    }
    if (block.length >= 2 && tableBlocks.length < 42) {
      tableBlocks.push(block.join("\n"));
    }
    i = Math.max(i, j - 1);
  }

  const sections = [
    `Derived scan from ${relPath}. Use this to avoid first-page bias; open the listed paths for exact evidence.`,
    clipSection("Heading Map", headings, 8_000),
    clipSection("Table Snippets Across Document", tableBlocks, 10_000),
    clipSection("Media And OCR References", mediaRefs, 4_000),
  ].filter(Boolean);
  const content = sections.join("\n\n").slice(0, SOURCE_SCAN_CHARS);
  if (content.trim().length < 120) return null;
  return {
    relPath: `${relPath}#source-scan`,
    content,
    truncated: content.length >= SOURCE_SCAN_CHARS,
  };
}

async function loadSwarmContext(params: {
  vaultRootAbs: string;
  job: SharedIngestJob;
  role: VaultAssetRole;
}): Promise<ContextItem[]> {
  const base = basenameFrom(params.job.fileName, params.job.relativePath);
  const stem = stemFrom(params.job.fileName, params.job.relativePath);
  const candidates = [
    "SCHEMA.md",
    "INDEX.md",
    "LOG.md",
    "brain/manifest.json",
    "brain/documents.jsonl",
    "brain/retrieval/router.json",
    "index/ingest_manifest.json",
    "index/coreference.json",
    extractedRelPath(params.job.fileName, params.job.relativePath),
    `extracted/${base}.meta.json`,
    `extracted/${base}.extraction_map.json`,
    `extracted/${base}.quality.json`,
    `segments/${base}.md.jsonl`,
    `templates/${stem}/outline.md`,
    `templates/${stem}/structure.yaml`,
    `scoring/${stem}/extracted.md`,
    `scoring/${stem}/BLURB.md`,
    `scoring/${stem}/meta.json`,
    "branding/BRAND_KIT.md",
    ...(isLikelyTextSource(base) ? [sourceRelPath(params.job.fileName, params.job.relativePath)] : []),
  ];

  const out: ContextItem[] = [];
  let remaining = MAX_CONTEXT_CHARS;
  const extractedPath = extractedRelPath(params.job.fileName, params.job.relativePath);
  const extractedRaw = await readFullRelText(params.vaultRootAbs, extractedPath);
  if (extractedRaw) {
    const scan = buildMarkdownSourceScan(extractedPath, extractedRaw);
    if (scan) {
      out.push(scan);
      remaining -= scan.content.length;
    }
  }
  for (const rel of [...new Set(candidates)]) {
    if (remaining <= 0) break;
    const item = await readRelFile(
      params.vaultRootAbs,
      rel,
      Math.min(MAX_FILE_CHARS, remaining)
    );
    if (!item) continue;
    out.push(item);
    remaining -= item.content.length;
  }
  return out;
}

function contextToPrompt(project: ProjectRecord, items: ContextItem[]): string {
  if (items.length === 0) {
    return [
      "No extracted text was found in the vault yet.",
      "Use the source metadata and report missing coverage clearly.",
    ].join("\n");
  }
  return items
    .map((item) =>
      [
        `--- ${readableVaultPath(project, item.relPath)}${
          item.truncated ? " (truncated)" : ""
        } ---`,
        item.content,
      ].join("\n")
    )
    .join("\n\n");
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter((s) => s.includes("{") && s.includes("}"));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function scoreFromParsed(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const rec = parsed as Record<string, unknown>;
  for (const key of ["coverageScore", "score", "confidenceScore", "qualityScore"]) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) return clampPercent(v);
  }
  return undefined;
}

function retryRequestsFromParsed(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const rec = parsed as Record<string, unknown>;
  const raw = rec.retryRequests ?? rec.retryReaderIds ?? rec.readersToRetry;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object") {
        const id = (item as Record<string, unknown>).readerId;
        return typeof id === "string" ? [id] : [];
      }
      return [];
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

async function writeJsonFile(
  project: ProjectRecord,
  vaultRootAbs: string,
  relPath: string,
  value: unknown
): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (project.visibility === "private") {
    await writeProjectArtifactFile(project.slug, relPath, body, {
      visibility: project.visibility,
    });
    return;
  }
  const abs = path.join(vaultRootAbs, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

async function writeMarkdownFile(
  project: ProjectRecord,
  vaultRootAbs: string,
  relPath: string,
  body: string
): Promise<void> {
  if (project.visibility === "private") {
    await writeProjectArtifactFile(project.slug, relPath, body, {
      visibility: project.visibility,
    });
    return;
  }
  const abs = path.join(vaultRootAbs, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

async function runGatewayPass(params: {
  gateway: GatewayConfig;
  passKind: SharedIngestPassKind;
  system: string;
  user: string;
  onActivityHeadline?: (headline: string) => void;
}): Promise<string> {
  const res = await fetch(`${params.gateway.base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.gateway.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.gateway.modelId,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      stream: true,
      stream_tool_progress: true,
      stream_options: { include_usage: true },
      ...sharedIngestRequestTuning(params.gateway, params.passKind),
    }),
    signal: params.gateway.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Swarm pass failed (${res.status}). ${errText.slice(0, 220)}`
    );
  }

  const drained = await drainHermesCompletionStreamBody(res.body, {
    onActivityHeadline: params.onActivityHeadline,
  });
  return drained.text.trim();
}

function readerSystemPrompt(task: ReaderDefinition, project: ProjectRecord): string {
  const evidencePath = evidencePathExample(project);
  const mediaPath = evidencePathExample(project, "extracted/source_media/image.png");
  const ocrPath = evidencePathExample(project, "extracted/source_media/image.ocr.txt");
  return [
    `You are ${task.label} Reader, a focused Hermes ingest sub-agent.`,
    "You work inside a larger reader swarm. Do one narrow job very well.",
    "Use only the provided context. Do not invent details. Do not stop at one match if the context contains related evidence.",
    "When an extraction quality report is present, use it to decide whether text, OCR, tables, images, or parser warnings need extra caution.",
    "Return JSON only. No markdown fences.",
    "Required JSON shape:",
    JSON.stringify(
      {
        readerId: task.id,
        coverageScore: 0,
        confidence: "low|medium|high",
        summary: "plain-language summary of what you found",
        importantFindings: [
          {
            title: "finding",
            detail: "source-backed detail",
            evidencePath,
            quote: "short quote when useful",
          },
        ],
        entities: [
          {
            name: "entity",
            type: "person|company|project|requirement|asset|concept|unknown",
            relationship: "how it connects",
            evidencePath,
          },
        ],
        facts: [
          {
            statement: "source-backed fact",
            evidencePath,
            confidence: "low|medium|high",
          },
        ],
        headingMap: ["major heading path or section anchor"],
        tableInventory: [
          {
            title: "table or list name",
            rowsPreserved: "representative row/column detail",
            evidencePath,
          },
        ],
        mediaInventory: [
          {
            assetPath: mediaPath,
            ocrPath,
            use: "what this asset appears to contain",
            confidence: "low|medium|high",
          },
        ],
        missingOrUnclear: ["anything the brain should not assume"],
        createUse: ["how Create can reuse this"],
        retrievalHints: ["aliases, query routes, must-read paths"],
      },
      null,
      2
    ),
  ].join("\n");
}

function readerUserPrompt(params: {
  task: ReaderDefinition;
  project: ProjectRecord;
  job: SharedIngestJob;
  role: VaultAssetRole;
  context: string;
  challengeFeedback?: string;
}): string {
  return [
    `Vault: ${params.project.name} (${params.project.slug})`,
    `Source: ${params.job.fileName}`,
    `Asset role: ${params.role}`,
    `Your task: ${params.task.instruction}`,
    params.challengeFeedback
      ? `Challenge feedback for this retry:\n${params.challengeFeedback}`
      : "",
    "Context:",
    params.context,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runReaderTask(params: {
  state: IngestSwarmStateAdapter;
  gateway: GatewayConfig;
  project: ProjectRecord;
  job: SharedIngestJob;
  role: VaultAssetRole;
  task: ReaderDefinition;
  vaultRootAbs: string;
  swarmRelDir: string;
  context: string;
  runId: string;
  retryCount?: number;
  challengeFeedback?: string;
}): Promise<ReaderRunResult | null> {
  const retryCount = params.retryCount ?? 0;
  await params.state.updateReaderTask(
    params.job.jobId,
    params.task.id,
    {
      status: "running",
      progress: retryCount > 0 ? 18 : 10,
      detail: retryCount > 0 ? "Re-reading after challenge" : params.task.description,
      retryCount,
    },
    { runId: params.runId }
  );

  try {
    const text = await runGatewayPass({
      gateway: params.gateway,
      passKind: "reader",
      system: readerSystemPrompt(params.task, params.project),
      user: readerUserPrompt({
        task: params.task,
        project: params.project,
        job: params.job,
        role: params.role,
        context: params.context,
        challengeFeedback: params.challengeFeedback,
      }),
      onActivityHeadline: (headline) => {
        void params.state.updateReaderTask(
          params.job.jobId,
          params.task.id,
          {
            status: "running",
            progress: 65,
            detail: headline,
            retryCount,
          },
          { runId: params.runId }
        );
      },
    });
    const parsed = extractJsonObject(text);
    const clipped = text.slice(0, MAX_READER_OUTPUT_CHARS);
    const score = scoreFromParsed(parsed);
    const outputPath = `${params.swarmRelDir}/${params.task.id}${
      retryCount > 0 ? `.retry-${retryCount}` : ""
    }.json`;
    await writeJsonFile(params.project, params.vaultRootAbs, outputPath, {
      schemaVersion: 1,
      runId: params.runId,
      readerId: params.task.id,
      label: params.task.label,
      role: params.role,
      sourceName: params.job.fileName,
      retryCount,
      generatedAt: new Date().toISOString(),
      parsed,
      rawText: parsed ? undefined : clipped,
    });
    await params.state.updateReaderTask(
      params.job.jobId,
      params.task.id,
      {
        status: "done",
        progress: 100,
        detail: score !== undefined ? `Score ${score}%` : "Reader complete",
        outputPath: readableVaultPath(params.project, outputPath),
        ...(score !== undefined ? { score } : {}),
        retryCount,
      },
      { runId: params.runId }
    );
    return {
      task: params.task,
      outputPath,
      parsed,
      rawText: clipped,
      ...(score !== undefined ? { score } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await params.state.updateReaderTask(
      params.job.jobId,
      params.task.id,
      {
        status: "error",
        progress: 0,
        detail: "Reader stopped",
        errorMessage: msg.slice(0, 300),
        retryCount,
      },
      { runId: params.runId }
    );
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= items.length) return;
        out[index] = await fn(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

function readerResultsForPrompt(
  project: ProjectRecord,
  results: ReaderRunResult[]
): string {
  return results
    .map((result) =>
      [
        `--- ${result.task.label} (${result.task.id}) ---`,
        `Output: ${readableVaultPath(project, result.outputPath)}`,
        result.parsed
          ? JSON.stringify(result.parsed, null, 2)
          : result.rawText.slice(0, 20_000),
      ].join("\n")
    )
    .join("\n\n");
}

async function runChallenge(params: {
  state: IngestSwarmStateAdapter;
  gateway: GatewayConfig;
  project: ProjectRecord;
  job: SharedIngestJob;
  role: VaultAssetRole;
  results: ReaderRunResult[];
  vaultRootAbs: string;
  swarmRelDir: string;
  runId: string;
  round: number;
}): Promise<{ outputPath: string; parsed: unknown | null; retryRequests: string[] }> {
  await params.state.updateChallengeTask(
    params.job.jobId,
    {
      status: "running",
      progress: 20,
      detail: params.round > 1 ? "Re-checking challenged readers" : "Challenging reader coverage",
    },
    { runId: params.runId }
  );

  const system = [
    "You are Hermes Challenge, the evaluator for an ingest reader swarm.",
    "Attack weak reasoning. Look for missing evidence, lazy first-snippet answers, unsupported claims, duplicate entities, and incomplete tables.",
    "Use extraction quality reports and extraction maps when present. If the parser says OCR, fallback, low quality, or missing layout parser, challenge readers to preserve that uncertainty.",
    "Request a retry only when a reader output is unusable, invalid, clearly below acceptable coverage, or missing a mandatory evidence class that is available in the provided context.",
    "If a gap is caused by intentionally truncated context, unavailable image pixels, or OCR uncertainty, put it in missingEvidence and mergeInstructions instead of spending another reader pass.",
    "Return JSON only. No markdown fences.",
    "Required JSON shape:",
    JSON.stringify(
      {
        score: 0,
        verdict: "pass|retry|fail",
        missingEvidence: ["what is missing"],
        conflicts: ["conflicts or unsupported claims"],
        retryRequests: [
          {
            readerId: "reader id to retry",
            reason: "specific thing to re-read",
          },
        ],
        mergeInstructions: ["what the merge pass must preserve"],
      },
      null,
      2
    ),
  ].join("\n");
  const user = [
    `Vault: ${params.project.name} (${params.project.slug})`,
    `Source: ${params.job.fileName}`,
    `Asset role: ${params.role}`,
    "Reader outputs:",
    readerResultsForPrompt(params.project, params.results),
  ].join("\n\n");
  const text = await runGatewayPass({
    gateway: params.gateway,
    passKind: "review",
    system,
    user,
    onActivityHeadline: (headline) => {
      void params.state.updateChallengeTask(
        params.job.jobId,
        {
          status: "running",
          progress: 72,
          detail: headline,
        },
        { runId: params.runId }
      );
    },
  });
  const parsed = extractJsonObject(text);
  const score = scoreFromParsed(parsed);
  const retryRequests = retryRequestsFromParsed(parsed);
  const outputPath = `${params.swarmRelDir}/challenge${
    params.round > 1 ? `.round-${params.round}` : ""
  }.json`;
  await writeJsonFile(params.project, params.vaultRootAbs, outputPath, {
    schemaVersion: 1,
    runId: params.runId,
    round: params.round,
    generatedAt: new Date().toISOString(),
    parsed,
    rawText: parsed ? undefined : text.slice(0, MAX_READER_OUTPUT_CHARS),
  });
  await params.state.updateChallengeTask(
    params.job.jobId,
    {
      status: "done",
      progress: 100,
      detail:
        retryRequests.length > 0
          ? `Requested ${retryRequests.length} retry${retryRequests.length === 1 ? "" : "ies"}`
          : "Coverage checked",
      outputPath: readableVaultPath(params.project, outputPath),
      retryRequests,
      ...(score !== undefined ? { score } : {}),
    },
    { runId: params.runId }
  );
  return { outputPath, parsed, retryRequests };
}

async function runMerge(params: {
  state: IngestSwarmStateAdapter;
  gateway: GatewayConfig;
  project: ProjectRecord;
  job: SharedIngestJob;
  role: VaultAssetRole;
  results: ReaderRunResult[];
  challenge: unknown | null;
  vaultRootAbs: string;
  swarmRelDir: string;
  latestRelPath: string;
  runId: string;
}): Promise<{ outputPath: string; latestPath: string; summary?: string }> {
  await params.state.updateMergeTask(
    params.job.jobId,
    {
      status: "running",
      progress: 20,
      detail: "Combining reader evidence",
    },
    { runId: params.runId }
  );
  const evidencePath = evidencePathExample(params.project);
  const system = [
    "You are Hermes Merge, the final brain pack builder for one ingest source.",
    "Merge reader findings into one source-backed pack for chat retrieval and Create. Keep useful uncertainty. Do not invent missing details.",
    "Carry extraction quality warnings into conflictsOrGaps so later chat and Create runs know when to verify images, tables, OCR, or the original source.",
    "Return JSON only. No markdown fences.",
    "Required JSON shape:",
    JSON.stringify(
      {
        summary: "plain-language source summary",
        facts: [{ statement: "fact", evidencePath, confidence: "low|medium|high" }],
        entities: [{ name: "entity", type: "person|company|project|concept|unknown", profileClass: "internal|external_client|supplier|partner|unknown", evidencePath }],
        relationships: [{ from: "entity/topic", type: "related_to|works_for|defines_requirement|shapes|mentions", to: "entity/topic", evidencePath }],
        retrieval: {
          aliases: ["search alias"],
          mustReadPaths: [evidencePath],
          coverageRule: "how Hermes should gather all relevant evidence",
        },
        create: {
          usefulFor: ["proposal|pdf|docx|deck|web|image|review"],
          instructions: ["how Create should use this"],
        },
        conflictsOrGaps: ["uncertainty to preserve"],
      },
      null,
      2
    ),
  ].join("\n");
  const user = [
    `Vault: ${params.project.name} (${params.project.slug})`,
    `Source: ${params.job.fileName}`,
    `Asset role: ${params.role}`,
    "Challenge output:",
    params.challenge ? JSON.stringify(params.challenge, null, 2) : "No challenge JSON parsed.",
    "Reader outputs:",
    readerResultsForPrompt(params.project, params.results),
  ].join("\n\n");
  const text = await runGatewayPass({
    gateway: params.gateway,
    passKind: "merge",
    system,
    user,
    onActivityHeadline: (headline) => {
      void params.state.updateMergeTask(
        params.job.jobId,
        {
          status: "running",
          progress: 72,
          detail: headline,
        },
        { runId: params.runId }
      );
    },
  });
  const parsed = extractJsonObject(text);
  const summary =
    parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).summary === "string"
      ? String((parsed as Record<string, unknown>).summary)
      : undefined;
  const score = scoreFromParsed(parsed);
  const outputPath = `${params.swarmRelDir}/merge.json`;
  const payload = {
    schemaVersion: 1,
    runId: params.runId,
    role: params.role,
    sourceName: params.job.fileName,
    generatedAt: new Date().toISOString(),
    parsed,
    rawText: parsed ? undefined : text.slice(0, MAX_READER_OUTPUT_CHARS),
  };
  await writeJsonFile(params.project, params.vaultRootAbs, outputPath, payload);
  await writeJsonFile(params.project, params.vaultRootAbs, params.latestRelPath, payload);
  await writeMarkdownFile(
    params.project,
    params.vaultRootAbs,
    `${params.swarmRelDir}/README.md`,
    [
      `# Hermes ingest swarm`,
      "",
      `Source: ${params.job.fileName}`,
      `Role: ${params.role}`,
      `Run: ${params.runId}`,
      "",
      summary || "Reader swarm completed. Open merge.json for the structured brain pack.",
      "",
    ].join("\n")
  );
  await params.state.updateMergeTask(
    params.job.jobId,
    {
      status: "done",
      progress: 100,
      detail: "Brain pack saved",
      outputPath: readableVaultPath(params.project, outputPath),
      ...(score !== undefined ? { score } : {}),
    },
    { runId: params.runId }
  );
  return { outputPath, latestPath: params.latestRelPath, summary };
}

function concurrencyFromEnv(): number {
  const raw = process.env.HERMES_SHARED_INGEST_SWARM_CONCURRENCY?.trim();
  const n = raw ? Number(raw) : DEFAULT_CONCURRENCY;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(Math.floor(n), 6));
}

export async function runSharedIngestSwarm(params: {
  gateway: GatewayConfig;
  project: ProjectRecord;
  job: SharedIngestJob;
  role: VaultAssetRole;
  runId: string;
  state?: IngestSwarmStateAdapter;
}): Promise<SharedIngestSwarmResult> {
  const state = params.state ?? defaultSwarmState;
  const vaultRootAbs = await resolveProjectRoot(params.project.slug);
  const stem = safePathPart(stemFrom(params.job.fileName, params.job.relativePath));
  const runPart = safePathPart(params.runId);
  const swarmRelDir = `brain/swarm/${stem}/${runPart}`;
  const latestRelPath = `brain/swarm/${stem}/latest.json`;
  const contextItems = await loadSwarmContext({
    vaultRootAbs,
    job: params.job,
    role: params.role,
  });
  const context = contextToPrompt(params.project, contextItems);
  const taskDefs = roleReaderDefinitions(params.role);

  const readerResults = (
    await runWithConcurrency(
      taskDefs,
      concurrencyFromEnv(),
      (task) =>
        runReaderTask({
          state,
          gateway: params.gateway,
          project: params.project,
          job: params.job,
          role: params.role,
          task,
          vaultRootAbs,
          swarmRelDir,
          context,
          runId: params.runId,
        })
    )
  ).filter((result): result is ReaderRunResult => result != null);

  const challenge = await runChallenge({
    state,
    gateway: params.gateway,
    project: params.project,
    job: params.job,
    role: params.role,
    results: readerResults,
    vaultRootAbs,
    swarmRelDir,
    runId: params.runId,
    round: 1,
  });

  let finalResults = readerResults;
  let finalChallengeParsed = challenge.parsed;
  const retryIds = new Set(
    challenge.retryRequests.filter((id) => taskDefs.some((task) => task.id === id))
  );
  if (retryIds.size > 0) {
    const retryTasks = taskDefs.filter((task) => retryIds.has(task.id));
    const retryFeedback = JSON.stringify(challenge.parsed ?? {}, null, 2).slice(0, 12_000);
    const retried = (
      await runWithConcurrency(retryTasks, Math.min(3, concurrencyFromEnv()), (task) =>
        runReaderTask({
          state,
          gateway: params.gateway,
          project: params.project,
          job: params.job,
          role: params.role,
          task,
          vaultRootAbs,
          swarmRelDir,
          context,
          runId: params.runId,
          retryCount: 1,
          challengeFeedback: retryFeedback,
        })
      )
    ).filter((result): result is ReaderRunResult => result != null);
    const byId = new Map(finalResults.map((result) => [result.task.id, result]));
    for (const result of retried) byId.set(result.task.id, result);
    finalResults = [...byId.values()];
    const secondChallenge = await runChallenge({
      state,
      gateway: params.gateway,
      project: params.project,
      job: params.job,
      role: params.role,
      results: finalResults,
      vaultRootAbs,
      swarmRelDir,
      runId: params.runId,
      round: 2,
    });
    finalChallengeParsed = secondChallenge.parsed;
  }

  const merge = await runMerge({
    state,
    gateway: params.gateway,
    project: params.project,
    job: params.job,
    role: params.role,
    results: finalResults,
    challenge: finalChallengeParsed,
    vaultRootAbs,
    swarmRelDir,
    latestRelPath,
    runId: params.runId,
  });

  return {
    outputPaths: [
      ...finalResults.map((result) => readableVaultPath(params.project, result.outputPath)),
      readableVaultPath(params.project, challenge.outputPath),
      readableVaultPath(params.project, merge.outputPath),
      readableVaultPath(params.project, merge.latestPath),
      readableVaultPath(params.project, `${swarmRelDir}/README.md`),
    ],
    ...(merge.summary ? { summary: merge.summary } : {}),
  };
}
