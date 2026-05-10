"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const DOUBLE_TAP_MS = 320;

type OrbDoubleTapStopProps = {
  sessionKey: string | null | undefined;
  /** When false, gestures are ignored (orb is decorative). */
  enabled: boolean;
  className?: string;
  children: ReactNode;
  /** After POST /api/chat/stop — refresh session poll state. */
  onStopped?: () => void;
};

export function OrbDoubleTapStop({
  sessionKey,
  enabled,
  className,
  children,
  onStopped,
}: OrbDoubleTapStopProps) {
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const lastTapRef = useRef(0);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const requestOpen = useCallback(() => {
    if (!enabled || !sessionKey?.trim()) return;
    setOpen(true);
  }, [enabled, sessionKey]);

  function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (!enabled || !sessionKey?.trim()) return;
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      e.preventDefault();
      requestOpen();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }

  async function confirmStop() {
    const key = sessionKey?.trim();
    setOpen(false);
    if (!key) return;
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: key }),
      });
    } catch {
      /* ignore */
    }
    onStopped?.();
  }

  return (
    <>
      <div
        className={cn("touch-manipulation", className)}
        onTouchEnd={onTouchEnd}
        onDoubleClick={(e) => {
          e.preventDefault();
          requestOpen();
        }}
        role={enabled && sessionKey ? "button" : undefined}
        tabIndex={enabled && sessionKey ? 0 : undefined}
        aria-label={
          enabled && sessionKey
            ? "Agent — double-tap to stop generation"
            : undefined
        }
        onKeyDown={
          enabled && sessionKey
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  requestOpen();
                }
              }
            : undefined
        }
      >
        {children}
      </div>
      {open && portalTarget
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
              role="presentation"
              onClick={() => setOpen(false)}
            >
              <div
                className="neu-raised w-full max-w-sm rounded-xl border border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] p-4 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="orb-stop-title"
                onClick={(ev) => ev.stopPropagation()}
              >
                <h2
                  id="orb-stop-title"
                  className="text-base font-semibold text-foreground"
                >
                  Stop generation?
                </h2>
                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                  This cancels the in-flight reply, same as a stop command.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="neu-raised rounded-lg bg-destructive/90 px-3 py-2 text-sm font-medium text-destructive-foreground"
                    onClick={() => void confirmStop()}
                  >
                    Stop
                  </button>
                </div>
              </div>
            </div>,
            portalTarget
          )
        : null}
    </>
  );
}
