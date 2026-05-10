import { saveBufferAsWebchatImage, saveDataUrlAsWebchatImage } from "@/lib/images";

/** Broad URL token; filter hosts with `isFalHost`. */
const HTTPS_URL_RE = /https?:\/\/[^\s\]"'<>\)]+/g;

function isFalCdnUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "fal.media" || h.endsWith(".fal.media");
  } catch {
    return /fal\.media|v3b\.fal\.media/i.test(url);
  }
}

/**
 * Temporary image hosts used by OpenAI / Azure (GPT image, DALL·E) returned via OpenRouter.
 * HermesChat must mirror these like FAL URLs: they often 403 from Node or expire in the browser.
 */
export function isEphemeralModelImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h.endsWith(".blob.core.windows.net")) return true;
  if (h.endsWith(".azureedge.net")) return true;
  if (h === "oaiusercontent.com" || h.endsWith(".oaiusercontent.com")) return true;
  if (h.endsWith(".openai.com") || h === "openai.com") return true;
  if (h.endsWith(".oaistatic.com")) return true;
  if (h === "openrouter.ai" || h.endsWith(".openrouter.ai")) return true;
  return false;
}

function collectEphemeralProviderImageUrls(markdown: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  function push(uRaw: string) {
    const u = uRaw.trim().replace(/[),.;]+$/g, "");
    try {
      if (!isEphemeralModelImageHost(new URL(u).hostname)) return;
    } catch {
      return;
    }
    if (seen.has(u)) return;
    seen.add(u);
    ordered.push(u);
  }
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*(https:\/\/[^)\s]+)\s*\)/gi)) {
    push(m[1] ?? "");
  }
  for (const m of markdown.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi
  )) {
    push(m[1] ?? "");
  }
  return ordered;
}

function collectUniqueFalUrls(markdown: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of markdown.matchAll(HTTPS_URL_RE)) {
    const u = m[0].replace(/[),.;]+$/g, "");
    if (!isFalCdnUrl(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    ordered.push(u);
  }
  return ordered;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchFalOnce(url: string): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://openrouter.ai/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  return { buffer: buf, contentType: ct };
}

export async function fetchFalWithRetries(
  url: string,
  delaysMs: number[]
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i]! > 0) await new Promise((r) => setTimeout(r, delaysMs[i]));
    try {
      const got = await fetchFalOnce(url);
      if (got) return got;
    } catch (e) {
      console.warn("[fal-mirror] fetch failed:", url.slice(0, 80), e);
    }
  }
  return null;
}

/**
 * Markdown image with data URI. Inner group may miss newlines / odd spacing; we also scan loosely below.
 */
const MD_DATA_IMAGE_RE = /!\[[^\]]*\]\(\s*(data:image\/[^)]+)\s*\)/gi;

/** Any inline data-URI (allows whitespace/newlines inside base64 — models and SSE often wrap). */
const INLINE_DATA_IMAGE_RE =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n \t]+/g;

const HTML_SRC_DATA_RE = /src\s*=\s*["'](data:image\/[^"']+)["']/gi;

const MAX_DATA_URL_CHARS = 45_000_000;

function normalizedDataImageKey(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("data:image/")) return null;
  const norm = t.replace(/\s+/g, "");
  if (norm.length < 64) return null;
  if (norm.length > MAX_DATA_URL_CHARS) {
    console.warn("[data-image-mirror] skip oversized data URL (chars):", norm.length);
    return null;
  }
  return norm;
}

/**
 * Rewrite inline data-URI images in markdown to `/api/images/{id}` (same storage as uploads).
 * Browsers often fail on huge `data:` `src`; we also catch URIs with line breaks that the strict
 * `![]()` regex used to miss.
 */
