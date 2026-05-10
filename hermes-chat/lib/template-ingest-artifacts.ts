import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import {
  readProject,
  resolveProjectRoot,
  writeProjectArtifactFile,
} from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import type { WorkspaceVisibility } from "@/lib/project-paths";

type TemplateSection = {
  title: string;
  level: number;
  role: "boilerplate" | "narrative" | "data_table" | "other";
  notes: string;
};

export type EnsuredTemplateArtifacts = {
  outlineRelPath: string;
  structureRelPath: string;
  createdPaths: string[];
};

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

async function isNonEmptyFile(abs: string): Promise<boolean> {
  try {
    const s = await stat(abs);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function yamlString(raw: string): string {
  return JSON.stringify(raw.replace(/\s+/g, " ").trim());
}

function inferSectionRole(title: string): TemplateSection["role"] {
  const t = title.toLowerCase();
  if (/table|schedule|pricing|budget|matrix|checklist|register/.test(t)) {
    return "data_table";
  }
  if (/terms|conditions|appendix|declaration|signature|cover|footer/.test(t)) {
    return "boilerplate";
  }
  if (/method|approach|summary|overview|response|plan|experience|team/.test(t)) {
    return "narrative";
  }
  return "other";
}

function extractSections(markdown: string, fallbackTitle: string): TemplateSection[] {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((m) => {
    const title = (m[2] ?? "").replace(/#+\s*$/, "").trim();
    const level = (m[1] ?? "#").length;
    return { title, level };
  });

  const usable = headings.filter((h) => h.title && !/^image\s+\d+$/i.test(h.title));
  const source = usable.length > 0 ? usable : [{ title: fallbackTitle, level: 1 }];

  return source.slice(0, 80).map((heading) => ({
    title: heading.title,
    level: heading.level,
    role: inferSectionRole(heading.title),
    notes:
      heading.level <= 2
        ? "Major reusable section in the document flow."
        : "Nested section; preserve hierarchy if relevant.",
  }));
}

function documentTone(markdown: string): string {
  const text = markdown.toLowerCase();
  const formalHits = (text.match(/\b(shall|must|required|therefore|pursuant|compliance)\b/g) ?? [])
    .length;
  const friendlyHits = (text.match(/\b(we|you|your|welcome|simple|help)\b/g) ?? [])
    .length;
  if (formalHits > friendlyHits + 3) return "formal / compliance-led";
  if (friendlyHits > formalHits + 3) return "plain-spoken / client-friendly";
  return "professional / balanced";
}

function countMatches(markdown: string, pattern: RegExp): number {
  return (markdown.match(pattern) ?? []).length;
}

function buildOutline(params: {
  sourceName: string;
  extractedRelPath: string;
  structureRelPath: string;
  sections: TemplateSection[];
  markdown: string;
}): string {
  const tableLines = countMatches(params.markdown, /^\s*\|.+\|\s*$/gm);
  const listItems = countMatches(params.markdown, /^\s*[-*]\s+/gm);
  const images = countMatches(params.markdown, /!\[[^\]]*]\(/g);
  return [
    `# Template outline — ${params.sourceName}`,
    "",
    `Source extraction: \`${params.extractedRelPath}\``,
    `Structure file: \`${params.structureRelPath}\``,
    "",
    "Use this as layout, section order, tone, and content-shape guidance only. Do not treat the old body text as facts for a new client output unless the same source is also selected as data.",
    "",
    "## Reusable Shape",
    "",
    `- Tone: ${documentTone(params.markdown)}`,
    `- Heading count: ${params.sections.length}`,
    `- Table-like lines: ${tableLines}`,
    `- List items: ${listItems}`,
    `- Image references: ${images}`,
    "",
    "## Heading Map",
    "",
    ...params.sections.map((section, index) => {
      const indent = "  ".repeat(Math.max(0, section.level - 1));
      return `${indent}${index + 1}. ${section.title} (${section.role})`;
    }),
    "",
  ].join("\n");
}

function buildStructure(params: {
  sourceName: string;
  sourceRelPath: string;
  extractedRelPath: string;
  outlineRelPath: string;
  sections: TemplateSection[];
  markdown: string;
}): string {
  return [
    "schema_version: 1",
    "kind: layout_tone_template",
    `source_name: ${yamlString(params.sourceName)}`,
    `source_path: ${yamlString(params.sourceRelPath)}`,
    `extracted_path: ${yamlString(params.extractedRelPath)}`,
    `outline_path: ${yamlString(params.outlineRelPath)}`,
    "template_use: layout_voice_structure_only",
    `tone: ${yamlString(documentTone(params.markdown))}`,
    "carry_over_defaults:",
    "  - structure",
    "  - content_categories",
    "  - tone",
    "sections:",
    ...params.sections.flatMap((section, index) => [
      `  - index: ${index + 1}`,
      `    title: ${yamlString(section.title)}`,
      `    level: ${section.level}`,
      `    role: ${section.role}`,
      `    notes_on_tone: ${yamlString(section.notes)}`,
    ]),
    "",
  ].join("\n");
}

function shouldUseArtifactBridge(visibility: WorkspaceVisibility): boolean {
  return visibility === "private" && shouldUseChatDatabase();
}

async function writeTemplateArtifact(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultRootAbs: string;
  relPath: string;
  body: string;
}): Promise<void> {
  if (shouldUseArtifactBridge(params.visibility)) {
    await writeProjectArtifactFile(params.projectSlug, params.relPath, params.body, {
      visibility: params.visibility,
    });
    return;
  }
  const abs = path.join(params.vaultRootAbs, params.relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, params.body, "utf8");
}

async function appendIfMissing(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultRootAbs: string;
  relPath: string;
  marker: string;
  block: string;
}): Promise<void> {
  const abs = path.join(params.vaultRootAbs, params.relPath);
  let current = "";
  try {
    current = await readFile(abs, "utf8");
  } catch {
    current = "";
  }
  if (current.includes(params.marker)) return;
  await writeTemplateArtifact({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs: params.vaultRootAbs,
    relPath: params.relPath,
    body: `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${params.block.trimEnd()}\n`,
  });
}

export async function ensureTemplateArtifactsForUpload(params: {
  projectSlug: string;
  fileName: string;
  relativePath: string;
}): Promise<EnsuredTemplateArtifacts> {
  const meta = await readProject(params.projectSlug);
  if (!meta) throw new Error("Project not found");
  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  const sourceName = basenameFrom(params.fileName, params.relativePath);
  const stem = stemFrom(params.fileName, params.relativePath);
  const sourceRelPath = `sources/${sourceName}`;
  const extractedRelPath = `extracted/${sourceName}.md`;
  const outlineRelPath = `templates/${stem}/outline.md`;
  const structureRelPath = `templates/${stem}/structure.yaml`;
  const extractedAbs = path.join(vaultRootAbs, extractedRelPath);
  const outlineAbs = path.join(vaultRootAbs, outlineRelPath);
  const structureAbs = path.join(vaultRootAbs, structureRelPath);

  const markdown = await readFile(extractedAbs, "utf8").catch(() => "");
  if (!markdown.trim()) {
    throw new Error(
      `Template ingest did not produce ${extractedRelPath}; cannot build reusable template artifacts.`
    );
  }

  const sections = extractSections(markdown, stem.replace(/[-_]+/g, " ").trim() || stem);
  const createdPaths: string[] = [];
  if (!shouldUseArtifactBridge(meta.visibility)) {
    await mkdir(path.dirname(outlineAbs), { recursive: true });
  }

  if (!(await isNonEmptyFile(outlineAbs))) {
    await writeTemplateArtifact({
      projectSlug: meta.slug,
      visibility: meta.visibility,
      vaultRootAbs,
      relPath: outlineRelPath,
      body: buildOutline({
        sourceName,
        extractedRelPath,
        structureRelPath,
        sections,
        markdown,
      }),
    });
    createdPaths.push(outlineRelPath);
  }

  if (!(await isNonEmptyFile(structureAbs))) {
    await writeTemplateArtifact({
      projectSlug: meta.slug,
      visibility: meta.visibility,
      vaultRootAbs,
      relPath: structureRelPath,
      body: buildStructure({
        sourceName,
        sourceRelPath,
        extractedRelPath,
        outlineRelPath,
        sections,
        markdown,
      }),
    });
    createdPaths.push(structureRelPath);
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  await appendIfMissing({
    projectSlug: meta.slug,
    visibility: meta.visibility,
    vaultRootAbs,
    relPath: "INDEX.md",
    marker: `templates/${stem}/`,
    block: [
      "## Templates",
      "",
      "| Source | Extracted | Template paths | Asset role | Updated |",
      "|---|---|---|---|---|",
      `| \`${sourceRelPath}\` | \`${extractedRelPath}\` | \`${outlineRelPath}\`; \`${structureRelPath}\` | output_template | ${today} |`,
    ].join("\n"),
  });
  await appendIfMissing({
    projectSlug: meta.slug,
    visibility: meta.visibility,
    vaultRootAbs,
    relPath: "LOG.md",
    marker: `templates/${stem}/`,
    block: `- ${now} — Ingested \`${sourceName}\` as output_template. Ensured reusable template structure at \`${outlineRelPath}\` and \`${structureRelPath}\`.`,
  });

  return {
    outlineRelPath,
    structureRelPath,
    createdPaths,
  };
}
