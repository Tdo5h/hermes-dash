import { randomUUID } from "crypto";
import path from "path";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { getHermesChatDataDir } from "@/lib/hermes-config";
import type {
  CreateProductionAsset,
  CreateProductionBrief,
} from "@/lib/create-production-types";

const PATTERN_ROOT_NAME = "create-patterns";
const PERSIST_USER_FIELDS = [
  "brief",
  "reviewedBrief",
  "sourceMaterial",
  "exactCopy",
  "dataNotes",
] as const;

export type CreatePatternPersistUserField = (typeof PERSIST_USER_FIELDS)[number];

export type CreatePatternPersistOptions = {
  assetIds?: string[];
  userFields?: CreatePatternPersistUserField[];
};

export type CreatePatternRow = {
  id: string;
  name: string;
  outputId: string;
  outputLabel: string;
  subtypeId: string;
  subtypeLabel: string;
  documentFormat?: string;
  createdAt: string;
  updatedAt: string;
  createBrief: CreateProductionBrief;
  resultNotes?: string;
};

type CreatePatternManifest = CreatePatternRow & {
  version: 1;
};

export type SaveCreatePatternInput = {
  name?: string;
  createBrief: CreateProductionBrief;
  persist?: unknown;
  resultNotes?: string;
};

function patternRoot(): string {
  return path.join(getHermesChatDataDir(), PATTERN_ROOT_NAME);
}

function outputRoot(outputId: string): string {
  return path.join(patternRoot(), slugPart(outputId || "create"));
}

function slugPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "create"
  );
}

function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || fallback).replace(/\s+/g, " ").slice(0, 120);
}

function derivePatternName(brief: CreateProductionBrief): string {
  const dna = brief.designDna?.systems
    ?.map((system) => system.name)
    .filter(Boolean)
    .slice(0, 2)
    .join(" + ");
  const dnaPart = dna ? ` · ${dna}` : "";
  return `${brief.output.displayName} · ${brief.subtype.label}${dnaPart}`;
}

function sanitizeResultNotes(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\/api\/(?:images|builds|projects)\/\S+/gi, " ")
    .replace(/\/(?:var|opt|app|vault-shared|vault-projects)\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return cleaned || undefined;
}

function cleanPersistOptions(value: unknown): CreatePatternPersistOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as { assetIds?: unknown; userFields?: unknown };
  const assetIds = Array.isArray(raw.assetIds)
    ? raw.assetIds
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 80)
    : [];
  const userFields = Array.isArray(raw.userFields)
    ? raw.userFields.filter((item): item is CreatePatternPersistUserField =>
        PERSIST_USER_FIELDS.includes(item as CreatePatternPersistUserField)
      )
    : [];
  return {
    ...(assetIds.length ? { assetIds: [...new Set(assetIds)] } : {}),
    ...(userFields.length ? { userFields: [...new Set(userFields)] } : {}),
  };
}

function cleanPersistedText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 40000) : undefined;
}

function copySelectedAssets(
  assets: CreateProductionAsset[] | undefined,
  selectedIds: Set<string>
): CreateProductionAsset[] | undefined {
  if (!assets?.length || selectedIds.size === 0) return undefined;
  const selected = assets
    .filter((asset) => selectedIds.has(asset.id))
    .map((asset) => ({ ...asset }))
    .slice(0, 40);
  return selected.length ? selected : undefined;
}

function sanitizeBriefForPattern(
  brief: CreateProductionBrief,
  persist?: CreatePatternPersistOptions
): CreateProductionBrief {
  const selectedAssetIds = new Set(persist?.assetIds ?? []);
  const selectedUserFields = new Set(persist?.userFields ?? []);
  const themeImages = copySelectedAssets(brief.assets?.themeImages, selectedAssetIds);
  const includeImages = copySelectedAssets(brief.assets?.includeImages, selectedAssetIds);
  const useImages = copySelectedAssets(brief.assets?.useImages, selectedAssetIds);
  const assets =
    themeImages || includeImages || useImages
      ? {
          ...(themeImages ? { themeImages } : {}),
          ...(includeImages ? { includeImages } : {}),
          ...(useImages ? { useImages } : {}),
        }
      : undefined;
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    ...(brief.creationMode ? { creationMode: brief.creationMode } : {}),
    intent: brief.intent,
    output: { ...brief.output },
    subtype: { ...brief.subtype },
    ...(brief.extraRoutes?.length
      ? { extraRoutes: brief.extraRoutes.map((route) => ({ ...route })) }
      : {}),
    ...(brief.openDesign ? { openDesign: { ...brief.openDesign } } : {}),
    user: {
      ...(brief.user.tuneTags?.length
        ? { tuneTags: brief.user.tuneTags.map((tag) => ({ ...tag })) }
        : {}),
      ...(selectedUserFields.has("brief") && cleanPersistedText(brief.user.brief)
        ? { brief: cleanPersistedText(brief.user.brief) }
        : {}),
      ...(selectedUserFields.has("reviewedBrief") &&
      cleanPersistedText(brief.user.reviewedBrief)
        ? { reviewedBrief: cleanPersistedText(brief.user.reviewedBrief) }
        : {}),
      ...(selectedUserFields.has("sourceMaterial") &&
      cleanPersistedText(brief.user.sourceMaterial)
        ? { sourceMaterial: cleanPersistedText(brief.user.sourceMaterial) }
        : {}),
      ...(selectedUserFields.has("exactCopy") && cleanPersistedText(brief.user.exactCopy)
        ? { exactCopy: cleanPersistedText(brief.user.exactCopy) }
        : {}),
      ...(selectedUserFields.has("dataNotes") && cleanPersistedText(brief.user.dataNotes)
        ? { dataNotes: cleanPersistedText(brief.user.dataNotes) }
        : {}),
    },
    ...(assets ? { assets } : {}),
    ...(brief.template ? { template: { ...brief.template } } : {}),
    ...(brief.designDna
      ? {
          designDna: {
            ...(brief.designDna.systems?.length
              ? { systems: brief.designDna.systems.map((system) => ({ ...system })) }
              : {}),
            ...(brief.designDna.carryOver?.length
              ? { carryOver: [...brief.designDna.carryOver] }
              : {}),
            ...(brief.designDna.strength ? { strength: brief.designDna.strength } : {}),
            ...(brief.designDna.avoidCopying?.length
              ? { avoidCopying: [...brief.designDna.avoidCopying] }
              : {}),
          },
        }
      : {}),
  };
}

