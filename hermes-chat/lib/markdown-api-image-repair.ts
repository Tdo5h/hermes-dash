import { fetchFalWithRetries } from "@/lib/fal-mirror";
import {
  collectAllToolImageUrlsFromSession,
  collectToolImageUrlsSinceLastUser,
  loadGatewaySessionMessages,
  mirrorHermesToolImageFileToWebchat,
  mirrorToolImagePathsInMarkdown,
} from "@/lib/hermes-session-enrich";
import type { ChatMessage } from "@/lib/sessions";
import {
  readImage,
  saveBufferAsWebchatImage,
  saveDataUrlAsWebchatImage,
} from "@/lib/images";
import { sanitizeVaultSourcesRelativePath } from "@/lib/project-service";
import { stripInvalidMarkdownImageRefs } from "@/lib/markdown-image-sanitize";

/**
 * Agent/sandbox UIs sometimes append `[Truncated: …]` to tool output; if that sticks to a
 * `/api/images/{uuid}.ext` path, the browser requests a nonsense URL and images 404.
 */
const API_IMAGE_TRUNCATION_SUFFIX_RE =
  /(\/api\/images\/[a-fA-F0-9-]{36}(?:\.[a-zA-Z0-9]{1,12})?)\[Truncated:[^\]]*\]/gi;

