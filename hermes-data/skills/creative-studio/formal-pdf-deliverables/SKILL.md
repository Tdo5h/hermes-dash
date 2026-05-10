---
name: formal-pdf-deliverables
description: "Create polished, print-ready formal PDFs in HermesChat Create or Builds: tender summaries, reports, proposals, briefing documents, and vault-backed business PDFs. Covers route planning, HTML-to-PDF export, Builds publishing, and quality checks."
triggers:
  - formal PDF
  - tender document
  - proposal PDF
  - report PDF
  - business PDF
  - document PDF
  - vault-backed briefing
related_skills: [creative-studio, pdf-generation-pymupdf, hermeschat-builds-manifest, project-vault, vault-ingest-read-guide]
---

# Formal PDF Deliverables

Use this when the user asks for a polished PDF/document such as a tender summary, proposal, report, formal briefing, or vault-backed business document.

This is a class-level companion for pinned skills that often govern the same work (`creative-studio`, `pdf-generation-pymupdf`, and `hermeschat-builds-manifest`). If those pinned skills are available, follow them too; this skill adds the specific quality workflow learned from producing formal PDF deliverables through Builds.

## Route and fit plan

Before writing files, do a short plan that confirms:

1. Intended artifact: formal PDF, not a slide deck or casual web page.
2. User must-haves: exact topic, requested number of points/details, output category/subtype, tone, and any wording to preserve.
3. Evidence source: vault, uploaded files, exact sections, people/entity notes, images/assets, and any source limitations.
4. Design route: print-first HTML canonical, exported to PDF; restrained professional styling unless the brief says otherwise.

Keep the plan compact. Do not paste internal meta-brief wording into the artifact.

## Build workflow

### HermesChat / Builds route

1. Write `/opt/data/builds/<slug>/index.html` as the canonical designed document.
2. Use A4 unless the user asks for Letter:
   ```bash
   node /opt/hermes-pdf-export/export_document_pdf.mjs \
     --html /opt/data/builds/<slug>/index.html \
     --out /opt/data/builds/<slug>/document.pdf \
     --format A4
   ```
3. Register the app in `/opt/data/builds/manifest.json` without dropping existing `apps[]`.
4. Read back `manifest.json` and confirm the app id exists.
5. Final reply should include both:
   - `[document.pdf](/api/builds/file?id=<id>&name=document.pdf)`
   - `[index.html](/api/builds/file?id=<id>&name=index.html)`
   and say it is available in **Builds**.

### Hermes Production Request / fixed output-root route

When the Create brief supplies an explicit output root and says to return concise file paths only, do **not** publish through Builds or ask for another path. Save all final user-facing files under the supplied output root. A good pattern is:

1. Read `HERMES_INPUTS.md` first, then `HERMES_VAULT_DIGEST.md`, then exact staged vault artifacts.
2. Generate the PDF and an editable source companion, e.g. `<slug>.pdf` and `<slug>.source.md`, directly under the output root.
3. Use `pdf-generation-pymupdf` when the route hint calls for it or when HTML export is unavailable.
4. Run verification against the output-root files: non-zero stat, `%PDF-` magic bytes, PyMuPDF open/page count/text extraction, required vault terms present, forbidden prompt/meta/placeholder terms absent.
5. If private vault facts include sensitive contact details, assert they are absent from the PDF/source unless explicitly requested.
6. Render representative pages to PNG and visually inspect for clipping, overlap, contrast, footer/header placement, and table fit.
7. Final reply should be minimal and path-focused, matching the request: usually just the created file paths and a terse QA note if useful.

## Quality pass before final reply

Run this pass before calling the deliverable done:

- Read or stat `index.html` after writing.
- Search for prompt/meta leakage: `TODO|Lorem|placeholder|CREATE REQUEST|USER_BRIEF|SOURCE_MATERIAL|EXACT_WORDING`.
- Export the PDF and verify it exists with non-zero size.
- Use PyMuPDF to check page count and extract text; confirm key requested terms are present.
- Render representative pages to PNG and inspect for:
  - clipped/cut-off content
  - overlapping text
  - unreadable contrast
  - missing images/assets
  - ugly or accidental scrollbars
  - content that looks like instructions rather than user-facing copy

If a visual pass finds a defect, fix CSS and re-export. Do not claim success until the PDF, not just the HTML, is checked.

## Print CSS pitfalls

- Cover pages can look fine in browser but clip bottom metadata in PDF when using `min-height: 100vh` or `100vh` inside an A4 page with margins.
- Add `@media print` rules for covers: explicit printable height, `grid-template-rows: auto minmax(0, 1fr) auto`, sensible gaps, and margins that fit inside the page box.
- After changing print CSS, re-export the PDF; re-reading the HTML alone is not enough.
- Bottom cards/metadata often need a two-column grid in print instead of four tiny columns.

## Vault-backed formal documents

When using vault knowledge:

- Prefer extracted/wiki/entity layers over raw source copy when available.
- Preserve evidence hierarchy in your own work: clean extracted narrative is stronger than OCR/image-only appendices.
- Treat legal/commercial/tender-form facts from embedded images or OCR sidecars cautiously unless verified.
- Include a short evidence/limitations note in the document when uncertainty matters.
- Keep factual claims source-backed and avoid invented brand colours, logos, machinery models, or legal details.

## Reference

- `references/formal-pdf-html-export-quality-pass.md` — successful workflow notes from a tender-summary PDF, including HTML export, manifest update, PyMuPDF verification, visual QA, and a cover cut-off fix.
- `references/output-root-pymupdf-rfq-qa.md` — production-request pattern for fixed output-root PyMuPDF formal PDFs, editable source companions, private-vault contact redaction, and QA scripts.
