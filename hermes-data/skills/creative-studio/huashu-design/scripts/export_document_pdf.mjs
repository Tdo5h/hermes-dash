#!/usr/bin/env node
/**
 * export_document_pdf.mjs — single-file print-ready HTML → multi-page PDF (A4 / Letter)
 *
 * For long-form business documents (cover, sections, @page, @media print).
 * Decks with one HTML per slide should use export_deck_pdf.mjs; deck-stage uses export_deck_stage_pdf.mjs.
 *
 * Gateway image installs deps under /opt/hermes-pdf-export (see hermes-agent.Dockerfile).
 *
 * Usage:
 *   node export_document_pdf.mjs --html <file.html> --out <file.pdf> [--format A4|Letter] [--wait-ms 2500]
 *
 * Depends: playwright (Chromium installed via playwright install chromium in image build)
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const FORMATS = new Set(['A4', 'Letter']);

function parseArgs() {
  const args = { format: 'A4', waitMs: 2500 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const tok = a[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.replace(/^--/, '');
    const next = a[i + 1];
    if (key === 'format') {
      args.format = next;
      i++;
    } else if (key === 'wait-ms') {
      args.waitMs = parseInt(next, 10) || 2500;
      i++;
    } else if (key === 'html') {
      args.html = next;
      i++;
    } else if (key === 'out') {
      args.out = next;
      i++;
    }
  }
  if (!args.html || !args.out) {
    console.error(
      'Usage: node export_document_pdf.mjs --html <file.html> --out <file.pdf> [--format A4|Letter] [--wait-ms 2500]'
    );
    process.exit(1);
  }
  if (!FORMATS.has(args.format)) {
    console.error(`--format must be A4 or Letter, got: ${args.format}`);
    process.exit(1);
  }
  return args;
}

async function main() {
  const { html, out, format, waitMs } = parseArgs();
  const htmlAbs = path.resolve(html);
  const outFile = path.resolve(out);

  await fs.access(htmlAbs).catch(() => {
    console.error(`HTML file not found: ${htmlAbs}`);
    process.exit(1);
  });

  console.log(`Rendering ${path.basename(htmlAbs)} → ${path.basename(outFile)} (${format})`);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('file://' + htmlAbs, { waitUntil: 'networkidle' }).catch(() =>
    page.goto('file://' + htmlAbs, { waitUntil: 'domcontentloaded' })
  );
  await new Promise((r) => setTimeout(r, waitMs));
  await page.emulateMedia({ media: 'print' });

  await page.pdf({
    path: outFile,
    format,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  await browser.close();

  const stat = await fs.stat(outFile);
  const kb = (stat.size / 1024).toFixed(0);
  console.log(`Wrote ${outFile} (${kb} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
