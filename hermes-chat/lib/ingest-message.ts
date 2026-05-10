/** Shared between API and client — builds the post-upload chat instruction for the agent. */

import { LLM_WIKI_INGEST_DIRECTIVE } from "@/lib/llm-wiki-conventions";
import type { WorkspaceVisibility } from "@/lib/project-paths";

export type VaultAssetRole =
  | "general_reference"
  | "output_template"
  | "org_global"
  | "scoring_criteria"
  | "company_branding"
  /** @deprecated UI maps to organization library (`org_global`). */
  | "supporting_context";

/** Full product descriptions for UI (paste modal, pickers). */
export const ASSET_ROLE_LABEL: Record<VaultAssetRole, string> = {
  general_reference:
    "Knowledge — facts, notes, policies, people, projects, decisions, procedures, and reference material Hermes should understand and reuse",
  output_template:
    "Style / structure — section order, layout, headings, tone, and voice only; the body is not treated as the authoritative fact base",
  org_global:
    "Organization library — org-wide material in the org-global vault (same general ingest pipeline as vault knowledge, shared catalog)",
  scoring_criteria:
    "Review rules — requirements, standards, checklists, grading rules, or decision criteria; kept separate from ordinary background knowledge",
  company_branding:
    "Brand details — canonical visuals and naming for this vault; written under `branding/BRAND_KIT.md`; use before `image_generate` and shared-facing visuals so names, colors, and product or service terms match the real org (not invented)",
  supporting_context:
    "Organization library — org-wide shared reference material (legacy role; same as org_global)",
};

/** Normalize form / legacy values to a canonical role for automation and metadata. */
export function normalizeVaultAssetRole(raw: unknown): VaultAssetRole {
  if (typeof raw !== "string" || !raw.trim()) return "general_reference";
  const t = raw.trim();
  if (t === "supporting_context") return "org_global";
  if (
    t === "general_reference" ||
    t === "output_template" ||
    t === "org_global" ||
    t === "scoring_criteria" ||
    t === "company_branding"
  )
    return t;
  return "general_reference";
}

/** Extra instructions for org-global uploads (provenance + scope). */
const ORG_GLOBAL_DIRECTIVE = [
  "Organization library ingest:",
  "- Run the same extract → segment → manifest → INDEX / LOG pipeline as other shared vault knowledge.",
  "- This file belongs in the **organization-wide** shared vault; retrieval may span all tenant vaults.",
  "- When **contextVaultSlug** is present in the user message or metadata, append **LOG.md** with that slug (vault the upload came from) so operators can trace provenance.",
  "- Do not treat this material as private to a single job unless the user message says otherwise.",
].join("\n");

/** Instructions for layout/tone templates — structure-first, not factual RAG. */
const OUTPUT_TEMPLATE_INGEST_DIRECTIVE = [
  "Layout-and-tone template ingest (not factual RAG body):",
  "- Preserve **section order**, **heading hierarchy**, **list/table patterns**, **paragraph rhythm**, and **tone markers** (formality, voice, boilerplate vs narrative blocks).",
  "- **Do not** treat narrative body text as authoritative facts for a specific job; it illustrates **shape and voice** only.",
  "- After `extract.py`, write under `/vault-shared/<slug>/templates/<source_stem>/`:",
  "  - `outline.md` — numbered outline + heading map mirroring the document.",
  "  - `structure.yaml` — machine-readable `sections[]` with `title`, `level`, `role` (`boilerplate` | `narrative` | `data_table` | `other`), and optional `notes_on_tone` per section.",
  "- **Skip** default `segment.py` / `segments/*.jsonl` for factual RAG on this source (no generic JSONL chunks for retrieval). Optional: a single manifest line noting `chunk_kind: template_layout` is unnecessary for MVP — rely on `structure.yaml` + `outline.md`.",
  "- Update **INDEX.md** with a row pointing at `templates/<source_stem>/`; append **LOG.md** describing template structure outputs.",
].join("\n");

