"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon, ImageIcon, FileUpIcon, ClipboardPasteIcon } from "lucide-react";

type AttachMenuProps = {
  onPickImage: () => void;
  onPickFile: () => void;
  /** Vault: opens paste / text ingest modal. Omitted in plain chat mode. */
  onPickPaste?: () => void;
  disabled?: boolean;
  /** When false, Add file is disabled (e.g. vault APIs unavailable). Add image stays available. */
  filePickEnabled?: boolean;
  /** When false, paste row is hidden (e.g. parent did not wire ingest). */
  pasteEnabled?: boolean;
};

export function AttachMenu({
  onPickImage,
  onPickFile,
  onPickPaste,
  disabled,
  filePickEnabled = true,
  pasteEnabled = true,
}: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const menuLocked = Boolean(disabled);

  return (
    <div className="relative flex-shrink-0" ref={wrapRef}>
      <button
        type="button"
        data-hermes-tip="Add an image, upload a file, or paste text."
        onClick={() => !menuLocked && setOpen((o) => !o)}
        disabled={menuLocked}
        className="neu-selected flex size-10 flex-shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-25"
      >
        <PlusIcon className="size-4" />
      </button>
      {open && !menuLocked ? (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[12rem] overflow-hidden rounded-lg border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent/20"
            data-hermes-tip="Add an image to the current message or vault."
            onClick={() => {
              setOpen(false);
              onPickImage();
            }}
          >
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
            Add image
          </button>
          <button
            type="button"
            data-hermes-tip={
              filePickEnabled
                ? "Upload a file for Hermes to read."
                : "Vault file upload unavailable (server config)"
            }
            disabled={!filePickEnabled}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => {
              if (!filePickEnabled) return;
              setOpen(false);
              onPickFile();
            }}
          >
            <FileUpIcon className="size-4 shrink-0 text-muted-foreground" />
            Add file
          </button>
          {onPickPaste && pasteEnabled ? (
            <button
              type="button"
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent/20"
              data-hermes-tip="Paste text directly into the vault without making a separate file."
              onClick={() => {
                setOpen(false);
                onPickPaste();
              }}
            >
              <ClipboardPasteIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block leading-tight">Add pasted text</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  Save notes or web copy to this vault
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
