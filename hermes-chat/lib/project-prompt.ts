import { LLM_WIKI_WORKSPACE_CONVENTIONS } from "@/lib/llm-wiki-conventions";
import type { WorkspaceVisibility } from "@/lib/project-paths";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";

/**
 * Strong vault-only grounding. Hermes also injects global memory (e.g. USER.md); this block
 * tells the model not to treat that as factual context for vault-bound deliverables.
 */
function workspaceVaultOnlyGroundingLines(
  projectSlug: string,
  workspaceVisibility: WorkspaceVisibility
): string {
  const orgLibSlug = getOrgGlobalSlug();
  const orgLibPath = "`/vault-shared/" + orgLibSlug + "/`";
  const vaultPathLine =
    workspaceVisibility === "shared"
      ? "- **Primary** factual content for this project: **`/vault-shared/" +
        projectSlug +
        "/`** — prefer **`brain/retrieval/router.json`**, **`extracted/`** and **`wiki/`**, then **`scoring/`**, **`INDEX.md` / `SCHEMA.md` / `LOG.md`**, then **`sources/`**. **Also authorized (only other routine corpus):** the **organization library** at " +
        orgLibPath +
        " (**organization-wide reference**: who you are, tone, priorities, how the org works — use to **frame** replies alongside this vault; not a substitute for project-specific facts). Use **read_file** / **search_files** with **absolute** `/vault-shared/…` paths (logical `projects/" +
        projectSlug +
        "/…` maps to this project tree on the gateway — **not** `/opt/data/projects/" +
        projectSlug +
        "/` for shared vaults)."
      : "- **Primary** factual content: **`projects/" +
        projectSlug +
        "/`** — prefer **`brain/retrieval/router.json`**, **`extracted/`** and **`wiki/`**, then **`scoring/`**, **`INDEX.md` / `SCHEMA.md` / `LOG.md`**, then **`sources/`**. **Also authorized (only other routine corpus):** the **organization library** on the shared wiki disk at " +
        orgLibPath +
        " (**organization-wide reference** for tone and operating context on **every** substantive answer — combine with this vault; it does not replace project-specific facts here). Use **read_file** / **search_files** on those paths.";

  const lines = [
    "Vault isolation (mandatory — overrides conflicting global profile/memory):",
    vaultPathLine,
    "- **No cross-vault fishing:** Do **not** read, **search_files**, or assume facts from **any other** project vault (`/vault-shared/<other>/` or `projects/<other>/`) unless the user **explicitly** names that vault (display name or slug), a **full path** under it, or clearly asks you to pull from it. **Mini-clusters:** this chat is bound to **one** vault’s materials plus the **organization library** — other vaults are **irrelevant** for routine answers.",
    "- Do not fill in company names, people, addresses, fleet or equipment, insurance, certifications, past projects, pricing, or “industry” boilerplate from global Hermes context (USER.md, SOUL.md, other sessions, or raw world knowledge) unless the same fact appears in **this vault**, the **organization library** (" +
      orgLibPath +
      "), or the user typed / pasted it here.",
    "- If the vault materials are about a specific matter, client, project, or scope (e.g. PDFs under sources/), align the draft to that subject matter. Do not substitute an unrelated business identity just because it appears elsewhere in the agent’s memory.",
    "- **Review rules (this vault):** If **`scoring/<stem>/`** exists here, it defines requirements, standards, checklists, grading rules, or decision criteria for this work. Use it when the user asks you to review, check, compare, score, or improve a draft against ingested rules — align structure, emphasis, and must-haves with `extracted.md` / `BLURB.md` / `meta.json` under the relevant stem (see **INDEX.md**). Do **not** treat general `wiki/` narrative alone as the rule source.",
    "- **Organization library vs this vault:** Treat **`" +
      orgLibPath +
      "** as **reference** (organization voice, standards, cross-project people and context). Treat **this vault** as the **source of truth** for the current matter, scope, and dates. Do not let global notes **override** facts that only exist in the project vault; do let them **inform tone and how you explain** things.",
    "- When information is missing, use clearly labelled placeholders (e.g. [Your registered company name], [Director name]) and briefly list what the user should supply or ingest — do not invent plausible-looking details.",
    "- **HermesChat UX (mandatory):** users read the **assistant message** first. **Never** tell them to fetch the answer only from disk, a server path, or **Vault files**. They do not browse `/opt/data/...` or arbitrary paths.",
    "- **Human-facing vault prose (mandatory):** When **summarizing** what's in this vault for the user, **do not** answer like an ops checklist: no directory trees (`sources/`, `extracted/`, `segments/`, `wiki/entities/…`), no long lists of POSIX paths or JSONL filenames. Refer to uploads by **readable names** (e.g. the document title); describe outcomes in plain language (*clean text*, *notes on companies and people*, *searchable chunks for quotes*) — tools may still use paths internally. Only include **paths or Download chips** when the user asks for them or a **single** citation/link is needed.",
    "- **Vault files** in the UI lists files already under `sources/` (mainly **what was uploaded**) so people can see the vault inventory and avoid re-uploading the same file — it is **not** the primary place to deliver new agent output.",
    "- For substantive answers (scripts, letters, reports, data): put the **readable full content in this chat** (prose and **reasonably sized** fenced snippets — follow HermesChat global rules: no massive HTML/SVG/CSS walls unless the user explicitly asked for full source). **HTML/visual demos:** prefer **write_file** into the vault then link per LLM Wiki conventions; huge markup belongs on disk, not pasted inline. Treat **write_file** under " +
      (workspaceVisibility === "shared"
        ? "`/vault-shared/" + projectSlug + "/sources/`"
        : "`projects/" + projectSlug + "/sources/`") +
      " as an **optional extra** (e.g. downloadable copy), never a substitute for a concise reply body.",
    "- Avoid saving user deliverables only under Hermes home or other opaque paths unless no vault path is available.",
    "- **Write verification pass (mandatory):** After every **`write_file`** to this vault (and after **`workspace_knowledge_write`** if you use it), immediately **`read_file`** the same path and confirm the content is present and matches what you intended. If **`read_file`** is not suitable, use **`terminal`** (e.g. `test -f` / `stat` on the path you used). **Do not** tell the user a file was created or updated until this check succeeds; if it fails, report the failure and retry or fix.",
  ];

  if (workspaceVisibility === "private") {
    lines.push(
      "- Other **private** vaults: do not read, search, or assume facts from any other tenant-private `projects/<other>/` tree unless the user explicitly names that vault (display name or slug) or a specific path under it."
    );
    lines.push(
      "- **Shared wiki disks:** Do **not** explore arbitrary `/vault-shared/<other>/` trees for “maybe related” material. The **only** shared tree you may use **without** the user naming it is the **organization library** at " +
        orgLibPath +
        "."
    );
  } else {
    lines.push(
      "- This chat is bound to **one** **shared** project vault (`/vault-shared/" +
        projectSlug +
        "/`). Do not assume facts from unnamed **private** vaults or from **other** shared vaults on the same wiki unless the user points you there. **Organization library** at " +
        orgLibPath +
        " is the sole routine exception (organization-wide identity, branding, and org docs)."
    );
  }

  return lines.join("\n");
}

