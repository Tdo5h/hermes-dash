import { loadEnvLocalIntoProcess } from "@/lib/load-env-local";

/** Short-lived JWT for browser live transcription (never send the project API key to the client). */
const TOKEN_TTL_SECONDS = 600;

export const dynamic = "force-dynamic";

const GRANT_DOCS =
  "https://developers.deepgram.com/reference/auth/tokens/grant";
const MEMBER_KEY_HINT =
  "Use a project API key with Member (or higher) role in the Deepgram Console; /v1/auth/grant requires that permission.";

function parseDeepgramErrorBody(text: string): string {
  const slice = text.slice(0, 400);
  try {
    const j = JSON.parse(text) as { err_msg?: string; message?: string };
    return (j.err_msg || j.message || slice).slice(0, 300);
  } catch {
    return slice;
  }
}

/** Does not call Deepgram; use to verify the server has env without exposing secrets. */
export async function GET() {
  loadEnvLocalIntoProcess();
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  return Response.json({
    ok: true,
    configured: Boolean(key),
  });
}

export async function POST() {
  loadEnvLocalIntoProcess();
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) {
    return Response.json(
      {
        error: "Server misconfiguration: DEEPGRAM_API_KEY is not set",
        hint: "Set DEEPGRAM_API_KEY on the host that runs next start (or add it to .env.local and redeploy).",
      },
      { status: 503 }
    );
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${key}`,
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = parseDeepgramErrorBody(text);
      console.error(
        `[deepgram/token] /v1/auth/grant returned ${res.status}:`,
        detail
      );
      const authFailure = res.status === 401 || res.status === 403;
      return Response.json(
        {
          error: `Deepgram /v1/auth/grant returned ${res.status}`,
          detail,
          ...(authFailure && {
            code: "deepgram_grant_denied",
            hint: MEMBER_KEY_HINT,
            docs: GRANT_DOCS,
          }),
        },
        { status: authFailure ? 503 : 502 }
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      return Response.json(
        { error: "No access_token in Deepgram response" },
        { status: 502 }
      );
    }

    return Response.json({
      access_token: data.access_token,
      expires_in: data.expires_in ?? TOKEN_TTL_SECONDS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[deepgram/token] fetch failed:", msg);
    return Response.json(
      {
        error: msg,
        hint: "Origin could not reach api.deepgram.com (network, DNS, or TLS).",
      },
      { status: 502 }
    );
  }
}
