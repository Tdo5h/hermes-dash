import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { isHeartbeatNoiseLabel } from "@/lib/heartbeat-noise";
import {
  getHermesBaseUrl,
  getHermesToken,
  getTitleChatModel,
} from "@/lib/hermes-config";
import { patchSessionLabel } from "@/lib/hermes-chat-store";

const TITLE_PROMPT =
  "Write one concise chat title in plain English (4-8 words). Name the central user goal, problem, or outcome from the transcript. Prefer concrete nouns from the user's messages and the latest real task over generic labels. Good style: Image Routing Fix, Timesheet Workflow Repair, Chat Divider Design. Bad style: Chat Help, App Improvements, Troubleshooting, General Discussion. Use normal words and spacing. Do not invent portmanteaus, merged words, or CamelCase product-style names unless they are real proper nouns from the topic. No quotes. No trailing punctuation.";

/**
 * Suggestion mode must not read as assistant small-talk. JSON keeps models from
 * "helping" the user in prose (questions, em dashes, "I'd love to help").
 */
const TITLE_MULTI_PROMPT = `You are a label generator for a chat app sidebar, not a conversational assistant.

Your ONLY output must be a single JSON array of exactly 3 strings, e.g. ["string1","string2","string3"].
No markdown fences. No keys. No text before or after the array.

Each string is a short folder-style chat name (4–8 words, plain English). Use noun phrases or short outcome phrases.
Rules for each string:
- Like a file or folder name: not a full sentence, not a question, not an offer to help.
- No greetings ("That sounds", "Great", "Sure"). No "I'd love", "I can help", "Let me", "Is there", "Would you".
- No em dash rambling. Use commas if you need a short clause.
- No question marks. No colons at the end.
- Differ in angle: e.g. user goal vs method vs result.
- Name the main user goal/problem/outcome, not assistant small-talk or generic app work.
- Prefer concrete project/topic nouns from user messages, especially the latest real task if the chat changed direction.
- Avoid vague labels such as "Chat Help", "App Improvements", "Troubleshooting", "General Discussion", "UI Updates", or "Code Review".
- Never use system/tool boilerplate as titles: no "memory" quotas (e.g. 2164/2200), no "replace or remove an entry", no context limits.

If you output anything that is not valid JSON, you have failed. Output JSON only.`;

const CHATTY_LINE_START =
  /^(that sounds|i'?d love|i would|is there|are you|let me|sure[,!]|here are|i can help|would you|could you|great question|i'm happy|happy to help)/i;

const CHATTY_LINE_CONTAINS = /\?|i'?d love to|happy to (help|explore)/i;

function normalizeTitle(raw: string, maxLen = 72): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^[\d.)]+\s*/, "")
    .replace(/[.!?]+$/g, "");
  if (cleaned.length <= maxLen) return cleaned;
  const clipped = cleaned.slice(0, maxLen);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trim();
}

function normalizeForDedupe(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeForDedupe(a);
  const nb = normalizeForDedupe(b);
  if (na === nb) return true;
  const pre = 40;
  if (na.slice(0, pre) === nb.slice(0, pre) && na.length > 12 && nb.length > 12) {
    return true;
  }
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return false;
  let inter = 0;
  for (const w of wa) {
    if (wb.has(w)) inter++;
  }
  const j = inter / Math.min(wa.size, wb.size);
  return j > 0.85;
}

function parseTitleLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    const t = normalizeTitle(line.replace(/^\d+[.)]\s*/, ""));
    if (t && !isHeartbeatNoiseLabel(t)) out.push(t);
  }
  return out;
}

function isBadTitleLine(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return true;
  if (t.length > 88) return true;
  if (t.split(/\s+/).length > 14) return true;
  if (t.includes("?")) return true;
  if (
    /^(chat|conversation|discussion|help|assistance|request|question|support|troubleshooting|general discussion|app improvements|ui updates|code changes|code review)$/i.test(
      t
    )
  ) {
    return true;
  }
  if (CHATTY_LINE_START.test(t)) return true;
  if (CHATTY_LINE_CONTAINS.test(t)) return true;
  if (/^(i|we)\s/i.test(t) && /help|glad|explore|wonder(ing|ed)?/i.test(t)) {
    return true;
  }
  /** Assistant/tool text sometimes echoed in transcripts (memory quota, context limits). */
  if (/\bmemory\b/i.test(t) && /\d{1,4}[,']?\d*\s*\/\s*\d{1,4}[,']?\d*/.test(t)) {
    return true;
  }
  if (
    /replace\s+or\s+remove\s+an?\s+existing/i.test(t) ||
    /existing\s+entr(y|ies)/i.test(t)
  ) {
    return true;
  }
  if (
    /\bcontext\s*(window|limit|quota|full|usage)\b/i.test(t) ||
    /token(s)?\s*(limit|budget|usage|remaining)/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Primary: JSON array. Fallback: non-JSON line split (old behavior), then drop chatty lines.
 */
function parseTitleArrayFromModel(text: string): string[] {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    const parsed = JSON.parse(unfenced);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => normalizeTitle(s))
        .filter(
          (s) =>
            s.length > 0 &&
            !isHeartbeatNoiseLabel(s) &&
            !isBadTitleLine(s)
        );
    }
  } catch {
    /* fall through to line-based */
  }
  return parseTitleLines(text).filter((s) => !isBadTitleLine(s));
}