/** Cap how many upload names we list in the system prompt (token budget). */
const MAX_UPLOADED_FILES_IN_PROMPT = 120;

function formatUploadedInventoryLines(
  projectSlug: string,
  workspaceVisibility: WorkspaceVisibility,
  files: { relativePath: string; name: string }[]
): string[] {
  if (files.length === 0) {
    const indexHint =
      workspaceVisibility === "shared"
        ? "`/vault-shared/" + projectSlug + "/INDEX.md` and `/vault-shared/" + projectSlug + "/SCHEMA.md`"
        : "`projects/" + projectSlug + "/INDEX.md` and `SCHEMA.md`";
    return [
      "Files in sources/ for this vault: _(none yet — use read_file on " +
        indexHint +
        " for vault structure; after ingest, prefer `extracted/` for text.)_",
    ];
  }
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const slice = sorted.slice(0, MAX_UPLOADED_FILES_IN_PROMPT);
  const lines = slice.map((f) => `- \`${f.relativePath}\``);
  if (sorted.length > MAX_UPLOADED_FILES_IN_PROMPT) {
    lines.push(
      `- _…and ${sorted.length - MAX_UPLOADED_FILES_IN_PROMPT} more under sources/ (list the directory if needed)._`
    );
  }
  return [
    "Files already in this vault under sources/ (upload inventory / dedupe — **not** the preferred read surface for text). For answers, follow INDEX → **extracted/** (and wiki) first; open sources/ only when no extracted sibling exists or the user needs the original file.",
    ...lines,
  ];
}

