"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

export type RenamePublishedAppDialogProps = {
  open: boolean;
  buildId: string;
  name: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
  /** Trash opens the delete confirmation flow (parent should close this dialog and show delete). */
  onRequestDelete?: () => void;
};

const MAX = 200;

export function RenamePublishedAppDialog({
  open,
  buildId,
  name: initialName,
  onClose,
  onRenamed,
  onRequestDelete,
}: RenamePublishedAppDialogProps) {
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setValue(initialName);
      setError(null);
      setSaving(false);
    }
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialName]);

  if (!open || !portalTarget) return null;

  async function handleSave() {
    const t = value.replace(/\s+/g, " ").trim().slice(0, MAX);
    if (!t) {
      setError("Enter a name");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await fetch(
      `/api/builds/apps/${encodeURIComponent(buildId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t }),
      }
    );
    setSaving(false);
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      setError(d.error || "Could not save");
      return;
    }
    const j = (await r.json().catch(() => ({}))) as { name?: string };
    onRenamed(typeof j.name === "string" ? j.name : t);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-published-app-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-sidebar-border/30 px-6 py-4">
          <h2
            id="rename-published-app-title"
            className="text-base font-semibold text-foreground"
          >
            Published app
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Change the name as it appears in Builds and the sidebar. To remove
            the app and its files, use{" "}
            <span className="text-foreground/90">Delete app</span> at the bottom
            left—your confirmation is still required.
          </p>
        </div>
        <div className="px-6 py-5">
          <label
            htmlFor="published-app-name-input"
            className="mb-2 block text-xs font-medium text-muted-foreground"
          >
            Name
          </label>
          <input
            id="published-app-name-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") onClose();
            }}
            className="neu-inset-input w-full rounded-lg px-4 py-3 text-base text-foreground"
            maxLength={MAX}
            aria-label="App name"
            autoComplete="off"
          />
          {error ? (
            <p className="mt-3 text-sm text-destructive/90">{error}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-8 border-t border-sidebar-border/30 px-6 py-4 sm:gap-12">
          <div className="flex min-w-0 flex-col items-start gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-sidebar-foreground"
            >
              Cancel
            </button>
            {onRequestDelete ? (
	              <button
	                type="button"
	                data-hermes-tip="Delete this published app after confirmation."
	                aria-label="Delete published app"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive/90 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRequestDelete()}
              >
                <Trash2 className="size-4 shrink-0" />
                <span>Delete app…</span>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="neu-raised shrink-0 rounded-lg px-6 py-2.5 text-sm font-medium text-sidebar-foreground disabled:opacity-40"
          >
            {saving ? "…" : "OK"}
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