/** Per-vault review-rule docs — isolated under `scoring/`, not general RAG. */
const SCORING_CRITERIA_DIRECTIVE = [
  "Review rules ingest (per-vault only — not organization library):",
  "- Produce **`projects/<slug>/extracted/<filename>.md`** (and `.meta.json` if your pipeline writes it) by running the app's unified extractor at **`/opt/data/skills/note-taking/unified-vault-ingest/scripts/extract.py`** when available. Spreadsheets go through the same extractor/fallback chain. **Never** use `python3 -c` (see below).",
  "- Create **`scoring/<source_stem>/`** at the vault root with:",
  "  - **`extracted.md`** — copy or mirror the full body of **`extracted/<filename>.md`** (this is what the LLM will read for checks against these rules).",
  "  - **`BLURB.md`** — short description; prefer **verbatim user notes** from this message when present; if notes are empty, one factual sentence describing the document is OK.",
  "  - **`meta.json`** — include `source_relative_path`, `asset_role: scoring_criteria`, and `upload_notes` when the user provided notes.",
  "- **Do not** merge this content into **`wiki/`** as general entities. **Do not** write **`segments/<this_source>.jsonl`** for default vault RAG (no `segment.py` for this role).",
  "- Maintain **`scoring/README.md`** listing each `<source_stem>` (or add a clearly labelled **Review rules** subsection in **INDEX.md**). Append **LOG.md** with role `scoring_criteria` and paths.",
  "`<source_stem>` matches the **`extracted/`** peer: basename of **`extracted/<name>.md`** **without** the trailing `.md` (e.g. `extracted/Image_Link.xlsx.md` → **`scoring/Image_Link.xlsx/`**).",
  "**HermesChat terminal (mandatory):** **`python3 -c '...'`** and similar **inline** Python are **blocked** (`approval_required`) — there is no approval UI here. **Always** use **`write_file`** to **`/tmp/extract_<stem>.py`** then **`terminal`:** `python3 /tmp/extract_<stem>.py`, **or** a heredoc script saved to a file then executed. For **reading** uploads from Python on the gateway, use absolute **`/opt/data/projects/<slug>/sources/<file>`** when needed.",
].join("\n");

/** Appended after generic LLM wiki ingest for scoring uploads only — narrows obligations. */
const LLM_WIKI_SCORING_INGEST_SUPPLEMENT = [
  "**This upload is scoring_criteria (overrides generic wiki-ingest bullets above for THIS message):**",
  "- **Do not** create **`wiki/entities/...`** or concept notes from this file. The durable home is **`scoring/<stem>/`** so later turns can **check drafts against these rules**.",
  "- Still update **`INDEX.md`** (Review rules section or row) and **`LOG.md`** so operators and the model can find `scoring/<stem>/`.",
  "- Finish only when **`scoring/<stem>/extracted.md`**, **`BLURB.md`**, and **`meta.json`** exist and you **`read_file`**-verified them.",
].join("\n");

