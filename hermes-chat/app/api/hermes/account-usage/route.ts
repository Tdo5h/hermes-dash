import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import {
  getHermesDataDir,
} from "@/lib/hermes-config";

export const dynamic = "force-dynamic";

type UsageWindow = {
  label: "Session" | "Weekly";
  usedPercent: number;
  remainingPercent: number;
  resetAt: string | null;
  resetAfterSeconds: number | null;
};

type AccountUsagePayload = {
  active: boolean;
  provider: string | null;
  plan: string | null;
  fetchedAt: string | null;
  windows: UsageWindow[];
  line: string | null;
  title: string | null;
  error?: string;
};

let cache:
  | {
      at: number;
      payload: AccountUsagePayload;
    }
  | null = null;

function titleCase(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function resetDateFromWindow(raw: Record<string, unknown>): string | null {
  const resetAt = raw.reset_at;
  if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
    return new Date(resetAt * 1000).toISOString();
  }
  if (typeof resetAt === "string" && resetAt.trim()) {
    const n = Number(resetAt);
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
    const d = new Date(resetAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

async function readCodexCredential(): Promise<{
  accessToken: string;
  baseUrl: string;
} | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  const raw = await readFile(path.join(root, "auth.json"), "utf-8");
  const auth = JSON.parse(raw) as {
    credential_pool?: Record<string, Array<Record<string, unknown>>>;
    providers?: Record<string, Record<string, unknown>>;
  };
  const pool = auth.credential_pool?.["openai-codex"] ?? [];
  const entry = pool
    .slice()
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
    .find((e) => typeof e.access_token === "string" && e.access_token.trim());
  const providerState = auth.providers?.["openai-codex"];
  const tokenFromProvider =
    providerState?.tokens &&
    typeof providerState.tokens === "object" &&
    "access_token" in providerState.tokens &&
    typeof providerState.tokens.access_token === "string"
      ? providerState.tokens.access_token
      : "";
  const accessToken =
    (typeof entry?.access_token === "string" ? entry.access_token.trim() : "") ||
    tokenFromProvider.trim();
  if (!accessToken) return null;
  const baseUrl =
    (typeof entry?.base_url === "string" && entry.base_url.trim()) ||
    "https://chatgpt.com/backend-api/codex";
  return { accessToken, baseUrl };
}

async function readActiveProvider(): Promise<string | null> {
  const root = getHermesDataDir();
  if (!root) return null;
  try {
    const raw = await readFile(path.join(root, "model_presets.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      active?: unknown;
      presets?: Record<string, Record<string, unknown>>;
    };
    const active = typeof parsed.active === "string" ? parsed.active.trim() : "";
    const bundle = active ? parsed.presets?.[active] : null;
    const fromPreset =
      bundle && typeof bundle.mainProvider === "string"
        ? bundle.mainProvider.trim()
        : "";
    if (fromPreset) return fromPreset;
  } catch {
    /* fall through to config.yaml */
  }

  try {
    const raw = await readFile(path.join(root, "config.yaml"), "utf-8");
    const match = raw.match(/(?:^|\n)model:\s*\n(?:[^\n]*\n)*?\s+provider:\s*([^\n#]+)/);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

function usageUrl(baseUrl: string): string {
  let normalized = (baseUrl || "https://chatgpt.com/backend-api/codex")
    .trim()
    .replace(/\/+$/, "");
  if (normalized.endsWith("/codex")) {
    normalized = normalized.slice(0, -"/codex".length);
  }
  if (normalized.includes("/backend-api")) return `${normalized}/wham/usage`;
  return `${normalized}/api/codex/usage`;
}

function parseUsage(payload: Record<string, unknown>): AccountUsagePayload {
  const rateLimit =
    payload.rate_limit && typeof payload.rate_limit === "object"
      ? (payload.rate_limit as Record<string, unknown>)
      : {};
  const windows: UsageWindow[] = [];
  for (const [key, label] of [
    ["primary_window", "Session"],
    ["secondary_window", "Weekly"],
  ] as const) {
    const raw =
      rateLimit[key] && typeof rateLimit[key] === "object"
        ? (rateLimit[key] as Record<string, unknown>)
        : null;
    if (!raw) continue;
    const usedPercent = Number(raw.used_percent);
    if (!Number.isFinite(usedPercent)) continue;
    const resetAfterSeconds = Number(raw.reset_after_seconds);
    windows.push({
      label,
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      resetAt: resetDateFromWindow(raw),
      resetAfterSeconds: Number.isFinite(resetAfterSeconds)
        ? resetAfterSeconds
        : null,
    });
  }

  const line = windows.length
    ? windows
        .map(
          (w) =>
            `${w.label}: ${Math.round(w.remainingPercent)}% left, resets ${formatDuration(
              w.resetAfterSeconds
            )}`
        )
        .join(" · ")
    : null;
  const plan = titleCase(payload.plan_type);
  return {
    active: true,
    provider: "openai-codex",
    plan,
    fetchedAt: new Date().toISOString(),
    windows,
    line,
    title: [plan ? `ChatGPT ${plan}` : "ChatGPT", line].filter(Boolean).join(" · "),
  };
}

export async function GET() {
  const provider = (await readActiveProvider())?.trim().toLowerCase() || null;
  if (provider !== "openai-codex") {
    return NextResponse.json({
      active: false,
      provider,
      plan: null,
      fetchedAt: null,
      windows: [],
      line: null,
      title: null,
    } satisfies AccountUsagePayload);
  }

  if (cache && Date.now() - cache.at < 15_000) {
    return NextResponse.json(cache.payload);
  }

  try {
    const credential = await readCodexCredential();
    if (!credential) {
      return NextResponse.json(
        {
          active: true,
          provider,
          plan: null,
          fetchedAt: null,
          windows: [],
          line: null,
          title: null,
          error: "ChatGPT account token is not readable from Hermes auth.",
        } satisfies AccountUsagePayload,
        { status: 503 }
      );
    }

    const res = await fetch(usageUrl(credential.baseUrl), {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
        "User-Agent": "codex-cli",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          active: true,
          provider,
          plan: null,
          fetchedAt: null,
          windows: [],
          line: null,
          title: null,
          error: `ChatGPT usage request failed (${res.status})`,
        } satisfies AccountUsagePayload,
        { status: 502 }
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    const payload = parseUsage(body);
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      {
        active: true,
        provider,
        plan: null,
        fetchedAt: null,
        windows: [],
        line: null,
        title: null,
        error: e instanceof Error ? e.message : String(e),
      } satisfies AccountUsagePayload,
      { status: 500 }
    );
  }
}
