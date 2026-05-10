"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

export type DeleteVaultDialogProps = {
  open: boolean;
  slug: string;
  name: string;
  visibility: "private" | "shared";
  onClose: () => void;
  onDeleted: () => void;
};

/**
 * Delete vault confirmation — one card, no overlay-on-form; shared vaults require exact name.
 */
export function DeleteVaultDialog({
  open,
  slug,
  name: vaultName,
  visibility,
  onClose,
  onDeleted,
}: DeleteVaultDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setDeleting(false);
      setConfirmName("");
    }
  }, [open, vaultName]);

  useEffect(() => {
    if (!open || visibility !== "shared") return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, visibility]);

  if (!open || !portalTarget) return null;

  async function performDelete() {
    setDeleting(true);
    setError(null);
    const body =
      visibility === "shared"
        ? JSON.stringify({ confirmName: confirmName.trim() })
        : undefined;
    const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      ...(body ? { body } : {}),
    });
    setDeleting(false);
    if (r.status === 204) {
      onDeleted();
      onClose();
      return;
    }
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setError(d.error || "Could not delete");
  }

  const sharedBlockDelete =
    visibility === "shared" && confirmName.trim() !== vaultName.trim();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-vault-dlg-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onClose();
      }}
    >
      <div
        className="flex max-h-[min(90dvh,28rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-destructive/20 bg-[var(--sidebar-depth-canvas)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-vault-dlg-title"
        aria-describedby="delete-vault-dlg-desc"
      >
        <div className="shrink-0 border-b border-sidebar-border/30 px-4 py-3">
          <h2
            id="delete-vault-dlg-title"
            className="text-sm font-semibold text-foreground"
          >
            {visibility === "shared" ? "Delete shared vault?" : "Delete this vault?"}
          </h2>
        </div>
        <div
          id="delete-vault-dlg-desc"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {visibility === "shared" ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Type the vault name{" "}
                <span className="font-medium text-foreground">{vaultName}</span> to
                confirm. This removes the vault and its files. This cannot be undone.
              </p>
              <input
                ref={inputRef}
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="neu-inset-input mt-3 w-full rounded-lg px-3 py-2 text-sm text-foreground"
                placeholder="Vault name"
                aria-label="Type vault name to confirm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sharedBlockDelete && !deleting) {
                    void performDelete();
                  }
                }}
              />
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              The vault, its files, and related data will be removed. Chats that used
              this vault may show errors. This cannot be undone.
            </p>
          )}
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
              disabled={deleting || sharedBlockDelete}
              className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
            >
              {deleting ? "…" : "Delete vault"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
