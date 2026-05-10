/**
 * Relative path under projects/<slug>/ for Postgres-backed wiki/extracted docs.
 * Rejects traversal and unexpected roots.
 */
export function normalizeWorkspaceKnowledgePath(raw: string): string | null {
  const s = raw.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!s || s.includes("..") || s.includes("\0")) return null;
  if (s === "INDEX.md" || s === "LOG.md" || s === "SCHEMA.md") return s;
  if (s.startsWith("wiki/") || s.startsWith("extracted/")) return s;
  return null;
}

export function normalizeProjectSlug(raw: string): string | null {
  const s = raw.trim();
  if (!s || !/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  return s;
}
