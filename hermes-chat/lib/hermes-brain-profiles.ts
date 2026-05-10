import { readdir, readFile } from "fs/promises";
import path from "path";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import {
  readProject,
  resolveProjectRoot,
  writeProjectArtifactFile,
} from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import type { WorkspaceVisibility } from "@/lib/project-paths";
import {
  HERMES_BRAIN_PEOPLE_PROFILES_PATH,
  type HermesBrainConfidence,
  type HermesBrainEvidenceRef,
  type HermesBrainPersonProfileRecord,
  type HermesBrainProfileClass,
  type HermesBrainVisibility,
} from "@/lib/hermes-brain-schema";
import {
  ensureHermesBrainDirs,
  makeHermesBrainId,
  readHermesBrainJsonl,
  writeHermesBrainJsonl,
} from "@/lib/hermes-brain-store";

export type CreatePeopleProfileRow = {
  id: string;
  name: string;
  profileClass: HermesBrainProfileClass;
  company: string;
  role: string;
  emails: string[];
  phones: string[];
  summary: string;
  vaultSlug: string;
  vaultName: string;
  evidencePaths: string[];
  confidence: HermesBrainConfidence;
  updatedAt: string;
};

export type ManualCreatePeopleProfileInput = {
  name: string;
  kind?: "clients" | "company";
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

function brainVisibility(
  projectSlug: string,
  visibility: WorkspaceVisibility
): HermesBrainVisibility {
  if (projectSlug === getOrgGlobalSlug()) return "org_global";
  return visibility;
}

function readableRoot(projectSlug: string, visibility: WorkspaceVisibility): string {
  const vis = brainVisibility(projectSlug, visibility);
  if (vis === "shared" || vis === "org_global") return `/vault-shared/${projectSlug}/`;
  return `projects/${projectSlug}/`;
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return (m?.[1] || fallback).trim();
}

function firstField(markdown: string, labels: string[]): string {
  const wanted = labels.map((label) => label.trim().toLowerCase());
  for (const line of markdown.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (wanted.some((label) => key === label || key.startsWith(`${label} `))) {
      return value;
    }
  }
  return "";
}

function cleanWikiValue(value: string): string {
  return value
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_m, slug: string, label?: string) =>
      String(label || slug).replace(/-/g, " ")
    )
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCompanyKey(raw: string): string {
  return cleanWikiValue(raw)
    .toLowerCase()
    .replace(/\b(?:ltd|limited|company|co|inc|llc|plc|2002)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourcePaths(markdown: string, root: string): HermesBrainEvidenceRef[] {
  const out: HermesBrainEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/-\s+`([^`]+)`/);
    if (!m?.[1]) continue;
    const rel = m[1].trim().replace(/^\/+/, "");
    const p = rel.startsWith("/vault-shared/") || rel.startsWith("projects/")
      ? rel
      : `${root}${rel}`;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({
      kind: p.includes("/extracted/") ? "extracted" : p.includes("/sources/") ? "source" : "wiki",
      path: p,
      confidence: "medium",
    });
  }
  return out;
}

function sectionBody(markdown: string, names: string[]): string {
  const wanted = names.map((name) => name.trim().toLowerCase());
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim().toLowerCase();
    if (heading) {
      if (inSection) break;
      inSection = wanted.includes(heading);
      continue;
    }
    if (inSection) out.push(line);
  }
  return out.join("\n").trim();
}

function extractBullets(markdown: string, limit = 4): string[] {
  const body =
    sectionBody(markdown, ["Relevant facts", "Notes", "Overview"]) || markdown;
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter((line) => line && !line.startsWith("`"))
    .slice(0, limit)
    .map(cleanWikiValue);
}

function extractSummary(markdown: string, fallback: string): string {
  const bullets = extractBullets(markdown);
  if (bullets.length > 0) return bullets[0];
  const body = sectionBody(markdown, ["Notes", "Overview", "Relevant facts"]);
  const paragraph = body
    .split(/\n{2,}/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("-"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .find(Boolean);
  return cleanWikiValue(paragraph || fallback);
}

function extractEmails(markdown: string): string[] {
  return [
    ...new Set(
      Array.from(markdown.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)).map((m) => m[0])
    ),
  ];
}

function extractPhones(markdown: string): string[] {
  const explicit = firstField(markdown, ["Phone", "Mobile", "Contact"]);
  const candidates = [
    explicit,
    ...Array.from(
      markdown.matchAll(/\b(?:\+?\d{1,3}[\s-]?)?(?:0\d{1,3}[\s-]?)?\d{3}[\s-]?\d{3,4}\b/g)
    ).map((m) => m[0]),
  ];
  return [
    ...new Set(
      candidates
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => /\d{7,}/.test(p.replace(/\D/g, "")))
    ),
  ].slice(0, 8);
}

