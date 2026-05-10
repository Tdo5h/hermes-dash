"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, MicIcon, UsersRoundIcon, XIcon } from "lucide-react";
import type { VaultAssetRole } from "@/lib/ingest-message";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import { fetchVaultHasUploadBasename } from "@/lib/vault-upload-basename";
import type { VaultDuplicateKind } from "@/components/VaultUploadGateDialogs";
import { useDeepgramDictation } from "@/lib/use-deepgram-dictation";
import { LiveWaveform } from "@/components/ui/live-waveform";

/** Ignore backdrop close for this long after open — native file picker dismiss can synthesize a click that would otherwise close us immediately. */
const BACKDROP_CLOSE_GRACE_MS = 450;

export type ProjectListItem = {
  slug: string;
  name: string;
  visibility?: string;
};

export type WorkspacePickResult = {
  userNotes: string;
  assetRole: VaultAssetRole;
};

type WorkspacePickDialogProps = {
  open: boolean;
  onClose: () => void;
  onChosen: (slug: string, name: string, options: WorkspacePickResult) => void;
  /** Basename of the file staged for upload (required for duplicate detection). */
  pendingFileName: string;
  /**
   * File already exists in the target vault (by stored name). Parent should show
   * `VaultFileAlreadyPresentDialog` and close this dialog.
   */
  onDuplicateInVault?: (info: {
    kind: VaultDuplicateKind;
    fileName: string;
    vaultLabel?: string;
  }) => void;
  /** After the list loads, select this workspace (e.g. current vault chat). */
  initialWorkspaceSlug?: string | null;
};

const ROLE_OPTIONS: {
  value: VaultAssetRole;
  label: string;
  hint: string;
}[] = [
  {
    value: "general_reference",
    label: "Knowledge",
    hint: "Facts, notes, people, places, decisions, instructions, ideas, or reference material Hermes should understand and reuse.",
  },
  {
    value: "output_template",
    label: "Style / structure",
    hint: "An example of how something should look, read, or be arranged. Hermes learns the shape and tone, not the facts.",
  },
  {
    value: "scoring_criteria",
    label: "Review rules",
    hint: "Requirements, standards, checklists, review rules, or decision criteria Hermes should use when checking or improving work.",
  },
];

