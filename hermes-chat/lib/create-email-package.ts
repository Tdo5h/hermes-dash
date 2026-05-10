import { readFile, stat } from "fs/promises";
import path from "path";
import type { BuildListApp } from "@/lib/builds-manifest";
import { findBuildListAppById } from "@/lib/builds-manifest";

const MAX_EMAIL_HTML_BYTES = 900_000;
const MAX_EMAIL_TEXT_BYTES = 120_000;
const MAX_CLIPBOARD_IMAGE_BYTES = 1_500_000;
const MAX_CLIPBOARD_IMAGE_TOTAL_BYTES = 2_500_000;
const CLIPBOARD_IMAGE_MODE = (
  process.env.HERMES_EMAIL_CLIPBOARD_IMAGE_MODE || "strip"
).toLowerCase();

const CLIPBOARD_IMAGE_MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const EMAIL_CLIENT_HEAD_PATCH = `
  <meta name="color-scheme" content="only light">
  <meta name="supported-color-schemes" content="only light">
  <style data-hermes-email-client-fix>
    :root { color-scheme: only light; supported-color-schemes: only light; }
    @media only screen and (max-width: 680px) {
      html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
      .outer-pad { padding: 0 !important; }
      .container, .email-container { width: 100% !important; max-width: 100% !important; border-left: 0 !important; border-right: 0 !important; border-radius: 0 !important; }
      .px { padding-left: 18px !important; padding-right: 18px !important; }
      [data-od-id="hero-image"] { padding-left: 18px !important; padding-right: 18px !important; }
      img { max-width: 100% !important; height: auto !important; }
    }
  </style>`;

export type PreparedCreateEmail = {
  buildId: string;
  buildName: string;
  subject: string;
  preheader: string;
  html: string;
  clipboardHtml: string;
  richClipboardHtml: string;
  text: string;
  htmlBytes: number;
  clipboardHtmlBytes: number;
  richClipboardHtmlBytes: number;
  textBytes: number;
  imageCount: number;
  warnings: string[];
};

function buildRootFor(app: BuildListApp): string | null {
  if (!app.appFolder) return null;
  const root = (process.env.BUILDS_FS_ROOT ?? "/app/builds").trim();
  const rootResolved = path.resolve(root);
  const dir = path.resolve(root, app.appFolder);
  if (dir !== rootResolved && !dir.startsWith(`${rootResolved}${path.sep}`)) {
    return null;
  }
  return dir;
}

async function readBuildFile(
  root: string,
  rel: string,
  maxBytes: number
): Promise<string> {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return "";
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile() || st.size > maxBytes) return "";
  return readFile(abs, "utf8").catch(() => "");
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripTagsToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|tr|table|h[1-6]|li)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstSubjectFromOptions(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const subject = line.match(/^subject\s*:\s*(.+)$/i)?.[1]?.trim();
    if (subject) return subject;
    const numbered = line.match(/^\d+[\).]\s*(.+)$/)?.[1]?.trim();
    if (numbered) return numbered;
    if (!/^subject options:?$/i.test(line) && !/^recommended subject:?$/i.test(line)) {
      break;
    }
  }
  return "";
}

function parsePlainTextEmail(raw: string): {
  subject: string;
  preheader: string;
  body: string;
} {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const subject =
    text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ||
    firstSubjectFromOptions(text) ||
    "";
  const preheader = text.match(/^Preheader:\s*(.+)$/im)?.[1]?.trim() || "";
  const marker = text.match(/(?:^|\n)Plain-text email:\s*\n/i);
  if (marker?.index != null) {
    return {
      subject,
      preheader,
      body: text.slice(marker.index + marker[0].length).trim(),
    };
  }
  const body = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^Subject:\s*/i.test(t)) return false;
      if (/^Preheader:\s*/i.test(t)) return false;
      if (/^Subject options:?$/i.test(t)) return false;
      if (/^Recommended subject:?$/i.test(t)) return false;
      if (/^\d+[\).]\s*/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject, preheader, body };
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return decodeHtmlEntities(stripTagsToText(title)).trim();
  const heading = html.match(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/i)?.[1];
  return heading ? stripTagsToText(heading) : "";
}

