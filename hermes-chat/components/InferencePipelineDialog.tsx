"use client";

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: "block" | "confirm";
  title: string;
  description: ReactNode;
  /** Confirm only — runs when user chooses to proceed (destructive). */
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Block variant dismiss label */
  acknowledgeLabel?: string;
};

/**
 * App-themed modal for inference / gateway pipeline warnings (matches ModelRoutingSettings invalid-model overlay).
 */
export function InferencePipelineDialog({
  open,
  onOpenChange,
  variant,
  title,
  description,
  onConfirm,
  confirmLabel = "Continue anyway",
  cancelLabel = "Cancel",
  acknowledgeLabel = "Got it",
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="inference-pipeline-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-4 shadow-lg">
        <h2
          id="inference-pipeline-dialog-title"
          className="text-sm font-semibold leading-tight text-foreground"
        >
          {title}
        </h2>
        <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
          {description}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {variant === "confirm" ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-border/70 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/30"
                onClick={() => onOpenChange(false)}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-destructive/25"
                onClick={() => {
                  onOpenChange(false);
                  onConfirm?.();
                }}
              >
                {confirmLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-border/70 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => onOpenChange(false)}
            >
              {acknowledgeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
