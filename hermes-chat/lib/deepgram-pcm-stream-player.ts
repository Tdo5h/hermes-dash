/** Stream linear16 mono PCM into Web Audio with low time-to-first-sample. */

export type PcmStreamPlayer = {
  readonly audioContext: AudioContext;
  push: (pcm: Uint8Array) => void;
  /** Call after server signals end of synthesis; schedules any remainder. */
  endInput: () => void;
  /** Stop immediately and silence output. */
  cancel: () => void;
  /** True after at least one chunk was scheduled. */
  hasStartedPlayback: () => boolean;
};

const SAMPLE_RATE = 48000;
/** First audible chunk: ~40ms at 48kHz mono */
const MIN_FIRST_BYTES = 3840;
/** Steady-state chunk size ~80ms */
const CHUNK_BYTES = 7680;

function int16ChunkToBuffer(
  ctx: AudioContext,
  bytes: Uint8Array
): AudioBuffer | null {
  const aligned = bytes.byteLength - (bytes.byteLength % 2);
  if (aligned < 2) return null;
  const samples = aligned / 2;
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, samples);
  const buffer = ctx.createBuffer(1, samples, SAMPLE_RATE);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) ch[i] = int16[i]! / 32768;
  return buffer;
}

export function createPcmStreamPlayer(options: {
  onFirstScheduled?: () => void;
  onPlaybackIdle?: () => void;
}): PcmStreamPlayer {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  let pending = new Uint8Array(0);
  let nextPlayTime = 0;
  let scheduledFirst = false;
  let endedInput = false;
  let cancelled = false;
  let activeSources = 0;
  let firstCallbackFired = false;

  function bumpIdle() {
    if (cancelled) return;
    if (activeSources === 0 && endedInput && pending.length === 0) {
      options.onPlaybackIdle?.();
    }
  }

  function scheduleBuffer(buf: AudioBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    activeSources += 1;
    const startAt = Math.max(nextPlayTime, ctx.currentTime + 0.02);
    src.start(startAt);
    nextPlayTime = startAt + buf.duration;
    src.addEventListener("ended", () => {
      activeSources -= 1;
      bumpIdle();
    });
    if (!firstCallbackFired) {
      firstCallbackFired = true;
      options.onFirstScheduled?.();
    }
  }

  function drainPending() {
    if (cancelled) return;
    while (true) {
      const minNeed = scheduledFirst ? CHUNK_BYTES : MIN_FIRST_BYTES;
      if (pending.length < minNeed) break;
      const aligned = Math.floor(pending.length / 2) * 2;
      const take = Math.min(CHUNK_BYTES, aligned);
      if (take < minNeed) break;
      const slice = pending.subarray(0, take);
      pending = pending.subarray(take);
      const buf = int16ChunkToBuffer(ctx, slice);
      if (buf) {
        scheduleBuffer(buf);
        scheduledFirst = true;
      } else break;
    }
  }

  function push(pcm: Uint8Array) {
    if (cancelled || pcm.length === 0) return;
    const combined = new Uint8Array(pending.length + pcm.length);
    combined.set(pending);
    combined.set(pcm, pending.length);
    pending = combined;
    if (ctx.state === "suspended") void ctx.resume();
    drainPending();
  }

  function endInput() {
    endedInput = true;
    if (cancelled) return;
    while (pending.length >= 2) {
      const take = Math.floor(pending.length / 2) * 2;
      const slice = pending.subarray(0, take);
      pending = pending.subarray(take);
      const buf = int16ChunkToBuffer(ctx, slice);
      if (buf) {
        scheduleBuffer(buf);
        scheduledFirst = true;
      }
    }
    bumpIdle();
  }

  function cancel() {
    cancelled = true;
    pending = new Uint8Array(0);
    endedInput = true;
    try {
      void ctx.close();
    } catch {
      /* ignore */
    }
  }

  return {
    audioContext: ctx,
    push,
    endInput,
    cancel,
    hasStartedPlayback: () => firstCallbackFired,
  };
}
