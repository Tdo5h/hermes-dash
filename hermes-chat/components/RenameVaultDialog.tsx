"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

export type RenameVaultDialogProps = {
  open: boolean;
  slug: string;
  name: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
};

const MAX = 200;

export function RenameVaultDialog({
  open,
  slug,
  name: initialName,
  onClose,
  onRenamed,
}: RenameVaultDialogProps) {
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
    const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t }),
    });
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-vault-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-h-[min(90dvh,32rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl">
        <div className="border-b border-sidebar-border/30 px-4 py-3">
          <h2
            id="rename-vault-title"
            className="text-sm font-semibold text-foreground"
          >
            Vault name
          </h2>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") onClose();
            }}
            className="neu-inset-input mb-2 w-full rounded-lg px-3 py-2 text-sm text-foreground"
            maxLength={MAX}
            aria-label="Vault name"
          />
          {error ? <p className="mb-2 text-xs text-destructive/90">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="neu-raised rounded-lg px-3 py-1.5 text-xs font-medium text-sidebar-foreground disabled:opacity-40"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
