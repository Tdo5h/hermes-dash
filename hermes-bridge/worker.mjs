import pg from "pg";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { execSync } from "child_process";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PROJECTS_ROOT = process.env.HERMES_PROJECTS_ROOT || "/opt/data/projects";
const SHARED_ROOT = process.env.HERMES_PROJECTS_SHARED_FS_ROOT?.trim();
const PRIVATE_ROOT = process.env.HERMES_PROJECTS_PRIVATE_FS_ROOT?.trim();
const STAGING = process.env.STAGING_DIR || "/var/vault-staging";
const UID = parseInt(process.env.HERMES_FS_UID || "10000", 10);
const GID = parseInt(process.env.HERMES_FS_GID || "1001", 10);
const VAULT_DIR_MODE = 0o2775;
const VAULT_MANIFEST_FILE = ".vault-manifest.json";

/** Match hermes-chat `lib/vault-templates.ts` schemaTemplate. */
function schemaTemplate(name) {
  return `# Project: ${name}

This vault follows **LLM Wiki** conventions (Karpathy-style, Obsidian-friendly): curated knowledge in \`wiki/\` with \`[[wikilinks]]\`, originals in \`sources/\`, extracted text in \`extracted/\`. See \`INDEX.md\` for the map of content and \`LOG.md\` for ingest history.

## Folder roles

| Path | Role |
|------|------|
| \`wiki/entities/people/\` | People (contact fields, relationships) |
| \`wiki/entities/companies/\` | Organisations, suppliers, clients |
| \`wiki/entities/projects/\` | Named projects, matters, jobs, engagements |
| \`wiki/entities/\` | Other named things (flat files OK) |
| \`wiki/concepts/\` | Ideas, standards, methods |
| \`wiki/comparisons/\` | A-vs-B, decisions |
| \`wiki/queries/\` | **Optional** cached answers — not source of truth; entities are canonical |
| \`branding/\` | Brand kit — canonical naming, colors, site, and product/service terms for \`BRAND_KIT.md\`; read before generated images |

## Entity-shaped notes (not document-shaped)

Entity files should read like **facts about the thing**, not a summary of one PDF.

- Use a short header: \`Type:\`, \`Location:\`, \`Relationship:\` where useful.
- Sections such as **Key people**, **Capabilities**, **Work history**, **Notes**.
- **Sources:** list the exact files that evidence facts. Keep bullets source-specific; Hermes uses them as a lightweight rollback ledger when an upload is removed.

## sources/ vs extracted/

- **sources/** — uploaded originals; do not replace others’ uploads without cause.
- **extracted/** — one canonical derived text per source **in this vault** (stable filenames).

Domain / intent for this vault. Update as you learn.

`;
}

/** Default architect ingest: structured wiki merge enabled (override with entity_extraction: minimal). */
function vaultProfileTemplate() {
  return `# HermesChat — default WikiVault profile (created by init_workspace)

# Shared-architect ingest: full entity/wiki mapping unless explicitly disabled.
entity_extraction: full
`;
}

function indexTemplate(name) {
  return `# Index — ${name}

_Created by HermesChat. Maintain this file during ingest._

## Router (query-oriented)

| Entity / topic | Primary note | Sources | Updated |
|----------------|--------------|---------|---------|
| _(add rows as you create notes)_ | \`wiki/…\` | \`sources/…\` | _(date)_ |

## Quick links

- \`SCHEMA.md\` — vault structure contract
- \`LOG.md\` — ingest history

`;
}

function projectDir(slug, visibility) {
  const v = visibility === "shared" ? "shared" : "private";
  if (v === "shared" && SHARED_ROOT) return path.join(SHARED_ROOT, slug);
  if (v === "private" && PRIVATE_ROOT) return path.join(PRIVATE_ROOT, slug);
  return path.join(PROJECTS_ROOT, slug);
}

function projectRelativePath(slug, ...segments) {
  return ["projects", slug, ...segments].join("/");
}

function vaultManifestPath(slug, visibility) {
  return path.join(projectDir(slug, visibility), "sources", VAULT_MANIFEST_FILE);
}

