import path from "path";
import { readFile } from "fs/promises";

import { getHermesDataDir, getHermesBaseUrl } from "@/lib/hermes-config";

export type SetupCheck = {
  ok: boolean;
  label: string;
  detail: string;
  optional?: boolean;
  links?: Array<{
    label: string;
    href: string;
  }>;
};

export type HermesSetupStatus = {
  ready: boolean;
  dashboardUrl: string | null;
  gateway: SetupCheck;
  codex: SetupCheck;
  deepgram: SetupCheck;
  openrouter: SetupCheck;
  checkedAt: string;
};

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readCodexAuth(root: string | null): Promise<boolean> {
  if (!root) return false;
  const raw = await readTextIfExists(path.join(root, "auth.json"));
  if (!raw) return false;
  try {
    const auth = JSON.parse(raw) as {
      credential_pool?: Record<string, Array<Record<string, unknown>>>;
      providers?: Record<string, Record<string, unknown>>;
    };
    const pool = auth.credential_pool?.["openai-codex"] ?? [];
    const fromPool = pool.some(
      (entry) =>
        typeof entry.access_token === "string" && entry.access_token.trim().length > 0
    );
    const providerState = auth.providers?.["openai-codex"];
    const tokens =
      providerState?.tokens && typeof providerState.tokens === "object"
        ? (providerState.tokens as Record<string, unknown>)
        : null;
    const fromProvider =
      typeof tokens?.access_token === "string" &&
      tokens.access_token.trim().length > 0;
    return fromPool || fromProvider;
  } catch {
    return false;
  }
}

async function readActiveProvider(root: string | null): Promise<string | null> {
  if (!root) return null;
  const presetsRaw = await readTextIfExists(path.join(root, "model_presets.json"));
  if (presetsRaw) {
    try {
      const parsed = JSON.parse(presetsRaw) as {
        active?: unknown;
        presets?: Record<string, Record<string, unknown>>;
      };
      const active = typeof parsed.active === "string" ? parsed.active.trim() : "";
      const bundle = active ? parsed.presets?.[active] : null;
      const provider =
        bundle && typeof bundle.mainProvider === "string"
          ? bundle.mainProvider.trim()
          : "";
      if (provider) return provider;
    } catch {
      /* fall through */
    }
  }
  const configRaw = await readTextIfExists(path.join(root, "config.yaml"));
  const match = configRaw?.match(
    /(?:^|\n)model:\s*\n(?:[^\n]*\n)*?\s+provider:\s*([^\n#]+)/
  );
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

async function checkGateway(): Promise<SetupCheck> {
  const configuredBase = getHermesBaseUrl();
  if (!configuredBase) {
    return {
      ok: false,
      label: "Hermes gateway",
      detail: "HERMES_URL is not configured for HermesChat.",
    };
  }
  const base = configuredBase.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (res.ok) {
      return {
        ok: true,
        label: "Hermes gateway",
        detail: "Running and reachable from HermesChat.",
      };
    }
    return {
      ok: false,
      label: "Hermes gateway",
      detail: `Gateway responded with HTTP ${res.status}.`,
    };
  } catch (e) {
    return {
      ok: false,
      label: "Hermes gateway",
      detail: e instanceof Error ? e.message : "Gateway is not reachable.",
    };
  }
}

export async function getHermesSetupStatus(): Promise<HermesSetupStatus> {
  const root = getHermesDataDir();
  const [gateway, codexAuth, provider] = await Promise.all([
    checkGateway(),
    readCodexAuth(root),
    readActiveProvider(root),
  ]);
  const providerLc = provider?.trim().toLowerCase() || "";
  const codexActive = !providerLc || providerLc === "openai-codex";
  const codexOk = codexActive && codexAuth;
  const deepgramOk = Boolean(process.env.DEEPGRAM_API_KEY?.trim());
  const openrouterOk = Boolean(
    process.env.OPENROUTER_MANAGEMENT_KEY?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim()
  );

  return {
    ready: gateway.ok && codexOk,
    dashboardUrl: process.env.HERMES_DASHBOARD_URL?.trim() || null,
    gateway,
    codex: {
      ok: codexOk,
      label: "OpenAI Codex / ChatGPT",
      detail: codexOk
        ? "Connected through Hermes auth."
        : codexActive
          ? "Not connected yet. Open the Hermes dashboard and connect OpenAI Codex with your ChatGPT subscription."
          : `Active provider is ${provider || "unknown"}, not openai-codex.`,
    },
    deepgram: {
      ok: deepgramOk,
      label: "Deepgram voice",
      detail: deepgramOk
        ? "Voice input and read-aloud are enabled."
        : "Optional. Add DEEPGRAM_API_KEY to enable microphone dictation and read-aloud.",
      optional: true,
      links: [
        {
          label: "Get Deepgram API key",
          href: "https://console.deepgram.com/api-keys",
        },
      ],
    },
    openrouter: {
      ok: openrouterOk,
      label: "OpenRouter",
      detail: openrouterOk
        ? "Configured for optional extra providers/features."
        : "Optional. Add OPENROUTER_API_KEY for extra model routing; it does not replace the supported Codex/ChatGPT setup path.",
      optional: true,
      links: [
        {
          label: "Get OpenRouter API key",
          href: "https://openrouter.ai/settings/keys",
        },
      ],
    },
    checkedAt: new Date().toISOString(),
  };
}
