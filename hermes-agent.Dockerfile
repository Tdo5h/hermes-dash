# Extends official Hermes agent image with vault ingest engines (MarkItDown + PDF + Office fallbacks).
# Hermes v0.13.0 → Docker tag v2026.5.7 (Kanban release).
FROM nousresearch/hermes-agent:v2026.5.7
USER root
# MarkItDown: MUST install optional extras — bare `markitdown` registers converters but MissingDependencyException without extras.
# `markitdown[all]` is the current upstream full optional-dependency set; plugins are still separate and runtime-discovered.
# `ffmpeg`: improves pydub/audio-transcription reliability for media MarkItDown accepts.
# pymupdf*: fast PDF path in unified extract.py.
# Docling is wired as an optional parser-router candidate, but not installed in the base gateway image:
# current Docling pulls a multi-GB Torch/CUDA stack. Keep it for a separate heavy parser image/service.
# python-docx / openpyxl / python-pptx: last-resort fallback only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip ffmpeg \
       tesseract-ocr tesseract-ocr-eng \
  && python3 -m pip install --no-cache-dir --break-system-packages \
       "markitdown[all]" \
       pymupdf pymupdf4llm \
       python-docx openpyxl python-pptx pytesseract \
  && python3 -c 'from pathlib import Path; from docx import Document; from markitdown import MarkItDown; p = Path("/tmp/markitdown_docx_smoke.docx"); d = Document(); d.add_paragraph("markitdown-smoke"); d.save(p); t = (MarkItDown().convert(str(p), keep_data_uris=False).text_content or ""); assert "markitdown-smoke" in t; print("markitdown docx converter smoke OK")' \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Ensure subprocess extract.py finds markitdown without relying only on /opt/data/home/.local/bin.
ENV PATH="/usr/local/bin:${PATH}"

# Creative Studio: HTML → PDF via Playwright + Chromium (business docs + deck export scripts).
# Browsers live in /opt/ms-playwright so runtime user `hermes` (10000) can read them (not under /root/.cache).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /opt/hermes-pdf-export
COPY hermes-data/skills/creative-studio/huashu-design/scripts/package.json ./package.json
COPY hermes-data/skills/creative-studio/huashu-design/scripts/export_document_pdf.mjs ./export_document_pdf.mjs
COPY hermes-data/skills/creative-studio/huashu-design/scripts/export_deck_pdf.mjs ./export_deck_pdf.mjs
COPY hermes-data/skills/creative-studio/huashu-design/scripts/export_deck_stage_pdf.mjs ./export_deck_stage_pdf.mjs
# Do not use `playwright install-deps` here: upstream script targets older Debian and fails on trixie (missing ttf-* names).
# The Hermes base image already ships Chromium library deps; add an explicit apt layer only if `playwright install chromium` fails at runtime.
RUN npm install --omit=dev \
  && npx playwright install chromium \
  && chown -R 10000:1001 /opt/hermes-pdf-export /opt/ms-playwright \
  && chmod -R g+rX /opt/hermes-pdf-export /opt/ms-playwright

COPY gateway-entrypoint.sh /stack-gateway-entrypoint.sh
RUN chmod +x /stack-gateway-entrypoint.sh
# Chain before upstream /opt/hermes/docker/entrypoint.sh so vault perms are fixed even if Chat never started.
ENTRYPOINT ["/stack-gateway-entrypoint.sh"]
