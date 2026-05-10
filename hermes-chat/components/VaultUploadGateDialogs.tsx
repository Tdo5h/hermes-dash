"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UsersRoundIcon, XIcon } from "lucide-react";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";

const BACKDROP_CLOSE_GRACE_MS = 450;

export type VaultDuplicateKind = "org" | "shared" | "private";

type OrgLibraryUploadConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function OrgLibraryUploadConfirmDialog({
  open,
  onClose,
  onConfirm,
}: OrgLibraryUploadConfirmDialogProps) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  if (!open || !portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm organization library upload"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAtRef.current < BACKDROP_CLOSE_GRACE_MS) return;
        onClose();
      }}
    >
      <div className="flex max-h-[min(90dvh,620px)] w-full max-w-md flex-col rounded-t-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-sidebar-border/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Organization library
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 py-5">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-sidebar-primary/25 bg-sidebar-accent/10 px-4 py-5 text-center">
            <div className="flex size-11 items-center justify-center rounded-full border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] text-sidebar-primary">
              <UsersRoundIcon className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Shared with your organization
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                This file will be stored in the{" "}
                <span className="font-medium text-sidebar-foreground">
                  organization library
                </span>{" "}
                (
                <span className="font-mono text-[10px]">{getOrgGlobalSlug()}</span>
                ), visible org-wide on the shared wiki. Confirm this material is
                appropriate to share.
              </p>
            </div>
          </div>
          <p className="text-center text-[10px] text-muted-foreground">
            If you meant to keep this private, cancel and open a private vault
            before using Add file.
          </p>
        </div>
        <div className="shrink-0 border-t border-sidebar-border/30 px-4 py-3">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="neu-raised-active w-full rounded-lg py-2.5 text-sm font-semibold text-sidebar-primary"
            >
              Continue — upload to organization library
            </button>
            <button
              type="button"
              onClick={onClose}
              className="neu-raised w-full rounded-lg py-2.5 text-sm font-medium text-muted-foreground hover:text-sidebar-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}

type VaultFileAlreadyPresentDialogProps = {
  open: boolean;
  onClose: () => void;
  kind: VaultDuplicateKind;
  /** Display name of the picked file (optional). */
  fileName?: string;
  /** Vault display name when kind is shared/private vault. */
  vaultLabel?: string;
};

export function VaultFileAlreadyPresentDialog({
  open,
  onClose,
  kind,
  fileName,
  vaultLabel,
}: VaultFileAlreadyPresentDialogProps) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  if (!open || !portalTarget) return null;

  const title =
    kind === "org"
      ? "Already in the organization library"
      : kind === "shared"
        ? "Already in this shared vault"
        : "Already in this private vault";

  const where =
    kind === "org"
      ? "the shared organization library (vault)"
      : kind === "shared"
        ? vaultLabel
          ? `the shared vault “${vaultLabel}”`
          : "this shared vault"
        : vaultLabel
          ? `the private vault “${vaultLabel}”`
          : "this private vault";

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="File already in vault"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAtRef.current < BACKDROP_CLOSE_GRACE_MS) return;
        onClose();
      }}
    >
      <div className="flex max-h-[min(90dvh,620px)] w-full max-w-md flex-col rounded-t-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-sidebar-border/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm leading-relaxed text-foreground">
            {fileName ? (
              <>
                <span className="font-medium">{fileName}</span> is already in{" "}
                {where}. You do not need to upload it again.
              </>
            ) : (
              <>This file is already in {where}. You do not need to upload it again.</>
            )}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            You can read and ask about it in chat by selecting it in{" "}
            <span className="font-medium text-sidebar-foreground">Files</span>.
            If you think it did not ingest properly, open the row menu (
            <span className="font-medium text-sidebar-foreground">⋯</span>) and
            choose <span className="font-medium text-sidebar-foreground">Re-sync</span>.
          </p>
        </div>
        <div className="shrink-0 border-t border-sidebar-border/30 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="neu-raised-active w-full rounded-lg py-2.5 text-sm font-semibold text-sidebar-primary"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
