import path from "path";
import { readFile } from "fs/promises";
import { getHermesDataDir } from "@/lib/hermes-config";
import { fetchFalWithRetries } from "@/lib/fal-mirror";
import { saveBufferAsWebchatImage, saveDataUrlAsWebchatImage } from "@/lib/images";
import {
  hasLikelyMarkdownImageRef,
  isLikelyMarkdownImageSrc,
  stripInvalidMarkdownImageRefs,
} from "@/lib/markdown-image-sanitize";

export type GatewaySessionMessage = { role?: string; content?: unknown };

/** Spilled binary from gateway `normalize_tool_image_for_session` (shared `HERMES_DATA_DIR`). */
const REL_TOOL_IMAGE_RE = /^tool_images\/[a-zA-Z0-9._-]+$/;

const HALLUCINATED_API_IMAGE_NAMES = new Set([
  "latest.png",
  "image.png",
  "generated.png",
  "output.png",
  "result.png",
]);

/** Webchat `saveBufferAsWebchatImage` ids are `randomUUID()` + extension — not raw gateway hex. */
const WEBCHAT_STORED_IMAGE_STEM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiImageIdLooksLikeWebchatStoredId(rawId: string): boolean {
  let id = rawId.trim();
  const cut = id.search(/[?#]/);
  if (cut >= 0) id = id.slice(0, cut);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep */
  }
  const stem = path.parse(id).name;
  return WEBCHAT_STORED_IMAGE_STEM_RE.test(stem);
}

/**
 * `![](/api/images/<32-hex>.<ext>)` is never a valid webchat filename (those are UUIDs). Models cite
 * gateway spill names here; if mirroring failed, strip so enrich can append a working link.
 */
function stripGatewayHexApiImageMarkdown(markdown: string): string {
  return markdown.replace(
    /!\[[^\]]*\]\(\s*\/api\/images\/([a-f0-9]{32}\.[a-z0-9]{2,10})\s*\)/gi,
    ""
  );
}

function isRelativeHermesToolImagePath(s: string): boolean {
  return REL_TOOL_IMAGE_RE.test(s.trim());
}