async function writeFileIfMissing(filePath, contents) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, contents, "utf-8");
  }
}

async function readVaultManifest(slug, visibility) {
  try {
    const raw = await fs.readFile(vaultManifestPath(slug, visibility), "utf-8");
    const j = JSON.parse(raw);
    if (j.files && typeof j.files === "object") return { files: j.files };
  } catch {
    /* new */
  }
  return { files: {} };
}

async function writeVaultManifest(slug, visibility, m) {
  const p = vaultManifestPath(slug, visibility);
  await fs.writeFile(p, JSON.stringify(m, null, 2), "utf-8");
  await fs.chmod(p, 0o640).catch(() => {});
  await fs.chown(p, UID, GID).catch(() => {});
}

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (sel.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const id = sel.rows[0].id;
    await client.query(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");
    const full = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
    return full.rows[0];
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function initWorkspace(job) {
  const { slug, name, visibility: visRaw } = job.payload;
  const visibility = visRaw === "shared" ? "shared" : "private";
  const root = projectDir(slug, visibility);
  await fs.mkdir(path.join(root, "sources"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "extracted"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "entities"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "entities", "people"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "entities", "companies"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "entities", "projects"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "concepts"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "comparisons"), { recursive: true, mode: VAULT_DIR_MODE });
  await fs.mkdir(path.join(root, "wiki", "queries"), { recursive: true, mode: VAULT_DIR_MODE });

  const meta = { name, slug, createdAt: Date.now(), visibility };
  const pj = path.join(root, "project.json");
  await fs.writeFile(pj, JSON.stringify(meta, null, 2), "utf-8");

  await writeFileIfMissing(path.join(root, "SCHEMA.md"), schemaTemplate(name));
  await writeFileIfMissing(path.join(root, "INDEX.md"), indexTemplate(name));
  await writeFileIfMissing(path.join(root, "LOG.md"), `# Log — ${name}\n\n`);
  await writeFileIfMissing(path.join(root, "vault_profile.yaml"), vaultProfileTemplate());

  execSync(`chown -R ${UID}:${GID} ${root}`, { stdio: "ignore" });
  execSync(`chmod -R g+rwX ${root}`, { stdio: "ignore" });
  try {
    execSync(`find ${root} -type d -exec chmod g+s {} +`, { stdio: "ignore" });
  } catch {
    /* */
  }

  await pool.query(`UPDATE workspace_projects SET tree_initialized = true WHERE slug = $1`, [slug]);
  return { slug, name, ok: true };
}

async function deleteWorkspace(job) {
  const { slug, visibility: visRaw } = job.payload;
  if (typeof slug !== "string" || !slug.trim()) {
    throw new Error("delete_workspace: invalid slug");
  }
  const visibility = visRaw === "shared" ? "shared" : "private";
  const root = projectDir(slug, visibility);
  await fs.rm(root, { recursive: true, force: true });
  return { ok: true, slug, root };
}

async function materializeUpload(job) {
  const {
    projectSlug,
    stagingId,
    originalName,
    sha256,
    sizeBytes,
    visibility: visPayload,
    assetRole: assetRolePayload,
    contextProjectSlug: contextProjectSlugPayload,
  } = job.payload;
  const assetRole =
    typeof assetRolePayload === "string" && assetRolePayload.trim()
      ? assetRolePayload.trim()
      : null;
  const contextProjectSlug =
    typeof contextProjectSlugPayload === "string" && contextProjectSlugPayload.trim()
      ? contextProjectSlugPayload.trim()
      : null;
  let visibility = visPayload === "shared" ? "shared" : visPayload === "private" ? "private" : null;
  if (!visibility) {
    const r = await pool.query(`SELECT visibility FROM workspace_projects WHERE slug = $1`, [
      projectSlug,
    ]);
    visibility = r.rows[0]?.visibility === "shared" ? "shared" : "private";
  }
  const stagingPath = path.join(STAGING, stagingId);
  const buf = await fs.readFile(stagingPath);
  if (typeof sizeBytes === "number" && buf.length !== sizeBytes) {
    throw new Error(`staging size mismatch: expected ${sizeBytes} got ${buf.length}`);
  }
  const hex =
    typeof sha256 === "string" && /^[a-f0-9]{64}$/i.test(sha256)
      ? sha256.toLowerCase()
      : createHash("sha256").update(buf).digest("hex");

  const base =
    path.basename(String(originalName || "upload")).replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const dest = path.join(projectDir(projectSlug, visibility), "sources", base);
  const relativePath = projectRelativePath(projectSlug, "sources", base);

  await fs.mkdir(path.dirname(dest), { recursive: true, mode: VAULT_DIR_MODE });

  const manifest = await readVaultManifest(projectSlug, visibility);
  let duplicatePath = null;
  for (const [p, entry] of Object.entries(manifest.files || {})) {
    if (entry.sha256 === hex) {
      duplicatePath = p;
      break;
    }
  }
  const duplicate = duplicatePath !== null;
  const prevEntry = manifest.files[relativePath];
  const samePathSameHash = prevEntry?.sha256 === hex;
  let skippedWrite = false;
  if (samePathSameHash) {
    skippedWrite = true;
  } else {
    await fs.writeFile(dest, buf);
    await fs.chmod(dest, 0o640).catch(() => {});
    await fs.chown(dest, UID, GID).catch(() => {});
  }

  manifest.files[relativePath] = {
    sha256: hex,
    size: buf.length,
    updatedAt: Date.now(),
  };
  await writeVaultManifest(projectSlug, visibility, manifest);

  const now = Date.now();
  await pool.query(
    `INSERT INTO vault_assets (project_slug, relative_path, file_name, sha256, size_bytes, status, created_at, asset_role, context_project_slug)
     VALUES ($1, $2, $3, $4, $5, 'materialized', $6, $7, $8)
     ON CONFLICT (project_slug, relative_path) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       sha256 = EXCLUDED.sha256,
       size_bytes = EXCLUDED.size_bytes,
       status = 'materialized',
       created_at = EXCLUDED.created_at,
       asset_role = EXCLUDED.asset_role,
       context_project_slug = EXCLUDED.context_project_slug`,
    [projectSlug, relativePath, base, hex, buf.length, now, assetRole, contextProjectSlug]
  );

  await fs.unlink(stagingPath).catch(() => {});

  return {
    relativePath,
    fileName: base,
    duplicate,
    duplicatePath,
    skippedWrite,
  };
}

function resolveProjectVisibility(projectSlug, visPayload) {
  let visibility = visPayload === "shared" ? "shared" : visPayload === "private" ? "private" : null;
  if (!visibility) {
    return pool
      .query(`SELECT visibility FROM workspace_projects WHERE slug = $1`, [projectSlug])
      .then((r) => (r.rows[0]?.visibility === "shared" ? "shared" : "private"));
  }
  return Promise.resolve(visibility);
}

/**
 * @returns {Promise<"shared"|"private">}
 */
async function getVisibilityForJob(projectSlug, visPayload) {
  return resolveProjectVisibility(projectSlug, visPayload);
}

function assertPathUnderDir(absFile, mustBeUnder) {
  const resolved = path.resolve(absFile);
  const root = path.resolve(mustBeUnder);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("path escape: " + absFile);
  }
}

function normalizeVaultArtifactRelPath(raw) {
  const rel = String(raw || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.startsWith("./") || rel.startsWith("../")) {
    throw new Error("write_vault_artifact: invalid relativePath");
  }
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("write_vault_artifact: invalid relativePath");
  }
  if (!parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("write_vault_artifact: unsafe path segment");
  }
  const normalized = parts.join("/");
  const allowed =
    normalized.startsWith("brain/") ||
    normalized.startsWith("index/") ||
    normalized.startsWith("templates/") ||
    normalized.startsWith("scoring/") ||
    normalized.startsWith("branding/") ||
    normalized.startsWith("segments/") ||
    normalized.startsWith("extracted/") ||
    normalized.startsWith("wiki/") ||
    ["INDEX.md", "LOG.md", "SCHEMA.md", "vault_profile.yaml"].includes(normalized);
  if (!allowed) {
    throw new Error("write_vault_artifact: artifact path is not writable");
  }
  return normalized;
}

