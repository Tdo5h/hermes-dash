import path from "path";
import { existsSync } from "fs";
import { chmod, readdir, readFile, writeFile, mkdir, rename } from "fs/promises";
import { getHermesDataDir } from "@/lib/hermes-config";

export type HermesUserSkill = {
  id: string;
  name: string;
  description: string;
  content: string;
  source: "primary" | "legacy";
  owner: "stack" | "user";
  relativePath: string;
  directory: string;
  state: string;
  pinned: boolean;
  pinnable: boolean;
  useCount: number | null;
  lastUsedAt: string | null;
  createdAt: string | null;
};

type UsageEntry = {
  pinned?: unknown;
  state?: unknown;
  use_count?: unknown;
  last_used_at?: unknown;
  created_at?: unknown;
  archived_at?: unknown;
};

type UsageJson = Record<string, UsageEntry>;

function skillNameFromMarkdown(raw: string, fallback: string): string {
  const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = frontmatter?.[1] ?? raw.slice(0, 1200);
  const name = block.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  return name || fallback;
}

function skillDescriptionFromMarkdown(raw: string): string {
  const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = frontmatter?.[1] ?? raw.slice(0, 1600);
  const folded = block.match(/^description:\s*[>|-]?\s*\n((?:\s{2,}.+\n?)+)/m)?.[1];
  if (folded) return folded.replace(/\s+/g, " ").trim();
  const single = block.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  if (single && single !== ">" && single !== ">-" && single !== "|") {
    return single.replace(/^>-\s*/, "").trim();
  }
  const heading = raw.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  return heading || "User skill";
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function readBundledSkillNames(root: string): Promise<Set<string>> {
  const bundled = new Set<string>();
  try {
    const raw = await readFile(path.join(root, "skills", ".bundled_manifest"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const name = line.split(":")[0]?.trim();
      if (name) bundled.add(name);
    }
  } catch {
    /* no bundled manifest */
  }
  return bundled;
}

async function readHubSkillNames(root: string): Promise<Set<string>> {
  const hub = new Set<string>();
  try {
    const raw = await readFile(path.join(root, "skills", ".hub", "lock.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(parsed)) hub.add(key);
  } catch {
    /* no hub lock */
  }
  return hub;
}

async function readUsage(root: string): Promise<UsageJson> {
  try {
    const raw = await readFile(path.join(root, "skills", ".usage.json"), "utf-8");
    const parsed = JSON.parse(raw) as UsageJson;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUsage(usagePath: string, usage: UsageJson): Promise<void> {
  await writeFile(usagePath, `${JSON.stringify(usage, null, 2)}\n`, "utf-8");
  await chmod(usagePath, 0o660).catch(() => {});
}

async function listSkillDirs(base: string): Promise<string[]> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function listSkillDirsRecursive(
  base: string,
  rel = "",
  depth = 0
): Promise<string[]> {
  if (depth > 3) return [];
  const dir = path.join(base, rel);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  if (existsSync(path.join(dir, "SKILL.md")) && rel) out.push(rel);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    out.push(
      ...(await listSkillDirsRecursive(
        base,
        rel ? path.join(rel, entry.name) : entry.name,
        depth + 1
      ))
    );
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function hasHermesChatUserMarker(root: string, dir: string): boolean {
  return existsSync(path.join(root, "skills", dir, ".hermeschat-user-skill.json"));
}

const STACK_SKILL_NAMES = new Set([
  "creative-studio",
  "hermes-cron-hermeschat",
  "hermes-skills-in-repo",
  "hermeschat-builds-manifest",
  "pdf-generation-pymupdf",
  "project-vault",
  "shared-wiki-vault-io",
  "unified-vault-ingest",
  "vault-ingest-read-guide",
  "wiki-vault-ingest-pipeline",
]);

function skillOwner(root: string, dir: string, name: string): "stack" | "user" {
  if (hasHermesChatUserMarker(root, dir)) return "user";
  if (STACK_SKILL_NAMES.has(name)) return "stack";
  return "user";
}

async function readSkillCard(params: {
  root: string;
  dir: string;
  source: "primary" | "legacy";
  usage: UsageJson;
}): Promise<HermesUserSkill | null> {
  const base =
    params.source === "primary"
      ? path.join(params.root, "skills", params.dir)
      : path.join(params.root, "home", ".skills", params.dir);
  const skillFile = path.join(base, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  const raw = await readFile(skillFile, "utf-8").catch(() => "");
  const name = skillNameFromMarkdown(raw, path.basename(params.dir));
  const usage = params.usage[name] ?? params.usage[params.dir] ?? {};
  return {
    id: name,
    name,
    description: skillDescriptionFromMarkdown(raw),
    content: raw,
    source: params.source,
    owner: skillOwner(params.root, params.dir, name),
    relativePath:
      params.source === "primary"
        ? `skills/${params.dir}/SKILL.md`
        : `home/.skills/${params.dir}/SKILL.md`,
    directory: params.dir,
    state: asString(usage.state) || "active",
    pinned: usage.pinned === true,
    pinnable: params.source === "primary",
    useCount: asCount(usage.use_count),
    lastUsedAt: asString(usage.last_used_at),
    createdAt: asString(usage.created_at),
  };
}

export async function listHermesUserSkills(): Promise<{
  ok: true;
  skills: HermesUserSkill[];
} | {
  ok: false;
  error: string;
}> {
  const root = getHermesDataDir();
  if (!root) return { ok: false, error: "HERMES_DATA_DIR is not configured." };
  const [bundled, hub, usage] = await Promise.all([
    readBundledSkillNames(root),
    readHubSkillNames(root),
    readUsage(root),
  ]);

  try {
    const primaryDirs = await listSkillDirs(path.join(root, "skills"));
    const legacyDirs = await listSkillDirsRecursive(path.join(root, "home", ".skills"));
    const cards: HermesUserSkill[] = [];

    for (const dir of await listSkillDirsRecursive(path.join(root, "skills"))) {
      const card = await readSkillCard({ root, dir, source: "primary", usage });
      if (!card) continue;
      if (bundled.has(card.name) || hub.has(card.name)) continue;
      if (card) cards.push(card);
    }
    for (const dir of legacyDirs) {
      const card = await readSkillCard({ root, dir, source: "legacy", usage });
      if (card && cards.some((existing) => existing.name === card.name)) continue;
      if (card) cards.push(card);
    }

    cards.sort((a, b) => {
      const at = Date.parse(a.lastUsedAt || a.createdAt || "") || 0;
      const bt = Date.parse(b.lastUsedAt || b.createdAt || "") || 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });

    return { ok: true, skills: cards };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not read Hermes skills: ${msg}` };
  }
}

export async function setHermesUserSkillPinned(
  skillId: string,
  pinned: boolean
): Promise<{ ok: true; pinned: boolean } | { ok: false; error: string }> {
  const root = getHermesDataDir();
  if (!root) return { ok: false, error: "HERMES_DATA_DIR is not configured." };
  if (!/^[a-zA-Z0-9._-]+$/.test(skillId)) {
    return { ok: false, error: "Invalid skill id." };
  }
  const bundled = await readBundledSkillNames(root);
  const hub = await readHubSkillNames(root);
  if (bundled.has(skillId) || hub.has(skillId)) {
    return { ok: false, error: "Bundled and hub skills do not need pinning." };
  }
  const primaryDirs = await listSkillDirsRecursive(path.join(root, "skills"));
  let skillDir: string | null = null;
  for (const dir of primaryDirs) {
    const full = path.join(root, "skills", dir);
    const raw = await readFile(path.join(full, "SKILL.md"), "utf-8").catch(() => "");
    if (skillNameFromMarkdown(raw, path.basename(dir)) === skillId) {
      skillDir = full;
      break;
    }
  }
  if (!skillDir) {
    return { ok: false, error: "Only skills in the main Hermes skills folder can be pinned." };
  }

  const usagePath = path.join(root, "skills", ".usage.json");
  const usage = await readUsage(root);
  usage[skillId] = {
    ...(usage[skillId] ?? {}),
    pinned,
    state: asString(usage[skillId]?.state) || "active",
  };
  try {
    await mkdir(path.dirname(usagePath), { recursive: true });
    await writeUsage(usagePath, usage);
    return { ok: true, pinned };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Could not update Hermes Curator usage file: ${msg}`,
    };
  }
}

async function findPrimarySkillById(root: string, skillId: string): Promise<{
  dir: string;
  full: string;
  raw: string;
  name: string;
} | null> {
  const primaryDirs = await listSkillDirsRecursive(path.join(root, "skills"));
  for (const dir of primaryDirs) {
    const full = path.join(root, "skills", dir);
    const raw = await readFile(path.join(full, "SKILL.md"), "utf-8").catch(() => "");
    const name = skillNameFromMarkdown(raw, path.basename(dir));
    if (name === skillId) return { dir, full, raw, name };
  }
  return null;
}

export async function deleteHermesUserSkill(
  skillId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const root = getHermesDataDir();
  if (!root) return { ok: false, error: "HERMES_DATA_DIR is not configured." };
  if (!/^[a-zA-Z0-9._-]+$/.test(skillId)) {
    return { ok: false, error: "Invalid skill id." };
  }
  const bundled = await readBundledSkillNames(root);
  const hub = await readHubSkillNames(root);
  if (bundled.has(skillId) || hub.has(skillId)) {
    return { ok: false, error: "Bundled and hub skills cannot be deleted here." };
  }

  const hit = await findPrimarySkillById(root, skillId);
  if (!hit) return { ok: false, error: "Skill not found in the main library." };
  if (skillOwner(root, hit.dir, hit.name) !== "user") {
    return { ok: false, error: "HermesChat app skills are built in and cannot be deleted here." };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(root, "skills", ".archive", "deleted-by-user", stamp);
  const destination = path.join(archiveDir, hit.dir);
  const usagePath = path.join(root, "skills", ".usage.json");
  const usage = await readUsage(root);

  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(hit.full, destination);
    usage[skillId] = {
      ...(usage[skillId] ?? {}),
      pinned: false,
      state: "deleted",
      archived_at: new Date().toISOString(),
    };
    await writeUsage(usagePath, usage);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not delete skill: ${msg}` };
  }
}
