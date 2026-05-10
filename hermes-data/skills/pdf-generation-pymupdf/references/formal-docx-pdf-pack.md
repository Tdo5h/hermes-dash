# Formal DOCX + PDF + HTML pack pattern

Use this when the requested artifact is a formal tender/report/letter pack where DOCX is primary but PDF/HTML previews are also useful.

## What worked

- Keep `pdf-generation-pymupdf` for the PDF output, but use `python-docx` for editable DOCX when available.
- Check availability before building:
  - `python3 --version`
  - Python imports: `docx`, `fitz`, `PIL`
  - optional converters like `pandoc` / `libreoffice` may be absent; do not depend on them.
- For source-grounded tender/report packs with missing source docs, generate a professional structure with explicit placeholders and clarification requests rather than inventing client/project facts.
- Store run notes beside the build, e.g. `_hermes-create/brief.md`, `_hermes-create/route.md`, `_hermes-create/sources.md`, `_hermes-create/style.md`, `_hermes-create/qa.md`.

## QA checklist

1. Verify every generated file exists and has non-zero size.
2. Open DOCX as a zip and confirm `word/document.xml` exists.
3. Search DOCX XML for required phrases/section titles.
4. Extract PDF text with PyMuPDF and confirm required phrases/section titles.
5. Render representative PDF pages with `get_pixmap()` and inspect visually for missing logo, cut-off text, overlaps, unreadable contrast, or broken placeholder blocks.
6. If registering in HermesChat Builds, read back `/opt/data/builds/manifest.json` and confirm the app entry is present.

## Useful implementation notes

- Use `python-docx` tables for tender/report matrices, with shaded header rows and small but readable table fonts.
- Use PyMuPDF hard-coded A4 dimensions and avoid `insert_textbox` for critical text unless checking return values.
- Use a single source data structure for sections/tables, then render it to DOCX, PDF, HTML, and Markdown to keep outputs consistent.
- When visual references are provided but no tender source docs are available, treat image assets as style/brand assets only and state the source limitation clearly in the output.