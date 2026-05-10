/**
 * Play Deepgram speak response with low latency: append chunks to MediaSource
 * when supported; otherwise buffer the stream and play one blob (still avoids
 * server-side buffering).
 */
export async function playMp3FromSpeakResponse(
  res: Response,
  options: { onStart?: () => void }
): Promise<void> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const stream = res.body;
  if (!stream) {
    const blob = await res.blob();
    await playMp3Blob(blob, options.onStart);
    return;
  }

  if (
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported("audio/mpeg")
  ) {
    const [forMse, forFallback] = stream.tee();
    try {
      await playViaMediaSource(forMse, options.onStart);
      await forFallback.cancel("mse-ok");
      return;
    } catch (e) {
      console.warn("[speak] MediaSource playback failed, falling back:", e);
      const blob = await new Response(forFallback).blob();
      await playMp3Blob(blob, options.onStart);
      return;
    }
  }

  const blob = await new Response(stream).blob();
  await playMp3Blob(blob, options.onStart);
}

async function playMp3Blob(blob: Blob, onStart?: () => void): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    onStart?.();
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("audio error")), {
        once: true,
      });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function playViaMediaSource(
  stream: ReadableStream<Uint8Array>,
  onStart?: () => void
): Promise<void> {
  const ms = new MediaSource();
  const objectUrl = URL.createObjectURL(ms);
  const audio = new Audio(objectUrl);

  await new Promise<void>((resolve, reject) => {
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
    ms.addEventListener(
      "error",
      () => reject(new Error("MediaSource error")),
      { once: true }
    );
  });

  const sb = ms.addSourceBuffer("audio/mpeg");
  const reader = stream.getReader();
  let started = false;

  const waitUpdateEnd = () =>
    new Promise<void>((resolve) => {
      if (!sb.updating) {
        resolve();
        return;
      }
      sb.addEventListener("updateend", () => resolve(), { once: true });
    });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;

      const copy = new Uint8Array(value);

      await waitUpdateEnd();
      await new Promise<void>((resolve, reject) => {
        try {
          sb.appendBuffer(copy);
        } catch (e) {
          reject(e);
          return;
        }
        sb.addEventListener("updateend", () => resolve(), { once: true });
      });

      if (!started) {
        started = true;
        onStart?.();
        await audio.play().catch(() => undefined);
      }
    }

    await waitUpdateEnd();
    if (ms.readyState === "open") ms.endOfStream();

    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener(
        "error",
        () => reject(new Error("audio error")),
        { once: true }
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