function manifestPath(outputId: string, id: string): string {
  return path.join(outputRoot(outputId), id, "pattern.json");
}

async function readPatternFile(filePath: string): Promise<CreatePatternRow | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<CreatePatternManifest>;
    if (parsed.version !== 1 || !parsed.id || !parsed.name || !parsed.createBrief) {
      return null;
    }
    return {
      id: String(parsed.id),
      name: String(parsed.name),
      outputId: String(parsed.outputId || parsed.createBrief.output.id),
      outputLabel: String(parsed.outputLabel || parsed.createBrief.output.displayName),
      subtypeId: String(parsed.subtypeId || parsed.createBrief.subtype.id),
      subtypeLabel: String(parsed.subtypeLabel || parsed.createBrief.subtype.label),
      ...(typeof parsed.documentFormat === "string"
        ? { documentFormat: parsed.documentFormat }
        : {}),
      createdAt: String(parsed.createdAt || new Date().toISOString()),
      updatedAt: String(parsed.updatedAt || parsed.createdAt || new Date().toISOString()),
      createBrief: parsed.createBrief as CreateProductionBrief,
      ...(typeof parsed.resultNotes === "string" ? { resultNotes: parsed.resultNotes } : {}),
    };
  } catch {
    return null;
  }
}

export async function listCreatePatterns(outputId?: string): Promise<CreatePatternRow[]> {
  const root = patternRoot();
  const outputDirs = outputId
    ? [slugPart(outputId)]
    : await readdir(root).catch(() => []);
  const files: string[] = [];
  for (const outputDir of outputDirs) {
    if (outputDir.startsWith(".")) continue;
    const dir = path.join(root, outputDir);
    const entries = await readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (!entry.startsWith(".")) files.push(path.join(dir, entry, "pattern.json"));
    }
  }
  const rows = await Promise.all(files.map(readPatternFile));
  return rows
    .filter((row): row is CreatePatternRow => Boolean(row))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function saveCreatePattern(input: SaveCreatePatternInput): Promise<CreatePatternRow> {
  const brief = sanitizeBriefForPattern(input.createBrief, cleanPersistOptions(input.persist));
  const now = new Date().toISOString();
  const id = `${slugPart(cleanName(input.name, derivePatternName(input.createBrief)))}-${randomUUID().slice(0, 8)}`;
  const row: CreatePatternManifest = {
    version: 1,
    id,
    name: cleanName(input.name, derivePatternName(input.createBrief)),
    outputId: brief.output.id,
    outputLabel: brief.output.displayName,
    subtypeId: brief.subtype.id,
    subtypeLabel: brief.subtype.label,
    ...(brief.output.documentFormat ? { documentFormat: brief.output.documentFormat } : {}),
    createdAt: now,
    updatedAt: now,
    createBrief: brief,
    ...(sanitizeResultNotes(input.resultNotes)
      ? { resultNotes: sanitizeResultNotes(input.resultNotes) }
      : {}),
  };
  const filePath = manifestPath(row.outputId, row.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(row, null, 2)}\n`, "utf8");
  return {
    id: row.id,
    name: row.name,
    outputId: row.outputId,
    outputLabel: row.outputLabel,
    subtypeId: row.subtypeId,
    subtypeLabel: row.subtypeLabel,
    ...(row.documentFormat ? { documentFormat: row.documentFormat } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createBrief: row.createBrief,
    ...(row.resultNotes ? { resultNotes: row.resultNotes } : {}),
  };
}

export async function deleteCreatePattern(id: string): Promise<boolean> {
  if (!/^[a-z0-9-]{1,140}$/.test(id)) return false;
  const rows = await listCreatePatterns();
  const row = rows.find((item) => item.id === id);
  if (!row) return false;
  await rm(path.dirname(manifestPath(row.outputId, row.id)), {
    recursive: true,
    force: true,
  });
  return true;
}