/** Canonical brand kit for imaging and comms — isolated under `branding/`, complements wiki entities. */
const COMPANY_BRANDING_INGEST_DIRECTIVE = [
  "Brand details / visual identity ingest (per-vault — canonical brand kit for `image_generate` and shared-facing visuals):",
  "- Create or update **`branding/BRAND_KIT.md`** at the vault root (private: `projects/<slug>/branding/…`; shared: `/vault-shared/<slug>/branding/…`). This file is the **single primary surface** the assistant must read before generating images in this vault.",
  "- **From this message:** use pasted text and/or the uploaded file under **`sources/…`**. When a file is present, run the usual **`extract.py`** path so **`extracted/…`** exists, then **merge** salient facts into `BRAND_KIT.md` with **Sources** bullets pointing at `sources/…` and `extracted/…`.",
  "- **`BRAND_KIT.md` sections:** Legal / trading name; industry or use area; **official website URL**; short brand voice; **colors** (hex if known); typography notes; **approved product, service, model, and asset names** (verbatim from user or extracted text — **never invent** names); logo/mark usage constraints; **Sources** (paths).",
  "- **Image prompts (mandatory subsection in `BRAND_KIT.md`):** state that before **`image_generate`** the assistant **must** read this file; use **only** names and terms listed here; do not fabricate logos, model numbers, or competitor marks; prefer neutral imagery if a fact is missing. Note vault default: generated images aim for **realistic / photorealistic** styling unless this kit or the **user explicitly** specifies otherwise.",
  "- If a **website URL** appears in the pasted text or user notes, call **`web_search`** when available to supplement **public** positioning, product lines, and visual cues — add brief attributed notes to `BRAND_KIT.md`; do not invent private or credential data.",
  "- Optionally merge non-contradictory facts into **`wiki/entities/companies/…`** only when a matching entity note already exists (**merge** + **Sources**); imaging still grounds on **`branding/BRAND_KIT.md`** first.",
  "- Add or update an **INDEX.md** row for `branding/BRAND_KIT.md`; append **LOG.md** with `asset_role: company_branding` and paths.",
].join("\n");

