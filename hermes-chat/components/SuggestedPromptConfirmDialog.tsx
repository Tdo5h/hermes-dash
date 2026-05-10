"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SuggestedPromptConfirmDialogProps = {
  open: boolean;
  /** The prompt text that would be sent (frozen at tap time). */
  suggestedText: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SuggestedPromptConfirmDialog({
  open,
  suggestedText,
  onCancel,
  onConfirm,
}: SuggestedPromptConfirmDialogProps) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!open || !portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/50 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="suggested-prompt-title"
      aria-describedby="suggested-prompt-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl">
        <div className="border-b border-sidebar-border/30 px-4 py-3">
          <h2
            id="suggested-prompt-title"
            className="text-sm font-semibold text-foreground"
          >
            Give Hermes something to work with
          </h2>
          <p
            id="suggested-prompt-desc"
            className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
          >
            Add the detail, goal, file, person, or outcome that matters here.
            The suggestion is just a starting point.
          </p>
          {suggestedText ? (
            <p className="mt-3 rounded-lg border border-sidebar-border/25 bg-sidebar-accent/10 px-3 py-2 text-xs italic text-sidebar-foreground">
              “{suggestedText}”
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-4 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/15 hover:text-sidebar-foreground"
          >
            Add context
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="neu-raised-active rounded-full px-4 py-2 text-sm font-medium text-sidebar-primary"
          >
            Send anyway
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
