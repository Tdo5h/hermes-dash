"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { useSettings } from "@/app/chat/layout";
import { stripMarkdownForSpeech } from "@/lib/strip-markdown-speech";
import { getDeepgramAccessToken } from "@/lib/deepgram-access-token";
import {
  DEFAULT_TTS_SPEED,
  normalizeTtsSpeed,
  supportsTtsVoiceControls,
} from "@/lib/deepgram-tts-voices";
import { createPcmStreamPlayer } from "@/lib/deepgram-pcm-stream-player";
import { playMp3FromSpeakResponse } from "@/lib/deepgram-mp3-stream-playback";
import { warmDeepgramSdk } from "@/lib/deepgram-sdk-load";
import { prepareSpeechChunks } from "@/lib/tts-speech-prep";

let activeSpeakMessageId: string | null = null;
const speakUiSubscribers = new Set<() => void>();

function setActiveSpeakMessageId(id: string | null) {
  activeSpeakMessageId = id;
  speakUiSubscribers.forEach((fn) => fn());
}

function subscribeSpeakUi(onStoreChange: () => void) {
  speakUiSubscribers.add(onStoreChange);
  return () => speakUiSubscribers.delete(onStoreChange);
}

function getActiveSpeakSnapshot() {
  return activeSpeakMessageId;
}

let cancelCurrentSpeak: (() => void) | null = null;

function stopSpeakPlayback() {
  cancelCurrentSpeak?.();
  cancelCurrentSpeak = null;
  setActiveSpeakMessageId(null);
}

let deepgramConfiguredCache: boolean | null = null;

async function getDeepgramConfigured(): Promise<boolean> {
  if (deepgramConfiguredCache !== null) return deepgramConfiguredCache;
  try {
    const r = await fetch("/api/deepgram/token", { cache: "no-store" });
    const d = (await r.json()) as { configured?: boolean };
    deepgramConfiguredCache = Boolean(d.configured);
  } catch {
    deepgramConfiguredCache = false;
  }
  return deepgramConfiguredCache;
}

const SAMPLE_RATE_STR = "48000" as const;
const TTS_WAIT_MS = 120_000;

function appendPcmChunk(parts: Uint8Array[], chunk: unknown): void {
  if (chunk instanceof ArrayBuffer) {
    parts.push(new Uint8Array(chunk));
    return;
  }
  if (ArrayBuffer.isView(chunk)) {
    parts.push(
      new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    );
    return;
  }
  if (typeof chunk === "string") {
    try {
      const bin = atob(chunk);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      parts.push(u8);
    } catch {
      /* ignore */
    }
  }
}