function preheaderFromHtml(html: string): string {
  const hidden =
    html.match(
      /<[^>]+style=["'][^"']*(?:display\s*:\s*none|max-height\s*:\s*0|opacity\s*:\s*0)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    )?.[1] ?? "";
  return hidden ? stripTagsToText(hidden) : "";
}

function removeDangerousCss(raw: string): string {
  return raw
    .replace(/@import\b[^;]+;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/behavior\s*:[^;"']+[;"']?/gi, "")
    .replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]+\)/gi, "none");
}

function sanitizeEmailHtml(raw: string): string {
  let html = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[\s\S]*?>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<input\b[\s\S]*?>/gi, "")
    .replace(/<button\b[\s\S]*?<\/button>/gi, "");

  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => {
    return `${open}${removeDangerousCss(css)}${close}`;
  });

  html = html
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+srcdoc\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+srcdoc\s*=\s*'[^']*'/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, "")
    .replace(/\s+style\s*=\s*"([^"]*)"/gi, (_m, css) => ` style="${removeDangerousCss(css)}"`)
    .replace(/\s+style\s*=\s*'([^']*)'/gi, (_m, css) => ` style="${removeDangerousCss(css)}"`);

  return html.trim();
}

function addEmailClientHeadPatch(html: string): string {
  if (html.includes("data-hermes-email-client-fix")) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${EMAIL_CLIENT_HEAD_PATCH}\n</head>`);
  }
  return `${EMAIL_CLIENT_HEAD_PATCH}\n${html}`;
}

function appendInlineStyle(tag: string, extraStyle: string): string {
  const styleRe = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  const found = styleRe.exec(tag);
  if (found) {
    const quote = found[1] ?? '"';
    const existing = found[2]?.trim().replace(/;?\s*$/, "") ?? "";
    return tag.replace(styleRe, ` style=${quote}${existing}; ${extraStyle}${quote}`);
  }

  const insertAt = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
  return `${tag.slice(0, insertAt)} style="${extraStyle}"${tag.slice(insertAt)}`;
}

function styleTags(
  html: string,
  tagName: string,
  predicate: (tag: string) => boolean,
  style: string,
  mapTag: (tag: string) => string = (tag) => tag
): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return html.replace(re, (tag) => {
    if (!predicate(tag)) return tag;
    return appendInlineStyle(mapTag(tag), style);
  });
}

function hasClass(tag: string, className: string): boolean {
  const classes = tag.match(/\sclass\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  return classes.split(/\s+/).includes(className);
}

function lockInlineColors(html: string): string {
  return html.replace(/<([a-z][a-z0-9:-]*)\b[^>]*\sstyle\s*=\s*(["'])([\s\S]*?)\2[^>]*>/gi, (tag, _name, _quote, style) => {
    const extras: string[] = [];
    const bg = String(style).match(/(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgb[a]?\([^)]+\))/i)?.[1];
    const color = String(style).match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|rgb[a]?\([^)]+\))/i)?.[1];

    if (bg) {
      extras.push(`background-color:${bg} !important`);
    }
    if (color) {
      extras.push(`color:${color} !important`);
      extras.push(`-webkit-text-fill-color:${color} !important`);
    }
    extras.push("color-scheme:only light !important");

    return appendInlineStyle(tag, extras.join("; "));
  });
}

function hexToRgb(raw: string): { r: number; g: number; b: number } | null {
  const hex = raw.trim().replace(/^#/, "");
  if (hex.length !== 3 && hex.length !== 6 && hex.length !== 8) return null;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : hex.slice(0, 6);
  const n = Number.parseInt(expanded, 16);
  if (!Number.isFinite(n)) return null;
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function relativeLuminance(color: string): number | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function normalizeClipboardColorStyles(html: string): string {
  return html.replace(/(<([a-z][a-z0-9:-]*)\b[^>]*\sstyle\s*=\s*)(["'])([\s\S]*?)\3/gi, (_m, prefix, tagName, quote, style) => {
    const tag = String(tagName).toLowerCase();
    let next = String(style);

    next = next.replace(
      /(background(?:-color)?\s*:\s*)(#[0-9a-f]{3,8})(\s*!important)?/gi,
      (_decl, prop, color, important = "") => {
        const lum = relativeLuminance(color);
        if (lum == null || lum > 0.35) return `${prop}${color}${important}`;
        const lightBg = tag === "td" || tag === "div" ? "#f8fafc" : "#ffffff";
        return `${prop}${lightBg}${important}`;
      }
    );

    next = next.replace(
      /((?:^|;)\s*(?:-webkit-text-fill-color|color)\s*:\s*)(#[0-9a-f]{3,8})(\s*!important)?/gi,
      (_decl, prop, color, important = "") => {
        const lum = relativeLuminance(color);
        if (lum == null || lum < 0.6) return `${prop}${color}${important}`;
        return `${prop}#111827${important}`;
      }
    );

    return `${prefix}${quote}${next}${quote}`;
  });
}

