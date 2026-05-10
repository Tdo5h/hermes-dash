/** Shared JWT cache for browser Deepgram WebSocket (listen + speak). */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

let cache: { accessToken: string; expiresAt: number } | null = null;

/** Prime token + warm path — optional; safe to call from useEffect. */
export function cacheDeepgramTokenFromResponse(body: {
  access_token?: string;
  expires_in?: number;
}): void {
  if (!body.access_token) return;
  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 600;
  cache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + ttlSec * 1000 - TOKEN_REFRESH_MARGIN_MS,
  };
}

export async function getDeepgramAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.accessToken;
  }
  const tokenRes = await fetch("/api/deepgram/token", { method: "POST" });
  if (!tokenRes.ok) {
    cache = null;
    let line = `Deepgram setup failed (${tokenRes.status})`;
    try {
      const errBody = (await tokenRes.json()) as {
        hint?: string;
        detail?: string;
        error?: string;
      };
      line = errBody.hint || errBody.detail || errBody.error || line;
    } catch {
      /* keep line */
    }
    throw new Error(line);
  }
  const body = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    cache = null;
    throw new Error("token_missing");
  }
  cacheDeepgramTokenFromResponse(body);
  return body.access_token;
}

export function clearDeepgramAccessTokenCache(): void {
  cache = null;
}
