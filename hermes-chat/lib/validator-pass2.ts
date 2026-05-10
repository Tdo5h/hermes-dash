import { createHash } from "crypto";

export type ValidatorTriggerReason =
  | "critical"
  | "json_fence_parse"
  | "short_reply_after_tools"
  | "sample";

/** User message requests Pass 2 (mirrors ingest metadata style). */
export function userMessageIsCritical(text: string): boolean {
  return /\[metadata:\s*critical=1\b/i.test(text);
}

const JSON_FENCE_RE = /```\s*json\s*([\s\S]*?)```/gi;

/** True if any ```json fence exists and its body is non-empty invalid JSON. */
export function replyHasBrokenJsonFence(reply: string): boolean {
  JSON_FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_FENCE_RE.exec(reply)) !== null) {
    const body = (m[1] || "").trim();
    if (!body) continue;
    try {
      JSON.parse(body);
    } catch {
      return true;
    }
  }
  return false;
}

function deterministicSampleHit(
  sessionKey: string,
  reply: string,
  percent: number
): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = createHash("sha256")
    .update(sessionKey + "\0" + reply.slice(0, 4000))
    .digest();
  const n = h[0]! % 100;
  return n < percent;
}

export function shouldValidatePass1(params: {
  lastUserPlain: string;
  reply: string;
  sawToolProgress: boolean;
  sessionKey: string;
  samplePercent: number;
  minReplyCharsAfterTools: number;
}): { run: boolean; reasons: ValidatorTriggerReason[] } {
  const reasons: ValidatorTriggerReason[] = [];
  if (userMessageIsCritical(params.lastUserPlain)) reasons.push("critical");
  if (replyHasBrokenJsonFence(params.reply)) reasons.push("json_fence_parse");
  if (
    params.sawToolProgress &&
    params.reply.trim().length < params.minReplyCharsAfterTools
  ) {
    reasons.push("short_reply_after_tools");
  }
  if (
    params.samplePercent > 0 &&
    deterministicSampleHit(params.sessionKey, params.reply, params.samplePercent)
  ) {
    reasons.push("sample");
  }
  return { run: reasons.length > 0, reasons };
}

export const VALIDATOR_SYSTEM_PROMPT = [
  "You validate another assistant's draft reply in the same chat.",
  "Rules:",
  "- If the draft is adequate (correct, complete enough for the user, and any ```json fences contain valid JSON), output exactly one line: APPROVED",
  "- If the draft must be replaced, first line must be REVISED, then one blank line, then the full replacement assistant message only (markdown allowed).",
  "- Do not explain the validation; do not add preface to the REVISED body.",
].join("\n");

export function buildValidatorUserPayload(
  reasons: ValidatorTriggerReason[],
  userExcerpt: string,
  draft: string
): string {
  return [
    `Triggers: ${reasons.join(", ")}`,
    "",
    "User request (excerpt):",
    userExcerpt.slice(0, 8000),
    "",
    "Assistant draft:",
    draft.slice(0, 120_000),
  ].join("\n");
}

/**
 * Parse Pass 2 output. On ambiguous output, keep Pass 1 (`approved`).
 */
export function parseValidatorResponse(
  raw: string,
  pass1Reply: string
): { approved: boolean; text: string } {
  const t = raw.trim();
  const firstNl = t.indexOf("\n");
  const firstLine = (firstNl === -1 ? t : t.slice(0, firstNl)).trim();
  const head = firstLine.toUpperCase();
  if (head === "APPROVED" || head.startsWith("APPROVED")) {
    return { approved: true, text: pass1Reply };
  }
  if (head === "REVISED" || head.startsWith("REVISED")) {
    const rest = firstNl === -1 ? "" : t.slice(firstNl + 1).trim();
    if (rest.length > 0) return { approved: false, text: rest };
  }
  return { approved: true, text: pass1Reply };
}
