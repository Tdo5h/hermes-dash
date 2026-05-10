/**
 * Hermes API server streams OpenAI-style chat.completion.chunk plus
 * `event: hermes.tool.progress` with JSON: { tool, emoji, label } (see gateway/platforms/api_server.py).
 */

import { STRUCTURING_PHASE_DISPLAY_LINE } from "@/lib/shared-ingest-hero-copy";

export type HermesToolProgressPayload = {
  tool?: string;
  emoji?: string;
  label?: string;
  /** Optional catalog id when the gateway forwards the LLM used for a sub-step. */
  model?: string;
  /** When Hermes forwards per-tool USD (optional; may be added by the gateway). */
  cost_usd?: number;
  costUsd?: number;
};

/** Normalize `hermes.tool.progress` cost fields (snake_case vs camelCase). */
export function toolProgressPayloadUsd(p: HermesToolProgressPayload): number {
  const a = p.cost_usd;
  const b = p.costUsd;
  const v =
    typeof a === "number" && Number.isFinite(a)
      ? a
      : typeof b === "number" && Number.isFinite(b)
        ? b
        : NaN;
  return Number.isFinite(v) ? v : 0;
}

const HEADLINE_MAX = 72;
/** ~5× one-line cap; orb “auto-expand thinking” shows multiple lines. */
const HEADLINE_EXPANDED_MAX = 360;

/** Model/gateway sometimes sends the same vague label for every tool progress tick. */
const VAGUE_TOOL_PROGRESS_LABEL =
  /deep\s+read|careful\s+read|reading\s+your\s+document|working\s+on\s+your\s+document/i;

/** Friendly labels for common Hermes tools (snake_case names). */
export const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  web_extract: "Reading page",
  browser_navigate: "Browsing",
  read_file: "Reading file",
  write_file: "Writing file",
  search_files: "Searching files",
  terminal: "Running command",
  execute_code: "Running code",
  memory: "Updating memory",
  vision_analyze: "Analyzing image",
  image_generate: "Generating image",
  image_edit: "Editing image",
  delegate_task: "Delegating task",
  mcp_call: "Calling tool",
  skills_list: "Listing skills",
  skill_view: "Reading a skill",
  skill_manage: "Updating skills",
};

const CANONICAL_ACTIVITY_BY_LOWER: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of Object.values(TOOL_LABELS)) {
    const k = v.toLowerCase();
    if (!m.has(k)) m.set(k, v);
  }
  return m;
})();

const TOOL_KEY_HUMAN_UNMAPPED = new Set(
  Object.keys(TOOL_LABELS).map((k) => k.replace(/_/g, " ").toLowerCase())
);

/** If `phrase` matches a TOOL_LABELS value (case-insensitive), return that canonical string. */
export function canonicalActivityLabelMatch(phrase: string): string | null {
  const n = phrase.replace(/\s+/g, " ").trim();
  if (!n) return null;
  return CANONICAL_ACTIVITY_BY_LOWER.get(n.toLowerCase()) ?? null;
}

/** True when the gateway sends a tool name as spaces (e.g. read_file → “read file”) or a known friendly label. */
export function isMechanicalIngestStreamHeadline(text: string): boolean {
  const n = text.replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (canonicalActivityLabelMatch(n) != null) return true;
  return TOOL_KEY_HUMAN_UNMAPPED.has(n.toLowerCase());
}

/**
 * Ingest UIs should show the mapped phase line (g.label) instead of the raw stream headline
 * for vague ticks, known tools, and common placeholders.
 */
export function isUseMappedIngestActivityHeadline(headline: string): boolean {
  const n = headline.replace(/\s+/g, " ").trim();
  if (!n) return true;
  const lower = n.toLowerCase();
  if (lower === "working") return true;
  if (lower === "running command" || lower === "running code") return true;
  if (lower === "processing your upload") return true;
  if (lower === STRUCTURING_PHASE_DISPLAY_LINE.toLowerCase()) return true;
  if (VAGUE_TOOL_PROGRESS_LABEL.test(n)) return true;
  if (isMechanicalIngestStreamHeadline(n)) return true;
  if (/\.(md|json|jsonl|yaml|yml)\b/i.test(n)) return true;
  if (/\/?(wiki|brain|index|extracted|segments|sources)\//i.test(n)) return true;
  return false;
}

function basenamePath(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const parts = t.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? t;
  return last.length > 48 ? `${last.slice(0, 45)}…` : last;
}

function clampWithMiddleEllipsis(s: string, max: number): string {
  if (s.length <= max) return s;
  const mid = "…";
  const budget = max - mid.length;
  const headLen = Math.max(0, Math.floor(budget / 2));
  const tailLen = Math.max(0, budget - headLen);
  return s.slice(0, headLen) + mid + s.slice(s.length - tailLen);
}

/** Shorten path-like labels; keep a single headline line. */
export function sanitizeActivityHeadline(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/[/\\]/.test(s) || /^[A-Za-z]:\\/.test(s)) {
    s = basenamePath(s);
    if (s.length > 1) s = `…/${s}`;
  }
  if (s.length > HEADLINE_MAX) s = s.slice(0, HEADLINE_MAX - 1) + "…";
  return s;
}

