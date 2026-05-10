import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ORModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
};

function normOrId(s: string): string {
  return s.replace(/^openrouter\//i, "").trim();
}

/**
 * Public OpenRouter model list — used for $/1M token hints in one-off model picker and plans.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get("ids");
  const want = ids
    ? new Set(
        ids
          .split(",")
          .map((s) => normOrId(s))
          .filter(Boolean)
      )
    : null;

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/models", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json({ ok: false as const, detail: "fetch_failed" }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false as const, detail: "upstream", status: res.status },
      { status: 502 }
    );
  }
  const body = (await res.json().catch(() => null)) as { data?: ORModel[] } | null;
  const list = (body?.data ?? []) as ORModel[];
  const out: {
    id: string;
    promptPer1K?: string;
    completionPer1K?: string;
  }[] = [];
  for (const m of list) {
    if (!m?.id) continue;
    if (want && !want.has(normOrId(m.id))) continue;
    const pr = m.pricing;
    // OpenRouter returns USD per token as string; same for prompt/completion.
    out.push({
      id: m.id,
      promptPer1K: pr?.prompt ?? undefined,
      completionPer1K: pr?.completion ?? undefined,
    });
    if (want && out.length >= want.size) break;
  }
  return NextResponse.json({ ok: true as const, models: out });
}
