"use client";

import { useEffect, useRef, useState } from "react";

export const HELPER_ROTATE_MS = 28_000;
export const HELPER_SWAP_MS = 900;

function shuffleArray<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useRotatingHelper(
  items: readonly string[],
  options?: {
    intervalMs?: number;
    pause?: boolean;
  }
) {
  const intervalMs = options?.intervalMs ?? HELPER_ROTATE_MS;
  const pause = options?.pause === true;
  const queueRef = useRef<string[]>([]);
  const idxRef = useRef(0);
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [text, setText] = useState(() => items[0] ?? "");
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    queueRef.current = shuffleArray([...items]);
    idxRef.current = 0;
    setTransitioning(false);
    setText(queueRef.current[0] ?? items[0] ?? "");
    if (swapTimerRef.current) {
      clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }
  }, [items]);

  useEffect(() => {
    if (pause || items.length <= 1) return;
    const timer = setInterval(() => {
      setTransitioning(true);
      swapTimerRef.current = setTimeout(() => {
        let nextIdx = idxRef.current + 1;
        if (queueRef.current.length === 0 || nextIdx >= queueRef.current.length) {
          queueRef.current = shuffleArray([...items]);
          nextIdx = 0;
        }
        idxRef.current = nextIdx;
        setText(queueRef.current[nextIdx] ?? items[0] ?? "");
        setTransitioning(false);
      }, HELPER_SWAP_MS);
    }, intervalMs);

    return () => {
      clearInterval(timer);
      if (swapTimerRef.current) {
        clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
    };
  }, [intervalMs, items, pause]);

  return { text, transitioning };
}