const WORKSPACE_TOOL_PRIORITY = [
  "Tool and source priority (this vault session — follow before calling the public web):",
  "- **Ingestion-first (mandatory):** After ingest, open **`brain/retrieval/router.json`** when present. The canonical text for models lives under **`extracted/`** (markdown) and **`wiki/`**, routed by the brain router plus **`INDEX.md`** / **`LOG.md`** / **`SCHEMA.md`**. For Q&A, summaries, quotes, and “what does this document say”, open **`extracted/<stem>.md`** (and **`wiki/`** when the router or INDEX points there) — **not** the raw file under **`sources/`**.",
  "- **Evidence map (multi-path merge):** After **`LOG.md`** and **`INDEX.md`**, open **`brain/retrieval/router.json`** and **`index/coreference.json`** when present. For each **`canonical_id`** or brain document you rely on, **read every path listed in `mentions[]`, `primaryPaths`, `specialistPaths`, or `evidencePaths`** that matters for the answer — **`extracted/`**, **`wiki/`**, **`segments/`**, **`sources/`**, **`scoring/`**, **`templates/`**, and **`brain/swarm/**/latest.json`** when listed — or say briefly why a path was skipped. Do **not** stop after the first INDEX row when the brain router or **`coreference.json`** lists sibling locations.",
  "- **Named entities (wiki-first):** For questions about a **specific person, organisation, or project**, **`search_files` / INDEX → `wiki/entities/…`** **before** treating one **`extracted/*.md`** hit as complete. Read that entity note and merge everything listed under **Sources** — **`extracted/`**, **`extracted/*_docx_media/`** when images matter, **`extracted/<stem>.extraction_map.json`** and **`extracted/<stem>.quality.json`** when present.",
  "- **`extracted/<stem>.extraction_map.json` + `extracted/<stem>.quality.json`** (when present): machine-readable **layer map** and parser report for that upload — primary markdown, unpacked Office images (`*_docx_media/` / `*_pptx_media/`), **`*.ocr.txt`** sidecars, parser choice, fallback/OCR warnings, and quality score. Open them before concluding narrative detail is absent — pasted CV pages often arrive **only** via OCR.",
  "- **When to use `sources/`** (PDF, DOCX, etc.): only if **no** matching row exists in INDEX/extracted yet, the user explicitly needs the **original binary** (exact pagination, layout, or “open the PDF”), or you are verifying ingest integrity. If both `sources/foo.pdf` and `extracted/foo.md` exist for the same ingest, **you must read the extracted markdown first** for text tasks; do not “lazy read” the PDF because read_file can open it.",
  "- Questions about “this”, “here”, “what we uploaded”, or “the file/doc/project”: use **read_file** / **search_files** under `projects/__PROJECT_SLUG__/` starting with **`LOG.md`**, **`INDEX.md`**, **`brain/retrieval/router.json`**, **`SCHEMA.md`**, then **`extracted/`** and **`wiki/`**, then role-specific trees (`scoring/`, `templates/`).",
  "- **`segments/*.jsonl`:** use only after **INDEX.md** (or the user) points you there, or for **tight quotes** from chunk text — not the default first read for Q&A.",
  "- **Organization library (every substantive reply):** Under **`/vault-shared/" +
    getOrgGlobalSlug() +
    "/`**, load **INDEX / SCHEMA / wiki / extracted** as **company reference** — how the org presents itself, tone, priorities, people, and cross-project context. Use it to **inform** wording and framing on **all** vaults (private or shared), **not** as infallible gospel and **not** to replace project-specific facts from the active vault. When a topic might be org-wide, **search_files** **only** under that org path (not under other project vaults) before saying it is unknown.",
  "- **Review-rule aware documents:** If **`scoring/<stem>/`** exists, **read_file** **`scoring/<stem>/extracted.md`** (and **`BLURB.md`**) when **drafting, revising, checking, or comparing** work against those rules.",
  "- **Terminal (HermesChat):** Do **not** run **`python3 -c '...'`** — the gateway returns **approval_required** and this app cannot approve it. Use **`write_file` → `/tmp/*.py`** then **`python3 /tmp/....py`**, or **`extract.py`** via a saved script file.",
  "- Do **not** use `web_search` or `web_extract` for vault-grounded questions until you have consulted **this vault** and the **organization library** for reference (or you confirm neither applies).",
  "- Use the public web only when the user clearly wants live/general internet information, or after vault + org reference are insufficient.",
].join("\n");

