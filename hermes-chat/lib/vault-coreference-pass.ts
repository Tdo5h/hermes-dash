import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import path from "path";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { writeProjectArtifactFile } from "@/lib/project-service";
import type { WorkspaceVisibility } from "@/lib/project-paths";
import {
  type CoreferenceMention,
  type CoreferenceRelatedEdge,
  type CoreferenceTopic,
  type VaultCoreferenceFile,
  VAULT_COREFERENCE_REL_PATH,
  VAULT_COREFERENCE_SCHEMA_VERSION,
} from "@/lib/vault-coreference-schema";

type ManifestRow = {
  source_file?: string;
  segment_path?: string;
  ingest_kind?: string;
};

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function segmentPathToExtractedRel(segmentPath: string): string | null {
  const p = segmentPath.trim();
  if (!p.startsWith("segments/") || !p.endsWith(".jsonl")) return null;
  const mid = p.slice("segments/".length, -".jsonl".length);
  return `extracted/${mid}`;
}

async function existsFile(abs: string): Promise<boolean> {
  try {
    const st = await stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

/** Recursive markdown paths under vault root; skips dot dirs and noisy trees. */
async function listMarkdownFiles(
  vaultRoot: string,
  subdir: string
): Promise<string[]> {
  const out: string[] = [];
  const base = path.join(vaultRoot, subdir);
  let entries: string[] = [];
  try {
    entries = await readdir(base);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const abs = path.join(base, name);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    const relFromVault = toPosix(path.relative(vaultRoot, abs));
    if (st.isDirectory()) {
      if (
        name === "_docx_media" ||
        name === "_pptx_media" ||
        name === "node_modules"
      ) {
        continue;
      }
      const nested = await listMarkdownFiles(vaultRoot, relFromVault);
      out.push(...nested);
      continue;
    }
    if (st.isFile() && name.endsWith(".md")) {
      out.push(relFromVault);
    }
  }
  return out;
}

async function readManifestRows(vaultRoot: string): Promise<ManifestRow[]> {
  const abs = path.join(vaultRoot, "index", "ingest_manifest.json");
  if (!(await existsFile(abs))) return [];
  try {
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ManifestRow[]) : [];
  } catch {
    return [];
  }
}

function pushMentionUnique(topic: CoreferenceTopic, m: CoreferenceMention): void {
  if (topic.mentions.some((x) => x.path === m.path && x.kind === m.kind)) return;
  topic.mentions.push(m);
}

function pushRelatedUnique(topic: CoreferenceTopic, e: CoreferenceRelatedEdge): void {
  if (
    topic.related.some(
      (x) => x.to_canonical_id === e.to_canonical_id && x.provenance === e.provenance
    )
  ) {
    return;
  }
  topic.related.push(e);
}

function firstHeadingMd(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim() : null;
}

/** Paths like `extracted/foo.md` from backticks or markdown links. */
function harvestExtractedRefs(content: string): string[] {
  const found = new Set<string>();
  const tickRe = /`([^`]+\.md)`/g;
  let tm: RegExpExecArray | null;
  while ((tm = tickRe.exec(content)) !== null) {
    const p = tm[1].trim().replace(/^\.\//, "");
    if (p.startsWith("extracted/") && p.endsWith(".md")) found.add(p);
  }
  const linkRe = /\]\(([^)]+\.md)\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(content)) !== null) {
    const p = lm[1].trim().replace(/^\.\//, "");
    if (p.startsWith("extracted/") && p.endsWith(".md")) found.add(p);
  }
  return [...found];
}

function wikiLinkTargets(content: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

function normalizeLinkKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function basenameSlugLower(rel: string): string {
  const base = path.posix.basename(rel, ".md");
  return normalizeLinkKey(base);
}

/** Atomic write for JSON next to vault root index/. */
async function atomicWriteJson(absFinal: string, data: unknown): Promise<void> {
  const dir = path.dirname(absFinal);
  await mkdir(dir, { recursive: true });
  const tmp = `${absFinal}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, absFinal);
}

function shouldUseArtifactBridge(visibility?: WorkspaceVisibility): boolean {
  return visibility === "private" && shouldUseChatDatabase();
}

