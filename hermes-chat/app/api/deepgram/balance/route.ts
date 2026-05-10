import { loadEnvLocalIntoProcess } from "@/lib/load-env-local";

export const dynamic = "force-dynamic";

/** Prefer optional billing-capable key; else main key (Member keys often cannot read balances). */
function billingOrMainKey(): string | undefined {
  const billing = process.env.DEEPGRAM_BILLING_API_KEY?.trim();
  const main = process.env.DEEPGRAM_API_KEY?.trim();
  return billing || main;
}

/** Server-only: project balance(s) for Settings. Requires billing:read (Owner/Admin key) or optional DEEPGRAM_BILLING_API_KEY. */
export async function GET() {
  loadEnvLocalIntoProcess();
  const key = billingOrMainKey();
  if (!key) {
    return Response.json(
      { ok: false, code: "no_key" as const },
      { status: 503 }
    );
  }

  try {
    const projRes = await fetch("https://api.deepgram.com/v1/projects", {
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
      },
    });

    if (projRes.status === 401 || projRes.status === 403) {
      return Response.json({
        ok: false,
        code: "forbidden" as const,
        detail: "Key cannot list projects (needs Manage scope for balance).",
      });
    }

    if (!projRes.ok) {
      const text = await projRes.text().catch(() => "");
      return Response.json(
        {
          ok: false,
          code: "upstream" as const,
          detail: text.slice(0, 200),
        },
        { status: 502 }
      );
    }

    const projJson = (await projRes.json()) as {
      projects?: { project_id?: string }[];
    };
    const projectId = projJson.projects?.[0]?.project_id;
    if (!projectId) {
      return Response.json({
        ok: true,
        balances: [] as { amount?: number; units?: string }[],
      });
    }

    const balRes = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/balances`,
      {
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (balRes.status === 401 || balRes.status === 403) {
      return Response.json({
        ok: false,
        code: "forbidden" as const,
        detail: "Key cannot read balances.",
      });
    }

    if (!balRes.ok) {
      const text = await balRes.text().catch(() => "");
      return Response.json(
        {
          ok: false,
          code: "upstream" as const,
          detail: text.slice(0, 200),
        },
        { status: 502 }
      );
    }

    const balJson = (await balRes.json()) as {
      balances?: { amount?: number; units?: string; balance_id?: string }[];
    };

    return Response.json({
      ok: true,
      balances: balJson.balances ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, code: "error" as const, detail: msg },
      { status: 502 }
    );
  }
}