function scrubHallucinatedApiImageRefs(reply: string): string {
  let out = reply;
  for (const id of HALLUCINATED_API_IMAGE_NAMES) {
    const esc = id.replace(/\./g, "\\.");
    out = out.replace(
      new RegExp(`!\\[[^\\]]*\\]\\(/api/images/${esc}\\)`, "gi"),
      ""
    );
  }
  out = out.replace(/!\[[^\]]*\]\(\s*https?:\/\/[`'"\s)]*\)/gi, "");
  return stripInvalidMarkdownImageRefs(out).replace(/\n{3,}/g, "\n\n").trimEnd();
}

function contentTypeForToolImageFile(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".avif") return "image/avif";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  return "image/png";
}

/**
 * Persist a gateway `tool_images/...` file into webchat storage; returns new image id or null.
 */
export async function mirrorHermesToolImageFileToWebchat(
  rel: string
): Promise<string | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  const relTrim = rel.trim();
  if (!isRelativeHermesToolImagePath(relTrim)) return null;
  const resolved = path.resolve(path.join(root, relTrim));
  const prefix = path.resolve(path.join(root, "tool_images")) + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  const delaysMs = [0, 60, 120, 200, 320, 500];
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
    try {
      const buf = await readFile(resolved);
      if (!buf.length) continue;
      const { id } = await saveBufferAsWebchatImage(
        buf,
        contentTypeForToolImageFile(resolved)
      );
      return id;
    } catch {
      /* tool file may lag the streamed assistant message slightly */
    }
  }
  return null;
}

/** `![alt](tool_images/foo.png)` — relative on the chat origin; must mirror. */
const MD_TOOL_IMAGE_HREF_RE =
  /!\[([^\]]*)\]\((tool_images\/[a-zA-Z0-9._-]+)\)/gi;

/**
 * `![alt](/api/images/tool_images/foo.png)` — model merges instructions; `/api/images/[id]` only
 * allows a single path segment, so this URL always 404s until we rewrite to a real stored id.
 */
const MD_HALLUCINATED_API_TOOL_IMAGE_RE =
  /!\[([^\]]*)\]\(\/api\/images\/(tool_images\/[a-zA-Z0-9._-]+)\)/gi;

/** Markdown `![](/api/images/...)` — capture href inside parens. */
const MD_API_IMAGE_HREF_RE = /!\[[^\]]*\]\(\/api\/images\/([^)]+)\)/gi;

/**
 * Gateway spill files are named ``<32-hex>.<ext>`` (no hyphens). Models often cite
 * ``/api/images/`` + the same hex **with fake UUID hyphens**, which is **not** the webchat
 * ``randomUUID()`` filename → 404. Remap when ``tool_images/<hex>.<ext>`` exists on disk.
 */
async function remapHallucinatedApiPathsToMirroredSpill(
  markdown: string
): Promise<string> {
  if (!markdown.includes("/api/images/")) return markdown;
  const rawHrefs = new Set<string>();
  for (const m of markdown.matchAll(MD_API_IMAGE_HREF_RE)) {
    const t = (m[1] ?? "").trim();
    if (t) rawHrefs.add(t);
  }
  if (rawHrefs.size === 0) return markdown;

  const hrefToNewId = new Map<string, string>();
  for (const rawHref of rawHrefs) {
    let href = rawHref;
    const cut = href.search(/[?#]/);
    if (cut >= 0) href = href.slice(0, cut);
    try {
      href = decodeURIComponent(href);
    } catch {
      /* keep */
    }
    if (!href || href.includes("..")) continue;
    /* `![](/api/images/tool_images/foo.png)` — href is `tool_images/foo.png` (contains `/`). */
    if (href.startsWith("tool_images/")) {
      if (!isRelativeHermesToolImagePath(href)) continue;
      const id = await mirrorHermesToolImageFileToWebchat(href);
      if (id) hrefToNewId.set(rawHref, id);
      continue;
    }
    if (href.includes("/")) continue;
    const extRaw = path.extname(href);
    const ext = extRaw.toLowerCase();
    if (!ext || ext.length > 12) continue;
    const stem = href.slice(0, -extRaw.length);
    const hex = stem.replace(/-/g, "");
    if (!/^[a-f0-9]{32}$/i.test(hex)) continue;
    const rel = `tool_images/${hex}${ext}`;
    if (!isRelativeHermesToolImagePath(rel)) continue;
    const id = await mirrorHermesToolImageFileToWebchat(rel);
    if (id) hrefToNewId.set(rawHref, id);
  }
  if (hrefToNewId.size === 0) return markdown;

  let out = markdown;
  const keys = [...hrefToNewId.keys()].sort((a, b) => b.length - a.length);
  for (const rawHref of keys) {
    const id = hrefToNewId.get(rawHref)!;
    out = out
      .split(`](/api/images/${rawHref})`)
      .join(`](/api/images/${id})`);
  }
  return out;
}

/**
 * Rewrite `![](tool_images/...)` and bogus `![](/api/images/tool_images/...)` to `/api/images/{id}`.
 */
export async function mirrorToolImagePathsInMarkdown(
  markdown: string
): Promise<string> {
  let out = await remapHallucinatedApiPathsToMirroredSpill(markdown);

  if (!out.includes("tool_images/")) return out;

  const rels = new Set<string>();
  for (const m of out.matchAll(MD_TOOL_IMAGE_HREF_RE)) {
    const rel = (m[2] ?? "").trim();
    if (isRelativeHermesToolImagePath(rel)) rels.add(rel);
  }
  for (const m of out.matchAll(MD_HALLUCINATED_API_TOOL_IMAGE_RE)) {
    const rel = (m[2] ?? "").trim();
    if (isRelativeHermesToolImagePath(rel)) rels.add(rel);
  }
  if (rels.size === 0) return out;
  const relToApi = new Map<string, string>();
  for (const rel of rels) {
    const id = await mirrorHermesToolImageFileToWebchat(rel);
    if (id) relToApi.set(rel, `/api/images/${id}`);
  }
  if (relToApi.size === 0) return out;
  const pairs = [...relToApi.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [rel, apiPath] of pairs) {
    const bogusApi = `/api/images/${rel}`;
    out = out.split(`](${bogusApi})`).join(`](${apiPath})`);
    out = out.split(`](${rel})`).join(`](${apiPath})`);
  }
  return out;
}

/**
 * `image` field from image_generate / image_edit tool JSON (gateway session only).
 * OpenRouter returns HTTPS URLs or data URIs; large outputs may be `tool_images/...` on disk.
 */
function isToolResultImageRef(im: string): boolean {
  const t = im.trim();
  if (/^data:image\//i.test(t)) return true;
  if (isRelativeHermesToolImagePath(t)) return true;
  if (/^https:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== "https:") return false;
      const h = u.hostname.toLowerCase();
      if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
      return isLikelyMarkdownImageSrc(t);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Recover image refs from a gateway `tool` message `content` string when JSON is truncated or
 * `success` was omitted — otherwise repair queues stay empty and `/api/images/{id}` 404s after
 * volume loss or failed mirrors.
 */
export function extractToolImageRefsFromToolMessageContent(c: string): string[] {
  const s = typeof c === "string" ? c.trim() : "";
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || seen.has(t)) return;
    if (!isToolResultImageRef(t)) return;
    seen.add(t);
    out.push(t);
  };

  try {
    const j = JSON.parse(s) as { success?: boolean; image?: string };
    if (j.success !== false && typeof j.image === "string") {
      add(j.image);
      if (out.length) return out;
    }
  } catch {
    /* loose extraction below */
  }

  for (const m of s.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) {
    add(m[1]);
  }
  for (const m of s.matchAll(/'image'\s*:\s*'([^']+)'/gi)) {
    add(m[1]);
  }
  for (const m of s.matchAll(/\b(tool_images\/[a-zA-Z0-9._-]+)\b/gi)) {
    add(m[1]);
  }
  for (const m of s.matchAll(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n \t]{80,}/gi
  )) {
    add(m[0].replace(/\s+/g, ""));
  }
  for (const m of s.matchAll(/https:\/\/[^\s"'<>[\]]+/gi)) {
    add(m[0].replace(/[,;)\]}>]+$/g, ""));
  }
  return out;
}

function indexOfLastUserMessage(messages: GatewaySessionMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/**
 * Image refs from `image_generate` / `image_edit` tool messages after the last user turn
 * (`tool_images/…`, `https://…`, `data:image/…`) — in session order for repair queues.
 */
