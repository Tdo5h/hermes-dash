/**
 * Lightweight cleanup so TTS does not read raw markdown/code punctuation aloud.
 * Replaces tables and spreadsheet-like blocks with a short cue so TTS does not read every cell/digit.
 */

/** Spoken once per removed block (or consecutive blocks collapse to one). */
export const FORMATTED_BLOCK_TTS_PLACEHOLDER =
  "There's a table or formatted layout in this message; see it in the chat.";

function collapseDuplicatePlaceholders(s: string): string {
  const esc = FORMATTED_BLOCK_TTS_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return s.replace(new RegExp(`(?:\\s*${esc}\\s*)+`, "g"), ` ${FORMATTED_BLOCK_TTS_PLACEHOLDER} `);
}

function replaceLineRuns(
  s: string,
  isRunLine: (line: string) => boolean,
  minRun: number
): string {
  const lines = s.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isRunLine(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isRunLine(lines[i])) i++;
    const len = i - start;
    if (len >= minRun) {
      out.push(FORMATTED_BLOCK_TTS_PLACEHOLDER);
    } else {
      for (let k = start; k < i; k++) out.push(lines[k]);
    }
  }
  return out.join("\n");
}

/** GFM-style | col | col | rows and | --- | separators. */
function isPipeTableLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  if (/^\|[\s\-:|]+\|$/.test(t) && /-/.test(t)) return true;
  return t.endsWith("|") && t.length >= 3;
}

/** 4+ space indent, but not a markdown sub-list line (`-`, `*`, `1.`). */
function isIndentedCodeLine(line: string): boolean {
  if (!/^ {4,}/.test(line)) return false;
  const t = line.replace(/^ +/, "");
  if (/^[-*+]\s/.test(t)) return false;
  if (/^\d+\.\s/.test(t)) return false;
  return t.length > 0;
}

/** Tab-separated with 3+ columns, or multiple wide space gaps (2+ spaces) between tokens — columnar. */
function looksTabularLine(line: string): boolean {
  if (!line.trim()) return false;
  if (line.includes("\t")) {
    const parts = line.split("\t");
    if (parts.length >= 3) return true;
  }
  return /\S(?:\s{2,})\S(?:\s{2,})\S/.test(line);
}

/** Prefer lines that look like data (digits) to reduce false positives on prose with double spaces. */
function looksTabularLineStrict(line: string): boolean {
  if (!looksTabularLine(line)) return false;
  const t = line.trim();
  if (!t) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  return digits >= 2 || t.includes("\t");
}

/**
 * Replace LLM-heavy punctuation with spoken phrasing (arrows, double hyphens, spaced slashes).
 * Run after fenced-code removal so code keeps operators; conservative on `/` and `-` inside tokens.
 */
export function normalizeLlmOutputForSpeech(s: string): string {
  let t = s;

  t = t.replace(/(?:^|\n)\s*[-*]{3,}\s*(?=\n|$)/g, "\n");

  t = t.replace(/\u2194|\u21d4|\u27f7/g, " or ");
  t = t.replace(/\u2190|\u21a9|\u21e6/g, " from ");
  t = t.replace(
    /[\u2192\u21d2\u279c\u2794\u27a1\u27f6\u27f9\u21aa\u21e8\u279d\u27a2]/gu,
    " to "
  );

  t = t.replace(/\s*-->\s*/g, " to ");
  t = t.replace(/\s+->\s+/g, " to ");

  t = t.replace(/(?<=\S)\s*--\s*(?=\S)/g, ", ");
  t = t.replace(/\s*[–—]\s*/g, ", ");

  t = t.replace(/(?<!\d) +\/ +(?!\d)/g, " or ");

  t = t.replace(/…/g, " ");
  t = t.replace(/\.{3,}/g, " ");

  t = t.replace(/\bto\b(?:\s+\bto\b)+/gi, " to ");
  t = t.replace(/\bor\b(?:\s+\bor\b)+/gi, " or ");

  return t;
}

export function stripMarkdownForSpeech(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n");

  s = s.replace(/```[\s\S]*?```/g, " ");
  s = normalizeLlmOutputForSpeech(s);

  s = replaceLineRuns(s, isPipeTableLine, 2);
  s = replaceLineRuns(s, looksTabularLineStrict, 3);
  s = replaceLineRuns(s, isIndentedCodeLine, 2);

  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");

  s = collapseDuplicatePlaceholders(s);
  s = s.replace(/[ \t]*\n+[ \t]*/g, ". ");
  s = s.replace(/(?:\.\s*){2,}/g, ". ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