function inferProfileClass(params: {
  projectSlug: string;
  orgCompanyKeys: Set<string>;
  companySlug: string;
  company: string;
}): HermesBrainProfileClass {
  if (params.projectSlug === getOrgGlobalSlug()) return "internal";
  const candidates = [
    params.company,
    params.companySlug,
    params.companySlug.replace(/-/g, " "),
  ]
    .map(normalizeCompanyKey)
    .filter(Boolean);
  if (
    candidates.some((candidate) =>
      [...params.orgCompanyKeys].some(
        (org) => candidate === org || candidate.includes(org) || org.includes(candidate)
      )
    )
  ) {
    return "internal";
  }
  if (params.companySlug) return "project_contact";
  return "unknown";
}

type OrgCompanyInfo = {
  keys: Set<string>;
  displayName: string;
};

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

async function writePeopleProfiles(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultRootAbs: string;
  profiles: HermesBrainPersonProfileRecord[];
}): Promise<void> {
  if (shouldUseArtifactBridge(params.visibility)) {
    const body = params.profiles.map((profile) => JSON.stringify(profile)).join("\n");
    await writeProjectArtifactFile(
      params.projectSlug,
      HERMES_BRAIN_PEOPLE_PROFILES_PATH,
      body ? `${body}\n` : "",
      { visibility: params.visibility }
    );
    return;
  }
  await writeHermesBrainJsonl(
    params.vaultRootAbs,
    HERMES_BRAIN_PEOPLE_PROFILES_PATH,
    params.profiles
  );
}

async function orgCompanyInfo(): Promise<OrgCompanyInfo> {
  const orgSlug = getOrgGlobalSlug();
  const project = await readProject(orgSlug).catch(() => null);
  if (!project) return { keys: new Set(), displayName: "" };
  const root = await resolveProjectRoot(orgSlug).catch(() => "");
  if (!root) return { keys: new Set(), displayName: "" };
  const dir = path.join(root, "wiki", "entities", "companies");
  try {
    const files = await readdir(dir);
    const keys = new Set<string>();
    let displayName = "";
    for (const file of files.filter((item) => item.endsWith(".md")).sort()) {
      const slug = file.replace(/\.md$/i, "");
      keys.add(normalizeCompanyKey(slug.replace(/-/g, " ")));
      const markdown = await readFile(path.join(dir, file), "utf8").catch(() => "");
      const title = titleFromMarkdown(markdown, slug.replace(/-/g, " "));
      if (!displayName && title) displayName = title;
      for (const value of [
        title,
        firstField(markdown, ["Official name used on website", "Official name", "Company"]),
      ]) {
        const key = normalizeCompanyKey(value);
        if (key) keys.add(key);
      }
    }
    return { keys, displayName };
  } catch {
    return { keys: new Set(), displayName: "" };
  }
}

type SupplementalPerson = {
  name: string;
  company: string;
  role: string;
  summary: string;
  emails: string[];
  phones: string[];
  evidence: HermesBrainEvidenceRef[];
  confidence: HermesBrainConfidence;
};

function tableCells(line: string): string[] {
  if (!line.trim().startsWith("|")) return [];
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) =>
      cleanWikiValue(
        cell
          .replace(/\*\*/g, "")
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/&nbsp;/g, " ")
          .trim()
      )
    );
}

function looksLikePersonName(raw: string): boolean {
  const name = raw.trim();
  if (!name || name.length > 80) return false;
  if (/^(role|name|hours|contract|project|technical|management|service|qualifications|training|profile|vitae)$/i.test(name)) {
    return false;
  }
  return /^[A-Z][A-Za-z'’-]+(?:\s+(?:de|van|von|te|[A-Z][A-Za-z'’-]+)){1,4}$/.test(name);
}