async function appendLogEvidenceMapLine(params: {
  vaultRoot: string;
  vaultSlug: string;
  visibility?: WorkspaceVisibility;
}): Promise<void> {
  const { vaultRoot, vaultSlug, visibility } = params;
  const abs = path.join(vaultRoot, "LOG.md");
  const iso = new Date().toISOString();
  const line = `- ${iso.split("T")[0]} evidence_map v${VAULT_COREFERENCE_SCHEMA_VERSION} rebuilt (\`${VAULT_COREFERENCE_REL_PATH}\`).`;
  try {
    const prev = await readFile(abs, "utf8");
    const sep = prev.endsWith("\n") ? "" : "\n";
    const next = `${prev}${sep}${line}\n`;
    if (shouldUseArtifactBridge(visibility)) {
      await writeProjectArtifactFile(vaultSlug, "LOG.md", next, { visibility });
    } else {
      await writeFile(abs, next, "utf8");
    }
  } catch {
    const next = `# LOG\n\n${line}\n`;
    if (shouldUseArtifactBridge(visibility)) {
      await writeProjectArtifactFile(vaultSlug, "LOG.md", next, { visibility });
    } else {
      await writeFile(abs, next, "utf8");
    }
  }
}

export type RunVaultCoreferencePassOpts = {
  vaultRootAbs: string;
  vaultSlug: string;
  visibility?: WorkspaceVisibility;
};

/**
 * Deterministic harvest: manifest bundles, wiki/extracted cross-refs, wikilinks.
 * No LLM — inferred edges are tagged explicitly.
 */
