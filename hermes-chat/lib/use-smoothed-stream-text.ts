"use client";

import { useEffect, useRef, useState } from "react";

const MAX_CHARS_PER_FRAME = 64;

function charsToAdvance(behind: number): number {
  if (behind <= 0) return 0;
  if (behind > 400) return Math.min(behind, MAX_CHARS_PER_FRAME);
  if (behind > 120) return Math.min(behind, 32);
  if (behind > 40) return Math.min(behind, 12);
  if (behind > 12) return Math.min(behind, 4);
  return Math.min(behind, 2);
}

/**
 * Reveals `target` incrementally so bursty poll/SSE updates read as a steadier flow.
 * When `target` is null or "", displayed text clears and the rAF loop stops.
 */
export function useSmoothedStreamText(target: string | null): string {
  const [displayed, setDisplayed] = useState("");
  const targetRef = useRef(target);
  targetRef.current = target;

  const streaming = target != null && target !== "";

  useEffect(() => {
    if (!streaming) {
      setDisplayed("");
      return;
    }

    let cancelled = false;
    let raf = 0;

    const loop = () => {
      if (cancelled) return;
      const t = targetRef.current;
      if (t == null || t === "") {
        return;
      }
      setDisplayed((prev) => {
        if (t.length < prev.length) return t;
        if (prev.length >= t.length) return prev;
        const behind = t.length - prev.length;
        const n = charsToAdvance(behind);
        return prev + t.slice(prev.length, prev.length + n);
      });
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [streaming]);

  return displayed;
}