export function collectToolImageUrlsSinceLastUser(
  messages: GatewaySessionMessage[]
): string[] {
  const lastUserIdx = indexOfLastUserMessage(messages);
  if (lastUserIdx < 0) return [];
  const out: string[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    const c = m.content;
    if (typeof c !== "string") continue;
    for (const ref of extractToolImageRefsFromToolMessageContent(c)) {
      out.push(ref);
    }
  }
  return out;
}

/**
 * All successful tool image URLs in gateway session order (whole transcript).
 * Used when repairing stored chat messages against the session file (not only the last turn).
 */
export function collectAllToolImageUrlsFromSession(
  messages: GatewaySessionMessage[]
): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m?.role !== "tool") continue;
    const c = m.content;
    if (typeof c !== "string") continue;
    for (const ref of extractToolImageRefsFromToolMessageContent(c)) {
      out.push(ref);
    }
  }
  return out;
}

/** True if the reply already embeds a generated image we would append (CDN, data URI, or mirrored path). */
function replyAlreadyShowsGeneratedImage(reply: string): boolean {
  if (/\]\([^)]*data:image\/[^)]+\)/i.test(reply)) return true;
  if (/\]\([^)]*fal\.media[^)]*\)/i.test(reply) || /fal\.media/i.test(reply))
    return true;
  if (hasLikelyMarkdownImageRef(reply)) return true;
  for (const m of reply.matchAll(/\]\(\/api\/images\/([^)]+)\)/gi)) {
    let id = (m[1] ?? "").trim();
    const cut = id.search(/[?#]/);
    if (cut >= 0) id = id.slice(0, cut);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep */
    }
    if (!id || HALLUCINATED_API_IMAGE_NAMES.has(id.toLowerCase())) continue;
    if (id.toLowerCase().startsWith("tool_images/")) continue;
    if (!apiImageIdLooksLikeWebchatStoredId(id)) continue;
    return true;
  }
  return false;
}

