"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilesIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";
import { Orb } from "@/components/ui/orb";
import {
  ARCHITECT_ORB_COLORS,
  CHAT_AGENT_ORB_COLORS,
} from "@/lib/architect-orb-presets";
import {
  isHermesPrivateIngestJob,
  matchWorkspaceVaultIngestJob,
  type WorkspaceVaultIngestJob,
} from "@/lib/workspace-vault-ingest-jobs";
import { cn } from "@/lib/utils";
import type { SharedVaultGapHint } from "@/lib/shared-vault-gap-types";
import { VaultFileActionsDialog } from "@/components/VaultFileActionsDialog";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import type { VaultAssetRole } from "@/lib/ingest-message";
import {
  ingestDetailLine,
  ingestProgressPercent,
  ingestProgressLine,
} from "@/lib/shared-ingest-hero-copy";

export type WorkspaceVaultFileRow = {
  name: string;
  relativePath: string;
  size: number;
  assetRole?: string | null;
};

type WebsiteCaptureInfo = {
  host: string;
  timestamp: string | null;
  manual: boolean;
};

type WorkspaceVaultDisplayFile = {
  key: string;
  displayName: string;
  primary: WorkspaceVaultFileRow;
  files: WorkspaceVaultFileRow[];
  duplicateLabel: string | null;
};

const ROLE_ORDER: VaultAssetRole[] = [
  "general_reference",
  "output_template",
  "company_branding",
  "org_global",
  "scoring_criteria",
];

function oneWordRoleLabel(roleKey: VaultAssetRole): string {
  switch (roleKey) {
    case "general_reference":
      return "Knowledge";
    case "output_template":
      return "Template";
    case "org_global":
      return "Org";
    case "company_branding":
      return "Brand";
    case "scoring_criteria":
      return "Scoring";
    default:
      return "Notes";
  }
}

function parseWebsiteCaptureName(name: string): WebsiteCaptureInfo | null {
  const m = /^company-website-(manual-)?(.+?)(?:-(\d{8}T\d{6}))?\.md$/i.exec(
    name
  );
  if (!m) return null;
  const host = m[2]?.trim();
  if (!host) return null;
  return {
    host,
    timestamp: m[3] ?? null,
    manual: Boolean(m[1]),
  };
}

function websiteCaptureSortKey(f: WorkspaceVaultFileRow): string {
  const info = parseWebsiteCaptureName(f.name);
  if (!info) return "";
  return info.timestamp ?? "99999999T999999";
}

function pickPrimaryDisplayFile(
  rows: WorkspaceVaultFileRow[]
): WorkspaceVaultFileRow {
  return [...rows].sort((a, b) =>
    websiteCaptureSortKey(b).localeCompare(websiteCaptureSortKey(a))
  )[0]!;
}

