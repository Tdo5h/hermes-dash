import path from "path";
import { readdir, readFile, stat } from "fs/promises";
import { getHermesDataDir } from "@/lib/hermes-config";

const OPEN_DESIGN_GATEWAY_ROOT = "/opt/data/open-design";

export type OpenDesignDnaRow = {
  id: string;
  slug: string;
  name: string;
  category?: string;
  description?: string;
  path: string;
  updatedAt: number;
};

const FEATURED_SLUGS = [
  "apple",
  "stripe",
  "airbnb",
  "shopify",
  "nike",
  "spotify",
  "tesla",
  "uber",
  "pinterest",
  "starbucks",
  "notion",
  "linear-app",
  "vercel",
  "figma",
  "framer",
  "webflow",
  "supabase",
  "cursor",
  "raycast",
  "coinbase",
  "binance",
  "mastercard",
  "meta",
  "nvidia",
  "posthog",
  "sentry",
  "resend",
  "mintlify",
  "wise",
  "revolut",
  "superhuman",
  "airtable",
  "miro",
];

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
    )
    .join(" ");
}

function parseDesignMarkdown(slug: string, markdown: string) {
  const rawTitle = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const name = (rawTitle || titleFromSlug(slug))
    .replace(/^Design System Inspired by\s+/i, "")
    .trim();
  const category = markdown.match(/^>\s*Category:\s*(.+?)\s*$/m)?.[1]?.trim();
  const quotedLines = markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^>\s*(.+?)\s*$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
  const description = quotedLines.find((line) => !/^Category:/i.test(line));
  return {
    name: name || titleFromSlug(slug),
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
  };
}

export async function listOpenDesignDna(): Promise<OpenDesignDnaRow[]> {
  const root = getHermesDataDir();
  if (!root) return [];
  const designSystemsRoot = path.join(root, "open-design", "design-systems");
  let entries: string[] = [];
  try {
    entries = await readdir(designSystemsRoot);
  } catch {
    return [];
  }

  const rows: OpenDesignDnaRow[] = [];
  for (const slug of entries) {
    if (slug.startsWith(".")) continue;
    const designPath = path.join(designSystemsRoot, slug, "DESIGN.md");
    try {
      const fileStat = await stat(designPath);
      if (!fileStat.isFile()) continue;
      const markdown = await readFile(designPath, "utf-8");
      const parsed = parseDesignMarkdown(slug, markdown);
      rows.push({
        id: slug,
        slug,
        ...parsed,
        path: `${OPEN_DESIGN_GATEWAY_ROOT}/design-systems/${slug}/DESIGN.md`,
        updatedAt: fileStat.mtimeMs,
      });
    } catch {
      /* skip incomplete design systems */
    }
  }

  const featuredRank = new Map(FEATURED_SLUGS.map((slug, index) => [slug, index]));
  return rows.sort((a, b) => {
    const aRank = featuredRank.get(a.slug);
    const bRank = featuredRank.get(b.slug);
    if (aRank !== undefined || bRank !== undefined) {
      return (aRank ?? 9999) - (bRank ?? 9999);
    }
    return a.name.localeCompare(b.name);
  });
}