/** Last `image_generate` / `image_edit` URL from tool JSON after the last user message. */
function collectLastToolImageUrlSinceLastUser(
  messages: GatewaySessionMessage[]
): string | null {
  const lastUserIdx = indexOfLastUserMessage(messages);
  if (lastUserIdx < 0) return null;
  let last: string | null = null;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    const c = m.content;
    if (typeof c !== "string") continue;
    const refs = extractToolImageRefsFromToolMessageContent(c);
    for (const ref of refs) last = ref;
  }
  return last;
}

/** Gateway may expose `X-Hermes-Session-Id` as `abc123` or `api-abc123`; files are `session_api-abc123.json`. */
function sessionJsonBasenames(hermesSessionId: string): string[] {
  const t = hermesSessionId.trim();
  if (!t) return [];
  const bases = new Set<string>();
  bases.add(`session_api-${t}.json`);
  if (t.startsWith("api-")) bases.add(`session_api-${t.slice(4)}.json`);
  else bases.add(`session_api-api-${t}.json`);
  return [...bases];
}

/**
 * Read gateway session `messages` with short retries so tool results are flushed to disk.
 */
export async function loadGatewaySessionMessages(
  hermesSessionId: string | null
): Promise<GatewaySessionMessage[] | null> {
  if (!hermesSessionId?.trim()) return null;
  const root = getHermesDataDir();
  if (!root) {
    console.warn(
      "[hermes-session-enrich] HERMES_DATA_DIR is unset — cannot read gateway session files (image repair / enrich will not see tool results)"
    );
    return null;
  }

  const candidates = sessionJsonBasenames(hermesSessionId).map((b) =>
    path.join(root, "sessions", b)
  );

  const delays = [0, 150, 350, 600];
  for (const ms of delays) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    for (const sessionPath of candidates) {
      try {
        const raw = await readFile(sessionPath, "utf-8");
        const data = JSON.parse(raw) as { messages?: GatewaySessionMessage[] };
        const msgs = data.messages;
        if (Array.isArray(msgs)) return msgs;
      } catch {
        /* try next path */
      }
    }
  }

  return null;
}

/**
 * Hermes streams only assistant `delta.content`; `image_generate` URLs live in tool results
 * inside the gateway session file. When the model forgets `![](url)` in prose, append the
 * last tool image URL from the current turn (mirrored to `/api/images/...` when possible).
 */
export async function enrichReplyWithLastSessionToolImage(
  reply: string,
  hermesSessionId: string | null
): Promise<string> {
  let text = scrubHallucinatedApiImageRefs(reply);
  text = stripGatewayHexApiImageMarkdown(text);
  if (!hermesSessionId?.trim()) return text;
  if (replyAlreadyShowsGeneratedImage(text)) return text;

  const msgs = await loadGatewaySessionMessages(hermesSessionId);
  if (!msgs) return text;

  const url = collectLastToolImageUrlSinceLastUser(msgs);
  if (!url) return text;

  const sep = text.trim().length > 0 ? "\n\n" : "";
  const delays = [0, 250, 700];

  if (/^data:image\//i.test(url)) {
    try {
      const { id } = await saveDataUrlAsWebchatImage(url);
      return `${text.trimEnd()}${sep}![Generated image](/api/images/${id})\n`;
    } catch (e) {
      console.warn(
        "[hermes-session-enrich] could not persist tool data:image:",
        e
      );
      return text;
    }
  }

  if (isRelativeHermesToolImagePath(url)) {
    try {
      const id = await mirrorHermesToolImageFileToWebchat(url);
      if (id) {
        return `${text.trimEnd()}${sep}![Generated image](/api/images/${id})\n`;
      }
    } catch (e) {
      console.warn(
        "[hermes-session-enrich] could not read gateway tool_images file:",
        e
      );
    }
    return text;
  }

  if (/^https:\/\//i.test(url)) {
    try {
      const fetched = await fetchFalWithRetries(url, delays);
      if (fetched) {
        const { id } = await saveBufferAsWebchatImage(
          fetched.buffer,
          fetched.contentType
        );
        return `${text.trimEnd()}${sep}![Generated image](/api/images/${id})\n`;
      }
    } catch (e) {
      console.warn("[hermes-session-enrich] could not mirror tool https image:", e);
    }
    if (!text.includes(url)) {
      return `${text.trimEnd()}${sep}![Generated image](${url})\n`;
    }
    return text;
  }

  if (!text.includes(url)) {
    return `${text.trimEnd()}${sep}![Generated image](${url})\n`;
  }

  return text;
}