/**
 * Wider path / label text for the chat orb when “auto-expand thinking” is on.
 * Keeps full path-like labels (no basename-only collapse); clamps with middle ellipsis.
 */
export function sanitizeActivityHeadlineExpanded(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > HEADLINE_EXPANDED_MAX) return clampWithMiddleEllipsis(s, HEADLINE_EXPANDED_MAX);
  return s;
}

export function headlineFromToolProgress(payload: HermesToolProgressPayload): string {
  const tool = (payload.tool || "").trim();
  const label = (payload.label || "").trim();
  const mapped = tool ? TOOL_LABELS[tool] : undefined;
  const vagueLabel = label.length > 0 && VAGUE_TOOL_PROGRESS_LABEL.test(label);

  let out: string;
  if (mapped) {
    out = mapped;
    if (label && !vagueLabel) {
      const piece = sanitizeActivityHeadline(label);
      const tNorm = tool.replace(/_/g, " ").toLowerCase();
      if (
        piece.length > 0 &&
        piece.toLowerCase() !== tNorm &&
        piece.toLowerCase() !== mapped.toLowerCase() &&
        !piece.toLowerCase().startsWith(mapped.toLowerCase() + " —")
      ) {
        out = `${mapped} — ${
          piece.length > 44 ? `${piece.slice(0, 41)}…` : piece
        }`;
      }
    }
  } else if (tool) {
    out = tool.replace(/_/g, " ");
  } else if (label && !vagueLabel) {
    out = label;
  } else if (label) {
    out = STRUCTURING_PHASE_DISPLAY_LINE;
  } else {
    out = "Working";
  }
  return sanitizeActivityHeadline(out);
}

export function headlineFromToolProgressExpanded(
  payload: HermesToolProgressPayload
): string {
  const tool = (payload.tool || "").trim();
  const label = (payload.label || "").trim();
  const mapped = tool ? TOOL_LABELS[tool] : undefined;
  const vagueLabel = label.length > 0 && VAGUE_TOOL_PROGRESS_LABEL.test(label);

  let out: string;
  if (mapped) {
    out = mapped;
    if (label && !vagueLabel) {
      const piece = sanitizeActivityHeadlineExpanded(label);
      const tNorm = tool.replace(/_/g, " ").toLowerCase();
      if (
        piece.length > 0 &&
        piece.toLowerCase() !== tNorm &&
        piece.toLowerCase() !== mapped.toLowerCase() &&
        !piece.toLowerCase().startsWith(mapped.toLowerCase() + " —")
      ) {
        out = `${mapped} — ${piece}`;
      }
    }
  } else if (tool) {
    out = tool.replace(/_/g, " ");
  } else if (label && !vagueLabel) {
    out = label;
  } else if (label) {
    out = STRUCTURING_PHASE_DISPLAY_LINE;
  } else {
    out = "Working";
  }
  return sanitizeActivityHeadlineExpanded(out);
}

export function headlineFromToolCallName(name: string | undefined): string | null {
  if (!name || typeof name !== "string") return null;
  const t = name.trim();
  if (!t) return null;
  const mapped = TOOL_LABELS[t];
  return sanitizeActivityHeadline(mapped || t.replace(/_/g, " "));
}

export function headlineFromToolCallNameExpanded(
  name: string | undefined
): string | null {
  if (!name || typeof name !== "string") return null;
  const t = name.trim();
  if (!t) return null;
  const mapped = TOOL_LABELS[t];
  return sanitizeActivityHeadlineExpanded(mapped || t.replace(/_/g, " "));
}

type DeltaShape = {
  /** Most models: string deltas. Gemini / some OpenRouter paths: multimodal part arrays. */
  content?: string | null | unknown[];
  /** OpenRouter-style image outputs on the delta (parallel to string content). */
  images?: unknown[] | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    function?: { name?: string };
    id?: string;
  }>;
};

