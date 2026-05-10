/**
 * Karpathy-style “LLM Wiki” steering for Hermes: Obsidian-friendly markdown, linked notes,
 * and clear vault layout. Single source of truth for vault system prompts and ingest messages.
 *
 * Retrieval: v1 is agent-side (`search_files` + INDEX → wiki → extracted). Deferred ideas (FTS /
 * embeddings / scoped `query_project`) stay out of HermesChat until router-first v1 proves insufficient.
 */

/** Appended to every vault-bound chat system prompt (see `activeWorkspaceSystemPrompt` in project-prompt.ts). */
export const LLM_WIKI_WORKSPACE_CONVENTIONS = [
  "LLM Wiki conventions (Obsidian-style vault):",
  "- **On disk:** all markdown for `extracted/`, `wiki/`, root `INDEX.md`, `LOG.md`, and `SCHEMA.md` lives under the vault tree. **Private** vaults: paths under `projects/<slug>/` (Hermes home `/opt/data`). **Shared** vaults (split FS): the gateway uses **`/vault-shared/<slug>/…`** — follow the active vault system prompt for which prefix applies.",
  "- **Tool calls:** use normal Hermes **gateway tools** (same class as `read_file`). Invoke **read_file** / **write_file** as **direct tool calls** in the agent loop. **Do not** use `execute_code` or `from hermes_tools import …` for vault file I/O — the sandbox does not mirror those APIs reliably.",
  "- **After every `write_file`:** run a **verification pass** — immediately **`read_file`** the same path (or `terminal` `test -f` / `stat`) and confirm before reporting success. If verification fails, report failure; do not claim the file exists.",
  "- sources/: canonical originals (don’t edit others’ uploads without cause); cite with path and page/section when possible. HermesChat lists `sources/` as **Vault files** (upload inventory). **Still paste the main answer in the chat**; optional saves here are extras, not a substitute for the message body.",
  "- **HTML / static demos:** Save as `write_file` → `projects/<slug>/sources/<name>.html` (or project root if required). **Do not** instruct users to run localhost dev servers or tunnels. In the reply, give **`[name](/api/projects/<slug>/file?name=name)`** plus backticks **`projects/<slug>/sources/name`** so HermesChat shows Download + Preview — **avoid pasting multi‑screen HTML/SVG into the chat body** unless the user explicitly asked for inline source.",
  "- When the user asks for drafts (letters, reports, submissions, summaries, or other documents), ground organisation-specific facts in this vault and this chat only — do not import identity or credentials from global Hermes memory if they are not evidenced here.",
  "- extracted/: one **canonical** derived text per source **in this vault** (stable filenames); mirror `sources/` names or a clear scheme.",
  "- **segments/** (JSONL chunks): optional for **you** in chat. Use after **INDEX.md** points there, or when you need **fine-grained quotes** from chunk text. **Primary** chunk surface for **embedding / future FTS** pipelines — not the first thing to read for normal Q&A (prefer INDEX → wiki → extracted).",
  "- **Named entities (wiki-first):** Questions about a **specific person, organisation, or project** named in this vault — **`search_files`** / **INDEX.md** → **`wiki/entities/…`** (people/companies/projects) **before** relying on one **`extracted/*.md`** fragment or a single OCR block. Open the entity note (create/update via ingest when missing) and **merge everything listed under Sources** — **`extracted/`** text, **`extracted/*_docx_media/`** where profile or table images matter, **`extracted/<stem>.extraction_map.json`** and **`extracted/<stem>.quality.json`** when present — then answer. Do **not** stop at the first matching chunk.",
  "- wiki/: curated markdown only — small atomic notes where practical; use [[wikilinks]] between notes; prefer stable paths under `wiki/entities/people/`, `wiki/entities/companies/`, `wiki/entities/projects/` when applicable.",
  "- wiki/entities/: people, orgs, products, concrete named things (typed subfolders optional but recommended).",
  "- wiki/concepts/: ideas, definitions, frameworks.",
  "- wiki/comparisons/: contrasts, A-vs-B, decision notes.",
  "- wiki/queries/: **optional** cached answers / scratch — **not** the source of truth; entities are canonical.",
  "- **scoring/:** review rules live under **`scoring/<stem>/`** (`extracted.md`, `BLURB.md`, `meta.json`). When **drafting, reviewing, comparing, or checking** work against requirements, standards, checklists, grading rules, or decision criteria, **read_file** there — not general `wiki/`. Ingest for `asset_role: scoring_criteria` writes here so the LLM can compare deliverables to the right rules.",
  "- **branding/:** when `branding/BRAND_KIT.md` exists, **read_file** it **before** `image_generate` or other shared-facing visuals in this vault. Use **only** names, colors, and product, service, or asset terms from that file (plus evidenced `wiki/` and org-library material); do not fabricate marks, logos, or model numbers.",
  "- **Image style (vault default):** For **`image_generate`** and **`image_edit`** while this vault is bound, assume **realistic / photorealistic** output unless the **user explicitly** asks for a different look (cartoon, flat illustration, diagram, infographic, watercolor, sketch, pixel art, etc.). Natural lighting, believable materials, and photography- or faithful-3D-render aesthetics are the default for vault-related deliverables. If **`branding/BRAND_KIT.md`** requires a fixed non-realistic visual language for the brand, follow the kit; explicit user wording still wins.",
  "- For lookups: **read_file** `projects/<slug>/SCHEMA.md` and `projects/<slug>/INDEX.md` first, then **`wiki/` entity notes** when the topic is a concrete named thing, then related `projects/<slug>/wiki/*` paths before leaning on full PDF dumps under `projects/<slug>/sources/`. If **read_file** says not-found for `projects/<slug>/…`, retry with `/opt/data/projects/<slug>/…` before concluding files are missing.",
  "- When ingesting or updating knowledge, maintain INDEX.md as a router (entity → primary note → sources) and append a one-line entry to LOG.md.",
  "- **Bottom-up synthesis:** merge new facts into **existing** entity notes when the same real-world person/org/project appears; avoid duplicate entity files — update the note and add a **Sources** bullet. One `extracted/` file per upload per vault.",
].join("\n");

