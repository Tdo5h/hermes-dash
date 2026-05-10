"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "@/app/chat/layout";

const HOVER_TIP_DELAY_MS = 1300;

type TipState = {
  text: string;
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

const VIEWPORT_MARGIN = 14;

function findTipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-hermes-tip]");
}

function readTip(el: HTMLElement): string {
  return (el.dataset.hermesTip || "").trim();
}

function positionTip(el: HTMLElement): TipState | null {
  const text = readTip(el);
  if (!text) return null;
  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const showBelow = rect.top < 96;
  return {
    text,
    anchorX: centerX,
    anchorTop: rect.top,
    anchorBottom: rect.bottom,
    x: Math.min(Math.max(centerX, VIEWPORT_MARGIN), window.innerWidth - VIEWPORT_MARGIN),
    y: showBelow ? rect.bottom : rect.top,
    placement: showBelow ? "bottom" : "top",
  };
}

export function HermesHoverTips() {
  const { hoverTipsEnabled } = useSettings();
  const [tip, setTip] = useState<TipState | null>(null);
  const activeElRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const visibleRef = useRef(false);

  useLayoutEffect(() => {
    if (!tip) return;
    const el = bubbleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nextX = Math.min(
      Math.max(tip.anchorX, VIEWPORT_MARGIN + rect.width / 2),
      window.innerWidth - VIEWPORT_MARGIN - rect.width / 2
    );
    let placement = tip.placement;
    let nextY = placement === "top" ? tip.anchorTop : tip.anchorBottom;

    const topIfTop = tip.anchorTop - rect.height - 11;
    const bottomIfBottom = tip.anchorBottom + rect.height + 11;
    if (placement === "top" && topIfTop < VIEWPORT_MARGIN) {
      placement = "bottom";
      nextY = tip.anchorBottom;
    } else if (placement === "bottom" && bottomIfBottom > window.innerHeight - VIEWPORT_MARGIN) {
      placement = "top";
      nextY = tip.anchorTop;
    }

    if (placement === "top") {
      nextY = Math.max(nextY, VIEWPORT_MARGIN + rect.height + 11);
    } else {
      nextY = Math.max(
        VIEWPORT_MARGIN,
        Math.min(nextY, window.innerHeight - VIEWPORT_MARGIN - rect.height - 11)
      );
    }

    if (nextX !== tip.x || nextY !== tip.y || placement !== tip.placement) {
      setTip({ ...tip, x: nextX, y: nextY, placement });
    }
  }, [tip]);

  useEffect(() => {
    if (!hoverTipsEnabled) {
      setTip(null);
      activeElRef.current = null;
      visibleRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }

    const clear = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      activeElRef.current = null;
      visibleRef.current = false;
      setTip(null);
    };

    const schedule = (el: HTMLElement) => {
      const text = readTip(el);
      if (!text) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      activeElRef.current = el;
      visibleRef.current = false;
      setTip(null);
      timerRef.current = window.setTimeout(() => {
        if (activeElRef.current !== el || !document.body.contains(el)) return;
        visibleRef.current = true;
        setTip(positionTip(el));
      }, HOVER_TIP_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const el = findTipTarget(event.target);
      if (!el || el === activeElRef.current) return;
      schedule(el);
    };

    const onPointerOut = (event: PointerEvent) => {
      const el = activeElRef.current;
      if (!el) return;
      const related = event.relatedTarget;
      if (related instanceof Node && el.contains(related)) return;
      clear();
    };

    const onFocusIn = (event: FocusEvent) => {
      const el = findTipTarget(event.target);
      if (el) schedule(el);
    };

    const onFocusOut = () => clear();
    const onScroll = () => {
      const el = activeElRef.current;
      if (!el || !visibleRef.current) return;
      setTip(positionTip(el));
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", clear);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", clear);
      clear();
    };
  }, [hoverTipsEnabled]);

  if (!tip || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className={`hermes-tip-bubble is-${tip.placement}`}
      style={{
        left: tip.x,
        top: tip.y,
      }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body
  );
}