function mergePcm(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function SpeakReplyButton({
  text,
  messageId,
}: {
  text: string;
  messageId: string;
}) {
  const { ttsVoice } = useSettings();
  const activeId = useSyncExternalStore(
    subscribeSpeakUi,
    getActiveSpeakSnapshot,
    getActiveSpeakSnapshot
  );
  const [phase, setPhase] = useState<"idle" | "loading" | "playing">("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void warmDeepgramSdk();
    void (async () => {
      try {
        const tokenRes = await fetch("/api/deepgram/token", { method: "POST" });
        if (!tokenRes.ok) return;
        const body = (await tokenRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        const { cacheDeepgramTokenFromResponse } = await import(
          "@/lib/deepgram-access-token"
        );
        cacheDeepgramTokenFromResponse(body);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void getDeepgramConfigured().then(setConfigured);
  }, []);

  const isBusyHere =
    activeId === messageId && (phase === "loading" || phase === "playing");
  const anotherPlaying = activeId !== null && activeId !== messageId;

  const runPlayback = useCallback(async () => {
    const speechChunks = prepareSpeechChunks(text);
    if (speechChunks.length === 0) return;
    const speed = supportsTtsVoiceControls(ttsVoice)
      ? normalizeTtsSpeed(DEFAULT_TTS_SPEED)
      : null;

    const ok = await getDeepgramConfigured();
    if (!ok) return;

    stopSpeakPlayback();

    let cancelled = false;
    let connection: { close: () => void } | null = null;
    let pcmPlayer: ReturnType<typeof createPcmStreamPlayer> | null = null;

    let resolvePlayback!: () => void;
    const playbackDone = new Promise<void>((r) => {
      resolvePlayback = r;
    });
    let playbackResolved = false;
    function settlePlayback() {
      if (playbackResolved) return;
      playbackResolved = true;
      resolvePlayback();
    }

    const teardown = () => {
      cancelled = true;
      try {
        connection?.close();
      } catch {
        /* ignore */
      }
      connection = null;
      try {
        pcmPlayer?.cancel();
      } catch {
        /* ignore */
      }
      pcmPlayer = null;
      settlePlayback();
    };

    cancelCurrentSpeak = () => {
      teardown();
      setPhase("idle");
    };

    setPhase("loading");
    setActiveSpeakMessageId(messageId);

    function finishSpeakUi() {
      if (!cancelled) {
        setPhase("idle");
        if (activeSpeakMessageId === messageId) {
          setActiveSpeakMessageId(null);
        }
      }
      cancelCurrentSpeak = null;
    }

    async function playRestTts(): Promise<void> {
      for (const chunk of speechChunks) {
        if (cancelled) return;
        const res = await fetch("/api/deepgram/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, model: ttsVoice, speed }),
        });
        await playMp3FromSpeakResponse(res, {
          onStart: () => {
            if (!cancelled) setPhase("playing");
          },
        });
      }
    }

    try {
      const accessToken = await getDeepgramAccessToken();
      const { DeepgramClient } = await warmDeepgramSdk();
      const deepgram = new DeepgramClient({ accessToken });

      pcmPlayer = createPcmStreamPlayer({
        onFirstScheduled: () => {
          if (!cancelled) setPhase("playing");
        },
        onPlaybackIdle: () => {
          settlePlayback();
        },
      });

      const pcmParts: Uint8Array[] = [];
      let messageChain = Promise.resolve();
      const expectedFlushes = speechChunks.length;
      let flushCount = 0;
      let resolveFinalFlushed: (() => void) | undefined;
      const finalFlushedPromise = new Promise<void>((resolve) => {
        resolveFinalFlushed = resolve;
      });

      const conn = await deepgram.speak.v1.connect({
        Authorization: "",
        model: ttsVoice,
        encoding: "linear16",
        sample_rate: SAMPLE_RATE_STR,
        queryParams: speed ? { speed } : undefined,
      });
      connection = conn;

      conn.on("message", (data: unknown) => {
        if (cancelled) return;
        messageChain = messageChain.then(async () => {
          if (cancelled || !data) return;

          if (typeof Blob !== "undefined" && data instanceof Blob) {
            const ab = await data.arrayBuffer();
            const u8 = new Uint8Array(ab);
            appendPcmChunk(pcmParts, ab);
            pcmPlayer?.push(u8);
            return;
          }

          if (typeof data === "object" && data !== null && "type" in data) {
            const t = (data as { type: string }).type;
            if (t === "Warning") {
              const w = data as { description?: string; code?: string };
              console.warn(
                "[speak] Deepgram warning:",
                w.code || "",
                w.description || ""
              );
              return;
            }
            if (t === "Metadata") return;
            if (t === "Flushed") {
              flushCount += 1;
              if (flushCount >= expectedFlushes && resolveFinalFlushed) {
                resolveFinalFlushed();
                resolveFinalFlushed = undefined;
              }
              return;
            }
            return;
          }

          appendPcmChunk(pcmParts, data);
          if (data instanceof ArrayBuffer) {
            pcmPlayer?.push(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            pcmPlayer?.push(
              new Uint8Array(
                data.buffer,
                data.byteOffset,
                data.byteLength
              )
            );
          }
        });
      });

      conn.connect();
      await conn.waitForOpen();
      if (cancelled) return;

      for (const chunk of speechChunks) {
        if (cancelled) return;
        conn.sendText({ type: "Speak", text: chunk });
        conn.sendFlush({ type: "Flush" });
      }

      await Promise.race([
        finalFlushedPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Read-aloud timed out")), TTS_WAIT_MS)
        ),
      ]);

      await messageChain;

      if (cancelled) return;

      try {
        conn.close();
      } catch {
        /* ignore */
      }
      connection = null;

      const merged = mergePcm(pcmParts);

      if (merged.length === 0) {
        pcmPlayer.cancel();
        pcmPlayer = null;
        settlePlayback();
        try {
          await playRestTts();
          if (!cancelled) finishSpeakUi();
        } catch (e) {
          console.warn("[speak] WebSocket had no PCM; REST fallback failed:", e);
          finishSpeakUi();
        }
        return;
      }

      pcmPlayer.endInput();
      await playbackDone;
      if (cancelled) return;

      try {
        pcmPlayer.audioContext.close();
      } catch {
        /* ignore */
      }
      pcmPlayer = null;
      finishSpeakUi();
    } catch (e) {
      console.error("[speak]", e);
      try {
        pcmPlayer?.cancel();
        pcmPlayer = null;
        settlePlayback();
        await playRestTts();
        if (!cancelled) finishSpeakUi();
      } catch (e2) {
        console.error("[speak] REST fallback:", e2);
        teardown();
        setPhase("idle");
        if (activeSpeakMessageId === messageId) setActiveSpeakMessageId(null);
        cancelCurrentSpeak = null;
      }
    }
  }, [text, ttsVoice, messageId]);

  const onPlay = useCallback(() => {
    if (phaseRef.current === "loading") return;
    void runPlayback();
  }, [runPlayback]);

  const onStop = useCallback(() => {
    stopSpeakPlayback();
    setPhase("idle");
  }, []);

  const cleanedOk = Boolean(stripMarkdownForSpeech(text));
  const disabledPlay =
    configured === false ||
    !cleanedOk ||
    phase === "loading" ||
    anotherPlaying;

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {isBusyHere ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop read-aloud"
          title="Stop"
          className="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <SquareIcon className="size-3 fill-current" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          disabled={disabledPlay}
          aria-label="Read reply aloud"
          title={
            configured === false
              ? "Add DEEPGRAM_API_KEY on the server to enable read-aloud"
              : anotherPlaying
                ? "Another message is playing"
                : "Read reply aloud"
          }
          className={`
            inline-flex shrink-0 items-center justify-center rounded p-0.5 transition-colors
            text-muted-foreground hover:text-foreground
            disabled:opacity-40 disabled:pointer-events-none
          `}
        >
          <Volume2Icon className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
