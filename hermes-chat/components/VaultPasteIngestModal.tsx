"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ImageIcon, XIcon } from "lucide-react";
import type { VaultAssetRole } from "@/lib/ingest-message";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import { cn } from "@/lib/utils";

type VaultPastedImage = {
  file: File;
  previewUrl: string;
};

type PasteTarget = {
  slug: string;
  name: string;
  visibility?: string;
};

type PasteStep = "target" | "content";
type PasteScope = "private" | "shared";

type VaultPasteIngestModalProps = {
  open: boolean;
  onClose: () => void;
  activeWorkspaceSlug?: string | null;
  activeWorkspaceName?: string | null;
  initialImageFiles?: File[];
  onConfirm: (payload: {
    pastedText: string;
    targetSlug: string;
    assetRole: VaultAssetRole;
    imageFiles: File[];
  }) => void;
};

const MAX_PASTE_IMAGES = 8;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const EMPTY_INITIAL_IMAGE_FILES: File[] = [];

const ROLE_OPTIONS: {
  value: VaultAssetRole;
  label: string;
  hint: string;
  requiresOrg?: boolean;
}[] = [
  {
    value: "general_reference",
    label: "General knowledge",
    hint: "Facts, notes, context, people, images, decisions, ideas, or reference material.",
  },
  {
    value: "output_template",
    label: "Template material",
    hint: "Reusable structure, style, sections, tone, layout, or message patterns.",
  },
  {
    value: "scoring_criteria",
    label: "Scoring material",
    hint: "Rules, checklists, standards, requirements, or review criteria.",
  },
  {
    value: "company_branding",
    label: "Brand details",
    hint: "Names, colors, voice, product terms, logo notes, or brand guardrails.",
  },
  {
    value: "org_global",
    label: "Organization library",
    hint: "Shared organization-wide reference available across vaults.",
    requiresOrg: true,
  },
];

