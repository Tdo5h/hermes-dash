import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { getHermesChatDataDir } from "@/lib/hermes-config";

const PRESENCE_FILE = path.join(getHermesChatDataDir(), "push-presence.json");
const VISIBLE_TTL_MS = 45_000;
const MAX_PRESENCE_AGE_MS = 5 * 60_000;

export type PushPresenceRecord = {
  clientId: string;
  path: string;
  visibilityState: "visible" | "hidden" | "prerender" | "unknown";
  focused: boolean;
  subscriptionEndpoint?: string | null;
  updatedAt: number;
};

function readPresenceFile(): Record<string, PushPresenceRecord> {
  if (!existsSync(PRESENCE_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(PRESENCE_FILE, "utf-8"));
    if (!raw || typeof raw !== "object") return {};
    return raw as Record<string, PushPresenceRecord>;
  } catch {
    return {};
  }
}

function writePresenceFile(records: Record<string, PushPresenceRecord>) {
  const dir = path.dirname(PRESENCE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PRESENCE_FILE, JSON.stringify(records, null, 2));
}

function prunePresence(
  records: Record<string, PushPresenceRecord>,
  now = Date.now()
): Record<string, PushPresenceRecord> {
  const out: Record<string, PushPresenceRecord> = {};
  for (const [clientId, row] of Object.entries(records)) {
    if (!row || typeof row.updatedAt !== "number") continue;
    if (now - row.updatedAt > MAX_PRESENCE_AGE_MS) continue;
    out[clientId] = row;
  }
  return out;
}

export function upsertPushPresence(input: {
  clientId: string;
  path?: string | null;
  visibilityState?: string | null;
  focused?: boolean | null;
  subscriptionEndpoint?: string | null;
}) {
  const clientId = input.clientId.trim().slice(0, 120);
  if (!clientId) return;
  const now = Date.now();
  const records = prunePresence(readPresenceFile(), now);
  const visibility =
    input.visibilityState === "visible" ||
    input.visibilityState === "hidden" ||
    input.visibilityState === "prerender"
      ? input.visibilityState
      : "unknown";
  records[clientId] = {
    clientId,
    path: input.path?.trim().slice(0, 500) || "/chat",
    visibilityState: visibility,
    focused: input.focused === true,
    subscriptionEndpoint: input.subscriptionEndpoint?.trim() || null,
    updatedAt: now,
  };
  writePresenceFile(records);
}

export function getVisiblePushPresence(now = Date.now()): PushPresenceRecord[] {
  const records = prunePresence(readPresenceFile(), now);
  return Object.values(records).filter(
    (row) =>
      row.visibilityState === "visible" &&
      now - row.updatedAt <= VISIBLE_TTL_MS
  );
}

export function hasVisibleHermesClient(): boolean {
  return getVisiblePushPresence().length > 0;
}
