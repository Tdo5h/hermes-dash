import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET https://openrouter.ai/api/v1/credits — requires a key with credit read access
 * (often an OpenRouter "management" key; plain API keys may return 403).
 */
export async function GET() {
  const key =
    process.env.OPENROUTER_MANAGEMENT_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({
      ok: false as const,
      detail: "no_key",
    });
  }

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json({
      ok: false as const,
      detail: "fetch_failed",
    });
  }

  if (!res.ok) {
    const message = (await res.text().catch(() => "")).slice(0, 280);
    return NextResponse.json({
      ok: false as const,
      detail:
        res.status === 403
          ? "forbidden"
          : res.status === 401
            ? "unauthorized"
            : "upstream_error",
      status: res.status,
      message: message || undefined,
    });
  }

  const body = (await res.json().catch(() => null)) as {
    data?: { total_credits?: number; total_usage?: number };
  } | null;
  const tc = body?.data?.total_credits;
  const tu = body?.data?.total_usage;
  if (typeof tc !== "number" || typeof tu !== "number") {
    return NextResponse.json({
      ok: false as const,
      detail: "parse_error",
    });
  }

  return NextResponse.json({
    ok: true as const,
    totalCredits: tc,
    totalUsage: tu,
    remaining: tc - tu,
  });
}