async function writeVaultArtifact(job) {
  const { projectSlug, visibility: visPayload, relativePath, content } = job.payload;
  if (typeof projectSlug !== "string" || !projectSlug.trim()) {
    throw new Error("write_vault_artifact: invalid projectSlug");
  }
  const visibility = await getVisibilityForJob(projectSlug, visPayload);
  const rel = normalizeVaultArtifactRelPath(relativePath);
  const text = typeof content === "string" ? content : JSON.stringify(content ?? null, null, 2) + "\n";
  const root = projectDir(projectSlug, visibility);
  const dest = path.join(root, rel);
  assertPathUnderDir(dest, root);
  await fs.mkdir(path.dirname(dest), { recursive: true, mode: VAULT_DIR_MODE });
  const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, text, "utf-8");
  await fs.chmod(tmp, 0o640).catch(() => {});
  await fs.chown(tmp, UID, GID).catch(() => {});
  await fs.rename(tmp, dest);
  await fs.chmod(dest, 0o640).catch(() => {});
  await fs.chown(dest, UID, GID).catch(() => {});
  return {
    ok: true,
    projectSlug,
    visibility,
    relativePath: rel,
    sizeBytes: Buffer.byteLength(text, "utf8"),
  };
}

/**
 * Read index/ingest_manifest.json: top-level array of entries (possibly empty).
 */