function revokePreviewUrls(entries: VaultPastedImage[]) {
  for (const e of entries) {
    try {
      URL.revokeObjectURL(e.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

function scopeForTarget(target?: PasteTarget | null): PasteScope {
  return target?.visibility === "shared" ? "shared" : "private";
}

export function VaultPasteIngestModal({
  open,
  onClose,
  activeWorkspaceSlug = null,
  activeWorkspaceName = null,
  initialImageFiles = EMPTY_INITIAL_IMAGE_FILES,
  onConfirm,
}: VaultPasteIngestModalProps) {
  const orgSlug = getOrgGlobalSlug();
  const [step, setStep] = useState<PasteStep>("target");
  const [scope, setScope] = useState<PasteScope>("private");
  const [projects, setProjects] = useState<PasteTarget[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [targetSlug, setTargetSlug] = useState("");
  const [assetRole, setAssetRole] =
    useState<VaultAssetRole>("general_reference");
  const [text, setText] = useState("");
  const [pastedImages, setPastedImages] = useState<VaultPastedImage[]>([]);
  const [clipErr, setClipErr] = useState<string | null>(null);
  const [imageErr, setImageErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastedImagesRef = useRef<VaultPastedImage[]>([]);
  pastedImagesRef.current = pastedImages;

  const selectedTarget =
    projects.find((project) => project.slug === targetSlug) ?? null;
  const orgTarget = projects.find((project) => project.slug === orgSlug) ?? null;
  const activeTarget = activeWorkspaceSlug
    ? projects.find((project) => project.slug === activeWorkspaceSlug) ?? null
    : null;

  const scopedProjects = useMemo(
    () => projects.filter((project) => scopeForTarget(project) === scope),
    [projects, scope]
  );

  useEffect(() => {
    if (!open) return;
    setProjectsLoading(true);
    setProjectsError(null);
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.json() as Promise<PasteTarget[]>;
      })
      .then((rows) => {
        const list = rows.map((project) => ({
          slug: project.slug,
          name: project.name,
          visibility: project.visibility,
        }));
        setProjects(list);
        const initial =
          (activeWorkspaceSlug
            ? list.find((project) => project.slug === activeWorkspaceSlug)
            : null) ??
          list.find((project) => project.visibility !== "shared") ??
          list[0] ??
          null;
        if (initial) {
          setTargetSlug(initial.slug);
          setScope(scopeForTarget(initial));
        }
      })
      .catch((e: unknown) => {
        setProjectsError(e instanceof Error ? e.message : "Could not load vaults");
        setProjects([]);
      })
      .finally(() => setProjectsLoading(false));
  }, [activeWorkspaceSlug, open]);

  useEffect(() => {
    if (!open) return;
    setStep("target");
    setClipErr(null);
    setImageErr(null);
    setAssetRole("general_reference");
    setPastedImages((prev) => {
      revokePreviewUrls(prev);
      const valid = initialImageFiles.filter(
        (file) =>
          file.type.startsWith("image/") &&
          file.size > 0 &&
          file.size <= MAX_IMAGE_BYTES
      );
      if (initialImageFiles.length > 0 && valid.length === 0) {
        setImageErr("Each image must be 20 MB or smaller.");
      }
      return valid.slice(0, MAX_PASTE_IMAGES).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    });
  }, [initialImageFiles, open]);

  useEffect(() => {
    if (!open) {
      setText("");
      setTargetSlug("");
      setProjects([]);
      setScope("private");
      setPastedImages((prev) => {
        revokePreviewUrls(prev);
        return [];
      });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      revokePreviewUrls(pastedImagesRef.current);
    };
  }, []);

  function chooseScope(nextScope: PasteScope) {
    setScope(nextScope);
    const first = projects.find((project) => scopeForTarget(project) === nextScope);
    if (first) setTargetSlug(first.slug);
  }

  const pushImageFiles = useCallback((files: FileList | File[]) => {
    setImageErr(null);
    const arr = Array.from(files).filter(
      (f) => f.type.startsWith("image/") && f.size > 0
    );
    if (arr.length === 0) {
      setImageErr("Only image files, like PNG, JPEG, or WebP.");
      return;
    }
    setPastedImages((prev) => {
      const next = [...prev];
      for (const f of arr) {
        if (f.size > MAX_IMAGE_BYTES) {
          setImageErr("Each image must be 20 MB or smaller.");
          return prev;
        }
        if (next.length >= MAX_PASTE_IMAGES) break;
        next.push({ file: f, previewUrl: URL.createObjectURL(f) });
      }
      return next.slice(0, MAX_PASTE_IMAGES);
    });
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    setClipErr(null);
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText((prev) => (prev ? `${prev}\n\n${t}` : t));
    } catch {
      setClipErr("Clipboard access denied. Paste manually with Ctrl+V or long-press.");
    }
  }, []);

  const onTextPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const dt = e.clipboardData;
      if (!dt) return;

      const fromItems: File[] = [];
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) fromItems.push(f);
        }
      }
      const fromFiles = Array.from(dt.files).filter((f) =>
        f.type.startsWith("image/")
      );
      const imgs = fromItems.length > 0 ? fromItems : fromFiles;
      if (imgs.length === 0) return;
      e.preventDefault();
      pushImageFiles(imgs);
    },
    [pushImageFiles]
  );

  if (!open) return null;

  const effectiveTarget =
    assetRole === "org_global" ? orgTarget : selectedTarget;
  const contentPlaceholder =
    assetRole === "company_branding"
      ? "Names, website, colors, product names, logo notes, visual rules..."
      : assetRole === "output_template"
        ? "Paste a reusable message, document, page, section, or layout pattern..."
        : assetRole === "scoring_criteria"
          ? "Paste rules, standards, checklists, scoring notes, or requirements..."
          : assetRole === "org_global"
            ? "Paste organization-wide context, standards, names, details, or shared reference..."
            : pastedImages.length > 0
              ? "Optional: what should Hermes remember about this image? Profile photo, brand icon, reference image, product photo, or letterhead asset."
              : "Paste the text you want Hermes to remember in this vault...";

  function handleConfirm() {
    const trimmed = text.replace(/\r\n/g, "\n").trim();
    if ((!trimmed && pastedImages.length === 0) || !effectiveTarget) return;
    onConfirm({
      pastedText: trimmed,
      targetSlug: effectiveTarget.slug,
      assetRole,
      imageFiles: pastedImages.map((x) => x.file),
    });
    setText("");
    revokePreviewUrls(pastedImages);
    setPastedImages([]);
    onClose();
  }

  const targetReady = Boolean(selectedTarget);
  const canSubmit =
    Boolean(text.trim()) || pastedImages.length > 0
      ? Boolean(effectiveTarget)
      : false;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add pasted text to vault"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={cn(
          "flex max-h-[min(90dvh,44rem)] w-full max-w-lg flex-col rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl"
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-sidebar-border/30 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {step === "target"
                ? "Where should this go?"
                : pastedImages.length > 0 && !text.trim()
                  ? "Add image to vault"
                  : "Add pasted text"}
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {step === "target"
                ? "Choose a private or shared vault first. Hermes will process it in the background."
                : pastedImages.length > 0
                  ? "Tell Hermes what the image is for, like a profile, brand asset, reference image, document artwork, or general vault knowledge."
                  : "Paste notes, messages, emails, page copy, or reference text. Hermes saves it so you can ask about it later."}
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

        {step === "target" ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-sidebar-border/30 p-1">
                {(["private", "shared"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => chooseScope(option)}
                    className={cn(
                      "rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors",
                      scope === option
                        ? "hermes-selected-choice"
                        : "text-muted-foreground hover:text-sidebar-foreground"
                    )}
                  >
                    {option === "private" ? "Private" : "Shared"}
                  </button>
                ))}
              </div>

              {projectsLoading ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Loading vaults...
                </p>
              ) : projectsError ? (
                <p className="rounded-lg border border-destructive/25 px-3 py-3 text-sm text-destructive/90">
                  {projectsError}
                </p>
              ) : scopedProjects.length === 0 ? (
                <p className="rounded-lg border border-sidebar-border/25 px-3 py-3 text-sm text-muted-foreground">
                  No {scope} vaults found yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {scopedProjects.map((project) => {
                    const selected = targetSlug === project.slug;
                    const isCurrent = project.slug === activeWorkspaceSlug;
                    const isOrg = project.slug === orgSlug;
                    return (
                      <button
                        key={project.slug}
                        type="button"
                        onClick={() => setTargetSlug(project.slug)}
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-left transition-colors",
                          selected
                            ? "hermes-selected-choice"
                            : "border-sidebar-border/30 text-muted-foreground hover:border-sidebar-border/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{project.name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {isOrg ? "Org" : isCurrent ? "Current" : scope}
                          </span>
                        </span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                          {isOrg
                            ? "Shared organization library."
                            : scope === "shared"
                              ? "Shared vault material may be visible to your organization."
                              : "Private vault material stays in your private vault."}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-sidebar-border/30 px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("content")}
                disabled={!targetReady}
                className="neu-raised rounded-lg px-3 py-1.5 text-sm font-medium text-sidebar-foreground disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <button
                type="button"
                onClick={() => setStep("target")}
                className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground"
              >
                <ChevronLeftIcon className="size-3.5" aria-hidden />
                {effectiveTarget?.name ?? activeWorkspaceName ?? "Choose vault"}
              </button>

              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                What is this material?
              </p>
              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLE_OPTIONS.filter(
                  (option) => !option.requiresOrg || effectiveTarget?.slug === orgSlug
                ).map(
                  (option) => {
                    const selected = assetRole === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAssetRole(option.value)}
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-left transition-colors",
                          selected
                            ? "hermes-selected-choice"
                            : "border-sidebar-border/30 text-muted-foreground hover:border-sidebar-border/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                          {option.hint}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>

              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Content
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={onTextPaste}
                placeholder={contentPlaceholder}
                className="neu-inset-input mb-2 min-h-[180px] w-full resize-y rounded-lg px-3 py-2 text-sm text-foreground"
              />

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const fl = e.target.files;
                    if (fl?.length) pushImageFiles(fl);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-lg border border-sidebar-border/40 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-sidebar-border/20"
                >
                  <ImageIcon className="size-3.5" aria-hidden />
                  Add images
                </button>
                <button
                  type="button"
                  onClick={() => void pasteFromClipboard()}
                  className="text-xs font-medium text-sidebar-primary hover:underline"
                >
                  Paste from clipboard
                </button>
                <span className="text-[10px] text-muted-foreground">
                  Optional images: {pastedImages.length}/{MAX_PASTE_IMAGES}
                </span>
              </div>

              {imageErr ? (
                <p className="mb-2 text-[11px] text-amber-200/90">{imageErr}</p>
              ) : null}
              {clipErr ? (
                <p className="mb-2 text-[11px] text-amber-200/90">{clipErr}</p>
              ) : null}

              {pastedImages.length > 0 ? (
                <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                  {pastedImages.map((entry, i) => (
                    <div
                      key={`${entry.previewUrl}-${i}`}
                      className="neu-raised relative size-16 shrink-0 overflow-hidden rounded-lg"
                    >
                      <img
                        src={entry.previewUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPastedImages((prev) => {
                            const rm = prev[i];
                            if (rm) {
                              try {
                                URL.revokeObjectURL(rm.previewUrl);
                              } catch {
                                /* ignore */
                              }
                            }
                            return prev.filter((_, j) => j !== i);
                          })
                        }
                        className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"
                        aria-label="Remove image"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-sidebar-border/30 px-4 py-3">
              <button
                type="button"
                onClick={() => setStep("target")}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canSubmit}
                className="neu-raised rounded-lg px-3 py-1.5 text-sm font-medium text-sidebar-foreground disabled:opacity-40"
              >
                Add to vault
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
