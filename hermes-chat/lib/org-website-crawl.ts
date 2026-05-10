import dns from "dns/promises";
import net from "net";

export type OrgWebsiteCrawlPage = {
  url: string;
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
  links: { href: string; text: string; internal: boolean }[];
};

export type OrgWebsiteCrawlResult = {
  startUrl: string;
  origin: string;
  crawledAt: string;
  pages: OrgWebsiteCrawlPage[];
  skipped: { url: string; reason: string }[];
  discoveredInternalLinks: string[];
  discoveredExternalLinks: string[];
};

export type CrawlCompanyWebsiteOptions = {
  maxPages?: number;
  maxPageBytes?: number;
  respectRobots?: boolean;
};

const DEFAULT_MAX_PAGES = 12;
const HARD_MAX_PAGES = 40;
const DEFAULT_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

const BINARY_EXT_RE =
  /\.(?:7z|avi|bmp|css|csv|doc|docx|eot|gif|gz|ico|jpeg|jpg|js|mov|mp3|mp4|mpeg|ods|odt|pdf|png|ppt|pptx|rar|svg|tar|tif|tiff|ttf|wav|webm|webp|woff|woff2|xls|xlsx|xml|zip)(?:[?#].*)?$/i;

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function sameSiteHost(a: string, b: string): boolean {
  return stripWww(a) === stripWww(b);
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m?.[1] ? decodeHtmlEntities(m[1].trim()) : null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? normalizeWhitespace(stripHtml(m[1])) : null;
}

function extractMetaDescription(html: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const name = getAttr(tag, "name")?.toLowerCase();
    const property = getAttr(tag, "property")?.toLowerCase();
    if (name === "description" || property === "og:description") {
      const content = getAttr(tag, "content");
      if (content) return normalizeWhitespace(content);
    }
  }
  return null;
}

function extractHeadings(html: string): string[] {
  const out: string[] = [];
  const re = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const h = normalizeWhitespace(stripHtml(m[1] ?? ""));
    if (h) out.push(h);
  }
  return unique(out).slice(0, 40);
}

function normalizeCrawlUrl(raw: string, base?: URL): URL | null {
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "/");
    }
    if (BINARY_EXT_RE.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: URL): { href: string; text: string; internal: boolean }[] {
  const out: { href: string; text: string; internal: boolean }[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hrefRaw = decodeHtmlEntities(m[1] ?? "").trim();
    if (!hrefRaw || /^(?:mailto|tel|sms|javascript):/i.test(hrefRaw)) continue;
    const url = normalizeCrawlUrl(hrefRaw, baseUrl);
    if (!url) continue;
    out.push({
      href: url.toString(),
      text: normalizeWhitespace(stripHtml(m[2] ?? "")).slice(0, 160),
      internal: sameSiteHost(url.hostname, baseUrl.hostname),
    });
  }
  const seen = new Set<string>();
  return out.filter((l) => {
    const key = `${l.href}\u001f${l.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipBlocked(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) return ipv4Blocked(address);
  if (kind === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.username || url.password) throw new Error("Website URL must not include credentials.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Website URL must be a public company website.");
  }
  if (net.isIP(host) && ipBlocked(host)) {
    throw new Error("Website URL points to a private or reserved address.");
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) throw new Error("Could not resolve website hostname.");
  if (records.some((r) => ipBlocked(r.address))) {
    throw new Error("Website hostname resolves to a private or reserved address.");
  }
}

async function fetchTextLimited(
  inputUrl: URL,
  maxBytes: number
): Promise<{ text: string; contentType: string; finalUrl: URL }> {
  let url = inputUrl;
  for (let redirects = 0; redirects < 6; redirects += 1) {
    await assertPublicHttpUrl(url);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html, text/plain;q=0.8, */*;q=0.1",
          "user-agent": "HermesBrainWebsiteIngest/1.0 (+org setup crawl)",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect without location (${res.status})`);
        const next = normalizeCrawlUrl(loc, url);
        if (!next) throw new Error("Redirect target is not a crawlable http(s) URL.");
        url = next;
        continue;
      }
      if (!res.ok) {
        const cfMitigated = res.headers.get("cf-mitigated")?.toLowerCase();
        if (res.status === 403 && cfMitigated === "challenge") {
          throw new Error(
            "Cloudflare challenge blocked Hermes from reading this page. If this is your site, allow the Hermes VPS IP or paste the website text below."
          );
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
      }
      const reader = res.body?.getReader();
      if (!reader) return { text: await res.text(), contentType, finalUrl: url };
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("Page is too large.");
        chunks.push(value);
      }
      return { text: Buffer.concat(chunks).toString("utf8"), contentType, finalUrl: url };
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error("Too many redirects.");
}