function normalizeIngestManifest(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.entries)) return raw.entries;
  return [];
}

async function walkMarkdownFiles(root, relDir) {
  const base = path.join(root, relDir);
  const out = [];
  async function walk(absDir, relPrefix) {
    let entries = [];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        out.push({ abs, rel: `${relDir}/${rel}`.replace(/\\/g, "/") });
      }
    }
  }
  await walk(base, "");
  return out;
}

function sourceReferenceNeedles(base, entries) {
  const raw = new Set([
    base,
    `sources/${base}`,
    `extracted/${base}.md`,
    `extracted/${base}.meta.json`,
    `extracted/${base}.extraction_map.json`,
    `extracted/${base}.quality.json`,
    `segments/${base}.md.jsonl`,
    `segments/${base}.jsonl`,
  ]);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    for (const key of [
      "source_file",
      "source_path",
      "extracted_path",
      "segment_path",
      "scoring_path",
      "outline_path",
      "structure_path",
    ]) {
      const v = entry[key];
      if (typeof v === "string" && v.trim()) raw.add(v.replace(/\\/g, "/"));
    }
    const src = typeof entry.source_file === "string" && entry.source_file.trim()
      ? entry.source_file.trim()
      : base;
    const stem = path.posix.parse(src).name;
    if (String(entry.ingest_kind || "") === "scoring_criteria" || entry.scoring_path) {
      raw.add(`scoring/${stem}/extracted.md`);
      raw.add(`scoring/${stem}/BLURB.md`);
      raw.add(`scoring/${stem}/meta.json`);
    }
    if (String(entry.ingest_kind || "") === "output_template" || entry.template_stem) {
      const tStem = entry.template_stem && typeof entry.template_stem === "string" ? entry.template_stem : stem;
      raw.add(`templates/${tStem}/outline.md`);
      raw.add(`templates/${tStem}/structure.yaml`);
    }
    if (String(entry.ingest_kind || "") === "company_branding") {
      raw.add("branding/BRAND_KIT.md");
    }
  }
  return [...raw]
    .map((s) => String(s || "").replace(/\\/g, "/").replace(/^\/+/, "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function lineReferencesRemovedSource(line, needles) {
  const normalized = line.replace(/\\/g, "/");
  return needles.some((needle) => normalized.includes(needle));
}

function cleanupSourceReferencesFromMarkdown(content, needles) {
  const lines = content.split(/\n/);
  const out = [];
  let inSources = false;
  let removedLines = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      inSources = /^sources\b/i.test(heading[2].trim());
    }
    const sourceLikeBullet =
      /^\s*(?:[-*+]|\d+\.)\s+/.test(line) &&
      /\b(?:sources|extracted|segments|scoring|templates|branding)\//i.test(line);
    const sourceLikeTable =
      /^\s*\|/.test(line) &&
      /\b(?:sources|extracted|segments|scoring|templates|branding)\//i.test(line);
    if (
      lineReferencesRemovedSource(line, needles) &&
      (inSources || sourceLikeBullet || sourceLikeTable)
    ) {
      removedLines += 1;
      continue;
    }
    out.push(line);
  }
  const next = out.join("\n").replace(/\n{4,}/g, "\n\n\n");
  return {
    content: next,
    removedLines,
    stillReferencesRemovedSource: lineReferencesRemovedSource(next, needles),
  };
}

