---
name: project-vault
description: >
  Current HermesChat private/shared vault reader and operator guide. Use for workspace-bound
  chats, vault path debugging, private-vault repairs, and answering from ingested files. The
  app/bridge owns source uploads, queueing, undo, and most writer automation.
metadata:
  hermes:
    related_skills: [vault-ingest-read-guide, unified-vault-ingest, wiki-vault-ingest-pipeline, shared-wiki-vault-io]
---

# Project Vault

HermesChat vaults are persistent workspaces. A chat can change, but every chat bound to the same vault sees the same vault files.

Use this skill to read and reason from a vault, debug paths, or repair a private vault. For shared automated ingest, use `wiki-vault-ingest-pipeline`. For extractor details, use `unified-vault-ingest`. For answering from already ingested files, use `vault-ingest-read-guide`.

## Vault Roots

- Private vault: `projects/<slug>/` relative to Hermes home, usually `/opt/data/projects/<slug>/` in Docker.
- Shared vault: `/vault-shared/<slug>/`.

Do not assume `/opt/data/projects/<slug>/` contains shared vault bytes. Shared workspaces use `/vault-shared/<slug>/`.

## Current Layout

New workspaces are initialized by HermesChat bridge with:

- `sources/` original uploads
- `extracted/` markdown, metadata, extraction maps, quality reports
- `segments/` chunk JSONL for general/org knowledge
- `wiki/entities/`, `wiki/concepts/`, `wiki/comparisons/`, `wiki/queries/`
- `templates/` for reusable document structure and tone
- `scoring/` for rubrics, grading, requirements, and review criteria
- `branding/BRAND_KIT.md` for brand details
- `index/ingest_manifest.json` and optional `index/coreference.json`
- `SCHEMA.md`, `INDEX.md`, `LOG.md`, `project.json`, `vault_profile.yaml`

## Read Order

Always start with:

1. `LOG.md`
2. `INDEX.md`
3. `index/coreference.json` when present
4. `SCHEMA.md`
5. role folders: `templates/`, `scoring/`, `branding/`
6. `wiki/`
7. `extracted/`
8. `segments/` for chunk-level follow-up
9. `sources/` only when exact originals are needed

This keeps Hermes aligned with the current ingest/retrieval system and avoids rereading raw PDFs/DOCX when clean markdown already exists.

## Asset Roles

HermesChat upload metadata may name an asset role:

- `general_reference`: normal vault knowledge; read `extracted/`, `segments/`, and `wiki/` when present.
- `org_global` / organization library: shared company-wide reference; same retrieval as general knowledge.
- `output_template`: use `templates/<stem>/outline.md` and `structure.yaml` for shape, headings, and tone.
- `scoring_criteria`: use `scoring/<stem>/extracted.md`, `BLURB.md`, and `meta.json`.
- `company_branding`: use `branding/BRAND_KIT.md` before visual, email, deck, PDF, or website work.

Notes entered by the user during upload are authoritative for intent and should be read with the role.

## Private Vault Repairs

If a private vault needs a manual repair:

1. Identify the slug and source file under `/opt/data/projects/<slug>/sources/`.
2. Use `unified-vault-ingest` scripts from `/opt/data/skills/note-taking/unified-vault-ingest/scripts/`.
3. Write outputs into the same role folders the app expects.
4. Update `INDEX.md` and append `LOG.md`.
5. Verify files on disk with `test -f`, `stat`, `wc`, or `sed`.

For shared vault repairs, use `/vault-shared/<slug>/` and the shared ingest skill instead.

## Re-Sync And Undo

HermesChat bridge handles file menu actions:

- Re-sync with Hermes verifies and refreshes outputs.
- Remove file and ingest outputs removes source plus manifest-linked derived outputs where possible.
- Delete upload only removes only the source.

Do not create a second, competing undo system in chat. If a cleanup requires manual wiki edits, say which notes need review and why.

## Public-facing generated artifacts

When a private vault is used to create a public or semi-public artifact such as a marketing page, Builds app, deck, or PDF, separate source-backed facts from private operational detail before writing copy.

- Public-safe: entity/property names the user asked to use, high-level maintenance themes, action categories, decisions, dates, and non-sensitive status language.
- Keep private unless explicitly authorized: resident names, unit-owner mappings, tenant notes, phone numbers, email addresses, bank balances, invoices, internal supplier contacts, and meeting attendance details.
- For Builds/static pages, pair the vault read with a final leak scan against exact sensitive strings discovered in the source, because tool output may redact phone numbers while the underlying source still contains them.

## Chat Context

Workspace-bound HermesChat sessions usually include slug and path metadata in the system prompt. Cite evidence with vault-relative paths like `extracted/...`, `wiki/...`, or `sources/...` plus page/sheet/section when known.

## Summary Requests

For short prompts like “make a clear summary” in a vault-bound chat, do not ask what to summarize if the active vault has an obvious primary document. Follow read order, then read the primary wiki/entity notes and targeted extracted sections around contents, scope, dates, evaluation criteria, obligations, risks, and deliverables. Return a clear, user-facing executive summary in plain language, not an ingest/status summary. Keep it concise unless the user asks for a detailed report.
