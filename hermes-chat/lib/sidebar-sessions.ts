/**
 * Collapse duplicate rows in sessions.json that share the same chat route id
 * (e.g. `webchat:cron-foo` vs `agent:main:webchat:cron-foo`).
 */

export type SidebarDedupeRow = {
  key: string;
  id: string;
  webchatId: string | null;
  updatedAt: number;
  processing?: boolean;
};

function navigationId(row: SidebarDedupeRow): string {
  return row.webchatId || row.id;
}

/** Prefer `webchat:…` keys written by this app over longer gateway-prefixed keys when timestamps tie. */
export function isCanonicalWebchatStoreKey(key: string): boolean {
  return key.startsWith("webchat:");
}

function pickNewerRow<T extends SidebarDedupeRow>(existing: T, candidate: T): T {
  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt > existing.updatedAt ? candidate : existing;
  }
  if (isCanonicalWebchatStoreKey(candidate.key) && !isCanonicalWebchatStoreKey(existing.key)) {
    return candidate;
  }
  if (isCanonicalWebchatStoreKey(existing.key) && !isCanonicalWebchatStoreKey(candidate.key)) {
    return existing;
  }
  return candidate;
}

export function dedupeSessionsForSidebar<T extends SidebarDedupeRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const nav = navigationId(row);
    const list = groups.get(nav) ?? [];
    list.push(row);
    groups.set(nav, list);
  }
  const out: T[] = [];
  for (const group of groups.values()) {
    let best = group[0];
    for (let i = 1; i < group.length; i++) {
      best = pickNewerRow(best, group[i]);
    }
    const anyProcessing = group.some((r) => Boolean((r as { processing?: boolean }).processing));
    out.push({
      ...best,
      processing: anyProcessing || Boolean((best as { processing?: boolean }).processing),
    } as T);
  }
  return out;
}