/** Shared vaults use split FS on the gateway (`/vault-shared/<slug>/`); private vaults use `projects/<slug>/` under Hermes home. */
const SHARED_WORKSPACE_TOOL_PRIORITY = [
  "Tool and source priority (this vault session — follow before calling the public web):",
  "- **Ingestion-first (mandatory):** After ingest, open **`brain/retrieval/router.json`** when present. The canonical text for models lives under **`extracted/`** (markdown) and **`wiki/`**, routed by the brain router plus **`INDEX.md`** / **`LOG.md`** / **`SCHEMA.md`**. For Q&A, summaries, and quotes, open **`extracted/<stem>.md`** (and **`wiki/`** when the router or INDEX points there) — **not** the raw file under **`sources/`**.",
  "- **Evidence map:** After **`LOG.md`** / **`INDEX.md`**, load **`brain/retrieval/router.json`** and **`index/coreference.json`** when they exist. Merge **`mentions[]`**, **`primaryPaths`**, **`specialistPaths`**, and **`evidencePaths`** for anything you use — all listed paths (`extracted`, `wiki`, `segments`, `sources`, `brain/swarm/**/latest.json`, etc.) or explicit skips. Prefer **`related[]`** edges tagged **`inferred`** / **`ambiguous`** as hints only.",
  "- **Named entities (wiki-first):** For questions about a **specific person, organisation, or project**, **`search_files` / INDEX → `wiki/entities/…`** **before** treating one **`extracted/*.md`** hit as complete. Read that entity note and merge everything listed under **Sources** — **`extracted/`**, **`extracted/*_docx_media/`** when images matter, **`extracted/<stem>.extraction_map.json`** and **`extracted/<stem>.quality.json`** when present.",
  "- **`extracted/<stem>.extraction_map.json` + `extracted/<stem>.quality.json`** (when present): layer inventory and parser report for that upload — markdown body, **`segments/`** JSONL path, Office media folders, OCR outputs, chosen parser, fallback/OCR warnings, and quality score. Check them plus OCR blocks in the `.md` before saying content is missing.",
  "- **When to use `sources/`** (PDF, DOCX, etc.): only if **no** matching extracted file exists yet, the user explicitly needs the **original binary**, or you are verifying ingest. If both `sources/foo.pdf` and `extracted/foo.md` exist, **read the extracted markdown first** for text tasks.",
  "- Questions about “this”, “here”, “what we uploaded”, or “the file/doc/project”: use **read_file** / **search_files** under **`/vault-shared/__PROJECT_SLUG__/`** starting with **`LOG.md`**, **`INDEX.md`**, **`brain/retrieval/router.json`**, **`SCHEMA.md`**, then **`extracted/`** and **`wiki/`**, then **`scoring/`** / **`templates/`** as INDEX indicates.",
  "- **`segments/*.jsonl`:** use only after **INDEX.md** (or the user) points you there, or for **tight quotes** from chunk text — not the default first read for Q&A.",
  "- **Organization library (every substantive reply):** Use **`/vault-shared/" +
    getOrgGlobalSlug() +
    "/`** as **organization-wide reference** (tone, identity, how things work, org context) for **all** answers in this chat — combine with **`/vault-shared/__PROJECT_SLUG__/`** for project facts. It is **reference**, not the only source of truth for the active matter. **search_files** **only** under that org path when a topic may be org-wide — **never** under other `/vault-shared/<other>/` vaults unless the user names them.",
  "- **Review-rule aware documents:** If **`/vault-shared/__PROJECT_SLUG__/scoring/<stem>/`** exists, **read_file** **`extracted.md`** / **`BLURB.md`** there when **drafting, checking, or comparing** work against those rules.",
  "- **Terminal (HermesChat):** Do **not** run **`python3 -c '...'`** — approval stalls. Use **`write_file` → `/tmp/*.py`** then **`python3 /tmp/....py`**, or **`extract.py`** via a script file.",
  "- Do **not** use `web_search` or `web_extract` for vault-grounded questions until you have consulted **this project vault** and the **organization library** (or you confirm neither applies).",
  "- Use the public web only when the user clearly wants live/general internet information, or after vault + org reference are insufficient.",
].join("\n");