function stripFragileClipboardCss(html: string): string {
  return html
    .replace(/background-image\s*:\s*linear-gradient\([^;"']*\)\s*!important\s*;?/gi, "")
    .replace(/background-image\s*:\s*linear-gradient\([^;"']*\)\s*;?/gi, "");
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function backgroundColorFromTag(tag: string): string {
  const style = tag.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "";
  const bg =
    style.match(/(?:^|;)\s*background-color\s*:\s*(#[0-9a-f]{3,8})/i)?.[1] ||
    style.match(/(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8})/i)?.[1] ||
    "";
  return bg;
}

function addBgcolorAttributes(html: string): string {
  return html.replace(/<(body|table|td)\b[^>]*>/gi, (tag) => {
    if (/\sbgcolor\s*=/i.test(tag)) return tag;
    const bg = backgroundColorFromTag(tag);
    if (!bg) return tag;
    const insertAt = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
    return `${tag.slice(0, insertAt)} bgcolor="${escapeHtmlAttr(bg)}"${tag.slice(insertAt)}`;
  });
}

function bodyInnerHtml(html: string): string {
  const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match?.[1]?.trim() || html.trim();
}

function wrapClipboardFragment(html: string, pageStyle: string): string {
  const body = bodyInnerHtml(html);
  const wrapperStyle = `${pageStyle}; display:block !important; width:100% !important; max-width:100% !important; min-width:0 !important`;
  return [
    `<div style="${wrapperStyle}" bgcolor="#ffffff">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="${wrapperStyle}; border-collapse:collapse !important;">`,
    `<tr><td bgcolor="#ffffff" style="${wrapperStyle}; padding:0 !important;">`,
    body,
    "</td></tr></table>",
    "</div>",
  ].join("");
}

function makeRichClipboardHtmlFluid(html: string): string {
  const pageStyle =
    "margin:0 !important; padding:0 !important; width:100% !important; max-width:100% !important; min-width:0 !important; -webkit-text-size-adjust:100% !important; text-size-adjust:100% !important";
  let out = styleTags(html, "html", () => true, pageStyle);
  out = styleTags(out, "body", () => true, pageStyle);
  out = styleTags(
    out,
    "table",
    (tag) => /(?:class\s*=\s*(["'])[^"']*(?:container|email-container)[^"']*\1|width\s*=\s*(["']?)(?:600|620|640|680)\2)/i.test(tag),
    "width:100% !important; max-width:100% !important; min-width:0 !important; margin:0 !important; box-sizing:border-box !important",
    (tag) =>
      tag
        .replace(/\swidth\s*=\s*(["']?)(?:600|620|640|680)\1/i, ' width="100%"')
        .replace(/\bmax-width\s*:\s*(?:600|620|640|680)px\s*;?/gi, "")
        .replace(/\bwidth\s*:\s*(?:600|620|640|680)px\s*;?/gi, "")
  );
  out = styleTags(
    out,
    "td",
    (tag) => hasClass(tag, "outer-pad") || /\spadding\s*:\s*0\s+\d+px/i.test(tag),
    "padding-left:0 !important; padding-right:0 !important; max-width:100% !important; box-sizing:border-box !important"
  );
  out = styleTags(
    out,
    "img",
    () => true,
    "display:block !important; width:100% !important; max-width:100% !important; height:auto !important",
    (tag) => tag.replace(/\swidth\s*=\s*(["']?)\d+\1/i, ' width="100%"')
  );
  out = addBgcolorAttributes(out);
  return wrapClipboardFragment(out, pageStyle);
}

function stripImagesForClipboard(html: string): { html: string; warnings: string[] } {
  const count = countImages(html);
  if (!count) return { html, warnings: [] };
  const next = html.replace(/<img\b[^>]*>/gi, "");
  return {
    html: next,
    warnings: [
      `Removed ${count} image${count === 1 ? "" : "s"} from the native-mail clipboard payload for safer delivery. Configure public email assets or a real email sender if images are required.`,
    ],
  };
}

function makeClipboardHtmlPasteSafe(html: string): string {
  const pageStyle =
    "margin:0 !important; padding:0 !important; width:100% !important; min-width:100% !important; background-color:#ffffff !important; color:#111827 !important; -webkit-text-fill-color:#111827 !important; color-scheme:only light !important";
  const containerStyle =
    "width:100% !important; max-width:100% !important; min-width:0 !important; margin:0 !important; border-left:0 !important; border-right:0 !important; border-radius:0 !important; background-color:#ffffff !important; color:#111827 !important; -webkit-text-fill-color:#111827 !important; color-scheme:only light !important";
  const fluidImageStyle =
    "display:block !important; width:100% !important; max-width:100% !important; height:auto !important";

  let out = styleTags(html, "html", () => true, pageStyle);
  out = styleTags(out, "body", () => true, `${pageStyle}; -webkit-text-size-adjust:100% !important; text-size-adjust:100% !important`);
  out = styleTags(out, "td", (tag) => hasClass(tag, "outer-pad"), `${pageStyle}; padding:0 !important`);
  out = styleTags(
    out,
    "table",
    (tag) => hasClass(tag, "container"),
    containerStyle,
    (tag) =>
      tag
        .replace(/\swidth\s*=\s*(["']?)640\1/i, ' width="100%"')
        .replace(/\bmax-width\s*:\s*640px\s*;?/i, "")
        .replace(/\bwidth\s*:\s*640px\s*;?/i, "")
  );
  out = styleTags(
    out,
    "img",
    (tag) => hasClass(tag, "fluid-img"),
    fluidImageStyle,
    (tag) => tag.replace(/\swidth\s*=\s*(["']?)\d+\1/i, ' width="100%"')
  );

  out = normalizeClipboardColorStyles(stripFragileClipboardCss(out));
  out = lockInlineColors(out);
  out = addBgcolorAttributes(out);
  return wrapClipboardFragment(out, pageStyle);
}

function publicBaseUrlFor(app: BuildListApp): URL | null {
  const candidate = app.emailHtmlUrl || app.openUrl;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function absolutizeEmailUrls(
  html: string,
  baseUrl: URL | null,
  options: { allowDataImages?: boolean } = {}
): {
  html: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!baseUrl) {
    return { html, warnings: ["Could not resolve public build URL for relative assets."] };
  }

  const rewrite = (attr: string, value: string): string => {
    const raw = value.trim();
    if (!raw || raw.startsWith("#")) return raw;
    if (/^(?:https?:|mailto:|tel:)/i.test(raw)) return raw;
    if (
      options.allowDataImages &&
      attr.toLowerCase() === "src" &&
      /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(raw)
    ) {
      return raw;
    }
    if (/^(?:cid:|data:)/i.test(raw)) {
      warnings.push("Removed unsupported inline image/data URL from email HTML.");
      return "";
    }
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      warnings.push(`Could not rewrite relative asset URL: ${raw}`);
      return raw;
    }
  };

  const nextHtml = html
    .replace(/\s(src|href|background)\s*=\s*"([^"]*)"/gi, (_m, attr, value) => {
      const out = rewrite(attr, value);
      return out ? ` ${attr}="${out}"` : "";
    })
    .replace(/\s(src|href|background)\s*=\s*'([^']*)'/gi, (_m, attr, value) => {
      const out = rewrite(attr, value);
      return out ? ` ${attr}="${out}"` : "";
    });

  return { html: nextHtml, warnings: [...new Set(warnings)] };
}

function localImagePathFor(root: string, rawSrc: string): { abs: string; mime: string } | null {
  const raw = rawSrc.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|cid:|data:)/i.test(raw)) return null;
  const pathname = raw.split(/[?#]/, 1)[0] ?? "";
  if (!pathname || pathname.includes("\0")) return null;

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }

  const ext = path.extname(decoded).toLowerCase();
  const mime = CLIPBOARD_IMAGE_MIME[ext];
  if (!mime) return null;

  const abs = path.resolve(root, decoded);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  return { abs, mime };
}

async function localImageDataUri(
  root: string,
  rawSrc: string,
  remainingBytes: number
): Promise<{ uri: string; size: number; warning?: string } | null> {
  const resolved = localImagePathFor(root, rawSrc);
  if (!resolved) return null;

  const st = await stat(resolved.abs).catch(() => null);
  if (!st?.isFile()) return null;
  if (st.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    return {
      uri: "",
      size: 0,
      warning: `Skipped inline clipboard image over ${Math.round(MAX_CLIPBOARD_IMAGE_BYTES / 1024)} KB: ${rawSrc}`,
    };
  }
  if (st.size > remainingBytes) {
    return {
      uri: "",
      size: 0,
      warning: "Skipped some inline clipboard images because the email image payload is too large.",
    };
  }

  const buf = await readFile(resolved.abs).catch(() => null);
  if (!buf) return null;
  return {
    uri: `data:${resolved.mime};base64,${buf.toString("base64")}`,
    size: st.size,
  };
}

async function inlineLocalImagesForClipboard(
  html: string,
  root: string
): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];
  let usedBytes = 0;
  let out = "";
  let lastIndex = 0;
  const imgRe = /<img\b[^>]*>/gi;

  for (const match of html.matchAll(imgRe)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const srcMatch = /\ssrc\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (!srcMatch) continue;

    out += html.slice(lastIndex, index);
    const src = srcMatch[2] ?? "";
    const data = await localImageDataUri(
      root,
      src,
      MAX_CLIPBOARD_IMAGE_TOTAL_BYTES - usedBytes
    );

    if (data?.warning) warnings.push(data.warning);
    if (data?.uri) {
      usedBytes += data.size;
      out += tag.replace(srcMatch[0], ` src="${data.uri}"`);
    } else {
      out += tag;
    }
    lastIndex = index + tag.length;
  }

  if (!out) return { html, warnings };
  out += html.slice(lastIndex);
  return { html: out, warnings: [...new Set(warnings)] };
}

function countImages(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}

function ensureHiddenPreheader(html: string, preheader: string): string {
  const clean = preheader.trim();
  if (!clean || /display\s*:\s*none|max-height\s*:\s*0|opacity\s*:\s*0/i.test(html)) {
    return html;
  }
  const block = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">${clean}</div>`;
  if (/<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, `<body$1>${block}`);
  }
  return `${block}\n${html}`;
}

export async function prepareCreateEmail(buildId: string): Promise<PreparedCreateEmail | null> {
  const app = await findBuildListAppById(buildId);
  if (!app || !app.emailHtmlUrl) return null;

  const root = buildRootFor(app);
  if (!root) return null;

  const rawHtml = await readBuildFile(root, "email.html", MAX_EMAIL_HTML_BYTES);
  if (!rawHtml.trim()) return null;

  const plainText = await readBuildFile(root, "plain-text.txt", MAX_EMAIL_TEXT_BYTES);
  const subjectLines = await readBuildFile(root, "subject-lines.txt", MAX_EMAIL_TEXT_BYTES);
  const parsedPlain = parsePlainTextEmail(plainText);

  const subject =
    parsedPlain.subject ||
    firstSubjectFromOptions(subjectLines) ||
    titleFromHtml(rawHtml) ||
    app.name ||
    "A quick note";
  const preheader =
    parsedPlain.preheader ||
    subjectLines.match(/Preheader\s*\n+(.+)/i)?.[1]?.trim() ||
    preheaderFromHtml(rawHtml);
  const text =
    parsedPlain.body ||
    stripTagsToText(rawHtml) ||
    `${subject}\n\n${preheader}`.trim();

  const sanitized = addEmailClientHeadPatch(sanitizeEmailHtml(rawHtml));
  const absolute = absolutizeEmailUrls(sanitized, publicBaseUrlFor(app));
  const richClipboardImages = await inlineLocalImagesForClipboard(sanitized, root);
  const richClipboardAbsolute = absolutizeEmailUrls(
    richClipboardImages.html,
    publicBaseUrlFor(app),
    { allowDataImages: true }
  );
  const clipboardImages =
    CLIPBOARD_IMAGE_MODE === "data-uri"
      ? await inlineLocalImagesForClipboard(sanitized, root)
      : CLIPBOARD_IMAGE_MODE === "absolute"
        ? { html: sanitized, warnings: [] }
        : stripImagesForClipboard(sanitized);
  const clipboardAbsolute = absolutizeEmailUrls(
    clipboardImages.html,
    publicBaseUrlFor(app),
    { allowDataImages: CLIPBOARD_IMAGE_MODE === "data-uri" }
  );
  const html = ensureHiddenPreheader(addBgcolorAttributes(absolute.html), preheader);
  const richClipboardHtml = makeRichClipboardHtmlFluid(
    ensureHiddenPreheader(richClipboardAbsolute.html, preheader)
  );
  const clipboardHtml = makeClipboardHtmlPasteSafe(
    ensureHiddenPreheader(clipboardAbsolute.html, preheader)
  );
  const warnings = [
    ...absolute.warnings,
    ...clipboardImages.warnings,
    ...clipboardAbsolute.warnings,
  ];
  if (countImages(html) > 0 && !/alt\s*=/i.test(html)) {
    warnings.push("Email contains images; make sure important images have alt text.");
  }

  return {
    buildId: app.id,
    buildName: app.name,
    subject: subject.slice(0, 220),
    preheader: preheader.slice(0, 260),
    html,
    clipboardHtml,
    richClipboardHtml,
    text,
    htmlBytes: Buffer.byteLength(html),
    clipboardHtmlBytes: Buffer.byteLength(clipboardHtml),
    richClipboardHtmlBytes: Buffer.byteLength(richClipboardHtml),
    textBytes: Buffer.byteLength(text),
    imageCount: countImages(html),
    warnings: [...new Set(warnings)],
  };
}