function dataUriFromInlinePayload(mime: string, b64: string): string {
  const mt =
    mime && mime.includes("/") ? mime.trim() : "image/png";
  const raw = b64.replace(/\s+/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!raw) return "";
  return `data:${mt};base64,${raw}`;
}

function imageUrlFromMultimodalPart(p: Record<string, unknown>): string {
  const iu = p.image_url ?? p.imageUrl ?? p.url;
  if (typeof iu === "string" && iu.trim()) return iu.trim();
  if (iu && typeof iu === "object") {
    const o = iu as Record<string, unknown>;
    const u = o.url ?? o.URL;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  const inline =
    (p.inline_data as Record<string, unknown> | undefined) ??
    (p.inlineData as Record<string, unknown> | undefined);
  if (inline && typeof inline === "object") {
    const data = inline.data;
    const mime = String(
      inline.mime_type ??
        inline.mimeType ??
        inline.media_type ??
        inline.mediaType ??
        "image/png"
    );
    if (typeof data === "string" && data.trim()) {
      const du = dataUriFromInlinePayload(mime, data);
      if (du) return du;
    }
  }
  const src = p.source as Record<string, unknown> | undefined;
  if (src && typeof src === "object") {
    const st = String(src.type ?? "").toLowerCase();
    if (st === "base64") {
      const data = src.data;
      const mime = String(
        src.media_type ?? src.mime_type ?? src.mimeType ?? "image/png"
      );
      if (typeof data === "string" && data.trim()) {
        const du = dataUriFromInlinePayload(mime, data);
        if (du) return du;
      }
    }
    if (st === "url") {
      const u = src.url;
      if (typeof u === "string" && u.trim()) return u.trim();
    }
  }
  const b64 = p.b64_json ?? p.base64;
  if (typeof b64 === "string" && b64.trim()) {
    const mime = String(p.mime_type ?? p.media_type ?? "image/png");
    return dataUriFromInlinePayload(mime, b64);
  }
  return "";
}

/** Append one chunk's `delta.content` (string or multimodal array) and optional `delta.images`. */
function appendDeltaMultimodalToAcc(
  delta: Record<string, unknown>,
  acc: string
): string {
  let next = acc;
  const content = delta.content;
  if (typeof content === "string" && content) {
    next += content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const typ = String(p.type ?? "").toLowerCase();
      if (typ === "text") {
        const text = p.text;
        if (typeof text === "string" && text) next += text;
        continue;
      }
      if (
        typ === "image_url" ||
        typ === "image" ||
        typ === "input_image" ||
        typ === "output_image" ||
        typ === "image_generation" ||
        typ === "inline_data"
      ) {
        const url = imageUrlFromMultimodalPart(p);
        if (
          url &&
          (url.startsWith("data:image/") ||
            url.startsWith("https://") ||
            url.startsWith("http://"))
        ) {
          next += `\n\n![](${url})\n\n`;
        }
      }
    }
  }

  const images = delta.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string" && img.trim()) {
        const u = img.trim();
        if (
          u.startsWith("data:image/") ||
          u.startsWith("https://") ||
          u.startsWith("http://")
        ) {
          next += `\n\n![](${u})\n\n`;
        }
        continue;
      }
      if (img && typeof img === "object") {
        const o = img as Record<string, unknown>;
        const url =
          imageUrlFromMultimodalPart(o) ||
          (typeof o.url === "string" ? o.url.trim() : "");
        if (
          url &&
          (url.startsWith("data:image/") ||
            url.startsWith("https://") ||
            url.startsWith("http://"))
        ) {
          next += `\n\n![](${url})\n\n`;
        }
      }
    }
  }

  return next;
}

/**
 * Convert a non-streaming `choices[0].message` body (string or multimodal content + images) to markdown.
 */
export function assistantMessageBodyToMarkdown(message: {
  content?: unknown;
  images?: unknown;
} | null | undefined): string {
  if (!message) return "";
  return appendDeltaMultimodalToAcc(
    { content: message.content, images: message.images } as Record<string, unknown>,
    ""
  );
}

/** True when a chunk has non-empty model reasoning (no user-visible content yet in many APIs). */
export function hasNonEmptyReasoningInChunkJson(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr) as {
      choices?: Array<{ delta?: DeltaShape }>;
    };
    const d = parsed.choices?.[0]?.delta;
    if (!d) return false;
    const r = d.reasoning_content ?? d.reasoning;
    return typeof r === "string" && r.trim().length > 0;
  } catch {
    return false;
  }
}