export async function runVaultCoreferencePass(
  opts: RunVaultCoreferencePassOpts
): Promise<VaultCoreferenceFile | null> {
  const vaultRoot = path.resolve(opts.vaultRootAbs);
  let rootStat;
  try {
    rootStat = await stat(vaultRoot);
  } catch {
    console.warn("[vault-coreference-pass] vault root missing:", vaultRoot);
    return null;
  }
  if (!rootStat.isDirectory()) return null;

  const topicsById = new Map<string, CoreferenceTopic>();

  function ensureTopic(canonical_id: string): CoreferenceTopic {
    let t = topicsById.get(canonical_id);
    if (!t) {
      t = { canonical_id, aliases: [], mentions: [], related: [] };
      topicsById.set(canonical_id, t);
    }
    return t;
  }

  const manifestRows = await readManifestRows(vaultRoot);

  const claimedExtracted = new Set<string>();

  for (const row of manifestRows) {
    const seg = row.segment_path?.trim();
    if (!seg) continue;
    const extractedRel = segmentPathToExtractedRel(seg);
    if (!extractedRel) continue;
    claimedExtracted.add(extractedRel);
    const topic = ensureTopic(extractedRel);
    pushMentionUnique(topic, {
      path: extractedRel,
      kind: "extracted",
      audit: "extracted",
    });
    pushMentionUnique(topic, {
      path: seg,
      kind: "segment",
      audit: "extracted",
    });
    const src = row.source_file?.trim();
    if (src) {
      pushMentionUnique(topic, {
        path: `sources/${src}`,
        kind: "source",
        audit: "extracted",
      });
    }
    pushMentionUnique(topic, {
      path: "index/ingest_manifest.json",
      kind: "manifest",
      audit: "extracted",
    });
  }

  const extractedMds = await listMarkdownFiles(vaultRoot, "extracted");
  for (const rel of extractedMds) {
    if (!rel.endsWith(".md")) continue;
    if (claimedExtracted.has(rel)) continue;
    const topic = ensureTopic(rel);
    pushMentionUnique(topic, {
      path: rel,
      kind: "extracted",
      audit: "extracted",
    });
  }

  const wikiByBasename = new Map<string, string[]>();
  const wikiPaths = await listMarkdownFiles(vaultRoot, "wiki");
  for (const wp of wikiPaths) {
    const k = basenameSlugLower(wp);
    const arr = wikiByBasename.get(k) ?? [];
    arr.push(wp);
    wikiByBasename.set(k, arr);
  }

  function resolveWikiLink(target: string): string | null {
    const key = normalizeLinkKey(target);
    const hits = wikiByBasename.get(key);
    if (hits?.length === 1) return hits[0];
    return null;
  }

  for (const wikiRel of wikiPaths) {
    const absWiki = path.join(vaultRoot, wikiRel);
    let content = "";
    try {
      content = await readFile(absWiki, "utf8");
    } catch {
      continue;
    }
    const citedExtracted = harvestExtractedRefs(content);
    const heading = firstHeadingMd(content);

    const wikiTopic = ensureTopic(wikiRel);
    pushMentionUnique(wikiTopic, {
      path: wikiRel,
      kind: "wiki",
      audit: "extracted",
    });
    if (heading && !wikiTopic.aliases.includes(heading)) {
      wikiTopic.aliases.push(heading);
    }

    for (const er of citedExtracted) {
      const bundleTopic = ensureTopic(er);
      pushMentionUnique(bundleTopic, {
        path: wikiRel,
        kind: "wiki",
        audit: "extracted",
      });
      pushRelatedUnique(bundleTopic, {
        to_canonical_id: wikiRel,
        audit: "extracted",
        provenance: "wiki_sources_section",
      });
      pushRelatedUnique(wikiTopic, {
        to_canonical_id: er,
        audit: "extracted",
        provenance: "wiki_sources_section",
      });
    }

    for (const wl of wikiLinkTargets(content)) {
      const resolved = resolveWikiLink(wl);
      if (!resolved || resolved === wikiRel) continue;
      const fromTopic = ensureTopic(wikiRel);
      pushRelatedUnique(fromTopic, {
        to_canonical_id: resolved,
        audit: "inferred",
        provenance: `wikilink:${wl}`,
      });
    }
  }

  const idxAbs = path.join(vaultRoot, "INDEX.md");
  if (await existsFile(idxAbs)) {
    try {
      const idx = await readFile(idxAbs, "utf8");
      const idxTopic = ensureTopic("INDEX.md");
      pushMentionUnique(idxTopic, {
        path: "INDEX.md",
        kind: "index_router",
        audit: "extracted",
      });
      for (const er of harvestExtractedRefs(idx)) {
        const t = ensureTopic(er);
        pushRelatedUnique(idxTopic, {
          to_canonical_id: t.canonical_id,
          audit: "inferred",
          provenance: "INDEX.md_pointer",
        });
      }
    } catch {
      /* skip */
    }
  }

  const scoringFiles = await listMarkdownFiles(vaultRoot, "scoring");
  for (const sr of scoringFiles) {
    if (!/\/extracted\.md$/.test(sr.replace(/\\/g, "/"))) continue;
    const topic = ensureTopic(sr);
    pushMentionUnique(topic, {
      path: sr,
      kind: "scoring",
      audit: "extracted",
    });
  }

  const templateFiles = await listMarkdownFiles(vaultRoot, "templates");
  for (const tr of templateFiles) {
    const topic = ensureTopic(tr);
    pushMentionUnique(topic, {
      path: tr,
      kind: "template",
      audit: "extracted",
    });
  }

  const doc: VaultCoreferenceFile = {
    schema_version: VAULT_COREFERENCE_SCHEMA_VERSION,
    vault_slug: opts.vaultSlug,
    generated_at: new Date().toISOString(),
    topics: [...topicsById.values()].sort((a, b) =>
      a.canonical_id.localeCompare(b.canonical_id)
    ),
  };

  if (shouldUseArtifactBridge(opts.visibility)) {
    await writeProjectArtifactFile(
      opts.vaultSlug,
      VAULT_COREFERENCE_REL_PATH,
      `${JSON.stringify(doc, null, 2)}\n`,
      { visibility: opts.visibility }
    );
  } else {
    const outAbs = path.join(vaultRoot, ...VAULT_COREFERENCE_REL_PATH.split("/"));
    await atomicWriteJson(outAbs, doc);
  }
  await appendLogEvidenceMapLine({
    vaultRoot,
    vaultSlug: opts.vaultSlug,
    visibility: opts.visibility,
  });

  return doc;
}
