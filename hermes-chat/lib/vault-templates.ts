/**
 * Initial vault markdown templates (LLM Wiki / Karpathy-style).
 * Keep in sync with hermes-bridge `schemaTemplate` in worker.mjs when changing SCHEMA.
 */

export function schemaTemplate(projectName: string): string {
  return `# Project: ${projectName}

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

export function indexTemplate(projectName: string): string {
  return `# Index — ${projectName}

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