/** Shared between API and client — builds the post-upload chat instruction for the agent. */
export function buildIngestUserMessage(params: {
  projectSlug: string;
  projectName: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  userNotes?: string;
  assetRole?: VaultAssetRole;
  /** Vault slug the user was in when uploading into org-global (LOG provenance). */
  contextVaultSlug?: string;
  duplicate?: boolean;
  duplicatePath?: string;
  /** When `shared`, ingest text explains `/vault-shared/…` gateway paths (split FS in Docker). */
  workspaceVisibility?: WorkspaceVisibility;
  /**
   * Manual **re-ingest** from HermesChat: verify/repair only — merge into existing wiki,
   * refresh missing `extracted/` / `segments/` / role paths, do not clone entities.
   */
  reingestVerify?: boolean;
}): string {
  const {
    projectSlug,
    projectName,
    fileName,
    relativePath,
    mimeType,
    userNotes,
    assetRole: rawRole,
    contextVaultSlug,
    duplicate,
    duplicatePath,
    workspaceVisibility = "private",
    reingestVerify = false,
  } = params;

  const assetRole = normalizeVaultAssetRole(rawRole ?? "general_reference");
  const roleLine = `How to use this file: ${ASSET_ROLE_LABEL[assetRole]}`;

  const templateDirectiveBlock =
    assetRole === "output_template" ? OUTPUT_TEMPLATE_INGEST_DIRECTIVE : null;

  const orgGlobalBlock =
    assetRole === "org_global" ? ORG_GLOBAL_DIRECTIVE : null;

  const scoringBlock =
    assetRole === "scoring_criteria" ? SCORING_CRITERIA_DIRECTIVE : null;

  const brandingBlock =
    assetRole === "company_branding" ? COMPANY_BRANDING_INGEST_DIRECTIVE : null;

  const contextLine =
    assetRole === "org_global" && contextVaultSlug?.trim()
      ? `Upload context: file was added from vault slug \`${contextVaultSlug.trim()}\` (record in LOG.md).`
      : null;

  const dupLine =
    reingestVerify
      ? "Re-ingest mode: **verify and repair** only — the source is already in this vault. **Do not** create duplicate `wiki/entities/…` files for the same real-world thing; **merge** into existing notes and refresh **Sources**."
      : duplicate
        ? duplicatePath
          ? `Note: This upload matches existing vault content (${duplicatePath}). Re-run ingest to refresh extracted text and wiki; do not duplicate wiki entities.`
          : "Note: This upload matches existing vault content. Re-run ingest to refresh extracted text and wiki; do not duplicate wiki entities."
        : null;

  const notesBlock =
    userNotes && userNotes.trim()
      ? ["User instructions for this file:", userNotes.trim(), ""].join("\n")
      : null;

  const sharedGatewayNote =
    workspaceVisibility === "shared"
      ? [
          "",
          "**Gateway filesystem (shared vault):** uploads for this vault live under **`/vault-shared/" +
            projectSlug +
            "/`** on the Hermes gateway (same tree HermesChat uses). Use **`/vault-shared/" +
            projectSlug +
            "/…`** for **read_file** / **write_file** / **search_files** — not `projects/" +
            projectSlug +
            "/…` (that prefix maps to the tenant private vault on the gateway, which is a different directory).",
          "",
        ]
      : [];

  const metaContext =
    assetRole === "org_global" && contextVaultSlug?.trim()
      ? ` contextVaultSlug=${contextVaultSlug.trim()}`
      : "";

  const openLine = reingestVerify
    ? `**Re-ingest / verify** (manual) for vault "${projectName}" — confirm outputs for an **existing** file still under \`sources/\` after other edits or partial deletes.`
    : `New file uploaded to vault "${projectName}".`;

  const lines = [
    openLine,
    "",
    `File: ${fileName}`,
    `Path: ${relativePath}`,
    `Vault: ${projectSlug}`,
    ...sharedGatewayNote,
    roleLine,
    "",
    ...(contextLine ? [contextLine, ""] : []),
    ...(templateDirectiveBlock ? [templateDirectiveBlock, ""] : []),
    ...(orgGlobalBlock ? [orgGlobalBlock, ""] : []),
    ...(scoringBlock ? [scoringBlock, ""] : []),
    ...(brandingBlock ? [brandingBlock, ""] : []),
    ...(dupLine ? [dupLine, ""] : []),
    ...(notesBlock ? [notesBlock] : []),
    ...(assetRole === "scoring_criteria"
      ? []
      : workspaceVisibility === "shared"
        ? [
            "**Vault profile:** Default for shared vaults is **`entity_extraction: full`** — merge salient people, organizations, projects, dates, decisions, and reusable facts into **`wiki/entities/...`** with **Sources** bullets. Set **`entity_extraction: minimal`** in `vault_profile.yaml` only if you intentionally want lighter wiki churn.",
            "",
          ]
        : [
            "**Vault profile:** Default for vaults is **`entity_extraction: full`** — merge salient people, organizations, projects, dates, decisions, and reusable facts into **`wiki/entities/...`** with **Sources** bullets. Set **`entity_extraction: minimal`** in `vault_profile.yaml` only if you want lighter wiki churn.",
            "",
          ]),
    reingestVerify
      ? "**Task:** Verify/repair this source using the app-native vault ingest contract for the asset role: **read** current `INDEX.md`, `index/ingest_manifest.json` for this source, and existing `extracted/` / role paths. **Re-run** `extract.py` / `segment.py` (when that branch uses them) **only** if files are missing, empty, or clearly wrong. **Update** the INDEX row and **append** `LOG.md` with `reingest_verify` and what you fixed or confirmed."
      : assetRole === "scoring_criteria"
        ? "Please ingest this review-rules document into **`scoring/<stem>/`** (and `extracted/` as needed), update **INDEX.md** / **LOG.md**, and **do not** treat it as general wiki knowledge."
        : "Please ingest this document and update the project wiki.",
    "Undo safety: if wiki or brand notes are touched, keep Sources bullets source-specific and record touched note paths in `index/ingest_manifest.json` as `wiki_paths`.",
    "",
    LLM_WIKI_INGEST_DIRECTIVE,
    "",
    ...(assetRole === "scoring_criteria" && !reingestVerify
      ? [LLM_WIKI_SCORING_INGEST_SUPPLEMENT, ""]
      : []),
    reingestVerify
      ? `[metadata: action=reingest_verify projectId=${projectSlug} fileType=${mimeType} assetRole=${assetRole}${metaContext}]`
      : `[metadata: action=ingest projectId=${projectSlug} fileType=${mimeType} assetRole=${assetRole}${metaContext}${duplicate ? " duplicate=1" : ""}]`,
  ];

  return lines.join("\n");
}