export type HermesInferenceChainStep = {
  model: string;
  role?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number | null;
  prompt_cost_usd?: number | null;
  completion_cost_usd?: number | null;
  cost_basis?: string;
};

export type HermesChunkUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** When the gateway forwards upstream USD accounting (e.g. some OpenRouter-compatible paths). */
  cost?: number;
  /** Optional split when upstream reports prompt vs completion cost (USD). */
  prompt_cost?: number;
  completion_cost?: number;
  /** Hermes gateway: per-step breakdown (LLM est. + image native, …). */
  hermes_inference_chain?: HermesInferenceChainStep[];
};

/**
 * Sum usage across multiple stream chunks (multi-step agent turns).
 * Per-chunk usage is treated as additive. If Hermes ever emits **cumulative** session totals
 * per chunk instead of per-completion deltas, summing would double-count — re-check gateway SSE.
 */
export function accumulateHermesChunkUsage(
  acc: HermesChunkUsage | undefined,
  chunk: HermesChunkUsage
): HermesChunkUsage {
  if (!acc) {
    return {
      prompt_tokens: chunk.prompt_tokens,
      completion_tokens: chunk.completion_tokens,
      total_tokens: chunk.total_tokens,
      ...(typeof chunk.cost === "number" && Number.isFinite(chunk.cost)
        ? { cost: chunk.cost }
        : {}),
      ...(typeof chunk.prompt_cost === "number" && Number.isFinite(chunk.prompt_cost)
        ? { prompt_cost: chunk.prompt_cost }
        : {}),
      ...(typeof chunk.completion_cost === "number" &&
      Number.isFinite(chunk.completion_cost)
        ? { completion_cost: chunk.completion_cost }
        : {}),
      ...(Array.isArray(chunk.hermes_inference_chain) && chunk.hermes_inference_chain.length > 0
        ? { hermes_inference_chain: chunk.hermes_inference_chain }
        : {}),
    };
  }
  const next: HermesChunkUsage = {
    prompt_tokens: acc.prompt_tokens + chunk.prompt_tokens,
    completion_tokens: acc.completion_tokens + chunk.completion_tokens,
    total_tokens: acc.total_tokens + chunk.total_tokens,
  };
  if (typeof acc.cost === "number" || typeof chunk.cost === "number") {
    const a = typeof acc.cost === "number" && Number.isFinite(acc.cost) ? acc.cost : 0;
    const c = typeof chunk.cost === "number" && Number.isFinite(chunk.cost) ? chunk.cost : 0;
    next.cost = a + c;
  }
  if (typeof acc.prompt_cost === "number" || typeof chunk.prompt_cost === "number") {
    const a =
      typeof acc.prompt_cost === "number" && Number.isFinite(acc.prompt_cost)
        ? acc.prompt_cost
        : 0;
    const c =
      typeof chunk.prompt_cost === "number" && Number.isFinite(chunk.prompt_cost)
        ? chunk.prompt_cost
        : 0;
    next.prompt_cost = a + c;
  }
  if (typeof acc.completion_cost === "number" || typeof chunk.completion_cost === "number") {
    const a =
      typeof acc.completion_cost === "number" && Number.isFinite(acc.completion_cost)
        ? acc.completion_cost
        : 0;
    const c =
      typeof chunk.completion_cost === "number" && Number.isFinite(chunk.completion_cost)
        ? chunk.completion_cost
        : 0;
    next.completion_cost = a + c;
  }
  if (
    Array.isArray(chunk.hermes_inference_chain) &&
    chunk.hermes_inference_chain.length > 0
  ) {
    next.hermes_inference_chain = chunk.hermes_inference_chain;
  }
  return next;
}

