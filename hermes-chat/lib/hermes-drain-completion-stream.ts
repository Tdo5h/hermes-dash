/**
 * Consume a Hermes /v1/chat/completions SSE body without writing chat status files
 * (background jobs, e.g. shared vault architect ingest after upload).
 */

import {
  sseEventsFromReader,
  appendAssistantFromChunkJson,
  parseUsageAndModelFromChunkJson,
  accumulateHermesChunkUsage,
  headlineFromToolCallName,
  toolNameHintFromChunkJson,
  headlineFromToolProgress,
  toolProgressPayloadUsd,
  type HermesChunkUsage,
  type HermesToolProgressPayload,
} from "@/lib/hermes-sse-stream";

export async function drainHermesCompletionStreamBody(
  body: ReadableStream<Uint8Array>,
  options?: {
    onActivityHeadline?: (headline: string) => void;
  }
): Promise<{
  text: string;
  responseModel?: string;
  usage?: HermesChunkUsage;
  toolCostsUsdFromStream: number;
  sawToolProgress: boolean;
}> {
  const onHeadline = options?.onActivityHeadline;
  const reader = body.getReader();
  let partialAcc = "";
  let activityHeadline = "";
  let lastToolProgressSig = "";
  let responseModel: string | undefined;
  let usage: HermesChunkUsage | undefined;
  let toolCostsUsdFromStream = 0;
  let sawToolProgress = false;

  try {
    for await (const ev of sseEventsFromReader(reader)) {
      const { event, data } = ev;
      if (data === "[DONE]") continue;

      if (event === "hermes.tool.progress") {
        sawToolProgress = true;
        try {
          const payload = JSON.parse(data) as HermesToolProgressPayload;
          toolCostsUsdFromStream += toolProgressPayloadUsd(payload);
          const sig = `${(payload.tool || "").trim()}\0${(payload.label || "").trim()}`;
          if (sig !== lastToolProgressSig) {
            lastToolProgressSig = sig;
            const h = headlineFromToolProgress(payload);
            if (h && h !== activityHeadline) {
              activityHeadline = h;
              onHeadline?.(h);
            }
          }
        } catch {
          /* ignore */
        }
        continue;
      }

      if (data.trim().startsWith("{")) {
        const hint = toolNameHintFromChunkJson(data);
        if (hint) {
          const th = headlineFromToolCallName(hint);
          if (th && th !== activityHeadline) {
            activityHeadline = th;
            onHeadline?.(th);
          }
        }
        const um = parseUsageAndModelFromChunkJson(data);
        if (um.model) responseModel = um.model;
        if (um.usage) usage = accumulateHermesChunkUsage(usage, um.usage);
        partialAcc = appendAssistantFromChunkJson(data, partialAcc);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: partialAcc,
    responseModel,
    usage,
    toolCostsUsdFromStream,
    sawToolProgress,
  };
}