/**
 * Injected as a `system` message when the HermesChat session is bound to a vault (`projectId` on the session row).
 */
export function activeWorkspaceSystemPrompt(params: {
  projectSlug: string;
  projectName: string;
  /** Current uploads under sources/ — drives “use this data first” behavior. */
  uploadedFiles?: { relativePath: string; name: string }[];
  workspaceVisibility: WorkspaceVisibility;
}): string {
  const {
    projectSlug,
    projectName,
    uploadedFiles = [],
    workspaceVisibility,
  } = params;
  const orgLibSlug = getOrgGlobalSlug();
  const grounding = workspaceVaultOnlyGroundingLines(
    projectSlug,
    workspaceVisibility
  );
  const toolPriority =
    workspaceVisibility === "shared"
      ? SHARED_WORKSPACE_TOOL_PRIORITY.replaceAll("__PROJECT_SLUG__", projectSlug)
      : WORKSPACE_TOOL_PRIORITY.replaceAll("__PROJECT_SLUG__", projectSlug);
  const inventory = formatUploadedInventoryLines(
    projectSlug,
    workspaceVisibility,
    uploadedFiles
  ).join("\n");
  const visLabel = workspaceVisibility === "shared" ? "shared (VPN-wide)" : "private";
  const orgLibraryLine =
    "**Organization library (organization-wide reference — all vaults):** lives under **`/vault-shared/" +
    orgLibSlug +
    "/`**. Same tree shape as project vaults (**LOG / INDEX / SCHEMA / extracted / wiki**). Use it on **every substantive answer** as **reference** for who the company is, **tone**, priorities, operating context, and cross-project notes — **not** as gospel that overrides project-specific facts in the active vault, but so outputs **sound and behave** like this org. Also consult when facts may live only in the global wiki.";

  const scoringLine =
    workspaceVisibility === "shared"
      ? "**Review rules (this vault — local to this work):** ingested criteria live under **`/vault-shared/" +
        projectSlug +
        "/scoring/<stem>/`** (`extracted.md`, `BLURB.md`, `meta.json`). **Before** claiming a draft meets the criteria, **read_file** those files and compare. The **organization library** does not replace **`scoring/`** here."
      : "**Review rules (this vault — local to this work):** **`projects/" +
        projectSlug +
        "/scoring/<stem>/`** (`extracted.md`, `BLURB.md`, `meta.json`). **Before** claiming a draft meets the criteria, **read_file** those files and compare. Org-wide tone lives under **`/vault-shared/" +
        orgLibSlug +
        "/`**; review checks use **`scoring/`** here.";

  const vaultIntro =
    workspaceVisibility === "shared"
      ? [
          `Vault root on the gateway (shared wiki disk): \`/vault-shared/${projectSlug}/\` — markdown lives in \`wiki/\`, \`extracted/\`, \`scoring/\` (per-upload review rules), and root \`SCHEMA.md\`, \`INDEX.md\`, \`LOG.md\`; originals in \`sources/\`.`,
          "**Do not** use `projects/" +
            projectSlug +
            "/…` or `/opt/data/projects/" +
            projectSlug +
            "/…` for this vault — those are different directories than the shared tree.",
        ]
      : [
          `Vault root on the gateway: \`projects/${projectSlug}/\` — markdown lives in \`wiki/\`, \`extracted/\`, \`scoring/\` (per-upload review rules), and root \`SCHEMA.md\`, \`INDEX.md\`, \`LOG.md\`; originals in \`sources/\`.`,
        ];

  const loadIndexLines =
    workspaceVisibility === "shared"
      ? [
          "Before answering from vault material, load **`/vault-shared/" +
            projectSlug +
            "/LOG.md`** (if present), then **`/vault-shared/" +
            projectSlug +
            "/INDEX.md`**, then **`/vault-shared/" +
            projectSlug +
            "/brain/retrieval/router.json`** when present (machine-readable **brain route** — read relevant `primaryPaths`, `specialistPaths`, and `evidencePaths`), then **`/vault-shared/" +
            projectSlug +
            "/index/coreference.json`** when present (machine-readable **evidence map** — merge **`mentions[]`** for each topic you use), then **`/vault-shared/" +
            projectSlug +
            "/SCHEMA.md`** with **read_file** (absolute paths — do not use bare filenames). Then use **`extracted/`** and **`wiki/`** for text; **`sources/`** only per the ingestion-first rules above.",
          ...(projectSlug !== orgLibSlug
            ? [
                "This vault is **not** the organization library: early in substantive turns, skim **`/vault-shared/" +
                  orgLibSlug +
                  "/INDEX.md`** (and **wiki/** / **extracted/** as needed) for **company reference** — tone, identity, how things work — and for org-wide facts. Combine with this project vault; do not treat global notes as overriding project-specific facts.",
              ]
            : []),
          "**read_file vs write_file paths (shared):** Use **absolute** paths under **`/vault-shared/" +
            projectSlug +
            "/…`** for both tools. If a relative path fails, retry with the full `/vault-shared/…` path.",
        ]
      : [
          "Before answering from vault material, load **`projects/" +
            projectSlug +
            "/LOG.md`** (if present), then **`projects/" +
            projectSlug +
            "/INDEX.md`**, then **`projects/" +
            projectSlug +
            "/brain/retrieval/router.json`** when present (read relevant `primaryPaths`, `specialistPaths`, and `evidencePaths`), then **`projects/" +
            projectSlug +
            "/index/coreference.json`** when present (merge **`mentions[]`** for topics you rely on), then **`projects/" +
            projectSlug +
            "/SCHEMA.md`** with **read_file** (path relative to Hermes home — do not use bare filenames). Then use **`extracted/`** and **`wiki/`** for text; **`sources/`** only per the ingestion-first rules above.",
          "For **organization-wide reference** (tone, org story, standards, people, cross-project notes), load **`/vault-shared/" +
            orgLibSlug +
            "/INDEX.md`** and use **`/vault-shared/" +
            orgLibSlug +
            "/wiki/`** and **`extracted/`** as needed — private **`projects/" +
            projectSlug +
            "/`** is the job vault; the org library **informs every answer** alongside it.",
          "**read_file vs write_file paths:** On this gateway, Hermes home is `/opt/data`. Use the same logical vault paths for both tools: `projects/" +
            projectSlug +
            "/…`. If **read_file** returns file-not-found for `projects/" +
            projectSlug +
            "/…` but those files exist (you wrote them with **write_file** or the user confirmed them on disk), retry **read_file** with the absolute path **`/opt/data/projects/" +
            projectSlug +
            "/…`** — do not treat the vault as missing after a single failed relative read.",
        ];

  const citeAndPersist =
    workspaceVisibility === "shared"
      ? [
          "When citing document content you derived from text, prefer paths under **`/vault-shared/" +
            projectSlug +
            "/extracted/`** (or **`wiki/`**). Add **`sources/`** path and page/sheet numbers when the user needs traceability to the original binary.",
          "**Persistence:** write vault markdown with **write_file** to paths under **`/vault-shared/" +
            projectSlug +
            "/`** (e.g. `extracted/…`, `scoring/…`, `wiki/…`, `INDEX.md`, `LOG.md`, `SCHEMA.md`). Use **direct gateway tool calls** only — not `execute_code` or sandbox imports for file I/O.",
        ]
      : [
          "When citing document content you derived from text, prefer paths under `projects/" +
            projectSlug +
            "/extracted/` (or `wiki/`). Add `sources/` path and page/sheet numbers when traceability to the original file matters.",
          "**Persistence:** write vault markdown with **write_file** to paths under `projects/" +
            projectSlug +
            "/` (e.g. `extracted/…`, `scoring/…`, `wiki/…`, `INDEX.md`, `LOG.md`, `SCHEMA.md`). Use **direct gateway tool calls** only — not `execute_code` or sandbox imports for file I/O.",
        ];

  const hermesChatDownload =
    workspaceVisibility === "shared"
      ? "**HermesChat:** The chat bubble is the deliverable. **Vault files** shows existing `sources/` uploads (inventory/dedup); optional **write_file** there is a bonus copy only. If you saved under `/vault-shared/" +
        projectSlug +
        "/sources/`, you may note it — users must never need that link alone to read your answer. After any disk **write_file**, run the **verification pass** (`read_file` or `terminal`) before claiming success. **Download link (mandatory when offering a saved file):** include a markdown link `[basename](/api/projects/" +
        projectSlug +
        "/file?name=basename)` for each file under `sources/` (basename must match the saved file; URL-encode the `name=` value if the filename has reserved characters). Users tap it in the app — do **not** use `/opt/...` or other VPS paths as the user-facing “open this” instruction. When citing a saved path in **inline code**, prefer `` `projects/" +
        projectSlug +
        "/sources/basename` `` so HermesChat can show a Download chip beside it."
      : "**HermesChat:** The chat bubble is the deliverable. **Vault files** shows existing `sources/` uploads (inventory/dedup); optional **write_file** there is a bonus copy only. If you saved under `projects/" +
        projectSlug +
        "/sources/`, you may note it — users must never need that link alone to read your answer. After any disk **write_file**, run the **verification pass** (`read_file` or `terminal`) before claiming success. **Download link (mandatory when offering a saved file):** include a markdown link `[basename](/api/projects/" +
        projectSlug +
        "/file?name=basename)` for each file under `sources/` (basename must match the saved file; URL-encode the `name=` value if the filename has reserved characters). Users tap it in the app — do **not** use `/opt/...` or other VPS paths as the user-facing “open this” instruction. When citing a saved path in **inline code**, prefer `` `projects/" +
        projectSlug +
        "/sources/basename` `` so HermesChat can show a Download chip beside it.";

  return [
    `Active vault: "${projectName}" (slug: ${projectSlug}, visibility: ${visLabel}).`,
    ...vaultIntro,
    "",
    orgLibraryLine,
    "",
    scoringLine,
    "",
    inventory,
    "",
    toolPriority,
    "",
    ...loadIndexLines,
    ...citeAndPersist,
    "When the user asks to ingest a new file, follow the LLM Wiki layout (extracted/, wiki/, INDEX.md, LOG.md) and **write_file** each artifact. Report paths you wrote.",
    "",
    hermesChatDownload,
    "",
    LLM_WIKI_WORKSPACE_CONVENTIONS,
    "",
    grounding,
  ].join("\n");
}