function distinctTitles(titles: string[], max: number): string[] {
  const result: string[] = [];
  for (const t of titles) {
    if (result.length >= max) break;
    if (result.some((r) => isNearDuplicate(r, t))) continue;
    result.push(t);
  }
  return result;
}

function compactTitleContent(content: string, maxLen: number): string {
  const cleaned = content
    .replace(/\[metadata:[^\]]+\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  const clipped = cleaned.slice(0, maxLen);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

function buildTitleTranscript(
  messages: { role: string; content: string }[]
): string {
  const clean = messages
    .map((m, index) => ({
      index,
      role: m.role === "assistant" ? "assistant" : "user",
      content: compactTitleContent(String(m.content || ""), 700),
    }))
    .filter((m) => m.content.length > 0);

  const selected = new Map<number, (typeof clean)[number]>();
  const add = (m: (typeof clean)[number] | undefined) => {
    if (m) selected.set(m.index, m);
  };

  add(clean.find((m) => m.role === "user"));
  for (const m of clean.slice(0, 2)) add(m);
  for (const m of clean.filter((m) => m.role === "user").slice(-6)) add(m);
  for (const m of clean.slice(-8)) add(m);

  let out = Array.from(selected.values())
    .sort((a, b) => a.index - b.index)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  if (out.length > 3_800) {
    out = `${out.slice(0, 1_200)}\n...\n${out.slice(-2_400)}`;
  }
  return out;
}

export async function POST(req: Request) {
  const base = getHermesBaseUrl();
  const token = getHermesToken();
  if (!base || !token) {
    return Response.json(
      { error: "Missing HERMES_URL or HERMES_TOKEN" },
      { status: 503 }
    );
  }

  const body = (await req.json()) as {
    messages: { role: string; content: string }[];
    sessionKey: string;
    apply?: boolean;
    suggestionCount?: number;
  };
  const { messages, sessionKey } = body;
  const apply = body.apply !== false;
  const wantCount = Math.min(
    3,
    Math.max(1, Math.floor(Number(body.suggestionCount) || 1))
  );
  if (!sessionKey || !messages?.length) {
    return Response.json(
      { error: "sessionKey and messages required" },
      { status: 400 }
    );
  }

  const preview = buildTitleTranscript(messages);

  const client = createOpenAI({
    baseURL: `${base.replace(/\/$/, "")}/v1`,
    apiKey: token,
  });

  const modelId = getTitleChatModel();

  const systemPrompt = wantCount >= 2 ? TITLE_MULTI_PROMPT : TITLE_PROMPT;
  const userContent =
    wantCount >= 2
      ? `Here is a short excerpt of a chat thread. Propose 3 distinct sidebar label strings for it (JSON array only, per system instructions):\n\n${preview}`
      : `Title this chat from the transcript below. Pick the specific main point a user would recognize in the sidebar.\n\n${preview}`;

  try {
    async function runMulti(attempt: 1 | 2): Promise<string> {
      const { text } = await generateText({
        model: client.chat(modelId),
        temperature: attempt === 1 ? 0.38 : 0.15,
        maxOutputTokens: 220,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              attempt === 1
                ? userContent
                : `${userContent}\n\nRemember: output must be only a JSON array of 3 short strings, nothing else. Example: ["A","B","C"]`,
          },
        ],
      });
      return text;
    }

    if (wantCount >= 2) {
      let text = await runMulti(1);
      let candidates = parseTitleArrayFromModel(text);
      let unique = distinctTitles(candidates, wantCount);
      if (unique.length === 0) {
        text = await runMulti(2);
        candidates = parseTitleArrayFromModel(text);
        unique = distinctTitles(candidates, wantCount);
      }
      if (apply && unique[0] && !isHeartbeatNoiseLabel(unique[0])) {
        try {
          await patchSessionLabel(sessionKey, unique[0]);
        } catch {
          /* label persistence failed */
        }
      }
      return Response.json({ titles: unique, title: unique[0] || "" });
    }

    const { text } = await generateText({
      model: client.chat(modelId),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const title = normalizeTitle(text);

    if (apply && !isHeartbeatNoiseLabel(title)) {
      try {
        await patchSessionLabel(sessionKey, title);
      } catch {
        // label persistence failed — title still returned to client
      }
    }

    return Response.json({
      title: isHeartbeatNoiseLabel(title) ? "" : title,
      titles: isHeartbeatNoiseLabel(title) ? [] : [title],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
