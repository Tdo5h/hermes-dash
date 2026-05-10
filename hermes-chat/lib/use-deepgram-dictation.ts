"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeepgramClient } from "@deepgram/sdk";
import {
  cacheDeepgramTokenFromResponse,
  getDeepgramAccessToken,
} from "@/lib/deepgram-access-token";
import { DEEPGRAM_NZ_BOP_KEYTERMS } from "@/lib/deepgram-nz-bop-keyterms";

const DEEPGRAM_STT_LANGUAGE =
  process.env.NEXT_PUBLIC_DEEPGRAM_STT_LANGUAGE ?? "en-NZ";

export type DeepgramVoiceState = "idle" | "recording" | "processing" | "error";

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

let deepgramSdkModulePromise: Promise<typeof import("@deepgram/sdk")> | null = null;
export function loadDeepgramSdk() {
  if (!deepgramSdkModulePromise) deepgramSdkModulePromise = import("@deepgram/sdk");
  return deepgramSdkModulePromise;
}

type DgListenSocket = Awaited<
  ReturnType<InstanceType<typeof DeepgramClient>["listen"]["v1"]["connect"]>
>;

export function useDeepgramDictation(options: {
  /** Snapshot when recording starts */
  getBaseText: () => string;
  /** Full line including base + committed + interim */
  applyText: (text: string) => void;
}) {
  const { getBaseText, applyText } = options;
  const getBaseTextRef = useRef(getBaseText);
  const applyTextRef = useRef(applyText);
  getBaseTextRef.current = getBaseText;
  applyTextRef.current = applyText;

  const baseTextRef = useRef("");
  const committedTranscriptRef = useRef("");
  const livePartialRef = useRef("");
  const recordingSessionRef = useRef(false);
  const connectionRef = useRef<DgListenSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [voiceState, setVoiceState] = useState<DeepgramVoiceState>("idle");
  const [voiceErrorHint, setVoiceErrorHint] = useState<string | null>(null);

  const clearKeepAlive = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    clearKeepAlive();
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
    stopMediaTracks();

    const conn = connectionRef.current;
    connectionRef.current = null;
    if (conn) {
      try {
        conn.sendFinalize({ type: "Finalize" });
      } catch {
        /* ignore */
      }
      try {
        conn.sendCloseStream({ type: "CloseStream" });
      } catch {
        /* ignore */
      }
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }

    recordingSessionRef.current = false;
    committedTranscriptRef.current = "";
    livePartialRef.current = "";
    setVoiceState("idle");
  }, [clearKeepAlive, stopMediaTracks]);

  useEffect(() => {
    if (voiceState === "error") {
      const ms = voiceErrorHint ? 5000 : 1200;
      const timer = setTimeout(() => {
        setVoiceState("idle");
        setVoiceErrorHint(null);
      }, ms);
      return () => clearTimeout(timer);
    }
  }, [voiceState, voiceErrorHint]);

  useEffect(() => {
    void loadDeepgramSdk();
    void (async () => {
      try {
        const tokenRes = await fetch("/api/deepgram/token", { method: "POST" });
        if (!tokenRes.ok) return;
        const body = (await tokenRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        cacheDeepgramTokenFromResponse(body);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => () => cleanupSession(), [cleanupSession]);

  const startRecording = useCallback(async () => {
    if (recordingSessionRef.current) return;
    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      setVoiceErrorHint(
        "Microphone needs HTTPS or localhost. Do not open the site as http://YOUR_SERVER_IP. " +
          "SSH tunnel: ssh -L 8080:127.0.0.1:80 root@YOUR_VPS then use http://localhost:8080/chat — " +
          "or put a TLS certificate on Caddy."
      );
      setVoiceState("error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceErrorHint(
        "Microphone is not available (blocked browser, or not HTTPS/localhost)."
      );
      setVoiceState("error");
      return;
    }

    recordingSessionRef.current = true;
    baseTextRef.current = getBaseTextRef.current();
    committedTranscriptRef.current = "";
    livePartialRef.current = "";
    setVoiceErrorHint(null);
    setVoiceState("processing");

    let accessToken: string;
    try {
      accessToken = await getDeepgramAccessToken();
    } catch (e) {
      recordingSessionRef.current = false;
      setVoiceErrorHint(e instanceof Error ? e.message : "Voice setup failed.");
      setVoiceState("error");
      return;
    }

    try {
      const { DeepgramClient: DgClient } = await loadDeepgramSdk();
      const deepgram = new DgClient({ accessToken });

      const connection = await deepgram.listen.v1.connect({
        Authorization: "",
        model: "nova-3",
        language: DEEPGRAM_STT_LANGUAGE,
        keyterm: DEEPGRAM_NZ_BOP_KEYTERMS,
        interim_results: "true",
        smart_format: "true",
        punctuate: "true",
      });

      connection.on("message", (data: unknown) => {
        if (!data || typeof data !== "object" || !("type" in data)) return;
        const msg = data as {
          type: string;
          is_final?: boolean;
          channel?: { alternatives?: { transcript: string }[] };
        };
        if (msg.type !== "Results") return;
        const alt = msg.channel?.alternatives?.[0];
        if (!alt) return;
        const transcript = alt.transcript?.trim() ?? "";
        if (!transcript) return;

        if (msg.is_final) {
          committedTranscriptRef.current +=
            (committedTranscriptRef.current &&
            !committedTranscriptRef.current.endsWith(" ")
              ? " "
              : "") + transcript;
          livePartialRef.current = "";
        } else {
          livePartialRef.current = transcript;
        }

        const base = baseTextRef.current;
        const sep = base && !base.endsWith(" ") ? " " : "";
        const committed = committedTranscriptRef.current;
        const sep2 = committed && livePartialRef.current ? " " : "";
        applyTextRef.current(
          base + sep + committed + sep2 + livePartialRef.current
        );
      });

      connection.on("error", () => {
        cleanupSession();
        setVoiceState("error");
      });

      connectionRef.current = connection;
      connection.connect();
      const [, stream] = await Promise.all([
        connection.waitForOpen(),
        navigator.mediaDevices.getUserMedia({ audio: true }),
      ]);
      mediaStreamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          try {
            connection.sendMedia(event.data);
          } catch {
            /* socket may be closing */
          }
        }
      };

      keepAliveRef.current = setInterval(() => {
        try {
          connection.sendKeepAlive({ type: "KeepAlive" });
        } catch {
          /* ignore */
        }
      }, 8000);

      mediaRecorder.start(250);
      setVoiceState("recording");
    } catch (e) {
      recordingSessionRef.current = false;
      cleanupSession();
      setVoiceErrorHint(
        e instanceof Error
          ? e.message
          : "Voice failed — allow microphone access, or check Deepgram (DEEPGRAM_API_KEY in the server env)."
      );
      setVoiceState("error");
    }
  }, [cleanupSession]);

  const stopRecording = useCallback(() => {
    if (!recordingSessionRef.current) return;
    cleanupSession();
  }, [cleanupSession]);

  const toggleRecording = useCallback(() => {
    if (voiceState === "recording") {
      stopRecording();
    } else if (voiceState !== "processing") {
      void startRecording();
    }
  }, [voiceState, startRecording, stopRecording]);

  return {
    voiceState,
    voiceErrorHint,
    startRecording,
    stopRecording,
    toggleRecording,
    cleanupSession,
  };
}