function collapseVaultFileRowsForDisplay(
  rows: WorkspaceVaultFileRow[]
): WorkspaceVaultDisplayFile[] {
  const buckets = new Map<string, WorkspaceVaultFileRow[]>();
  for (const row of rows) {
    const website = parseWebsiteCaptureName(row.name);
    const key = website
      ? `website:${website.host.toLowerCase()}`
      : `file:${row.relativePath}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  return [...buckets.entries()].map(([key, list]) => {
    const primary = pickPrimaryDisplayFile(list);
    const website = parseWebsiteCaptureName(primary.name);
    return {
      key,
      primary,
      files: list,
      displayName: website
        ? `${website.host} website capture`
        : primary.name,
      duplicateLabel:
        list.length > 1
          ? `${list.length} captures`
          : null,
    };
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function matchGapHint(
  f: WorkspaceVaultFileRow,
  hints: SharedVaultGapHint[]
): SharedVaultGapHint | undefined {
  return hints.find(
    (h) =>
      h.relativePath === f.relativePath ||
      h.name === f.name ||
      h.relativePath.endsWith(f.name)
  );
}

function gapHintLabel(h: SharedVaultGapHint): string {
  switch (h.kind) {
    case "missing_extracted":
      return "Needs ingest";
    case "circuit_paused":
      return "Auto-ingest paused";
    case "auto_exhausted":
      return "Max auto-retries — tap … to re-ingest";
    default:
      return "Ingest status";
  }
}

function isArchitectConfigErrorMessage(msg: string): boolean {
  return /not configured for (architect|shared ingest)|HERMES_ARCHITECT_URL|HERMES_ARCHITECT_TOKEN|HERMES_SHARED_INGEST/i.test(
    msg
  );
}

function ingestErrorFooterHint(msg: string): string {
  if (isArchitectConfigErrorMessage(msg)) {
    return "Server: shared ingest is not wired to this tenant's Hermes gateway. Contact the dev with this message.";
  }
  return "If this keeps happening, contact your admin or dev with the message above.";
}

function statusSubtitle(job: WorkspaceVaultIngestJob): string {
  if (isHermesPrivateIngestJob(job)) {
    if (job.status === "running") return job.phaseLabel;
    return job.errorMessage?.trim()
      ? job.errorMessage.length > 200
        ? `${job.errorMessage.slice(0, 200)}…`
        : job.errorMessage
      : "Hermes could not finish this verify pass.";
  }
  const line = ingestProgressLine({
    status: job.status,
    phaseKey: job.phaseKey,
    role: job.assetRole,
    isQueuedWaiting: job.isQueuedWaiting,
    slugQueuePosition: job.slugQueuePosition,
  });
  if (job.status === "running") return line;
  if (job.status === "error") {
    return job.errorMessage?.trim()
      ? job.errorMessage.length > 200
        ? `${job.errorMessage.slice(0, 200)}…`
        : job.errorMessage
      : "Something went wrong during ingest.";
  }
  if (job.status === "queued") {
    return line;
  }
  return "";
}

function statusDetail(job: WorkspaceVaultIngestJob): string | null {
  if (isHermesPrivateIngestJob(job) || job.status !== "running") return null;
  return ingestDetailLine(job.phaseLabel, statusSubtitle(job));
}

function matchDisplayFileJob(
  item: WorkspaceVaultDisplayFile,
  jobs: WorkspaceVaultIngestJob[]
): WorkspaceVaultIngestJob | undefined {
  const matches = item.files
    .map((f) => matchWorkspaceVaultIngestJob(f, jobs))
    .filter((j): j is WorkspaceVaultIngestJob => Boolean(j));
  return (
    matches.find((j) => j.status === "running") ??
    matches.find((j) => j.status === "queued") ??
    matches.find((j) => j.status === "error") ??
    matches[0]
  );
}

function matchDisplayFileGapHint(
  item: WorkspaceVaultDisplayFile,
  hints: SharedVaultGapHint[]
): SharedVaultGapHint | undefined {
  for (const f of item.files) {
    const hint = matchGapHint(f, hints);
    if (hint) return hint;
  }
  return undefined;
}

interface WorkspaceVaultFilesBarProps {
  projectSlug: string;
  /** Pass through for private Hermes re-verify sidebar attribution. */
  workspaceSessionId?: string | null;
  files: WorkspaceVaultFileRow[];
  /** Shared ingest jobs + private Hermes verify jobs (poll from parent). */
  ingestJobs?: WorkspaceVaultIngestJob[];
  gapHints?: SharedVaultGapHint[] | null;
  workspaceIsShared?: boolean;
  onVaultRefresh?: () => void;
  /** After shared vault re-ingest API returns a jobId (shared ingest queue). */
  onReingestQueued?: (p: {
    jobId: string;
    fileName: string;
    projectSlug: string;
    assetRole?: string | null;
  }) => void;
  onPrivateReingestStarted?: (p: {
    jobId: string;
    fileName: string;
    projectSlug: string;
    assetRole?: string | null;
  }) => void;
}

export function WorkspaceVaultFilesBar({
  projectSlug,
  workspaceSessionId,
  files,
  ingestJobs = [],
  gapHints = null,
  workspaceIsShared = false,
  onVaultRefresh,
  onReingestQueued,
  onPrivateReingestStarted,
}: WorkspaceVaultFilesBarProps) {
  const [open, setOpen] = useState(false);
  const [actionFile, setActionFile] = useState<WorkspaceVaultFileRow | null>(
    null
  );
  const [dismissBusyJobId, setDismissBusyJobId] = useState<string | null>(null);

  const downloadHref = useCallback(
    (name: string) =>
      `/api/projects/${encodeURIComponent(projectSlug)}/file?name=${encodeURIComponent(name)}`,
    [projectSlug]
  );

  const openInBrowserHref = useCallback(
    (name: string) =>
      `${downloadHref(name)}&disposition=inline`,
    [downloadHref]
  );

  const canOpenInBrowser = useCallback((name: string) => {
    const lower = name.toLowerCase();
    return (
      lower.endsWith(".html") ||
      lower.endsWith(".htm") ||
      lower.endsWith(".svg")
    );
  }, []);

  const hints = gapHints ?? [];

  const hasActiveIngest = useMemo(
    () => ingestJobs.some((j) => j.status === "queued" || j.status === "running"),
    [ingestJobs]
  );

  const firstIngestErrorJob = useMemo(
    () =>
      ingestJobs.find((j) => j.status === "error" && j.errorMessage?.trim()) ??
      ingestJobs.find((j) => j.status === "error") ??
      null,
    [ingestJobs]
  );

  const hasIngestError = firstIngestErrorJob !== null;

  const firstIngestError = useMemo(() => {
    const j = firstIngestErrorJob;
    if (!j?.errorMessage?.trim()) return null;
    return j.errorMessage.trim();
  }, [firstIngestErrorJob]);

  const dismissSharedIngestError = useCallback(
    async (job: WorkspaceVaultIngestJob) => {
      if (isHermesPrivateIngestJob(job)) return;
      setDismissBusyJobId(job.jobId);
      try {
        await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/shared-ingest-status`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: job.jobId }),
          }
        );
      } finally {
        setDismissBusyJobId(null);
        onVaultRefresh?.();
      }
    },
    [onVaultRefresh, projectSlug]
  );

  const gapCount = useMemo(
    () => hints.filter((h) => h.kind === "missing_extracted").length,
    [hints]
  );

  const showStaleGaps = useMemo(
    () =>
      !hasActiveIngest &&
      hints.some(
        (h) => h.kind === "missing_extracted" || h.kind === "auto_exhausted"
      ),
    [hasActiveIngest, hints]
  );

  /** Counts for every label including zeros; “Notes” catches unknown / non-standard roles. */
  const roleCounts = useMemo(() => {
    const byKey = new Map<VaultAssetRole, number>();
    for (const k of ROLE_ORDER) byKey.set(k, 0);
    let other = 0;
    const rowsByRole = new Map<VaultAssetRole, WorkspaceVaultFileRow[]>();
    for (const f of files) {
      const key = normalizeVaultAssetRole(f.assetRole);
      if (ROLE_ORDER.includes(key)) {
        const list = rowsByRole.get(key) ?? [];
        list.push(f);
        rowsByRole.set(key, list);
      } else {
        other += 1;
      }
    }
    for (const key of ROLE_ORDER) {
      byKey.set(
        key,
        collapseVaultFileRowsForDisplay(rowsByRole.get(key) ?? []).length
      );
    }
    return {
      entries: [
        ...ROLE_ORDER.map((k) => ({
          key: k,
          label: oneWordRoleLabel(k),
          count: byKey.get(k) ?? 0,
        })),
        { key: "other" as const, label: "Notes", count: other },
      ],
    };
  }, [files]);

  const groupedFiles = useMemo(() => {
    const byRole = new Map<VaultAssetRole, WorkspaceVaultFileRow[]>();
    for (const f of files) {
      const key = normalizeVaultAssetRole(f.assetRole);
      const list = byRole.get(key) ?? [];
      list.push(f);
      byRole.set(key, list);
    }
    const out: { roleKey: VaultAssetRole; label: string; items: WorkspaceVaultFileRow[] }[] = [];
    for (const key of ROLE_ORDER) {
      const items = byRole.get(key);
      if (items?.length) {
        out.push({ roleKey: key, label: oneWordRoleLabel(key), items });
      }
    }
    for (const [key, items] of byRole) {
      if (!ROLE_ORDER.includes(key) && items.length) {
        out.push({ roleKey: key, label: "Notes", items });
      }
    }
    return out.map((g) => ({
      ...g,
      items: collapseVaultFileRowsForDisplay(g.items),
    }));
  }, [files]);

  return (
    <div className="flex-shrink-0 border-b border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-xl border border-sidebar-border/35 bg-sidebar/25 px-2.5 py-2 text-left text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_22px_rgba(0,0,0,0.08)]",
          "transition-colors hover:border-sidebar-primary/45 hover:bg-sidebar-accent/10"
        )}
        aria-expanded={open}
      >
        <span className="neu-raised flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-primary">
          <FilesIcon className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs font-semibold">Files</span>
            <span className="rounded-full border border-sidebar-border/35 px-1.5 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
              {files.length} {files.length === 1 ? "item" : "items"}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-0 gap-y-0.5 text-[10px] font-normal leading-snug text-muted-foreground">
            {roleCounts.entries.map((e, i) => (
              <span key={e.key} className="whitespace-nowrap">
                {i > 0 ? (
                  <span className="text-muted-foreground/40" aria-hidden>
                    {" "}
                    ·{" "}
                  </span>
                ) : null}
                {e.label}{" "}
                <span className="tabular-nums text-foreground/90">{e.count}</span>
              </span>
            ))}
          </span>
        </span>
        <span className="neu-raised inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-sidebar-foreground">
          {open ? "Hide" : "View"}
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              open ? "rotate-180" : ""
            )}
            aria-hidden
          />
        </span>
      </button>
      {!open && hasIngestError && firstIngestError ? (
        <div
          className="mt-1.5 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[10px] font-semibold text-destructive">
              Ingest failed
            </p>
            {firstIngestErrorJob && !isHermesPrivateIngestJob(firstIngestErrorJob) ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/20 hover:text-foreground disabled:opacity-50"
                disabled={dismissBusyJobId === firstIngestErrorJob.jobId}
                onClick={(e) => {
                  e.stopPropagation();
                  void dismissSharedIngestError(firstIngestErrorJob);
                }}
                aria-label="Dismiss ingest failure"
              >
                <XIcon className="size-3" aria-hidden />
                Dismiss
              </button>
            ) : null}
          </div>
          <p className="text-[10px] leading-snug text-foreground/90 [overflow-wrap:anywhere]">
            {firstIngestError}
          </p>
          <p className="text-[9px] leading-snug text-muted-foreground">
            {ingestErrorFooterHint(firstIngestError)} Open <span className="font-medium">Files</span> below for
            per-file details.
          </p>
        </div>
      ) : !open && hasActiveIngest ? (
        <p className="mt-0.5 pl-0.5 text-[10px] font-medium text-foreground/90">
          {ingestJobs.some(isHermesPrivateIngestJob)
            ? "Hermes verifying — open "
            : "Hermes ingesting — open "}
          <span className="font-semibold">Files</span> for status.
        </p>
      ) : !open && showStaleGaps && workspaceIsShared && gapCount > 0 ? (
        <p className="mt-0.5 pl-0.5 text-[10px] text-muted-foreground">
          {gapCount} need ingest
        </p>
      ) : null}
      {open ? (
        <ul className="mt-1 max-h-[min(40dvh,14rem)] space-y-2 overflow-y-auto overscroll-contain pl-0">
          {files.length === 0 ? (
            <li className="list-none px-1 py-1 text-[10px] text-muted-foreground">
              No files
            </li>
          ) : null}
          {groupedFiles.map((g) => (
            <li key={g.roleKey} className="list-none">
              <p className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {g.label} ({g.items.length})
              </p>
              <ul className="space-y-1.5 pl-1">
                {g.items.map((item) => {
                  const f = item.primary;
                  const job = matchDisplayFileJob(item, ingestJobs);
                  const hint = workspaceIsShared
                    ? matchDisplayFileGapHint(item, hints)
                    : undefined;
                  const showStatus = Boolean(job && job.status !== "done");
                  const hermesErr =
                    Boolean(job) &&
                    isHermesPrivateIngestJob(job!) &&
                    job!.status === "error";
                  const showGapBadge =
                    !showStatus && hint && workspaceIsShared && hint.kind !== undefined;
                  const orbColors =
                    job && isHermesPrivateIngestJob(job)
                      ? CHAT_AGENT_ORB_COLORS
                      : ARCHITECT_ORB_COLORS;
                  const detail = job ? statusDetail(job) : null;
                  const progress =
                    job && !isHermesPrivateIngestJob(job)
                      ? ingestProgressPercent({
                          status: job.status,
                          phaseKey: job.phaseKey,
                          role: job.assetRole,
                          isQueuedWaiting: job.isQueuedWaiting,
                        })
                      : null;
                  return (
                    <li
                      key={item.key}
                      className={`flex min-w-0 items-start gap-2 rounded-md ${
                        showStatus || showGapBadge
                          ? job?.status === "error" || hermesErr
                            ? "border border-destructive/25 bg-destructive/5 py-2 pl-1 pr-1"
                            : "bg-sidebar/30 py-2 pl-1 pr-1"
                          : "py-0.5"
                      }`}
                    >
                      {showStatus ? (
	                        <div
	                          className="mt-0.5 size-9 shrink-0 sm:size-10"
	                          data-hermes-tip={
	                            job && isHermesPrivateIngestJob(job)
	                              ? "Hermes is verifying this file in your vault."
                              : "Hermes is ingesting this file into the shared vault."
                          }
                        >
                          <Orb
                            agentState={
                              job!.status === "running" ? "thinking" : "listening"
                            }
                            colors={orbColors}
                            className="size-full"
                          />
                        </div>
                      ) : showGapBadge ? (
                        <div className="mt-0.5 size-9 shrink-0 sm:size-10">
                          <Orb
                            agentState="listening"
                            colors={["#94a3b8", "#64748b"]}
                            className="size-full opacity-90"
                          />
                        </div>
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1">
                          <div className="neu-raised inline-flex min-w-0 flex-1 cursor-default items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-sidebar-foreground">
                            <span className="min-w-0 truncate">
                              {item.displayName}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
                              {item.duplicateLabel ?? formatBytes(f.size)}
                            </span>
                          </div>
                          <a
                            href={downloadHref(f.name)}
	                            download={f.name}
	                            className="neu-raised inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-sidebar-foreground"
	                            data-hermes-tip="Download this source file."
	                            aria-label={`Download ${f.name}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DownloadIcon className="size-3.5" aria-hidden />
                          </a>
                          {canOpenInBrowser(f.name) ? (
                            <a
                              href={openInBrowserHref(f.name)}
                              target="_blank"
	                              rel="noopener noreferrer"
	                              className="neu-raised inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-sidebar-foreground"
	                              data-hermes-tip="Open this file in the browser."
	                              aria-label={`Open ${f.name} in browser`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLinkIcon className="size-3.5" aria-hidden />
                            </a>
                          ) : null}
                          <button
	                            type="button"
	                            className="neu-raised inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-sidebar-foreground"
	                            data-hermes-tip="Re-sync, remove ingest outputs, or delete this upload."
	                            aria-label={`Actions for ${f.name}`}
                            onClick={() => setActionFile(f)}
                          >
                            <MoreHorizontalIcon className="size-3.5" aria-hidden />
                          </button>
                        </div>
                        {showStatus ? (
                          <>
                            <p
                              className={
                                job!.status === "error"
                                  ? "pl-0.5 text-[10px] leading-snug text-destructive"
                                  : "pl-0.5 text-[10px] leading-snug text-muted-foreground"
                              }
                            >
                              <span
                                className={
                                  job!.status === "error" || hermesErr
                                    ? "font-semibold text-destructive"
                                    : "font-medium text-foreground/90"
                                }
                              >
                                {job!.status === "error" || hermesErr
                                  ? "Ingest failed"
                                  : isHermesPrivateIngestJob(job!)
                                    ? "Hermes verifying"
                                    : "Hermes ingesting"}
                              </span>
                              {" · "}
                              <span
                                className={
                                  job!.status === "error"
                                    ? "text-foreground/95"
                                    : undefined
                                }
                              >
                                {statusSubtitle(job!)}
                              </span>
                              {progress !== null ? (
                                <span className="text-sidebar-primary">
                                  {" "}
                                  · {progress}%
                                </span>
                              ) : null}
                              {progress !== null ? (
                                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-sidebar-border/25">
                                  <span
                                    className="block h-full rounded-full bg-sidebar-primary transition-[width] duration-700"
                                    style={{ width: `${progress}%` }}
                                  />
                                </span>
                              ) : null}
                              {detail ? (
                                <span className="mt-0.5 block text-[9px] font-normal text-muted-foreground">
                                  Right now: {detail}
                                </span>
                              ) : null}
                              {(job!.status === "error" || hermesErr) &&
                              job!.errorMessage?.trim() ? (
                                <span className="mt-0.5 block text-[9px] font-normal text-muted-foreground">
                                  {ingestErrorFooterHint(job!.errorMessage)}
                                </span>
                              ) : null}
                            </p>
                            {job!.status === "error" && !isHermesPrivateIngestJob(job!) ? (
                              <button
                                type="button"
                                className="ml-0.5 mt-0.5 inline-flex w-fit items-center gap-1 rounded-md border border-sidebar-border/25 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/20 hover:text-foreground disabled:opacity-50"
                                disabled={dismissBusyJobId === job!.jobId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void dismissSharedIngestError(job!);
                                }}
                              >
                                <XIcon className="size-3" aria-hidden />
                                Dismiss failure
                              </button>
                            ) : null}
                          </>
                        ) : showGapBadge ? (
                          <p className="pl-0.5 text-[10px] leading-snug text-muted-foreground">
                            {gapHintLabel(hint!)}
                            {hint?.detail
                              ? ` — ${hint.detail.slice(0, 100)}${hint.detail.length > 100 ? "…" : ""}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      <VaultFileActionsDialog
        open={actionFile !== null}
        projectSlug={projectSlug}
        workspaceSessionId={workspaceSessionId}
        file={actionFile}
        workspaceIsShared={workspaceIsShared}
        onClose={() => setActionFile(null)}
        onAfterChange={() => {
          onVaultRefresh?.();
        }}
        onReingestQueued={onReingestQueued}
        onPrivateReingestStarted={onPrivateReingestStarted}
      />
    </div>
  );
}
