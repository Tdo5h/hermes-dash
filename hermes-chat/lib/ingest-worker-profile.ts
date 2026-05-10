import { closePool } from "@/lib/db/client";
import type { IngestSourceProfile } from "@/lib/shared-ingest-job-store";

function coalesceIngestSourceProfile(
  profile: IngestSourceProfile | undefined
): IngestSourceProfile {
  if (profile) {
    return profile;
  }
  const d = process.env.INGEST_WORKER_DEFAULT_PROFILE?.trim();
  if (d === "bt_user1" || d === "bt_user2" || d === "main") {
    return d;
  }
  return "main";
}

function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function parseProfileList(raw: string | undefined): IngestSourceProfile[] {
  if (!raw?.trim()) return [];
  const out: IngestSourceProfile[] = [];
  const seen = new Set<IngestSourceProfile>();
  for (const part of raw.split(",")) {
    const p = part.trim();
    if (p !== "main" && p !== "bt_user1" && p !== "bt_user2") continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Profiles this worker is allowed to consume from the shared queue.
 * Multiple workers can watch the same coord dir; this keeps tenant jobs on their own gateway/DB.
 */
export function getIngestWorkerSupportedProfiles(): IngestSourceProfile[] {
  const explicit = parseProfileList(process.env.INGEST_WORKER_PROFILES);
  if (explicit.length > 0) return explicit;

  const out = new Set<IngestSourceProfile>();
  out.add(coalesceIngestSourceProfile(undefined));

  if (
    hasEnv(
      "INGEST_WORKER_MAIN_HERMES_URL",
      "INGEST_WORKER_MAIN_SHARED_INGEST_URL",
      "INGEST_WORKER_MAIN_HERMES_TOKEN",
      "INGEST_WORKER_MAIN_SHARED_INGEST_TOKEN",
      "INGEST_WORKER_MAIN_DATABASE_URL",
      "INGEST_WORKER_MAIN_HERMES_DATA_DIR"
    )
  ) {
    out.add("main");
  }
  if (
    hasEnv(
      "INGEST_WORKER_BT_USER1_HERMES_URL",
      "INGEST_WORKER_BT_USER1_SHARED_INGEST_URL",
      "INGEST_WORKER_BT_USER1_HERMES_TOKEN",
      "INGEST_WORKER_BT_USER1_SHARED_INGEST_TOKEN",
      "INGEST_WORKER_BT_USER1_DATABASE_URL",
      "INGEST_WORKER_BT_USER1_HERMES_DATA_DIR"
    )
  ) {
    out.add("bt_user1");
  }
  if (
    hasEnv(
      "INGEST_WORKER_BT_USER2_HERMES_URL",
      "INGEST_WORKER_BT_USER2_SHARED_INGEST_URL",
      "INGEST_WORKER_BT_USER2_HERMES_TOKEN",
      "INGEST_WORKER_BT_USER2_SHARED_INGEST_TOKEN",
      "INGEST_WORKER_BT_USER2_DATABASE_URL",
      "INGEST_WORKER_BT_USER2_HERMES_DATA_DIR"
    )
  ) {
    out.add("bt_user2");
  }

  return [...out];
}

/**
 * Map tenant-specific env for the architect ingest worker.
 * After each call, `readProject` / `listVaultUploadedFiles` use the matching database and paths.
 */
export async function applyIngestSourceProfile(
  profile: IngestSourceProfile | undefined
): Promise<void> {
  await closePool();
  const p: IngestSourceProfile = coalesceIngestSourceProfile(profile);
  if (p === "bt_user1") {
    const d =
      process.env.INGEST_WORKER_BT_USER1_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL_USER1?.trim();
    if (d) {
      process.env.DATABASE_URL = d;
    }
    const h = process.env.INGEST_WORKER_BT_USER1_HERMES_DATA_DIR?.trim();
    if (h) {
      process.env.HERMES_DATA_DIR = h;
    }
    const gatewayUrl =
      process.env.INGEST_WORKER_BT_USER1_HERMES_URL?.trim() ||
      process.env.INGEST_WORKER_BT_USER1_SHARED_INGEST_URL?.trim();
    if (gatewayUrl) {
      process.env.HERMES_SHARED_INGEST_URL = gatewayUrl;
      process.env.HERMES_ARCHITECT_URL = gatewayUrl;
      process.env.HERMES_URL = gatewayUrl;
    }
    const gatewayToken =
      process.env.INGEST_WORKER_BT_USER1_HERMES_TOKEN?.trim() ||
      process.env.INGEST_WORKER_BT_USER1_SHARED_INGEST_TOKEN?.trim();
    if (gatewayToken) {
      process.env.HERMES_SHARED_INGEST_TOKEN = gatewayToken;
      process.env.HERMES_ARCHITECT_TOKEN = gatewayToken;
      process.env.HERMES_TOKEN = gatewayToken;
    }
  } else if (p === "bt_user2") {
    const d =
      process.env.INGEST_WORKER_BT_USER2_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL_USER2?.trim();
    if (d) {
      process.env.DATABASE_URL = d;
    }
    const h = process.env.INGEST_WORKER_BT_USER2_HERMES_DATA_DIR?.trim();
    if (h) {
      process.env.HERMES_DATA_DIR = h;
    }
    const gatewayUrl =
      process.env.INGEST_WORKER_BT_USER2_HERMES_URL?.trim() ||
      process.env.INGEST_WORKER_BT_USER2_SHARED_INGEST_URL?.trim();
    if (gatewayUrl) {
      process.env.HERMES_SHARED_INGEST_URL = gatewayUrl;
      process.env.HERMES_ARCHITECT_URL = gatewayUrl;
      process.env.HERMES_URL = gatewayUrl;
    }
    const gatewayToken =
      process.env.INGEST_WORKER_BT_USER2_HERMES_TOKEN?.trim() ||
      process.env.INGEST_WORKER_BT_USER2_SHARED_INGEST_TOKEN?.trim();
    if (gatewayToken) {
      process.env.HERMES_SHARED_INGEST_TOKEN = gatewayToken;
      process.env.HERMES_ARCHITECT_TOKEN = gatewayToken;
      process.env.HERMES_TOKEN = gatewayToken;
    }
  } else {
    const m = process.env.INGEST_WORKER_MAIN_DATABASE_URL?.trim();
    if (m) {
      process.env.DATABASE_URL = m;
    }
    const h = process.env.INGEST_WORKER_MAIN_HERMES_DATA_DIR?.trim();
    if (h) {
      process.env.HERMES_DATA_DIR = h;
    }
    const gatewayUrl =
      process.env.INGEST_WORKER_MAIN_HERMES_URL?.trim() ||
      process.env.INGEST_WORKER_MAIN_SHARED_INGEST_URL?.trim();
    if (gatewayUrl) {
      process.env.HERMES_SHARED_INGEST_URL = gatewayUrl;
      process.env.HERMES_ARCHITECT_URL = gatewayUrl;
      process.env.HERMES_URL = gatewayUrl;
    }
    const gatewayToken =
      process.env.INGEST_WORKER_MAIN_HERMES_TOKEN?.trim() ||
      process.env.INGEST_WORKER_MAIN_SHARED_INGEST_TOKEN?.trim();
    if (gatewayToken) {
      process.env.HERMES_SHARED_INGEST_TOKEN = gatewayToken;
      process.env.HERMES_ARCHITECT_TOKEN = gatewayToken;
      process.env.HERMES_TOKEN = gatewayToken;
    }
  }
}

export function getIngestWorkerNotifyConfig(profile: IngestSourceProfile | undefined): {
  baseUrl: string;
  token: string;
  siteBaseUrl: string;
} {
  const p: IngestSourceProfile = coalesceIngestSourceProfile(profile);
  if (p === "bt_user1") {
    return {
      baseUrl: (
        process.env.INGEST_WORKER_BT_USER1_NOTIFY_URL?.trim() ||
        "http://127.0.0.1:13100"
      ).replace(/\/$/, ""),
      token:
        process.env.INGEST_WORKER_BT_USER1_NOTIFY_TOKEN?.trim() ||
        process.env.HERMES_CHAT_ARCHITECT_NOTIFY_TOKEN?.trim() ||
        "",
      siteBaseUrl: (
        process.env.INGEST_WORKER_BT_USER1_SITE_URL?.trim() ||
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        ""
      ).replace(/\/$/, ""),
    };
  }
  if (p === "bt_user2") {
    return {
      baseUrl: (
        process.env.INGEST_WORKER_BT_USER2_NOTIFY_URL?.trim() ||
        "http://127.0.0.1:13101"
      ).replace(/\/$/, ""),
      token:
        process.env.INGEST_WORKER_BT_USER2_NOTIFY_TOKEN?.trim() ||
        process.env.HERMES_CHAT_ARCHITECT_NOTIFY_TOKEN?.trim() ||
        "",
      siteBaseUrl: (
        process.env.INGEST_WORKER_BT_USER2_SITE_URL?.trim() ||
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        ""
      ).replace(/\/$/, ""),
    };
  }
  return {
    baseUrl: (process.env.HERMESCHAT_INTERNAL_URL?.trim() || "http://127.0.0.1:3100").replace(
      /\/$/,
      ""
    ),
    token: process.env.HERMES_CHAT_ARCHITECT_NOTIFY_TOKEN?.trim() || "",
    siteBaseUrl: (process.env.INGEST_WORKER_MAIN_SITE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      "").replace(/\/$/, ""),
  };
}

export async function postIngestQueueDonePush(params: {
  profile: IngestSourceProfile | undefined;
  projectName: string;
  projectSlug: string;
  reingestVerify: boolean;
}): Promise<void> {
  const { baseUrl, token, siteBaseUrl } = getIngestWorkerNotifyConfig(params.profile);
  if (!token) {
    console.warn("[ingest-worker] skip push: no notify token for profile");
    return;
  }
  const path = `/api/internal/architect-ingest-notify`;
  const url = siteBaseUrl
    ? `${siteBaseUrl}/chat/workspace/${encodeURIComponent(params.projectSlug)}`
    : undefined;
  const body = {
    title: params.reingestVerify ? "Vault re-sync complete" : "Vault ingest complete",
    body: params.reingestVerify
      ? `${params.projectName} is ready. All queued re-sync work has finished.`
      : `${params.projectName} is ready. All queued ingest work has finished.`,
    ...(url ? { url } : {}),
    kind: "vault",
    tag: `vault-shared-${params.projectSlug}`,
  };
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[ingest-worker] notify failed:", res.status, t.slice(0, 200));
  }
}