export function sanitizeMarkdownApiImageTruncationArtifacts(markdown: string): string {
  if (!markdown.includes("/api/images/")) {
    return markdown;
  }
  let out = markdown;
  for (let i = 0; i < 5 && /\[Truncated:/i.test(out); i++) {
    const next = out.replace(API_IMAGE_TRUNCATION_SUFFIX_RE, "$1");
    if (next === out) break;
    out = next;
  }
  // Stray "=" after `![](/api/images/uuid.ext)` from UI paste glitches (e.g. "Image not available=").
  out = out.replace(
    /(!\[[^\]]*\]\(\/api\/images\/[a-fA-F0-9-]{36}(?:\.[a-zA-Z0-9]{1,12})?\))\s*=\s*/gi,
    "$1"
  );
  // Broken model output from failed image turns, e.g. `![Generated image](https://`)`.
  out = out.replace(
    /!\[[^\]]*\]\(\s*https?:\/\/(?:%60|`|['"\s])*\)/gi,
    ""
  );
  return stripInvalidMarkdownImageRefs(out);
}

/** Markdown image refs like `extracted/…/x.png` → `/api/projects/<slug>/file?name=…&inline=1` for chat rendering. */
export function rewriteVaultRelativeImagesInMarkdown(
  markdown: string,
  projectSlug: string
): string {
  const slug = projectSlug.trim();
  if (!slug || !markdown.includes("](")) {
    return markdown;
  }
  const slugSeg = encodeURIComponent(slug);
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt, srcRaw) => {
    let src = String(srcRaw).trim();
    const cut = src.search(/[#?]/);
    if (cut >= 0) src = src.slice(0, cut).trim();
    if (!src) return full;
    if (/^(https?:|data:)/i.test(src)) return full;
    if (src.startsWith("/api/")) return full;

    const rel = sanitizeVaultSourcesRelativePath(src);
    if (!rel) return full;

    const nameEnc = encodeURIComponent(rel);
    const url = `/api/projects/${slugSeg}/file?name=${nameEnc}&inline=1`;
    return `![${alt}](${url})`;
  });
}

const MD_IMG_API_RE = /!\[[^\]]*\]\((\/api\/images\/[^)]+)\)/g;
const REMOTE_IMAGE_FETCH_DELAYS_MS = [0, 250, 700];

async function ingestToolImageUrlToWebchat(srcUrl: string): Promise<string | null> {
  const u = srcUrl.trim();
  if (!u) return null;
  if (/^data:image\//i.test(u)) {
    try {
      const { id } = await saveDataUrlAsWebchatImage(u);
      return id;
    } catch {
      return null;
    }
  }
  if (/^tool_images\//.test(u) && !u.includes("..")) {
    return mirrorHermesToolImageFileToWebchat(u);
  }
  const fetched = await fetchFalWithRetries(u, REMOTE_IMAGE_FETCH_DELAYS_MS);
  if (!fetched) return null;
  try {
    const { id } = await saveBufferAsWebchatImage(fetched.buffer, fetched.contentType);
    return id;
  } catch {
    return null;
  }
}

/**
 * Like {@link repairMissingApiImageRefs} but consumes from a shared `urlQueue` (mutated).
 * Skips queue entries when the `/api/images/{id}` file already exists.
 */
async function repairMarkdownConsumingQueue(
  markdown: string,
  urlQueue: string[]
): Promise<string> {
  markdown = sanitizeMarkdownApiImageTruncationArtifacts(markdown);
  if (!markdown.includes("/api/images/") || urlQueue.length === 0) return markdown;

  const fixed = new Map<string, string>();

  for (const m of markdown.matchAll(MD_IMG_API_RE)) {
    const apiPath = m[1]!;
    if (fixed.has(apiPath)) continue;

    let id = apiPath.slice("/api/images/".length);
    const cut = id.search(/[?#]/);
    if (cut >= 0) id = id.slice(0, cut);
    if (!id || id.includes("..") || id.includes("/")) continue;

    const existing = await readImage(id);
    if (existing) continue;

    const srcUrl = urlQueue.shift();
    if (!srcUrl) {
      console.warn(
        "[markdown-api-image-repair] no tool image URL left for missing:",
        apiPath.slice(0, 80)
      );
      break;
    }

    const newId = await ingestToolImageUrlToWebchat(srcUrl);
    if (!newId) {
      console.warn(
        "[markdown-api-image-repair] could not ingest tool image for:",
        apiPath.slice(0, 80)
      );
      continue;
    }
    fixed.set(apiPath, `/api/images/${newId}`);
  }

  if (fixed.size === 0) return markdown;

  let out = markdown;
  const pairs = [...fixed.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [bad, good] of pairs) {
    out = out.split(bad).join(good);
  }
  return out;
}

/**
 * When loading a chat, re-fetch missing `/api/images/...` bytes using the gateway session file
 * (full tool order). Persists updated markdown via {@link saveSessionMessages} by the caller.
 */
export async function repairSessionTranscriptApiImages(
  messages: ChatMessage[],
  hermesSessionId: string | null,
  projectSlug?: string | null
): Promise<{ messages: ChatMessage[]; mutated: boolean }> {
  const slug = projectSlug?.trim() ?? "";
  const sid = hermesSessionId?.trim() ?? "";
  if (!slug && !sid) return { messages, mutated: false };

  const gw = sid ? await loadGatewaySessionMessages(sid) : null;
  const queue = gw ? [...collectAllToolImageUrlsFromSession(gw)] : [];

  let mutated = false;
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || typeof msg.content !== "string") {
      out.push(msg);
      continue;
    }
    let content = sanitizeMarkdownApiImageTruncationArtifacts(msg.content);
    if (content !== msg.content) mutated = true;
    if (content.includes("tool_images/")) {
      const mirrored = await mirrorToolImagePathsInMarkdown(content);
      if (mirrored !== content) {
        content = mirrored;
        mutated = true;
      }
    }
    if (slug) {
      const rewrote = rewriteVaultRelativeImagesInMarkdown(content, slug);
      if (rewrote !== content) {
        content = rewrote;
        mutated = true;
      }
    }
    if (!content.includes("/api/images/")) {
      out.push(content === msg.content ? msg : { ...msg, content });
      continue;
    }
    const next = await repairMarkdownConsumingQueue(content, queue);
    if (next !== content) mutated = true;
    out.push({ ...msg, content: next });
  }
  return { messages: out, mutated };
}

/**
 * When the model emits `![](/api/images/{id})` for files that were never saved, replace them
 * by ingesting image refs from the current turn's gateway tool results (`tool_images/`, HTTPS,
 * data URIs — same order as `image_generate` / `image_edit` calls).
 */
export async function repairMissingApiImageRefs(
  markdown: string,
  hermesSessionId: string | null
): Promise<string> {
  markdown = sanitizeMarkdownApiImageTruncationArtifacts(markdown);
  if (markdown.includes("tool_images/")) {
    markdown = await mirrorToolImagePathsInMarkdown(markdown);
  }
  if (!hermesSessionId?.trim() || !markdown.includes("/api/images/")) {
    return markdown;
  }

  const msgs = await loadGatewaySessionMessages(hermesSessionId);
  if (!msgs) return markdown;

  const toolImageUrlQueue = [...collectToolImageUrlsSinceLastUser(msgs)];
  if (toolImageUrlQueue.length === 0) return markdown;

  const fixed = new Map<string, string>();

  for (const m of markdown.matchAll(MD_IMG_API_RE)) {
    const apiPath = m[1]!;
    if (fixed.has(apiPath)) continue;

    let id = apiPath.slice("/api/images/".length);
    const cut = id.search(/[?#]/);
    if (cut >= 0) id = id.slice(0, cut);
    if (!id || id.includes("..") || id.includes("/")) continue;

    const existing = await readImage(id);
    if (existing) continue;

    const srcUrl = toolImageUrlQueue.shift();
    if (!srcUrl) {
      console.warn(
        "[markdown-api-image-repair] no tool image ref left for missing:",
        apiPath.slice(0, 80)
      );
      continue;
    }

    const newId = await ingestToolImageUrlToWebchat(srcUrl);
    if (newId) {
      fixed.set(apiPath, `/api/images/${newId}`);
    } else {
      console.warn(
        "[markdown-api-image-repair] ingest failed for:",
        srcUrl.slice(0, 80)
      );
    }
  }

  if (fixed.size === 0) return markdown;

  let out = markdown;
  const pairs = [...fixed.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [bad, good] of pairs) {
    out = out.split(bad).join(good);
  }
  return out;
}
