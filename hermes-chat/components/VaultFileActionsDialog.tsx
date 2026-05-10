"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangleIcon,
  FileTextIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { WorkspaceVaultFileRow } from "@/components/WorkspaceVaultFilesBar";
import { normalizeVaultAssetRole, type VaultAssetRole } from "@/lib/ingest-message";

export type VaultFileActionsDialogProps = {
  open: boolean;
  projectSlug: string;
  /** Current `/chat/[sessionId]` id — attributes Hermes re-verify to this chat for sidebar orbs. */
  workspaceSessionId?: string | null;
  file: WorkspaceVaultFileRow | null;
  workspaceIsShared: boolean;
  onClose: () => void;
  onAfterChange: () => void;
  /**
   * Shared vault re-ingest queued architect job — use to show SharedIngestArchitectHero
   * and poll `shared-ingest-status`.
   */
  onReingestQueued?: (p: {
    jobId: string;
    fileName: string;
    projectSlug: string;
    assetRole?: string | null;
  }) => void;
  /**
   * Private vault Hermes verify started — inline chat orb + file-row orb (poll `private-reingest-status`).
   */
  onPrivateReingestStarted?: (p: {
    jobId: string;
    fileName: string;
    projectSlug: string;
    assetRole?: string | null;
  }) => void;
};

function compactRoleLabel(role: VaultAssetRole): string {
  switch (role) {
    case "general_reference":
      return "Knowledge";
    case "output_template":
      return "Template";
    case "company_branding":
      return "Brand";
    case "org_global":
      return "Org";
    case "scoring_criteria":
      return "Scoring";
    default:
      return "Notes";
  }
}

export function VaultFileActionsDialog({
  open,
  projectSlug,
  workspaceSessionId,
  file,
  workspaceIsShared,
  onClose,
  onAfterChange,
  onReingestQueued,
  onPrivateReingestStarted,
}: VaultFileActionsDialogProps) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [busy, setBusy] = useState<"reingest" | "undo" | "delete" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(null);
    }
  }, [open, file?.relativePath]);

  if (!open || !portalTarget || !file) return null;
  const role = normalizeVaultAssetRole(file.assetRole);
  const scopeLabel = workspaceIsShared ? "Shared vault" : "Private vault";
  const roleLabel = compactRoleLabel(role);

  async function handleSharedReingest() {
    if (!workspaceIsShared) return;
    const row = file;
    if (!row) return;
    setBusy("reingest");
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/ingest-source`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relativePath: row.relativePath }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
      };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.jobId && onReingestQueued) {
        onReingestQueued({
          jobId: data.jobId,
          fileName: row.name,
          projectSlug,
          assetRole: row.assetRole ?? null,
        });
      }
      onAfterChange();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function handlePrivateReingest() {
    if (workspaceIsShared) return;
    const row = file;
    if (!row) return;
    setBusy("reingest");
    setError(null);
    try {
      const sid =
        typeof workspaceSessionId === "string" && workspaceSessionId.trim()
          ? workspaceSessionId.trim()
          : "";
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/reingest-hermes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relativePath: row.relativePath,
            ...(sid ? { sourceWebchatId: sid } : {}),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
        fileName?: string;
        assetRole?: string | null;
      };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      const jid = typeof data.jobId === "string" ? data.jobId.trim() : "";
      if (!jid) {
        setError("Server did not return a job id");
        return;
      }
      onPrivateReingestStarted?.({
        jobId: jid,
        fileName: typeof data.fileName === "string" ? data.fileName : row.name,
        projectSlug,
        ...(data.assetRole != null && String(data.assetRole).trim()
          ? { assetRole: String(data.assetRole).trim() }
          : { assetRole: row.assetRole ?? null }),
      });
      onAfterChange();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleUndoIngest() {
    const row = file;
    if (!row) return;
    setBusy("undo");
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/undo-ingest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relativePath: row.relativePath }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onAfterChange();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteSourceOnly() {
    const row = file;
    if (!row) return;
    setBusy("delete");
    setError(null);
    try {
      const qs = new URLSearchParams({ relativePath: row.relativePath });
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/files?${qs.toString()}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onAfterChange();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-end justify-center bg-black/55 p-3 sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-sidebar-border/35 bg-[var(--sidebar-depth-canvas)] text-foreground shadow-2xl"
        role="dialog"
        aria-labelledby="vault-file-actions-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-sidebar-border/25 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="neu-raised mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl text-sidebar-primary">
              <FileTextIcon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="vault-file-actions-title"
                className="break-words text-sm font-semibold leading-snug text-foreground"
              >
                {file.name}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-sidebar-border/35 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {scopeLabel}
                </span>
                <span className="rounded-full border border-sidebar-primary/30 bg-sidebar-primary/10 px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary">
                  {roleLabel}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/20 hover:text-sidebar-foreground disabled:opacity-50"
              disabled={busy !== null}
              onClick={onClose}
              aria-label="Close file options"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="rounded-xl border border-sidebar-border/30 bg-sidebar/20 px-3 py-2.5">
            <p className="text-xs font-semibold text-foreground">What these do</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {workspaceIsShared
                ? "Shared vault actions use the org ingest queue. Re-sync verifies the upload and repairs missing extracted text, index entries, role outputs, and related notes where possible."
                : "Private vault actions ask Hermes to verify this upload and refresh extracted text, index entries, role outputs, and related notes where possible."}
            </p>
          </div>

          <div className="grid gap-2">
            {workspaceIsShared ? (
              <button
                type="button"
                className="neu-raised flex items-start gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void handleSharedReingest()}
              >
                <RefreshCwIcon className="mt-0.5 size-4 shrink-0 text-sidebar-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {busy === "reingest" ? "Starting..." : "Re-sync with org ingest"}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Queue a verify pass for this shared vault file.
                  </span>
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="neu-raised flex items-start gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void handlePrivateReingest()}
              >
                <RefreshCwIcon className="mt-0.5 size-4 shrink-0 text-sidebar-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {busy === "reingest" ? "Starting..." : "Re-sync with Hermes"}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Run a Hermes verify pass for this private vault file.
                  </span>
                </span>
              </button>
            )}

            <button
              type="button"
              className="flex items-start gap-3 rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-3 text-left transition-colors hover:bg-destructive/10 disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void handleUndoIngest()}
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-destructive">
                  {busy === "undo" ? "Removing..." : "Remove upload and generated outputs"}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  Removes the upload, manifest entry, extracted text, segments, and role-specific outputs tied to this file. Merged wiki notes may remain if other files also fed them.
                </span>
              </span>
            </button>

            <button
              type="button"
              className="neu-raised flex items-start gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void handleDeleteSourceOnly()}
            >
              <Trash2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {busy === "delete" ? "Deleting..." : "Delete upload only"}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  Removes the source file only. Extracted notes, index entries, and generated vault files stay.
                </span>
              </span>
            </button>
          </div>
        </div>

        {error ? (
          <p className="mx-4 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="border-t border-sidebar-border/25 px-4 py-3">
          <button
            type="button"
            className="neu-raised w-full rounded-xl px-3 py-2.5 text-center text-sm font-medium text-muted-foreground disabled:opacity-50"
            disabled={busy !== null}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