async function mirrorKnowledgeDoc(projectSlug, docPath, content) {
  await pool.query(
    `INSERT INTO workspace_knowledge_docs (project_slug, doc_path, content, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_slug, doc_path)
     DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`,
    [projectSlug, docPath, content, Date.now()]
  );
}

async function cleanupWikiSourceReferences({ root, projectSlug, base, entries, dryRun }) {
  const needles = sourceReferenceNeedles(base, entries);
  const candidates = [
    ...(await walkMarkdownFiles(root, "wiki")),
    ...(await walkMarkdownFiles(root, "branding")),
  ];
  const cleaned = [];
  const remainingReferences = [];
  for (const file of candidates) {
    let current = "";
    try {
      current = await fs.readFile(file.abs, "utf-8");
    } catch {
      continue;
    }
    if (!lineReferencesRemovedSource(current, needles)) continue;
    const next = cleanupSourceReferencesFromMarkdown(current, needles);
    if (next.removedLines > 0) {
      cleaned.push({ path: file.rel, removedLines: next.removedLines });
      if (!dryRun) {
        await fs.writeFile(file.abs, next.content, "utf-8");
        await fs.chmod(file.abs, 0o640).catch(() => {});
        await fs.chown(file.abs, UID, GID).catch(() => {});
        await mirrorKnowledgeDoc(projectSlug, file.rel, next.content).catch(() => {});
      }
    }
    if (next.stillReferencesRemovedSource) {
      remainingReferences.push(file.rel);
    }
  }
  return { cleaned, remainingReferences, needles };
}

/**
 * Remove source + all ingest manifest derivatives for that source; update manifest, LOG, INDEX, Postgres.
 * Payload: { projectSlug, relativePath, visibility? optional, dryRun?: boolean }
 */
