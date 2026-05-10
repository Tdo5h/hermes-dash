import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  HERMES_BRAIN_COMPANY_PROFILES_PATH,
  HERMES_BRAIN_DIR,
  HERMES_BRAIN_DOCUMENTS_PATH,
  HERMES_BRAIN_ENTITIES_PATH,
  HERMES_BRAIN_FACTS_PATH,
  HERMES_BRAIN_MANIFEST_PATH,
  HERMES_BRAIN_PEOPLE_PROFILES_PATH,
  HERMES_BRAIN_RELATIONSHIPS_PATH,
  HERMES_BRAIN_RETRIEVAL_ROUTER_PATH,
  HERMES_BRAIN_WEBSITE_CRAWLS_PATH,
  type HermesBrainManifest,
} from "@/lib/hermes-brain-schema";

type IdentifiedRecord = { id: string };

const BRAIN_DIRS = [
  HERMES_BRAIN_DIR,
  "brain/profiles",
  "brain/retrieval",
  "brain/conflicts",
];

export function hermesBrainRelPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function makeHermesBrainId(prefix: string, parts: string[]): string {
  const normalized = parts
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .join("\u001f");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

export async function ensureHermesBrainDirs(vaultRootAbs: string): Promise<void> {
  await Promise.all(
    BRAIN_DIRS.map((dir) => mkdir(path.join(vaultRootAbs, dir), { recursive: true }))
  );
}

async function atomicWrite(absFinal: string, content: string): Promise<void> {
  await mkdir(path.dirname(absFinal), { recursive: true });
  const tmp = `${absFinal}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, absFinal);
}

export async function readHermesBrainJsonl<T extends object>(
  vaultRootAbs: string,
  relPath: string
): Promise<T[]> {
  const abs = path.join(vaultRootAbs, relPath);
  let raw = "";
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export async function writeHermesBrainJsonl<T extends object>(
  vaultRootAbs: string,
  relPath: string,
  records: T[]
): Promise<void> {
  await ensureHermesBrainDirs(vaultRootAbs);
  const abs = path.join(vaultRootAbs, relPath);
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  await atomicWrite(abs, body ? `${body}\n` : "");
}

export async function upsertHermesBrainJsonlRecord<T extends object & IdentifiedRecord>(
  vaultRootAbs: string,
  relPath: string,
  record: T
): Promise<void> {
  const records = await readHermesBrainJsonl<T>(vaultRootAbs, relPath);
  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  await writeHermesBrainJsonl(vaultRootAbs, relPath, records);
}

export async function readHermesBrainJson<T extends object>(
  vaultRootAbs: string,
  relPath: string
): Promise<T | null> {
  try {
    const raw = await readFile(path.join(vaultRootAbs, relPath), "utf8");
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeHermesBrainJson<T extends object>(
  vaultRootAbs: string,
  relPath: string,
  value: T
): Promise<void> {
  await ensureHermesBrainDirs(vaultRootAbs);
  await atomicWrite(
    path.join(vaultRootAbs, relPath),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

export async function readHermesBrainManifest(
  vaultRootAbs: string
): Promise<HermesBrainManifest | null> {
  try {
    const raw = await readFile(path.join(vaultRootAbs, HERMES_BRAIN_MANIFEST_PATH), "utf8");
    const parsed = JSON.parse(raw) as HermesBrainManifest;
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeHermesBrainManifest(
  vaultRootAbs: string,
  manifest: HermesBrainManifest
): Promise<void> {
  await ensureHermesBrainDirs(vaultRootAbs);
  await atomicWrite(
    path.join(vaultRootAbs, HERMES_BRAIN_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

export const HERMES_BRAIN_JSONL_PATHS = {
  documents: HERMES_BRAIN_DOCUMENTS_PATH,
  entities: HERMES_BRAIN_ENTITIES_PATH,
  facts: HERMES_BRAIN_FACTS_PATH,
  relationships: HERMES_BRAIN_RELATIONSHIPS_PATH,
  peopleProfiles: HERMES_BRAIN_PEOPLE_PROFILES_PATH,
  companyProfiles: HERMES_BRAIN_COMPANY_PROFILES_PATH,
  retrievalRouter: HERMES_BRAIN_RETRIEVAL_ROUTER_PATH,
  websiteCrawls: HERMES_BRAIN_WEBSITE_CRAWLS_PATH,
} as const;