/**
 * Appended to the Create / Open Design system preamble when the user picked a reference vault.
 * Shorter than `activeWorkspaceSystemPrompt` — this chat is still artifact-first, not vault Q&A.
 */
export function creativeStudioReferenceVaultAppendix(params: {
  projectSlug: string;
  projectName: string;
  workspaceVisibility: WorkspaceVisibility;
  uploadedFiles: { relativePath: string; name: string }[];
}): string {
  const { projectSlug, projectName, workspaceVisibility, uploadedFiles } = params;
  const orgLibSlug = getOrgGlobalSlug();
  const rootLine =
    workspaceVisibility === "shared"
      ? `**Gateway root (shared):** \`/vault-shared/${projectSlug}/\` — use **absolute** \`/vault-shared/${projectSlug}/…\` paths with **read_file** / **search_files**.`
      : `**Gateway root (private):** \`projects/${projectSlug}/\` under Hermes home — same layout as vaults (\`wiki/\`, \`extracted/\`, \`sources/\`, \`INDEX.md\`, \`LOG.md\`, \`SCHEMA.md\`).`;
  const readOrder =
    workspaceVisibility === "shared"
      ? `Before drafting from vault text, load \`/vault-shared/${projectSlug}/LOG.md\` (if present), then \`/vault-shared/${projectSlug}/INDEX.md\`, \`/vault-shared/${projectSlug}/brain/retrieval/router.json\` when present, and \`/vault-shared/${projectSlug}/SCHEMA.md\`. Prefer **extracted/** and **wiki/** for text; use router **primaryPaths**, **specialistPaths**, and **evidencePaths** so you do not stop at one matching file. When router evidence lists **brain/swarm/** latest packs, read them as the reader/challenge/merge summary before drafting; when it lists **extracted/*.quality.json**, use it to understand parser/OCR/table risk. **sources/** only when no extracted sibling exists, the user needs the original binary, or you verify ingest.`
      : `Before drafting from vault text, load \`projects/${projectSlug}/LOG.md\` (if present), then \`projects/${projectSlug}/INDEX.md\`, \`projects/${projectSlug}/brain/retrieval/router.json\` when present, and \`projects/${projectSlug}/SCHEMA.md\`. Prefer **extracted/** and **wiki/** for text; use router **primaryPaths**, **specialistPaths**, and **evidencePaths** so you do not stop at one matching file. When router evidence lists **brain/swarm/** latest packs, read them as the reader/challenge/merge summary before drafting; when it lists **extracted/*.quality.json**, use it to understand parser/OCR/table risk. **sources/** only when no extracted sibling exists, the user needs the original binary, or you verify ingest.`;
  const inventory = formatUploadedInventoryLines(
    projectSlug,
    workspaceVisibility,
    uploadedFiles
  ).join("\n");

  return [
    "",
    "Reference vault (Create / Open Design — supplementary context):",
    "- This is a **Create** session: **primary deliverable** is still the requested artifact using the Open Design routing instructions above. The vault below is **reference material** — facts, quotes, structure, and ingested documents to inform what you build.",
    `- **Vault:** "${projectName}" (slug: \`${projectSlug}\`, visibility: ${workspaceVisibility === "shared" ? "shared" : "private"}).`,
    `- ${rootLine}`,
    `- ${readOrder}`,
    `- **Organization library:** \`/vault-shared/${orgLibSlug}/\` — organization-wide tone and context; combine with this vault. Do not let org notes **override** project-specific facts that live only in this reference vault.`,
    "- **No cross-vault fishing:** Do not read other \`projects/<other>/\` or \`/vault-shared/<other>/\` trees unless the user explicitly names them.",
    "- **Ingestion-first:** Same rule as vault sessions — canonical text lives under **extracted/** and **wiki/** after ingest.",
    "- **Images:** When you **`image_generate`** / **`image_edit`** in this chat (deck art, thumbnails, vault-related visuals), default to **realistic / photorealistic** imagery unless the user explicitly requests another aesthetic or **`branding/BRAND_KIT.md`** dictates a branded non-realistic look.",
    "",
    inventory,
  ].join("\n");
}
