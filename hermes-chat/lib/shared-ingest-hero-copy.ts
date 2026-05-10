import type { VaultAssetRole } from "@/lib/ingest-message";

export type SharedIngestPhaseKey =
  | "structuring"
  | "entity_metadata"
  | "reasoning"
  | "relationships"
  | "merge_antidrift"
  | "periodic_refinement"
  | "unknown";

export type IngestFocusedReader = {
  id: string;
  label: string;
  progress: number;
  state: "done" | "active" | "waiting" | "error";
};

const PHASE_TITLES: Record<SharedIngestPhaseKey, string> = {
  structuring: "Structuring for search and citations",
  entity_metadata: "Pulling out names, dates, and key facts",
  reasoning: "Connecting ideas across the document",
  relationships: "Linking related topics",
  merge_antidrift: "Merging duplicates and checking consistency",
  periodic_refinement: "Refreshing the wider vault",
  /** Distinct from vague/SSE fallbacks; body stays in HERO_BODIES.unknown */
  unknown: "Fitting the document into the vault pipeline",
};

/** Shown for structuring phase + as vague tool-progress replacement in SSE (single source of truth). */
export const STRUCTURING_PHASE_DISPLAY_LINE = PHASE_TITLES.structuring;

/** Short line for files bar + job store. */
export function phaseDisplayLabel(
  key: SharedIngestPhaseKey,
  status: "queued" | "running"
): string {
  if (status === "queued") return "Queued";
  return PHASE_TITLES[key] ?? PHASE_TITLES.unknown;
}