export async function mirrorDataImageUrlsInMarkdown(markdown: string): Promise<string> {
  const normSeen = new Set<string>();

  for (const m of markdown.matchAll(MD_DATA_IMAGE_RE)) {
    const k = normalizedDataImageKey(m[1] ?? "");
    if (k) normSeen.add(k);
  }
  for (const m of markdown.matchAll(INLINE_DATA_IMAGE_RE)) {
    const k = normalizedDataImageKey(m[0]);
    if (k) normSeen.add(k);
  }
  for (const m of markdown.matchAll(HTML_SRC_DATA_RE)) {
    const k = normalizedDataImageKey(m[1] ?? "");
    if (k) normSeen.add(k);
  }

  if (normSeen.size === 0) return markdown;

  const normToLocal = new Map<string, string>();
  for (const norm of normSeen) {
    try {
      const { id } = await saveDataUrlAsWebchatImage(norm);
      normToLocal.set(norm, `/api/images/${id}`);
    } catch (e) {
      console.warn("[data-image-mirror] save failed:", (e as Error)?.message ?? e);
    }
  }
  if (normToLocal.size === 0) return markdown;

  const spans: { start: number; end: number; local: string }[] = [];
  const spanKeys = new Set<string>();

  function pushSpan(start: number, end: number, local: string) {
    const key = `${start}:${end}`;
    if (spanKeys.has(key)) return;
    spanKeys.add(key);
    spans.push({ start, end, local });
  }

  for (const m of markdown.matchAll(INLINE_DATA_IMAGE_RE)) {
    const norm = m[0].replace(/\s+/g, "");
    const local = normToLocal.get(norm);
    if (local) pushSpan(m.index!, m.index! + m[0].length, local);
  }

  for (const m of markdown.matchAll(HTML_SRC_DATA_RE)) {
    const inner = (m[1] ?? "").trim();
    const norm = inner.replace(/\s+/g, "");
    const local = normToLocal.get(norm);
    if (!local) continue;
    const full = m[0];
    const innerStart = full.indexOf(inner);
    if (innerStart < 0) continue;
    pushSpan(m.index! + innerStart, m.index! + innerStart + inner.length, local);
  }

  spans.sort((a, b) => b.start - a.start);
  let out = markdown;
  for (const s of spans) {
    out = out.slice(0, s.start) + s.local + out.slice(s.end);
  }
  return out;
}

/**
 * Download OpenAI/Azure ephemeral image URLs in markdown (GPT image, etc.) and rewrite to
 * `/api/images/{id}`. Removes the markdown image if fetch fails so enrich can append from
 * `tool_images/…` instead of leaving a broken `![](https://…)`.
 */
export async function mirrorEphemeralProviderImageUrlsInMarkdown(
  markdown: string
): Promise<string> {
  const urls = collectEphemeralProviderImageUrls(markdown);
  if (urls.length === 0) return markdown;

  const delays = [0, 250, 700, 1500];
  let out = markdown;
  const urlToLocal = new Map<string, string>();

  for (const url of urls) {
    const fetched = await fetchFalWithRetries(url, delays);
    if (!fetched) {
      console.warn("[ephemeral-image-mirror] could not mirror:", url.slice(0, 96));
      out = out.replace(
        new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(url)}\\)`, "g"),
        ""
      );
      out = out.replace(
        new RegExp(
          `<img\\b[^>]*\\bsrc\\s*=\\s*["']${escapeRegExp(url)}["'][^>]*>`,
          "gi"
        ),
        ""
      );
      continue;
    }
    try {
      const { id } = await saveBufferAsWebchatImage(
        fetched.buffer,
        fetched.contentType
      );
      urlToLocal.set(url, `/api/images/${id}`);
    } catch (e) {
      console.warn("[ephemeral-image-mirror] save failed:", e);
      out = out.replace(
        new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(url)}\\)`, "g"),
        ""
      );
      out = out.replace(
        new RegExp(
          `<img\\b[^>]*\\bsrc\\s*=\\s*["']${escapeRegExp(url)}["'][^>]*>`,
          "gi"
        ),
        ""
      );
    }
  }

  if (urlToLocal.size === 0) return out.replace(/\n{3,}/g, "\n\n").trimEnd();

  const byLength = [...urlToLocal.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remote, local] of byLength) {
    out = out.replace(new RegExp(escapeRegExp(remote), "g"), local);
  }
  return out;
}

/**
 * Download FAL URLs embedded in markdown and rewrite to `/api/images/{id}` so Streamdown
 * serves stable assets from HermesChat storage (avoids expired/blocked CDN links).
 */
export async function mirrorFalUrlsInMarkdown(markdown: string): Promise<string> {
  const urls = collectUniqueFalUrls(markdown);
  if (urls.length === 0) return markdown;

  const urlToLocal = new Map<string, string>();
  const delays = [0, 250, 700];

  for (const url of urls) {
    const fetched = await fetchFalWithRetries(url, delays);
    if (!fetched) {
      console.warn("[fal-mirror] could not mirror:", url.slice(0, 96));
      continue;
    }
    try {
      const { id } = await saveBufferAsWebchatImage(
        fetched.buffer,
        fetched.contentType
      );
      urlToLocal.set(url, `/api/images/${id}`);
    } catch (e) {
      console.warn("[fal-mirror] save failed:", e);
    }
  }

  if (urlToLocal.size === 0) return markdown;

  let out = markdown;
  const byLength = [...urlToLocal.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remote, local] of byLength) {
    out = out.replace(new RegExp(escapeRegExp(remote), "g"), local);
  }
  return out;
}
