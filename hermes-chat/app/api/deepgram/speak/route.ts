import { loadEnvLocalIntoProcess } from "@/lib/load-env-local";
import {
  ALLOWED_TTS_MODELS,
  DEFAULT_TTS_VOICE,
  MAX_TTS_TEXT_CHARS,
  normalizeTtsSpeed,
  supportsTtsVoiceControls,
} from "@/lib/deepgram-tts-voices";

export const dynamic = "force-dynamic";

function parseErrorBody(text: string): string {
  const slice = text.slice(0, 400);
  try {
    const j = JSON.parse(text) as { err_msg?: string; message?: string };
    return (j.err_msg || j.message || slice).slice(0, 300);
  } catch {
    return slice;
  }
}

export async function POST(req: Request) {
  loadEnvLocalIntoProcess();
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) {
    return Response.json(
      {
        error: "Server misconfiguration: DEEPGRAM_API_KEY is not set",
        hint: "Set DEEPGRAM_API_KEY where Next runs (same as voice input).",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (!text) {
    return Response.json({ error: "Missing or empty text" }, { status: 400 });
  }

  if (text.length > MAX_TTS_TEXT_CHARS) {
    return Response.json(
      {
        error: `Text too long (max ${MAX_TTS_TEXT_CHARS} characters)`,
      },
      { status: 400 }
    );
  }

  let model = DEFAULT_TTS_VOICE;
  if (
    typeof body === "object" &&
    body !== null &&
    "model" in body &&
    typeof (body as { model: unknown }).model === "string"
  ) {
    const m = (body as { model: string }).model.trim();
    if (m && !ALLOWED_TTS_MODELS.has(m)) {
      return Response.json({ error: "Invalid voice model" }, { status: 400 });
    }
    if (m) model = m;
  }

  const requestedSpeed =
    typeof body === "object" &&
    body !== null &&
    "speed" in body
      ? normalizeTtsSpeed((body as { speed: unknown }).speed)
      : null;

  const qs = new URLSearchParams({
    model,
    encoding: "mp3",
  });
  if (requestedSpeed && supportsTtsVoiceControls(model)) {
    qs.set("speed", String(requestedSpeed));
  }

  try {
    const res = await fetch(`https://api.deepgram.com/v1/speak?${qs}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${key}`,
      },
      body: JSON.stringify({ text }),
    });

    const contentType = res.headers.get("content-type") || "audio/mpeg";

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const detail = parseErrorBody(errText);
      console.error(`[deepgram/speak] ${res.status}:`, detail);
      return Response.json(
        { error: `Deepgram speak returned ${res.status}`, detail },
        { status: res.status >= 500 ? 502 : 400 }
      );
    }

    const body = res.body;
    if (!body) {
      const buf = await res.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[deepgram/speak] fetch failed:", msg);
    return Response.json(
      {
        error: msg,
        hint: "Origin server could not reach api.deepgram.com.",
      },
      { status: 502 }
    );
  }
}
