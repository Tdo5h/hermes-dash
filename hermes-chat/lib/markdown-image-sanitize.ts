import { isEphemeralModelImageHost } from "@/lib/fal-mirror";

const IMAGE_FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|heic|heif)(?:$|[?#])/i;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)]+?)\s*\)/g;

function stripMarkdownUrlNoise(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\\+$/g, "")
    .replace(/[),.;]+$/g, "");
}

function urlPathOrFileParamLooksImage(url: URL): boolean {
  if (IMAGE_FILE_EXT_RE.test(url.pathname)) return true;
  const fileParam = url.searchParams.get("name") ?? url.searchParams.get("file") ?? "";
  return IMAGE_FILE_EXT_RE.test(fileParam);
}

/**
 * Markdown image syntax is easy for models to misuse. Only keep refs that are likely
 * renderable images; CSS, font, page, and docs URLs should not become broken chat images.
 */
export function isLikelyMarkdownImageSrc(rawSrc: string): boolean {
  const src = stripMarkdownUrlNoise(rawSrc);
  if (!src) return false;
  if (/^data:image\//i.test(src)) return true;
  if (/^tool_images\/[a-zA-Z0-9._-]+$/i.test(src)) return true;
  if (src.startsWith("/api/images/")) return true;
  if (src.startsWith("/api/projects/") || src.startsWith("/api/builds/file")) {
    try {
      return urlPathOrFileParamLooksImage(new URL(src, "http://local"));
    } catch {
      return IMAGE_FILE_EXT_RE.test(src);
    }
  }
  if (/^https?:\/\//i.test(src)) {
    try {
      const url = new URL(src);
      const host = url.hostname.toLowerCase();
      if (host === "fal.media" || host.endsWith(".fal.media")) return true;
      if (isEphemeralModelImageHost(host)) return true;
      return urlPathOrFileParamLooksImage(url);
    } catch {
      return false;
    }
  }
  if (src.startsWith("/")) return IMAGE_FILE_EXT_RE.test(src);
  return IMAGE_FILE_EXT_RE.test(src);
}

export function stripInvalidMarkdownImageRefs(markdown: string): string {
  if (!markdown.includes("](")) return markdown;
  return markdown
    .replace(MD_IMAGE_RE, (full, _alt, src) =>
      isLikelyMarkdownImageSrc(String(src)) ? full : ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function hasLikelyMarkdownImageRef(markdown: string): boolean {
  if (!markdown.includes("](")) return false;
  for (const match of markdown.matchAll(MD_IMAGE_RE)) {
    if (isLikelyMarkdownImageSrc(String(match[2] ?? ""))) return true;
  }
  return false;
}