async function undoVaultIngest(job) {
  const { projectSlug, relativePath: relRaw, visibility: visPayload, dryRun: dryRunRaw } = job.payload;
  const dryRun = dryRunRaw === true;
  const visibility = await getVisibilityForJob(projectSlug, visPayload);
  const root = projectDir(projectSlug, visibility);
  const rel = String(relRaw || "").replace(/\\/g, "/").trim();
  if (!rel || !rel.includes("/sources/")) {
    throw new Error("undo_vault_ingest: invalid relativePath");
  }
  const base = path.posix.basename(rel);
  if (!base || base.startsWith(".") || base === "sources") {
    throw new Error("undo_vault_ingest: invalid basename");
  }
  const sourcesDir = path.join(root, "sources");
  const sourceAbs = path.join(sourcesDir, base);
  assertPathUnderDir(sourceAbs, sourcesDir);

  const ingManifestPath = path.join(root, "index", "ingest_manifest.json");
  let allEntries = [];
  try {
    const raw = await fs.readFile(ingManifestPath, "utf-8");
    allEntries = normalizeIngestManifest(JSON.parse(raw));
  } catch {
    allEntries = [];
  }

  const baseEq = (a, b) => path.posix.basename(String(a)) === path.posix.basename(String(b));
  const matched = allEntries.filter((e) => e && baseEq(e.source_file || "", base));
  const remaining = allEntries.filter((e) => !e || !baseEq(e.source_file || "", base));

  const deleted = [];
  const warnings = [];
  const docPathsForDb = new Set();

  const tryUnlink = async (abs, label) => {
    try {
      await fs.lstat(abs);
    } catch {
      warnings.push(`missing: ${label}`);
      return;
    }
    if (dryRun) {
      deleted.push(`(dry-run) would delete ${label}`);
      return;
    }
    try {
      const st = await fs.lstat(abs);
      if (st.isDirectory()) {
        await fs.rm(abs, { recursive: true, force: true });
      } else {
        await fs.unlink(abs);
      }
      deleted.push(label);
    } catch (e) {
      warnings.push(`unlink ${label}: ${e}`);
    }
  };

  const addRelDocPath = (relUnix) => {
    if (!relUnix || relUnix.includes("..")) return;
    const n = relUnix.replace(/\\/g, "/").replace(/^\/+/, "");
    if (n.startsWith("wiki/") || n.startsWith("extracted/") || n === "INDEX.md" || n === "LOG.md") {
      docPathsForDb.add(n);
    }
  };

  const wikiCleanup = await cleanupWikiSourceReferences({
    root,
    projectSlug,
    base,
    entries: matched,
    dryRun,
  });
  for (const relPath of wikiCleanup.remainingReferences) {
    warnings.push(`wiki still references removed source: ${relPath}`);
  }

  for (const entry of matched) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.segment_path && typeof entry.segment_path === "string") {
      const p = path.join(root, entry.segment_path.replace(/\\/g, "/"));
      assertPathUnderDir(p, root);
      const relL = path.relative(root, p).replace(/\\/g, "/");
      addRelDocPath(relL);
      await tryUnlink(p, relL);
    }
    if (entry.scoring_path && typeof entry.scoring_path === "string") {
      const p = path.join(root, entry.scoring_path.replace(/\\/g, "/"));
      assertPathUnderDir(p, root);
      const relL = path.relative(root, p).replace(/\\/g, "/");
      addRelDocPath(relL);
      await tryUnlink(p, relL);
    }
    const srcFile = String(entry.source_file || base);
    const stem = path.posix.parse(srcFile).name;

    if (String(entry.ingest_kind || "") === "scoring_criteria" || entry.scoring_path) {
      const scoreDir = path.join(root, "scoring", stem);
      assertPathUnderDir(scoreDir, root);
      for (const f of ["extracted.md", "BLURB.md", "meta.json"].map((f) => path.join(scoreDir, f))) {
        const relL = path.relative(root, f).replace(/\\/g, "/");
        addRelDocPath(relL);
        await tryUnlink(f, relL);
      }
      await tryUnlink(scoreDir, `scoring/${stem}/ (dir)`);
    }

    if (String(entry.ingest_kind || "") === "output_template" || entry.template_stem) {
      const tStem = entry.template_stem && typeof entry.template_stem === "string" ? entry.template_stem : stem;
      const tDir = path.join(root, "templates", tStem);
      assertPathUnderDir(tDir, root);
      await tryUnlink(tDir, `templates/${tStem}/ (dir)`);
    }

    const exMd = path.join(root, "extracted", `${srcFile}.md`);
    const exMeta = path.join(root, "extracted", `${srcFile}.meta.json`);
    assertPathUnderDir(exMd, root);
    assertPathUnderDir(exMeta, root);
    addRelDocPath(`extracted/${srcFile}.md`);
    addRelDocPath(`extracted/${srcFile}.meta.json`);
    await tryUnlink(exMd, `extracted/${srcFile}.md`);
    await tryUnlink(exMeta, `extracted/${srcFile}.meta.json`);

    if (!entry.segment_path) {
      const seg1 = path.join(root, "segments", `${srcFile}.md.jsonl`);
      const seg2 = path.join(root, "segments", `${srcFile}.jsonl`);
      for (const [p, lab] of [
        [seg1, `segments/${srcFile}.md.jsonl`],
        [seg2, `segments/${srcFile}.jsonl`],
      ]) {
        assertPathUnderDir(p, root);
        addRelDocPath(lab);
        await tryUnlink(p, lab);
      }
    }
  }

  if (matched.length === 0) {
    warnings.push(
      "no ingest_manifest entry for this source; still removing conventional extracted/segments if present and source file"
    );
    const exMd = path.join(root, "extracted", `${base}.md`);
    const exMeta = path.join(root, "extracted", `${base}.meta.json`);
    for (const [p, lab] of [
      [exMd, `extracted/${base}.md`],
      [exMeta, `extracted/${base}.meta.json`],
      [path.join(root, "segments", `${base}.md.jsonl`), `segments/${base}.md.jsonl`],
      [path.join(root, "segments", `${base}.jsonl`), `segments/${base}.jsonl`],
    ]) {
      assertPathUnderDir(p, root);
      const relL = lab;
      if (relL.startsWith("extracted/")) addRelDocPath(relL);
      await tryUnlink(p, relL);
    }
  }

  if (!dryRun) {
    await fs.mkdir(path.join(root, "index"), { recursive: true, mode: VAULT_DIR_MODE });
    await fs.writeFile(ingManifestPath, JSON.stringify(remaining, null, 2) + "\n", "utf-8");
    await fs.chmod(ingManifestPath, 0o640).catch(() => {});
    await fs.chown(ingManifestPath, UID, GID).catch(() => {});

    const stamp = new Date().toISOString();
    const logPath = path.join(root, "LOG.md");
    const wikiNote =
      wikiCleanup.cleaned.length > 0
        ? `; source references removed from ${wikiCleanup.cleaned.length} wiki/brand note${wikiCleanup.cleaned.length === 1 ? "" : "s"}`
        : "";
    const remainingNote =
      wikiCleanup.remainingReferences.length > 0
        ? `; ${wikiCleanup.remainingReferences.length} note${wikiCleanup.remainingReferences.length === 1 ? "" : "s"} still mention this source and need review`
        : "";
    const line = `\n- ${stamp} — **Removed ingest** for source \`sources/${base}\` (undo); manifest entry cleared${wikiNote}${remainingNote}.\n`;
    await fs.appendFile(logPath, line, "utf-8");
    await fs.chmod(logPath, 0o640).catch(() => {});
    await fs.chown(logPath, UID, GID).catch(() => {});

    const indexPath = path.join(root, "INDEX.md");
    const indexNote = `\n\n_Router: removed ingest for \`sources/${base}\` (${stamp.slice(0, 10)})._\n`;
    try {
      await fs.appendFile(indexPath, indexNote, "utf-8");
      await fs.chmod(indexPath, 0o640).catch(() => {});
      await fs.chown(indexPath, UID, GID).catch(() => {});
    } catch {
      warnings.push("INDEX.md append failed (missing file is ok)");
    }
  } else {
    deleted.push(`(dry-run) would rewrite index/ingest_manifest.json (${matched.length} entries → ${remaining.length} rows)`);
  }

  if (!dryRun) {
    await fs.unlink(sourceAbs).catch(() => {
      warnings.push("source file already absent (continuing)");
    });
    const vm = await readVaultManifest(projectSlug, visibility);
    if (vm.files[rel]) {
      delete vm.files[rel];
      await writeVaultManifest(projectSlug, visibility, vm);
    }
  }

  if (!dryRun) {
    await pool.query(`DELETE FROM vault_assets WHERE project_slug = $1 AND relative_path = $2`, [
      projectSlug,
      rel,
    ]);
    await pool.query(
      `DELETE FROM vault_ingest_auto_state WHERE project_slug = $1 AND source_relative_path = $2`,
      [projectSlug, rel]
    );
    const dps = [...docPathsForDb];
    if (dps.length > 0) {
      await pool.query(
        `DELETE FROM workspace_knowledge_docs WHERE project_slug = $1 AND doc_path = ANY($2::text[])`,
        [projectSlug, dps]
      );
    }
    await pool.query(
      `DELETE FROM workspace_knowledge_docs WHERE project_slug = $1 AND (doc_path = $2::text OR doc_path = $3::text)`,
      [projectSlug, `extracted/${base}.md`, `extracted/${base}.meta.json`]
    );
  }

  return {
    ok: true,
    relativePath: rel,
    fileName: base,
    manifestEntriesRemoved: matched.length,
    deleted,
    warnings,
    wikiSourceReferencesCleaned: wikiCleanup.cleaned,
    wikiStillReferencingSource: wikiCleanup.remainingReferences,
    dryRun,
  };
}