function splitPersonAndCompany(raw: string): { name: string; company: string } {
  const cleaned = cleanWikiValue(raw).replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { name: cleaned, company: "" };
  return { name: m[1].trim(), company: m[2].trim() };
}

function readableEvidencePath(root: string, relPath: string): string {
  return `${root}${relPath.replace(/^\/+/, "")}`;
}

function upsertSupplemental(
  map: Map<string, SupplementalPerson>,
  person: SupplementalPerson
): void {
  const key = slugifyName(person.name);
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, person);
    return;
  }
  const evidenceByPath = new Map(
    [...existing.evidence, ...person.evidence].map((item) => [item.path, item])
  );
  map.set(key, {
    ...existing,
    company: existing.company || person.company,
    role: existing.role || person.role,
    summary: existing.summary || person.summary,
    emails: [...new Set([...existing.emails, ...person.emails])],
    phones: [...new Set([...existing.phones, ...person.phones])],
    evidence: [...evidenceByPath.values()],
    confidence:
      existing.confidence === "high" || person.confidence === "high"
        ? "high"
        : existing.confidence === "medium" || person.confidence === "medium"
          ? "medium"
          : "low",
  });
}

function extractSupplementalPeopleFromMarkdown(params: {
  markdown: string;
  root: string;
  relPath: string;
  defaultInternalCompany: string;
}): SupplementalPerson[] {
  const people = new Map<string, SupplementalPerson>();
  const evidence: HermesBrainEvidenceRef = {
    kind: "extracted",
    path: readableEvidencePath(params.root, params.relPath),
    confidence: "medium",
  };
  let inRoleHoursTable = false;
  let inExperienceTable = false;

  for (const line of params.markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells.length === 0) {
      inRoleHoursTable = false;
      inExperienceTable = false;
      continue;
    }
    const lower = cells.map((cell) => cell.toLowerCase());
    if (lower[0] === "role" && lower[1] === "name") {
      inRoleHoursTable = true;
      inExperienceTable = false;
      continue;
    }
    if (lower[0]?.includes("contract/project experience")) {
      inExperienceTable = true;
      inRoleHoursTable = false;
      continue;
    }
    if (cells.every((cell) => /^-+$/.test(cell))) continue;

    if (inRoleHoursTable && cells.length >= 2 && looksLikePersonName(cells[1])) {
      upsertSupplemental(people, {
        name: cells[1],
        company: "",
        role: cells[0],
        summary: cells[2] ? `${cells[0]}, allocated ${cells[2]} hours per week.` : cells[0],
        emails: [],
        phones: [],
        evidence: [evidence],
        confidence: "medium",
      });
      continue;
    }

    if (!inExperienceTable) continue;
    const first = cells[0] ?? "";
    if (!looksLikePersonName(first.replace(/\s*\([^)]+\)\s*$/, ""))) continue;
    const { name, company } = splitPersonAndCompany(first);
    if (!looksLikePersonName(name)) continue;
    upsertSupplemental(people, {
      name,
      company,
      role: "",
      summary: company ? `Named in project personnel material for ${company}.` : "Named in project personnel material.",
      emails: [],
      phones: [],
      evidence: [evidence],
      confidence: "medium",
    });
  }

  return [...people.values()].map((person) => ({
    ...person,
    company: person.company || params.defaultInternalCompany,
  }));
}

