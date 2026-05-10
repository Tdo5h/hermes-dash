/**
 * Detects a closing "Would you like me to:" / similar block at the **tail** of an assistant
 * message so we can offer one-tap follow-up chips (not mid-message false positives).
 */

export type AssistantFollowUpOption = {
  /** Short label for the chip */
  label: string;
  /** Text sent as the user message */
  prompt: string;
};

const TAIL_LINE_WINDOW = 22;
const MAX_LABEL_LEN = 96;
const MAX_PROMPT_LEN = 600;

/**
 * Line that introduces a choice block at the **end** of the assistant message (whole line).
 * Allows a short phrase before the colon, e.g. "Would you like me to pick one:"
 */
const WOULD_YOU_LIKE_LINE =
  /^would you like me to\b[^:]{0,56}:\s*$/i;

/** Thanks / sign-off lines that sometimes follow real choices — not tap targets. */
function looksLikeClosingRemark(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return false;
  if (/^or\b/i.test(t)) return false;
  // Continuation of a question (parenthetical line)
  if (/^\([^)]+\)\??$/.test(t)) return false;
  if (t.length > 280) return false;
  return /^(i appreciate|thank you|thanks\b|you'?re welcome|hope this helps|glad to help|let me know(if)?\b|feel free to\b|happy to help\b)/i.test(
    t
  );
}

/**
 * Keeps only the choice text from a chunk; stops before a closing remark or extra paragraphs.
 * Fixes "Or … ?\n\nI appreciate…" being one chunk after Or-split.
 */
function trimChunkToChoiceOnly(chunk: string): string {
  const paras = chunk.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const head = paras[0] ?? "";
  const lines = head.split("\n").map((l) => l.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    if (looksLikeClosingRemark(line)) break;
    kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/** A line/paragraph we are willing to show as a one-tap follow-up. */
function looksLikeSelectionOption(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 12) return false;
  if (/^or\b/i.test(t)) return true;
  if (/\?\s*$/.test(t)) return true;
  if (/^\s*([-*•]|\d+[.)])\s+\S/.test(t)) return true;
  return false;
}

function splitOptionBlocks(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  const lines = trimmed.split("\n");
  const listItem = /^\s*([-*•]|\d+[.)])\s+(.+)$/;
  if (lines.some((l) => listItem.test(l))) {
    const out: string[] = [];
    let cur = "";
    for (const line of lines) {
      const m = line.match(listItem);
      if (m) {
        if (cur) out.push(cur.trim());
        cur = m[2] ?? "";
      } else if (!line.trim()) {
        if (cur) {
          out.push(cur.trim());
          cur = "";
        }
      } else {
        if (looksLikeClosingRemark(line)) break;
        cur = cur ? `${cur} ${line.trim()}` : line.trim();
      }
    }
    if (cur) out.push(cur.trim());
    return out.filter((s) => s.length >= 6 && looksLikeSelectionOption(s));
  }

  const orSplit = trimmed
    .split(/\n(?=Or\s+)/i)
    .map((p) => trimChunkToChoiceOnly(p))
    .filter((p) => p.length >= 6 && looksLikeSelectionOption(p));
  if (orSplit.length >= 2) return orSplit;

  const paras = trimmed
    .split(/\n\n+/)
    .map((p) => trimChunkToChoiceOnly(p))
    .filter((p) => p.length >= 6);

  const choiceParas: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (!looksLikeSelectionOption(p)) break;
    choiceParas.push(p);
  }
  if (choiceParas.length >= 2) return choiceParas;

  const singleLineOr = trimmed
    .split(/\s+(?=Or\s+)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 6 && looksLikeSelectionOption(p));
  if (singleLineOr.length >= 2) return singleLineOr;

  return [];
}

function trimPrompt(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_PROMPT_LEN) return t;
  return `${t.slice(0, MAX_PROMPT_LEN - 1)}…`;
}

function labelFromPrompt(prompt: string): string {
  const t = prompt.replace(/\?+$/, "").trim();
  if (t.length <= MAX_LABEL_LEN) return t;
  return `${t.slice(0, MAX_LABEL_LEN - 1)}…`;
}

/**
 * Returns follow-up options if the message ends with a recognized offer block
 * introduced in the last {@link TAIL_LINE_WINDOW} lines.
 */
export function extractAssistantFollowUpSuggestions(
  text: string
): AssistantFollowUpOption[] | null {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length < 40) return null;

  const lines = normalized.split("\n");
  if (lines.length < 3) return null;

  let triggerIdx = -1;
  const startScan = Math.max(0, lines.length - TAIL_LINE_WINDOW);
  for (let i = lines.length - 1; i >= startScan; i--) {
    if (WOULD_YOU_LIKE_LINE.test(lines[i].trim())) {
      triggerIdx = i;
      break;
    }
  }

  if (triggerIdx < 0) return null;

  const afterLines = lines.slice(triggerIdx + 1);
  const body = afterLines.join("\n").trim();
  if (body.length < 12) return null;

  const blocks = splitOptionBlocks(body);
  if (blocks.length < 2) return null;

  const options: AssistantFollowUpOption[] = [];
  for (const raw of blocks) {
    const prompt = trimPrompt(raw);
    if (prompt.length < 8) continue;
    options.push({
      label: labelFromPrompt(prompt),
      prompt: prompt.endsWith("?") ? `Yes. ${prompt}` : `Yes — ${prompt}`,
    });
  }

  return options.length >= 2 ? options : null;
}