async function deleteVaultSource(job) {
  const { projectSlug, relativePath, visibility: visPayload } = job.payload;
  const visibility = await getVisibilityForJob(projectSlug, visPayload);
  const rel = String(relativePath || "").replace(/\\/g, "/").trim();
  if (!rel || !rel.includes("/sources/")) {
    throw new Error("delete_vault_source: invalid relativePath");
  }
  const base = path.posix.basename(rel);
  if (!base || base.startsWith(".") || base === "sources") {
    throw new Error("delete_vault_source: invalid basename");
  }
  const dest = path.join(projectDir(projectSlug, visibility), "sources", base);
  const resolved = path.resolve(dest);
  const sourcesRoot = path.resolve(path.join(projectDir(projectSlug, visibility), "sources"));
  if (!resolved.startsWith(sourcesRoot + path.sep) && resolved !== sourcesRoot) {
    throw new Error("delete_vault_source: path escape");
  }
  await fs.unlink(resolved).catch(() => {});

  const manifest = await readVaultManifest(projectSlug, visibility);
  if (manifest.files[rel]) {
    delete manifest.files[rel];
    await writeVaultManifest(projectSlug, visibility, manifest);
  }

  await pool.query(
    `DELETE FROM vault_assets WHERE project_slug = $1 AND relative_path = $2`,
    [projectSlug, rel]
  );

  return { ok: true, relativePath: rel, fileName: base };
}