export function WorkspacePickDialog({
  open,
  onClose,
  onChosen,
  pendingFileName,
  onDuplicateInVault,
  initialWorkspaceSlug = null,
}: WorkspacePickDialogProps) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const openedAtRef = useRef(0);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userNotes, setUserNotes] = useState("");
  const [assetRole, setAssetRole] = useState<VaultAssetRole>("general_reference");
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [selectedSlug, setSelectedSlug] = useState("");
  /** Second step: confirm intent before uploading into a shared vault. */
  const [sharedVaultNotice, setSharedVaultNotice] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const {
    voiceState,
    voiceErrorHint,
    toggleRecording: handleNotesMicPress,
    cleanupSession: cleanupVoiceSession,
  } = useDeepgramDictation({
    getBaseText: () => userNotes,
    applyText: setUserNotes,
  });

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) {
      cleanupVoiceSession();
    }
  }, [open, cleanupVoiceSession]);

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    setError(null);
    setUserNotes("");
    setAssetRole("general_reference");
    setSelectedSlug(initialWorkspaceSlug?.trim() ?? "");
    setSharedVaultNotice(false);
    setCheckingDuplicate(false);
    setLoading(true);
    void fetch("/api/projects")
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json() as Promise<ProjectListItem[]>;
      })
      .then((rows) => {
        const list = rows.map((p) => ({
          slug: p.slug,
          name: p.name,
          visibility: p.visibility,
        }));
        setProjects(list);
        if (
          initialWorkspaceSlug &&
          list.some((p) => p.slug === initialWorkspaceSlug)
        ) {
          setSelectedSlug(initialWorkspaceSlug);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not load your vaults");
        setProjects([]);
      })
      .finally(() => setLoading(false));
  }, [open, initialWorkspaceSlug]);

  useEffect(() => {
    if (!open || projects.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        projects.map(async (p) => {
          try {
            const r = await fetch(
              `/api/projects/${encodeURIComponent(p.slug)}/files`,
              { cache: "no-store" }
            );
            if (!r.ok) return [p.slug, 0] as const;
            const d = (await r.json()) as { files?: unknown[] };
            return [p.slug, (d.files ?? []).length] as const;
          } catch {
            return [p.slug, 0] as const;
          }
        })
      );
      if (!cancelled) {
        setFileCounts(Object.fromEntries(entries) as Record<string, number>);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projects]);

  function selectedProject(): ProjectListItem | null {
    return projects.find((p) => p.slug === selectedSlug) ?? null;
  }

  function selectedProjectIsOrgLibrary(): boolean {
    return selectedSlug === getOrgGlobalSlug();
  }

  function pickOptions(): WorkspacePickResult {
    return {
      userNotes: userNotes.trim(),
      assetRole: selectedProjectIsOrgLibrary() ? "org_global" : assetRole,
    };
  }

  async function handlePrimaryAction() {
    if (loading || checkingDuplicate) return;

    const name = pendingFileName.trim();
    if (!name) {
      setError("Missing file — use Add file and choose a file again.");
      return;
    }

    const p = selectedProject();
    if (!p) return;

    if (sharedVaultNotice) return;

    setCheckingDuplicate(true);
    setError(null);
    try {
    if (await fetchVaultHasUploadBasename(p.slug, name)) {
        onDuplicateInVault?.({
          kind:
            p.slug === getOrgGlobalSlug()
              ? "org"
              : p.visibility === "shared"
                ? "shared"
                : "private",
          fileName: name,
          vaultLabel: p.name,
        });
        onClose();
        return;
      }
    } catch {
      setError("Could not verify vault contents. Try again.");
      return;
    } finally {
      setCheckingDuplicate(false);
    }

    if (p.visibility === "shared") {
      setSharedVaultNotice(true);
      return;
    }
    cleanupVoiceSession();
    onChosen(p.slug, p.name, pickOptions());
  }

  function handleSharedVaultConfirm() {
    const p = selectedProject();
    if (!p || p.visibility !== "shared") {
      setSharedVaultNotice(false);
      return;
    }
    cleanupVoiceSession();
    setSharedVaultNotice(false);
    onChosen(p.slug, p.name, pickOptions());
  }

  if (!open || !portalTarget) return null;

  const hasVaults = projects.length > 0;
  const vaultReady = hasVaults && Boolean(selectedSlug);
  const canSubmit = !loading && !checkingDuplicate && vaultReady;
  const selected = selectedProject();
  const isOrgLibrary = selectedProjectIsOrgLibrary();
  const effectiveAssetRole: VaultAssetRole = isOrgLibrary ? "org_global" : assetRole;
  const lockedToCurrentVault = Boolean(initialWorkspaceSlug?.trim());
  const currentVaultLabel =
    selected?.name?.trim() ||
    (lockedToCurrentVault ? initialWorkspaceSlug!.trim() : "");

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Store file in vault"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAtRef.current < BACKDROP_CLOSE_GRACE_MS) return;
        onClose();
      }}
    >
      <div className="flex max-h-[min(90dvh,620px)] w-full max-w-md flex-col rounded-t-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-sidebar-border/30 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Store file in this vault
            </h2>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Choose what Hermes should learn from it. Everything else is
              optional.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent/20 hover:text-sidebar-foreground"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {sharedVaultNotice ? (
              <div className="flex flex-col gap-4 pt-1">
                <div className="flex flex-col items-center gap-3 rounded-xl border border-sidebar-primary/25 bg-sidebar-accent/10 px-4 py-5 text-center">
                  <div className="flex size-11 items-center justify-center rounded-full border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] text-sidebar-primary">
                    <UsersRoundIcon className="size-5" aria-hidden />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {isOrgLibrary ? "Organization library" : "Shared vault"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {isOrgLibrary ? (
                        <>
                          This file will be stored in the{" "}
                          <span className="font-medium text-sidebar-foreground">
                            organization library
                          </span>{" "}
                          (
                          <span className="font-mono text-[10px]">
                            {getOrgGlobalSlug()}
                          </span>
                          ), visible org-wide on the shared wiki. Confirm this
                          material is appropriate to share.
                        </>
                      ) : (
                        <>
                          You are about to add this file to a{" "}
                          <span className="font-medium text-sidebar-foreground">
                            shared
                          </span>{" "}
                          vault. Content here may be visible to others in your
                          organization. Please confirm this material is
                          appropriate to share and is not intended to stay
                          private or confidential.
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <p className="text-center text-[10px] text-muted-foreground">
                  If you meant a private vault, go back and pick a private vault
                  in the list, or add one from the vault sidebar.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 border-b border-sidebar-border/20 pb-3">
                  {lockedToCurrentVault ? (
                    <div role="status">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Adding to
                      </p>
                      <p className="mt-1 text-xl font-semibold leading-tight tracking-tight text-sidebar-primary sm:text-2xl">
                        {currentVaultLabel || "This vault"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Which vault is this for?
                      </label>
                      <div className="relative">
                        <select
                          value={selectedSlug}
                          onChange={(e) => {
                            setSelectedSlug(e.target.value);
                            setAssetRole("general_reference");
                          }}
                          disabled={loading || !hasVaults}
                          className="neu-inset-input w-full appearance-none rounded-lg border border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] py-2.5 pl-3 pr-10 text-sm text-foreground disabled:opacity-50"
                        >
                          <option value="">
                            {loading
                              ? "Loading…"
                              : !hasVaults
                                ? "Add a vault in the sidebar first"
                                : "Select a vault…"}
                          </option>
                          {projects.map((p) => {
                            const n = fileCounts[p.slug];
                            const hint =
                              typeof n === "number" ? ` (${n} in vault)` : "";
                            return (
                              <option key={p.slug} value={p.slug}>
                                {p.name}
                                {hint}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDownIcon
                          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                      {selected ? (
                        <p
                          className="mt-2 text-sm font-medium text-foreground"
                          role="status"
                        >
                          Adding to:{" "}
                          <span className="text-sidebar-primary">
                            {selected.name}
                          </span>
                        </p>
                      ) : null}
                    </>
                  )}
                  {isOrgLibrary ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Files added here become organization-wide knowledge. Hermes can
                      use them from other vaults, but they are not private to one
                      vault.
                    </p>
                  ) : null}
                  {!loading && !hasVaults ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Create a vault from the <strong>Vault</strong> area in
                      the sidebar, then return here to store files in it.
                    </p>
                  ) : null}
                </div>

                {isOrgLibrary ? (
                  <div className="mb-4 rounded-lg border border-sidebar-primary/35 bg-sidebar-accent/15 px-3 py-2.5 text-left text-sm text-sidebar-foreground">
                    <span className="font-medium">Organization knowledge</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                      Hermes treats this as shared organization reference: useful
                      facts, standards, people, language, and context
                      that can help across vaults.
                    </span>
                  </div>
                ) : (
                  <>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      What should Hermes learn from this?
                    </p>
                    <div className="mb-4 flex flex-col gap-2.5">
                      {ROLE_OPTIONS.map((o) => {
                        const on = assetRole === o.value;
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => setAssetRole(o.value)}
                            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                              on
                                ? "hermes-selected-choice"
                                : "border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] text-muted-foreground hover:border-sidebar-border/50 hover:text-sidebar-foreground"
                            }`}
                          >
                            <span className="font-medium">{o.label}</span>
                            <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                              {o.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <div className="neu-raised rounded-xl p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Notes for agent
                    </p>
                    <button
                      type="button"
                      onClick={handleNotesMicPress}
                      disabled={voiceState === "processing"}
                      className="neu-selected relative flex size-9 shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-[box-shadow,background] duration-200 disabled:opacity-40"
                      aria-label={
                        voiceState === "recording"
                          ? "Stop recording"
                          : "Dictate notes"
                      }
                    >
                      {voiceState === "recording" ? (
                        <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
                          <LiveWaveform
                            active={false}
                            processing={true}
                            barWidth={2}
                            barGap={1}
                            barColor="#a3c4f3"
                            height={28}
                            mode="static"
                            fadeEdges={true}
                            fadeWidth={8}
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <MicIcon className="size-4" />
                      )}
                    </button>
                  </div>
                  <textarea
                    value={userNotes}
                    onChange={(e) => setUserNotes(e.target.value)}
                    placeholder={
                      effectiveAssetRole === "scoring_criteria"
                        ? "Optional: what should Hermes check for when using these rules?"
                        : effectiveAssetRole === "output_template"
                          ? "Optional: what style, sections, or layout details should Hermes notice?"
                        : "Optional: what is this, what matters, or what should Hermes ignore?"
                    }
                    rows={2}
                    className="neu-inset-input w-full resize-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  {voiceErrorHint ? (
                    <p className="mt-2 text-[10px] text-destructive/90">
                      {voiceErrorHint}
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <p className="mt-2 text-xs text-destructive/90">{error}</p>
                ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-sidebar-border/30 px-4 py-3">
            {sharedVaultNotice ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleSharedVaultConfirm}
                  className="neu-raised-active w-full rounded-lg py-2.5 text-sm font-semibold text-sidebar-primary"
                >
                  {isOrgLibrary
                    ? "Continue — upload to organization library"
                    : "Continue — upload to shared vault"}
                </button>
                <button
                  type="button"
                  onClick={() => setSharedVaultNotice(false)}
                  className="neu-raised w-full rounded-lg py-2.5 text-sm font-medium text-muted-foreground hover:text-sidebar-foreground"
                >
                  Go back
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handlePrimaryAction()}
                className="neu-raised-active w-full rounded-lg py-2.5 text-sm font-semibold text-sidebar-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checkingDuplicate ? "Checking vault…" : "Store file"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