function extractSupplementalPersonFromOcr(params: {
  text: string;
  root: string;
  relPath: string;
  existingCompany?: string;
}): SupplementalPerson | null {
  if (!/vitae|curriculum/i.test(params.text)) return null;
  const lines = params.text
    .split(/\r?\n/)
    .map((line) => cleanWikiValue(line).trim())
    .filter(Boolean);
  const nameIndex = lines.findIndex(looksLikePersonName);
  if (nameIndex < 0) return null;
  const name = lines[nameIndex];
  const role = lines
    .slice(nameIndex + 1, nameIndex + 4)
    .find((line) => line.length <= 80 && !/^(qualifications|training|technical|management|service|profile)$/i.test(line)) ?? "";
  const summary = lines
    .slice(nameIndex + 1)
    .join(" ")
    .split(/\bQualifications and Training\b/i)[0]
    ?.replace(role, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || role || "OCR profile card extracted from document media.";
  const company =
    params.existingCompany || "";
  return {
    name,
    company,
    role,
    summary,
    emails: extractEmails(params.text),
    phones: extractPhones(params.text),
    evidence: [
      {
        kind: "ocr",
        path: readableEvidencePath(params.root, params.relPath),
        confidence: "medium",
      },
    ],
    confidence: "medium",
  };
}

async function extractSupplementalPeople(params: {
  vaultRootAbs: string;
  root: string;
  defaultInternalCompany: string;
}): Promise<SupplementalPerson[]> {
  const people = new Map<string, SupplementalPerson>();
  const extractedDir = path.join(params.vaultRootAbs, "extracted");
  let entries: string[] = [];
  try {
    entries = await readdir(extractedDir);
  } catch {
    return [];
  }

  for (const entry of entries.sort()) {
    if (entry.endsWith(".md")) {
      const relPath = `extracted/${entry}`;
      const markdown = await readFile(path.join(extractedDir, entry), "utf8").catch(() => "");
      for (const person of extractSupplementalPeopleFromMarkdown({
        markdown,
        root: params.root,
        relPath,
        defaultInternalCompany: params.defaultInternalCompany,
      })) {
        upsertSupplemental(people, person);
      }
    }
  }

  for (const entry of entries.filter((item) => item.endsWith("_docx_media")).sort()) {
    const dir = path.join(extractedDir, entry);
    const mediaFiles = await readdir(dir).catch(() => []);
    for (const file of mediaFiles.filter((item) => item.endsWith(".ocr.txt")).sort()) {
      const relPath = `extracted/${entry}/${file}`;
      const text = await readFile(path.join(dir, file), "utf8").catch(() => "");
      const existing = people.get(slugifyName(extractLikelyNameFromText(text) || ""));
      const person = extractSupplementalPersonFromOcr({
        text,
        root: params.root,
        relPath,
        existingCompany: existing?.company,
      });
      if (person) upsertSupplemental(people, person);
    }
  }

  return [...people.values()];
}

function extractLikelyNameFromText(text: string): string | null {
  return (
    text
      .split(/\r?\n/)
      .map((line) => cleanWikiValue(line).trim())
      .find(looksLikePersonName) ?? null
  );
}

export async function rebuildPeopleProfilesForProject(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
}): Promise<HermesBrainPersonProfileRecord[]> {
  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  await ensureHermesBrainDirsForWrites(vaultRootAbs, params.visibility);
  const peopleDir = path.join(vaultRootAbs, "wiki", "entities", "people");
  const orgInfo = await orgCompanyInfo();
  const root = readableRoot(params.projectSlug, params.visibility);
  const now = new Date().toISOString();

  let files: string[] = [];
  try {
    files = (await readdir(peopleDir)).filter((file) => file.endsWith(".md"));
  } catch {
    await writePeopleProfiles({
      projectSlug: params.projectSlug,
      visibility: params.visibility,
      vaultRootAbs,
      profiles: [],
    });
    return [];
  }

  const existing = await readHermesBrainJsonl<HermesBrainPersonProfileRecord>(
    vaultRootAbs,
    HERMES_BRAIN_PEOPLE_PROFILES_PATH
  );
  const createdAtById = new Map(existing.map((p) => [p.id, p.createdAt]));

  const profiles: HermesBrainPersonProfileRecord[] = [];
  for (const file of files.sort()) {
    const relWikiPath = `wiki/entities/people/${file}`;
    const abs = path.join(peopleDir, file);
    const markdown = await readFile(abs, "utf8").catch(() => "");
    if (!markdown.trim()) continue;

    const name = titleFromMarkdown(markdown, file.replace(/\.md$/i, "").replace(/-/g, " "));
    const companyRaw = firstField(markdown, [
      "Organisation",
      "Organization",
      "Associated organisation",
      "Associated organization",
      "Company",
    ]);
    const roleRaw = firstField(markdown, ["Role", "Role in"]);
    const company = cleanWikiValue(companyRaw);
    const role = cleanWikiValue(roleRaw);
    const companySlug =
      companyRaw.match(/\[\[([^\]|]+)(?:\|[^\]]+)?]]/)?.[1]?.trim() ??
      slugifyName(company);
    const aliasesRaw = firstField(markdown, ["Aliases", "Alias"]);
    const aliases = [
      name,
      ...aliasesRaw
        .split(/[,;]/)
        .map(cleanWikiValue)
        .filter(Boolean),
    ];
    const profileClass = inferProfileClass({
      projectSlug: params.projectSlug,
      orgCompanyKeys: orgInfo.keys,
      companySlug,
      company,
    });
    const evidence = [
      {
        kind: "wiki" as const,
        path: `${root}${relWikiPath}`,
        confidence: "high" as const,
      },
      ...extractSourcePaths(markdown, root),
    ];
    const summary = extractSummary(
      markdown,
      role || company || "Person profile extracted from vault evidence."
    );
    const id = makeHermesBrainId("person", [params.projectSlug, name]);
    const companyEntityIds = company
      ? [makeHermesBrainId("company", [params.projectSlug, companySlug || company])]
      : [];

    profiles.push({
      id,
      kind: "person",
      vaultSlug: params.projectSlug,
      visibility: brainVisibility(params.projectSlug, params.visibility),
      createdAt: createdAtById.get(id) ?? now,
      updatedAt: now,
      canonicalName: name,
      aliases: [...new Set(aliases)],
      profileClass,
      summary,
      attributes: {
        company: company || null,
        sourceWikiPath: `${root}${relWikiPath}`,
      },
      evidence,
      confidence: evidence.length > 1 ? "high" : "medium",
      companyEntityIds,
      roleTitles: role ? [role] : [],
      emails: extractEmails(markdown),
      phones: extractPhones(markdown),
      projectEntityIds: [],
      cvEvidence: evidence.filter((item) => /cv|profile|people/i.test(item.path)),
    });
  }

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const supplementalPeople = await extractSupplementalPeople({
    vaultRootAbs,
    root,
    defaultInternalCompany: orgInfo.displayName || "",
  });
  for (const person of supplementalPeople) {
    const normalizedPersonName = slugifyName(person.name);
    const aliasHit = [...byId.values()].find((profile) =>
      profile.aliases.some((alias) => slugifyName(alias) === normalizedPersonName)
    );
    const id = aliasHit?.id ?? makeHermesBrainId("person", [params.projectSlug, person.name]);
    const existing = byId.get(id);
    const companySlug = slugifyName(person.company);
    const profileClass = inferProfileClass({
      projectSlug: params.projectSlug,
      orgCompanyKeys: orgInfo.keys,
      companySlug,
      company: person.company,
    });
    const evidenceByPath = new Map(
      [...(existing?.evidence ?? []), ...person.evidence].map((item) => [item.path, item])
    );
    byId.set(id, {
      id,
      kind: "person",
      vaultSlug: params.projectSlug,
      visibility: brainVisibility(params.projectSlug, params.visibility),
      createdAt: existing?.createdAt ?? createdAtById.get(id) ?? now,
      updatedAt: now,
      canonicalName: existing?.canonicalName ?? person.name,
      aliases: [...new Set([...(existing?.aliases ?? []), person.name])],
      profileClass:
        existing?.profileClass && existing.profileClass !== "unknown"
          ? existing.profileClass
          : profileClass,
      summary: existing?.summary || person.summary,
      attributes: {
        ...(existing?.attributes ?? {}),
        company:
          typeof existing?.attributes.company === "string" && existing.attributes.company
            ? existing.attributes.company
            : person.company || null,
      },
      evidence: [...evidenceByPath.values()],
      confidence:
        existing?.confidence === "high" || person.confidence === "high"
          ? "high"
          : existing?.confidence === "medium" || person.confidence === "medium"
            ? "medium"
            : "low",
      companyEntityIds:
        existing?.companyEntityIds?.length
          ? existing.companyEntityIds
          : person.company
            ? [makeHermesBrainId("company", [params.projectSlug, companySlug || person.company])]
            : [],
      roleTitles: [
        ...new Set([
          ...(existing?.roleTitles ?? []),
          ...(person.role ? [person.role] : []),
        ]),
      ],
      emails: [...new Set([...(existing?.emails ?? []), ...person.emails])],
      phones: [...new Set([...(existing?.phones ?? []), ...person.phones])],
      projectEntityIds: existing?.projectEntityIds ?? [],
      cvEvidence: [...evidenceByPath.values()].filter((item) =>
        /cv|profile|people|ocr/i.test(item.path)
      ),
    });
  }

  const sortedProfiles = [...byId.values()].sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName)
  );
  await writePeopleProfiles({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs,
    profiles: sortedProfiles,
  });
  return sortedProfiles;
}