async function fetchRobotsText(url: URL): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/plain, */*;q=0.1",
        "user-agent": "HermesBrainWebsiteIngest/1.0 (+org setup crawl)",
      },
    });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt.slice(0, 256 * 1024);
  } finally {
    clearTimeout(t);
  }
}

function robotsAllows(pathname: string, robots: string | null): boolean {
  if (!robots) return true;
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  let applies = false;
  let sawAnyRule = false;
  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || /hermesbrainwebsiteingest/i.test(value);
      continue;
    }
    if (!applies || key !== "disallow") continue;
    sawAnyRule = true;
    if (!value) continue;
    if (pathname.startsWith(value)) return false;
  }
  return !sawAnyRule || true;
}

function pageFromHtml(url: URL, html: string): OrgWebsiteCrawlPage {
  const links = extractLinks(html, url);
  const text = stripHtml(html)
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, 24_000);
  return {
    url: url.toString(),
    title: extractTitle(html),
    description: extractMetaDescription(html),
    headings: extractHeadings(html),
    text,
    links,
  };
}

export async function crawlCompanyWebsite(
  startUrlRaw: string,
  options?: CrawlCompanyWebsiteOptions
): Promise<OrgWebsiteCrawlResult> {
  const startUrl = normalizeCrawlUrl(startUrlRaw);
  if (!startUrl) throw new Error("Enter a valid public http(s) website URL.");
  await assertPublicHttpUrl(startUrl);

  const maxPages = Math.min(
    Math.max(1, Math.floor(options?.maxPages ?? DEFAULT_MAX_PAGES)),
    HARD_MAX_PAGES
  );
  const maxPageBytes = Math.min(
    Math.max(64 * 1024, Math.floor(options?.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES)),
    DEFAULT_MAX_PAGE_BYTES
  );
  const respectRobots = options?.respectRobots !== false;

  let robots: string | null = null;
  if (respectRobots) {
    const robotsUrl = new URL("/robots.txt", startUrl.origin);
    robots = await fetchRobotsText(robotsUrl).catch(() => null);
  }

  const queue: URL[] = [startUrl];
  const queued = new Set([startUrl.toString()]);
  const visited = new Set<string>();
  const pages: OrgWebsiteCrawlPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url.toString())) continue;
    visited.add(url.toString());
    if (!sameSiteHost(url.hostname, startUrl.hostname)) continue;
    if (!robotsAllows(url.pathname, robots)) {
      skipped.push({ url: url.toString(), reason: "Blocked by robots.txt" });
      continue;
    }

    try {
      await assertPublicHttpUrl(url);
      const { text, finalUrl } = await fetchTextLimited(url, maxPageBytes);
      if (!sameSiteHost(finalUrl.hostname, startUrl.hostname)) {
        skipped.push({ url: url.toString(), reason: `Redirected off-site to ${finalUrl.toString()}` });
        continue;
      }
      const page = pageFromHtml(finalUrl, text);
      pages.push(page);
      for (const link of page.links) {
        if (link.internal) {
          internalLinks.add(link.href);
          const next = normalizeCrawlUrl(link.href);
          if (
            next &&
            sameSiteHost(next.hostname, startUrl.hostname) &&
            !queued.has(next.toString()) &&
            !visited.has(next.toString()) &&
            queue.length + pages.length < maxPages * 3
          ) {
            queued.add(next.toString());
            queue.push(next);
          }
        } else {
          externalLinks.add(link.href);
        }
      }
    } catch (e) {
      skipped.push({
        url: url.toString(),
        reason: e instanceof Error ? e.message : "Fetch failed",
      });
    }
  }

  return {
    startUrl: startUrl.toString(),
    origin: startUrl.origin,
    crawledAt: new Date().toISOString(),
    pages,
    skipped,
    discoveredInternalLinks: [...internalLinks].sort(),
    discoveredExternalLinks: [...externalLinks].sort(),
  };
}

function mdEscapeLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

export function companyWebsiteCrawlToMarkdown(
  crawl: OrgWebsiteCrawlResult,
  options?: { companyName?: string | null }
): string {
  const company = options?.companyName?.trim();
  const lines: string[] = [
    "---",
    "hermes_ingest_kind: company_website_crawl",
    `website_url: ${JSON.stringify(crawl.startUrl)}`,
    `company_name: ${JSON.stringify(company || "")}`,
    `crawled_at: ${JSON.stringify(crawl.crawledAt)}`,
    "---",
    "",
    "# Company website crawl",
    "",
    company ? `Company: ${company}` : "Company: _not supplied_",
    `Website: ${crawl.startUrl}`,
    `Pages captured: ${crawl.pages.length}`,
    "",
    "## What Hermes should learn",
    "",
    "- Treat this as public organization-level company context.",
    "- Extract official names, services, products, locations, industries, claims, values, links, and contact/profile clues.",
    "- Update org-global company profile, relevant people/client lists, `branding/BRAND_KIT.md`, `wiki/entities/companies/`, and Hermes Brain records when supported.",
    "- Keep all facts source-backed to the page URL and this crawl source file.",
    "",
    "## Internal links discovered",
    "",
    ...crawl.discoveredInternalLinks.map((href) => `- ${href}`),
    "",
    "## External links discovered",
    "",
    ...crawl.discoveredExternalLinks.map((href) => `- ${href}`),
  ];

  if (crawl.skipped.length > 0) {
    lines.push("", "## Skipped pages", "");
    for (const s of crawl.skipped) {
      lines.push(`- ${s.url} — ${s.reason}`);
    }
  }

  for (const page of crawl.pages) {
    lines.push(
      "",
      "---",
      "",
      `## Page: ${page.title ? mdEscapeLine(page.title) : page.url}`,
      "",
      `URL: ${page.url}`,
      page.description ? `Description: ${mdEscapeLine(page.description)}` : "Description: _none found_",
      "",
      "### Headings",
      "",
      ...(page.headings.length > 0 ? page.headings.map((h) => `- ${mdEscapeLine(h)}`) : ["_No headings found._"]),
      "",
      "### Links on this page",
      "",
      ...(page.links.length > 0
        ? page.links.map((l) => `- ${l.internal ? "Internal" : "External"}: [${l.text || l.href}](${l.href})`)
        : ["_No links found._"]),
      "",
      "### Extracted text",
      "",
      page.text || "_No text extracted._"
    );
  }

  return `${lines.join("\n")}\n`;
}

export function companyWebsiteSourceName(urlRaw: string): string {
  const url = new URL(urlRaw);
  const host = url.hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  return `company-website-${host}.md`;
}
