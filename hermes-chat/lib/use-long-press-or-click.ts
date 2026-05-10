"use client";

import { useCallback, useRef } from "react";

const DEFAULT_DURATION_MS = 520;
const DEFAULT_MOVE_THRESHOLD_PX = 10;

/**
 * Long-press vs short click for sidebar rows: opens rename on hold without firing navigate.
 * After a long-press, the synthetic click is suppressed so `close()` / router.push do not run.
 *
 * Return `false` from `onLongPress` to avoid suppressing the next click (no-op long-press).
 */
export function useLongPressOrClick(options: {
  onLongPress: () => void | false;
  /** If omitted, short clicks do nothing (e.g. header title). */
  onShortClick?: () => void;
  durationMs?: number;
  moveThresholdPx?: number;
}) {
  const {
    onLongPress,
    onShortClick,
    durationMs = DEFAULT_DURATION_MS,
    moveThresholdPx = DEFAULT_MOVE_THRESHOLD_PX,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      clearTimer();
      suppressClickRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const shouldSuppress = onLongPress() !== false;
        suppressClickRef.current = shouldSuppress;
      }, durationMs);
    },
    [clearTimer, durationMs, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!timerRef.current) return;
      const dx = Math.abs(e.clientX - startRef.current.x);
      const dy = Math.abs(e.clientY - startRef.current.y);
      if (dx + dy > moveThresholdPx) clearTimer();
    },
    [clearTimer, moveThresholdPx]
  );

  const endPointer = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickRef.current = false;
        return;
      }
      onShortClick?.();
    },
    [onShortClick]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onPointerLeave: endPointer,
    onClick,
  };
}