export async function listCreatePeopleProfiles(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultName: string;
}): Promise<CreatePeopleProfileRow[]> {
  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  let profiles = await readHermesBrainJsonl<HermesBrainPersonProfileRecord>(
    vaultRootAbs,
    HERMES_BRAIN_PEOPLE_PROFILES_PATH
  );
  if (profiles.length === 0) {
    profiles = await rebuildPeopleProfilesForProject(params);
  }
  return profiles
    .map((profile) => ({
      id: profile.id,
      name: profile.canonicalName,
      profileClass: profile.profileClass,
      company:
        typeof profile.attributes.company === "string"
          ? profile.attributes.company
          : "",
      role: profile.roleTitles[0] ?? "",
      emails: profile.emails,
      phones: profile.phones,
      summary: profile.summary ?? "",
      vaultSlug: params.projectSlug,
      vaultName: params.vaultName,
      evidencePaths: profile.evidence.map((item) => item.path),
      confidence: profile.confidence,
      updatedAt: profile.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertManualCreatePeopleProfile(params: {
  projectSlug: string;
  visibility: WorkspaceVisibility;
  vaultName: string;
  input: ManualCreatePeopleProfileInput;
}): Promise<CreatePeopleProfileRow> {
  const vaultRootAbs = await resolveProjectRoot(params.projectSlug);
  const now = new Date().toISOString();
  const name = params.input.name.trim() || "Untitled profile";
  const company = params.input.company?.trim() ?? "";
  const role = params.input.role?.trim() ?? "";
  const email = params.input.email?.trim() ?? "";
  const phone = params.input.phone?.trim() ?? "";
  const notes = params.input.notes?.trim() ?? "";
  const visibility = brainVisibility(params.projectSlug, params.visibility);
  const id = makeHermesBrainId("person", [
    params.projectSlug,
    name,
    company,
    role,
  ]);
  const profiles = await readHermesBrainJsonl<HermesBrainPersonProfileRecord>(
    vaultRootAbs,
    HERMES_BRAIN_PEOPLE_PROFILES_PATH
  );
  const existing = profiles.find((profile) => profile.id === id);
  const record: HermesBrainPersonProfileRecord = {
    ...(existing ?? {
      id,
      kind: "person",
      vaultSlug: params.projectSlug,
      visibility,
      createdAt: now,
      sourceRunId: "manual-create-profile",
      aliases: [],
      companyEntityIds: [],
      projectEntityIds: [],
      cvEvidence: [],
    }),
    vaultSlug: params.projectSlug,
    visibility,
    updatedAt: now,
    canonicalName: name,
    profileClass:
      params.input.kind === "company" || params.projectSlug === getOrgGlobalSlug()
        ? "internal"
        : "project_contact",
    summary: notes,
    attributes: {
      ...(existing?.attributes ?? {}),
      company,
      manualProfile: true,
    },
    roleTitles: role ? [role] : [],
    emails: email ? [email] : [],
    phones: phone ? [phone] : [],
    evidence: [
      {
        kind: "profile",
        path: `${readableRoot(params.projectSlug, params.visibility)}brain/profiles/people.jsonl`,
        confidence: "high",
      },
    ],
    confidence: "high",
  };

  await writePeopleProfiles({
    projectSlug: params.projectSlug,
    visibility: params.visibility,
    vaultRootAbs,
    profiles: [...profiles.filter((profile) => profile.id !== id), record].sort((a, b) =>
      a.canonicalName.localeCompare(b.canonicalName)
    ),
  });

  return {
    id: record.id,
    name: record.canonicalName,
    profileClass: record.profileClass,
    company,
    role,
    emails: record.emails,
    phones: record.phones,
    summary: record.summary ?? "",
    vaultSlug: params.projectSlug,
    vaultName: params.vaultName,
    evidencePaths: record.evidence.map((item) => item.path),
    confidence: record.confidence,
    updatedAt: record.updatedAt,
  };
}
