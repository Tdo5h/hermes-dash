/**
 * Reads Hermes gateway home files (USER.md, SOUL.md) so HermesChat labels match
 * what the Hermes process loads from the same paths (see Nous Hermes docs).
 * Server-only — uses fs.
 */
import fs from "fs";
import path from "path";
import { getAgentDisplayName } from "@/lib/agent-display-name";

export type HermesIdentityPayload = {
  agentName: string;
  /** First markdown `#` heading in SOUL.md (trimmed), e.g. persona title. */
  soulHeadline: string | null;
  userName: string | null;
  callThem: string | null;
  pronouns: string | null;
  timezone: string | null;
  notes: string | null;
  /** Best display for the human: call them, else name. */
  userDisplay: string | null;
  /** One line for header: agent · human context. */
  labelLine: string;
  hermesDataDir: string | null;
  userMdLoaded: boolean;
  soulMdLoaded: boolean;
};

export function resolveHermesDataDir(): string | null {
  const env = process.env.HERMES_DATA_DIR?.trim();
  if (env) {
    try {
      if (fs.statSync(env).isDirectory()) return path.resolve(env);
    } catch {
      /* fall through */
    }
  }
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "hermes-data"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "hermes-data"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isDirectory()) return path.resolve(p);
    } catch {
      /* continue */
    }
  }
  return null;
}

function parseUserMdBullet(content: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^\\s*-\\s*\\*\\*${escaped}\\*\\*:\\s*(.*)$`,
    "im"
  );
  const m = content.match(re);
  const v = m?.[1]?.trim() ?? "";
  return v.length > 0 ? v : null;
}

function parseUserMdTimezone(content: string): string | null {
  const bullet = parseUserMdBullet(content, "Timezone");
  if (bullet) return bullet;
  const line = content
    .match(/(?:^|\n).*?(?:Location\/timezone|Timezone)\s*:\s*(.+)$/im)?.[1]
    ?.trim();
  if (!line) return null;
  return line.match(/[A-Za-z_]+\/[A-Za-z_/-]+/)?.[0] ?? line;
}

export function parseUserMdFields(content: string): {
  userName: string | null;
  callThem: string | null;
  pronouns: string | null;
  timezone: string | null;
  notes: string | null;
} {
  return {
    userName: parseUserMdBullet(content, "Name"),
    callThem: parseUserMdBullet(content, "What to call them"),
    pronouns: parseUserMdBullet(content, "Pronouns"),
    timezone: parseUserMdTimezone(content),
    notes: parseUserMdBullet(content, "Notes"),
  };
}

export function parseSoulHeadline(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("#")) {
      return t.replace(/^#+\s*/, "").trim() || null;
    }
  }
  return null;
}

export function buildHermesIdentityPayload(): HermesIdentityPayload {
  const agentName = getAgentDisplayName();
  const dir = resolveHermesDataDir();
  let soulHeadline: string | null = null;
  let userName: string | null = null;
  let callThem: string | null = null;
  let pronouns: string | null = null;
  let timezone: string | null = null;
  let notes: string | null = null;
  let userMdLoaded = false;
  let soulMdLoaded = false;

  if (dir) {
    const soulPath = path.join(dir, "SOUL.md");
    try {
      const soul = fs.readFileSync(soulPath, "utf-8");
      soulHeadline = parseSoulHeadline(soul);
      soulMdLoaded = true;
    } catch {
      /* missing */
    }

    const userPath = path.join(dir, "memories", "USER.md");
    try {
      const user = fs.readFileSync(userPath, "utf-8");
      const parsed = parseUserMdFields(user);
      userName = parsed.userName;
      callThem = parsed.callThem;
      pronouns = parsed.pronouns;
      timezone = parsed.timezone;
      notes = parsed.notes;
      userMdLoaded = true;
    } catch {
      /* missing */
    }
  }

  const userDisplay = callThem || userName || null;

  const parts: string[] = [agentName];
  if (userDisplay) {
    parts.push(`with ${userDisplay}`);
  } else if (userMdLoaded) {
    parts.push("add Name in USER.md");
  }
  const labelLine = parts.join(" · ");

  return {
    agentName,
    soulHeadline,
    userName,
    callThem,
    pronouns,
    timezone,
    notes,
    userDisplay,
    labelLine,
    hermesDataDir: dir,
    userMdLoaded,
    soulMdLoaded,
  };
}