/** Normalize gateway ``usage.hermes_inference_chain`` (non-stream JSON or final SSE chunk). */
export function normalizeHermesInferenceChain(
  raw: unknown
): HermesInferenceChainStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: HermesInferenceChainStep[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const mod = r.model;
    if (typeof mod !== "string" || !mod.trim()) continue;
    const costUsd = r.cost_usd;
    const pt = r.prompt_tokens;
    const ct = r.completion_tokens;
    const tt = r.total_tokens;
    const role = r.role;
    const cb = r.cost_basis;
    rows.push({
      model: mod.trim(),
      ...(typeof role === "string" && role.trim() ? { role: role.trim() } : {}),
      ...(typeof pt === "number" && Number.isFinite(pt) ? { prompt_tokens: pt } : {}),
      ...(typeof ct === "number" && Number.isFinite(ct) ? { completion_tokens: ct } : {}),
      ...(typeof tt === "number" && Number.isFinite(tt) ? { total_tokens: tt } : {}),
      ...(typeof costUsd === "number" && Number.isFinite(costUsd)
        ? { cost_usd: costUsd }
        : {}),
      ...(typeof r.prompt_cost_usd === "number" && Number.isFinite(r.prompt_cost_usd)
        ? { prompt_cost_usd: r.prompt_cost_usd }
        : {}),
      ...(typeof r.completion_cost_usd === "number" &&
      Number.isFinite(r.completion_cost_usd)
        ? { completion_cost_usd: r.completion_cost_usd }
        : {}),
      ...(typeof cb === "string" && cb.trim() ? { cost_basis: cb.trim() } : {}),
    });
  }
  return rows.length > 0 ? rows : undefined;
}

/** Last chunk may include `usage` when the request sets `stream_options: { include_usage: true }`. */
export function parseUsageAndModelFromChunkJson(jsonStr: string): {
  model?: string;
  usage?: HermesChunkUsage;
} {
  try {
    const parsed = JSON.parse(jsonStr) as {
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        hermes_inference_chain?: unknown;
      };
    };
    const out: { model?: string; usage?: HermesChunkUsage } = {};
    if (typeof parsed.model === "string" && parsed.model.trim()) {
      out.model = parsed.model.trim();
    }
    const u = parsed.usage;
    if (u && typeof u.total_tokens === "number") {
      const uExt = u as {
        cost?: unknown;
        prompt_cost?: unknown;
        completion_cost?: unknown;
      };
      const costRaw = uExt.cost;
      const cost =
        typeof costRaw === "number" && Number.isFinite(costRaw) ? costRaw : undefined;
      const promptCostRaw = uExt.prompt_cost;
      const prompt_cost =
        typeof promptCostRaw === "number" && Number.isFinite(promptCostRaw)
          ? promptCostRaw
          : undefined;
      const completionCostRaw = uExt.completion_cost;
      const completion_cost =
        typeof completionCostRaw === "number" && Number.isFinite(completionCostRaw)
          ? completionCostRaw
          : undefined;
      const chain = normalizeHermesInferenceChain(u.hermes_inference_chain);
      out.usage = {
        prompt_tokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
        completion_tokens:
          typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
        total_tokens: u.total_tokens,
        ...(cost !== undefined ? { cost } : {}),
        ...(prompt_cost !== undefined ? { prompt_cost } : {}),
        ...(completion_cost !== undefined ? { completion_cost } : {}),
        ...(chain ? { hermes_inference_chain: chain } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Append text from a chat.completion.chunk `data:` JSON line. */
export function appendAssistantFromChunkJson(jsonStr: string, acc: string): string {
  try {
    const parsed = JSON.parse(jsonStr) as {
      choices?: Array<{ delta?: DeltaShape }>;
    };
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return acc;
    return appendDeltaMultimodalToAcc(delta as Record<string, unknown>, acc);
  } catch {
    return acc;
  }
}

/** Best-effort tool name from streaming tool_calls delta (partial fragments). */
export function toolNameHintFromChunkJson(jsonStr: string): string | null {
  try {
    const parsed = JSON.parse(jsonStr) as {
      choices?: Array<{ delta?: DeltaShape }>;
    };
    const tc = parsed.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(tc)) return null;
    for (const t of tc) {
      const n = t?.function?.name;
      if (typeof n === "string" && n.trim()) return n.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function parseSseBlock(raw: string): { event?: string; data: string } | null {
  const lines = raw.split("\n");
  let eventName: string | undefined;
  const dataParts: string[] = [];
  for (const line of lines) {
    const l = line.replace(/\r$/, "");
    if (!l || l.startsWith(":")) continue;
    if (l.startsWith("event:")) {
      eventName = l.slice(6).trim();
    } else if (l.startsWith("data:")) {
      dataParts.push(l.slice(5).trimStart());
    }
  }
  if (!dataParts.length) return null;
  return { event: eventName, data: dataParts.join("\n") };
}

export async function* sseEventsFromReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) {
      buf += decoder.decode();
    }
    for (;;) {
      const sep = buf.indexOf("\n\n");
      if (sep < 0) break;
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const parsed = parseSseBlock(raw);
      if (parsed) yield parsed;
    }
    if (done) break;
  }
  if (buf.trim()) {
    const parsed = parseSseBlock(buf);
    if (parsed) yield parsed;
  }
}