/** Appended to file and plain-text ingest user messages (ingest-message.ts). */
export const LLM_WIKI_INGEST_DIRECTIVE = [
  "Ingest obligation (LLM Wiki): do not stop at a chat-only summary.",
  "- Persist all markdown with **write_file** under the vault (one write per path: extracted/…, wiki/…, branding/… when applicable, INDEX.md, LOG.md, SCHEMA.md when changed).",
  "- Use **write_file** as a **native gateway tool** (not inside `execute_code`).",
  "- After each **write_file**, immediately **read_file** that path (verification pass) before moving on; only report paths you verified.",
  "- Report each path you wrote.",
  "- **Entity-shaped notes:** write facts about the **thing** (person, company, project), not a prose summary of a single PDF. Prefer updating an existing `wiki/entities/...` file when the entity already exists.",
  "- **Sources (mandatory for entity pages):** each entity note under `wiki/entities/...` should end with a **Sources** section: bullet lines with paths to **`extracted/...` markdown**, **`sources/...`** originals when relevant, **`extracted/<stem>.extraction_map.json`** and **`extracted/<stem>.quality.json`** when ingest produced them, **`extracted/*_docx_media/`** image paths when OCR or screenshots carry facts (e.g. profile photos, tables), and OCR transcript paths referenced by the map — so nothing lives “only” in a sidecar. Keep the note the **canonical** place for facts; extracted/ is the full-text mirror of the upload.",
  "- **Undo-safe source ledger:** keep Sources bullets source-specific. Do not bundle unrelated uploads into one vague source line. These source bullets are the lightweight rollback ledger Hermes uses when a user removes an upload and its generated outputs.",
  "- **Merge:** if the document mentions an entity that already has a note, **read** that file first, then **merge** new facts and extend **Sources** — do not create a second competing file for the same entity.",
  "- **Router:** add or update a row in **INDEX.md** so the next turn can find this source, extracted path, and any entity/wiki stub; append **LOG.md** with one line.",
].join("\n");
