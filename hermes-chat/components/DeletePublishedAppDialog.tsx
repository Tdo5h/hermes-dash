"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export type DeletePublishedAppDialogProps = {
  open: boolean;
  buildId: string;
  name: string;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  onDeleted: () => void;
};

/**
 * Confirm delete of a manifest app: removes manifest entry, app folder on disk, and related chats.
 */
export function DeletePublishedAppDialog({
  open,
  buildId,
  name: appName,
  title = "Delete published app?",
  description,
  confirmLabel = "Delete app",
  onClose,
  onDeleted,
}: DeletePublishedAppDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setDeleting(false);
    }
  }, [open, appName]);

  if (!open || !portalTarget) return null;

  async function performDelete() {
    setDeleting(true);
    setError(null);
    const r = await fetch(
      `/api/builds/apps/${encodeURIComponent(buildId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: appName }),
      }
    );
    setDeleting(false);
    if (r.ok) {
      onDeleted();
      onClose();
      return;
    }
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setError(d.error || "Could not delete");
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-published-app-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onClose();
      }}
    >
      <div
        className="flex max-h-[min(90dvh,28rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-destructive/20 bg-[var(--sidebar-depth-canvas)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-published-app-title"
        aria-describedby="delete-published-app-desc"
      >
        <div className="shrink-0 border-b border-sidebar-border/30 px-4 py-3">
          <h2
            id="delete-published-app-title"
            className="text-sm font-semibold text-foreground"
          >
            {title}
          </h2>
        </div>
        <div
          id="delete-published-app-desc"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description ?? (
              <>
                <span className="font-medium text-foreground">{appName}</span>{" "}
                will be removed from Builds, its files deleted from disk, and
                all Create / Edit chats for this app will be removed. This
                cannot be undone.
              </>
            )}
          </p>
          {error ? <p className="mt-2 text-xs text-destructive/90">{error}</p> : null}
        </div>
        <div className="shrink-0 border-t border-sidebar-border/30 px-4 py-3">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void performDelete()}
              disabled={deleting}
              className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
            >
              {deleting ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