async function appendSharedVaultLog(job) {
  const { projectSlug, line } = job.payload;
  const r = await pool.query(`SELECT visibility FROM workspace_projects WHERE slug = $1`, [
    projectSlug,
  ]);
  const visibility = r.rows[0]?.visibility === "shared" ? "shared" : "private";
  if (visibility !== "shared") {
    throw new Error("append_shared_vault_log: project is not shared");
  }
  const text = typeof line === "string" ? line : String(line || "");
  if (!text.trim()) throw new Error("append_shared_vault_log: empty line");
  const root = projectDir(projectSlug, "shared");
  const logPath = path.join(root, "LOG.md");
  const stamp = new Date().toISOString();
  const chunk = `\n- ${stamp} — ${text.trim()}\n`;
  await fs.appendFile(logPath, chunk, "utf-8");
  await fs.chmod(logPath, 0o640).catch(() => {});
  await fs.chown(logPath, UID, GID).catch(() => {});
  return { ok: true };
}

async function completeJob(id, result) {
  await pool.query(
    `UPDATE jobs SET status = 'completed', result = $2::jsonb, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result)]
  );
}

async function failJob(id, err) {
  await pool.query(
    `UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, String(err).slice(0, 2000)]
  );
}

async function loop() {
  for (;;) {
    let job;
    try {
      job = await claimJob();
    } catch (e) {
      console.error("[bridge] claim", e);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    try {
      let result;
      if (job.type === "init_workspace") {
        result = await initWorkspace(job);
      } else if (job.type === "materialize_upload") {
        result = await materializeUpload(job);
      } else if (job.type === "delete_vault_source") {
        result = await deleteVaultSource(job);
      } else if (job.type === "undo_vault_ingest") {
        result = await undoVaultIngest(job);
      } else if (job.type === "append_shared_vault_log") {
        result = await appendSharedVaultLog(job);
      } else if (job.type === "write_vault_artifact") {
        result = await writeVaultArtifact(job);
      } else if (job.type === "delete_workspace") {
        result = await deleteWorkspace(job);
      } else {
        throw new Error(`unknown job type: ${job.type}`);
      }
      await completeJob(job.id, result);
    } catch (e) {
      console.error("[bridge] job failed", job?.id, e);
      await failJob(job.id, e);
    }
  }
}

console.log("[hermes-bridge] starting", {
  PROJECTS_ROOT,
  SHARED_ROOT: SHARED_ROOT || null,
  PRIVATE_ROOT: PRIVATE_ROOT || null,
  STAGING,
});
loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
