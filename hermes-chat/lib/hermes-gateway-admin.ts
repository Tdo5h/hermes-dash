import { getHermesBaseUrl, getHermesToken } from "@/lib/hermes-config";

/** When set to `1`/`true`, enables POST /api/hermes/stack and job patches from the UI. */
export function isHermesStackModelEditsEnabled(): boolean {
  const v = process.env.HERMES_ALLOW_STACK_MODEL_EDITS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Call Hermes gateway admin routes (same bearer as HERMES_TOKEN / API_SERVER_KEY).
 */
export async function hermesGatewayAdminFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const base = getHermesBaseUrl();
  const token = getHermesToken();
  if (!base || !token) {
    return new Response(
      JSON.stringify({ error: "HERMES_URL or HERMES_TOKEN not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const { timeoutMs, ...rest } = init;
  const ctrl = new AbortController();
  const t = timeoutMs ?? 30_000;
  const to = setTimeout(() => ctrl.abort(), t);
  const hdrs = new Headers(rest.headers as HeadersInit | undefined);
  if (!hdrs.has("Authorization")) {
    hdrs.set("Authorization", `Bearer ${token}`);
  }
  if (rest.body != null && !hdrs.has("Content-Type")) {
    hdrs.set("Content-Type", "application/json");
  }
  try {
    return await fetch(url, {
      ...rest,
      signal: rest.signal ?? ctrl.signal,
      headers: hdrs,
    });
  } finally {
    clearTimeout(to);
  }
}