export function ingestProgressLine(params: {
  status: "queued" | "running" | "done" | "error";
  phaseKey?: SharedIngestPhaseKey;
  role?: VaultAssetRole;
  isQueuedWaiting?: boolean;
  slugQueuePosition?: number;
}): string {
  if (params.status === "queued") {
    if (params.isQueuedWaiting) {
      return params.slugQueuePosition && params.slugQueuePosition > 1
        ? `Waiting behind ${params.slugQueuePosition - 1} update${
            params.slugQueuePosition - 1 === 1 ? "" : "s"
          }`
        : "Waiting for the current update";
    }
    return "Getting ready to ingest";
  }
  if (params.status === "done") return "Saved to the vault";
  if (params.status === "error") return "Ingest stopped";

  switch (params.role) {
    case "company_branding":
      return "Building the brand kit";
    case "org_global":
      return "Updating organization knowledge";
    case "output_template":
      return "Capturing template structure";
    case "scoring_criteria":
      return "Filing review rules";
    default:
      return phaseDisplayLabel(params.phaseKey ?? "unknown", "running");
  }
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function ingestProgressPercent(params: {
  status: "queued" | "running" | "done" | "error";
  phaseKey?: SharedIngestPhaseKey;
  role?: VaultAssetRole;
  isQueuedWaiting?: boolean;
}): number {
  if (params.status === "done") return 100;
  if (params.status === "error") return 0;
  if (params.status === "queued") return params.isQueuedWaiting ? 6 : 10;

  const baseByPhase: Record<SharedIngestPhaseKey, number> = {
    unknown: 18,
    structuring: 28,
    entity_metadata: 46,
    reasoning: 62,
    relationships: 76,
    merge_antidrift: 88,
    periodic_refinement: 94,
  };
  const roleNudge =
    params.role === "output_template" || params.role === "scoring_criteria"
      ? 4
      : params.role === "company_branding"
        ? 2
        : 0;
  return clampPercent((baseByPhase[params.phaseKey ?? "unknown"] ?? 18) + roleNudge);
}

function roleReaderLabels(role?: VaultAssetRole): string[] {
  switch (role) {
    case "output_template":
      return ["Text", "Structure", "Tone", "Template"];
    case "scoring_criteria":
      return ["Text", "Rules", "Checks", "Finder"];
    case "company_branding":
      return ["Text", "Brand", "Visuals", "Kit"];
    case "org_global":
      return ["Text", "Org", "Links", "Search"];
    default:
      return ["Text", "Details", "Links", "Search"];
  }
}

function readerProgress(overall: number, index: number): number {
  const starts = [8, 24, 44, 68];
  const ends = [38, 62, 84, 100];
  const start = starts[index] ?? 0;
  const end = ends[index] ?? 100;
  if (overall <= start) return 0;
  if (overall >= end) return 100;
  return clampPercent(((overall - start) / (end - start)) * 100);
}

export function ingestFocusedReaders(params: {
  status: "queued" | "running" | "done" | "error";
  phaseKey?: SharedIngestPhaseKey;
  role?: VaultAssetRole;
  isQueuedWaiting?: boolean;
}): IngestFocusedReader[] {
  const overall = ingestProgressPercent(params);
  return roleReaderLabels(params.role).map((label, index) => {
    const progress =
      params.status === "error"
        ? 0
        : params.status === "done"
          ? 100
          : readerProgress(overall, index);
    const state: IngestFocusedReader["state"] =
      params.status === "error"
        ? "error"
        : progress >= 100
          ? "done"
          : progress > 0
            ? "active"
            : "waiting";
    return {
      id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
      label,
      progress,
      state,
    };
  });
}

export function ingestDetailLine(
  phaseLabel: string | null | undefined,
  progressLine: string
): string | null {
  const detail = phaseLabel?.replace(/\s+/g, " ").trim();
  if (!detail) return null;
  const lower = detail.toLowerCase();
  if (
    lower === "queued" ||
    lower === "complete" ||
    lower === "working…" ||
    lower === "working..." ||
    lower === progressLine.toLowerCase()
  ) {
    return null;
  }
  return detail.length > 160 ? `${detail.slice(0, 160)}…` : detail;
}

export function runningHeroBody(role?: VaultAssetRole): string {
  switch (role) {
    case "company_branding":
      return "I’m pulling out the real names, tone, services, and visual cues so Create can use the brand without inventing details.";
    case "org_global":
      return "I’m turning this source into organization knowledge: useful facts, links, and citations Hermes can reuse later.";
    case "output_template":
      return "I’m reading the example for structure, section order, image placement, and tone so Create can reuse the shape cleanly.";
    case "scoring_criteria":
      return "I’m filing this as guidance for checking work, so later answers stay tied to the right rules.";
    default:
      return "I’m reading the file, structuring the important parts, and saving it so chat can find the right evidence later.";
  }
}

/** Hero headline under the orb. */
export function heroHeadline(fileName: string): string {
  return `Hermes is ingesting “${fileName}”`;
}

/** Role-specific headline for shared vault ingest. */
export function ingestHeroHeadline(
  fileName: string,
  role?: VaultAssetRole
): string {
  switch (role) {
    case "output_template":
      return `Hermes is capturing layout and tone from “${fileName}”`;
    case "scoring_criteria":
      return `Hermes is filing review rules from “${fileName}”`;
    case "org_global":
      return `Hermes is adding organization library material from “${fileName}”`;
    case "company_branding":
      return `Hermes is saving brand details from “${fileName}”`;
    default:
      return heroHeadline(fileName);
  }
}

/** Short, plain-language steps per phase (no jargon). */
const HERO_BODIES: Record<SharedIngestPhaseKey, string> = {
  structuring:
    "I process your file into a vault-ready layout—sectioned and indexed—so I can search it precisely and cite it when you ask.",
  entity_metadata:
    "I’m pulling out people, organizations, dates, and other standout facts and filing them where they belong, so they’re easy to find again.",
  reasoning:
    "I’m connecting sections—what implies what, and what belongs with what—so answers stay grounded in what you uploaded.",
  relationships:
    "I’m mapping how topics and entities relate so related material stays linked instead of scattered.",
  merge_antidrift:
    "I’m merging overlaps, reconciling inconsistencies, and keeping one clear source of truth as the vault grows.",
  periodic_refinement:
    "I’m running a broader pass so patterns across the vault stay aligned when you’ve added a lot over time.",
  unknown:
    "Here’s the usual flow: I convert your file to searchable markdown and chunks, save everything under your vault (including figures inline in extracted markdown when present), update the index and log, and merge key facts into wiki entity notes when this upload is general reference material. It runs in the background; when it finishes, chat can use this document like the rest of your vault.",
};

const UNKNOWN_BODY_BY_ROLE: Partial<Record<VaultAssetRole, string>> = {
  output_template:
    "I extract the text, then record section order, headings, and tone under templates/. This path is for layout and voice: it is not a full factual run that feeds the same default chunks as your main reference material.",
  scoring_criteria:
    "I extract the text and file it only under the review-rules area. It is not merged into general background knowledge, so checks stay tied to this document.",
  org_global:
    "I run the same extract-and-index flow. This file is for the organization-wide library (shared with your org), with provenance in the log when applicable—this is not a private single-vault copy.",
  company_branding:
    "I extract text when needed, then merge the important bits into branding/BRAND_KIT.md—official names, site, colors, and product terms—so later creations stay grounded in your real brand instead of invented logos or names.",
};

/** In-feed copy when the job row has not loaded yet (replaces hidden browser tooltips). */
export function connectingInlineBody(
  fileName: string,
  role?: VaultAssetRole
): string {
  const quoted = `“${fileName}”`;
  switch (role) {
    case "scoring_criteria":
      return `Starting the background job for ${quoted}. This upload is review rules: it will be filed separately, not as general project notes. It is not mixed into everyday background knowledge.`;
    case "output_template":
      return `Starting the background job for ${quoted}. This is a layout and tone example: I capture structure and writing style, not a full authoritative fact pass for the job.`;
    case "org_global":
      return `Starting the background job for ${quoted} in the organization library. It is shared with your org and is not kept as a private single‑vault only upload.`;
    case "company_branding":
      return `Starting the background job for ${quoted}. This upload is brand material: I file a canonical brand kit under branding/ so creations can use your real names and colors.`;
    default:
      return `Connecting to the background job for ${quoted}. I’ll read the file, update the index, and build structured wiki notes when this document feeds the general knowledge base. In a few seconds the current step will show here; you can keep using chat.`;
  }
}

export function heroBodyForPhase(
  key: SharedIngestPhaseKey,
  role?: VaultAssetRole
): string {
  if (key === "unknown" && role && UNKNOWN_BODY_BY_ROLE[role]) {
    return UNKNOWN_BODY_BY_ROLE[role]!;
  }
  return HERO_BODIES[key] ?? HERO_BODIES.unknown;
}

export function queuedHeroBody(): string {
  return "Another upload is finishing first. Yours is already saved and will start automatically—no need to upload again.";
}
