"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  Filter,
  Globe2,
  Mail,
  MonitorPlay,
  PencilLine,
  Presentation,
  RotateCcw,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { ChatHeader } from "@/components/chat-header";
import { BuildEmailSendButton } from "@/components/BuildEmailSendButton";
import { CreateStudioIntentDialog } from "@/components/CreateStudioIntentDialog";
import { DeletePublishedAppDialog } from "@/components/DeletePublishedAppDialog";
import { Orb } from "@/components/ui/orb";
import { useChatIdentity } from "@/ChatIdentity";
import type { CreativeStudioIntent } from "@/lib/creative-studio-session";
import type { CreateProductionBrief } from "@/lib/create-production-types";
import { getOrbHelper } from "@/lib/helper-suggestions";
import {
  CREATIVE_STUDIO_DRAFT_INITIAL_KEY,
  type CreativeStudioDraftInitialPayload,
} from "@/lib/creative-studio-draft-send";

type BuildApp = {
  id: string;
  name: string;
  description?: string;
  openUrl: string;
  emailHtmlUrl?: string | null;
  emailComposeUrl?: string | null;
  path?: string | null;
  appFolder?: string | null;
  gatewayAppDir?: string | null;
  thumbnailUrl?: string | null;
  thumbnailKind?: "image" | "fallback";
  createdAt?: number | null;
  updatedAt?: number | null;
};

type ArchivedBuildApp = {
  id: string;
  name: string;
  description?: string;
  path: string | null;
  appFolder: string;
  archivedAt: string;
  archiveFile: string;
  originalBytes: number;
  archiveBytes: number;
  compressionRatio: number;
};

type ArchiveNotice = {
  name: string;
  originalBytes: number;
  archiveBytes: number;
  compressionRatio: number;
};

type BuildTypeId = "website" | "pdf" | "deck" | "image" | "email" | "web-app";
type BuildTypeFilter = BuildTypeId | "all";

type BuildTypeMeta = {
  id: BuildTypeId;
  label: string;
  Icon: LucideIcon;
};

const BUILD_TYPE_FILTER_STORAGE_KEY = "hermeschat-builds-type-filter";
const BUILD_TYPE_FILTERS: { id: BuildTypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "website", label: "Website" },
  { id: "pdf", label: "PDF" },
  { id: "deck", label: "Slide deck" },
  { id: "image", label: "Image" },
  { id: "email", label: "Email" },
  { id: "web-app", label: "Web app" },
];

function inferBuildType(app: BuildApp): BuildTypeMeta {
  const haystack = `${app.name} ${app.description ?? ""} ${app.path ?? ""}`.toLowerCase();
  if (/\b(email|newsletter|mail)\b/.test(haystack)) {
    return { id: "email", label: "Email", Icon: Mail };
  }
  if (/\b(pdf|bio|document)\b/.test(haystack)) {
    return { id: "pdf", label: "PDF", Icon: FileText };
  }
  if (/\b(deck|slide|presentation)\b/.test(haystack)) {
    return { id: "deck", label: "Slide deck", Icon: Presentation };
  }
  if (/\b(image|poster|visual|graphic)\b/.test(haystack)) {
    return { id: "image", label: "Image", Icon: FileImage };
  }
  if (/\b(app|timer|tool)\b/.test(haystack)) {
    return { id: "web-app", label: "Web app", Icon: MonitorPlay };
  }
  return { id: "website", label: "Website", Icon: Globe2 };
}

function buildOpenHref(app: BuildApp): string {
  return `/chat/builds/open/${encodeURIComponent(app.id)}`;
}

function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstTwo = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return firstTwo.join("") || "H";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatReduction(ratio: number): string {
  const pct = Math.max(0, Math.min(99, Math.round(ratio * 100)));
  return `${pct}% smaller`;
}

function formatCardTimestamp(ms?: number | null): string {
  if (!ms || !Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function navigateToWebchatSession(router: ReturnType<typeof useRouter>, sessionId: string) {
  const k = `webchat:${sessionId}`;
  window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
  router.push(
    `/chat/${encodeURIComponent(sessionId)}?k=${encodeURIComponent(k)}`
  );
}

export default function BuildsPage() {
  const router = useRouter();
  const { agentName } = useChatIdentity();
  const [apps, setApps] = useState<BuildApp[] | null>(null);
  const [archivedApps, setArchivedApps] = useState<ArchivedBuildApp[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editBusyId, setEditBusyId] = useState<string | null>(null);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BuildApp | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | null>(null);
  const [typeFilter, setTypeFilter] = useState<BuildTypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [createStudioOpen, setCreateStudioOpen] = useState(false);
  const [createStudioBusy, setCreateStudioBusy] = useState(false);

  async function loadBuildData() {
    const [buildsResult, archiveResult] = await Promise.allSettled([
      fetch("/api/builds", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json()) as {
          apps?: BuildApp[];
          loadError?: string;
        };
        if (typeof d.loadError === "string" && d.loadError) {
          setLoadError(d.loadError);
        }
        return Array.isArray(d.apps) ? d.apps : [];
      }),
      fetch("/api/builds/archive", { cache: "no-store" }).then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as {
          apps?: ArchivedBuildApp[];
          error?: string;
        };
        if (!r.ok) {
          throw new Error(d.error || "Could not load archive");
        }
        return Array.isArray(d.apps) ? d.apps : [];
      })
    ]);
    if (buildsResult.status === "fulfilled") {
      setApps(buildsResult.value);
    } else {
      setApps([]);
      setLoadError("Could not load builds");
    }
    if (archiveResult.status === "fulfilled") {
      setArchivedApps(archiveResult.value);
    }
  }

  useEffect(() => {
    void loadBuildData().catch(() => {
        setLoadError("Could not load builds");
        setApps([]);
      });
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(BUILD_TYPE_FILTER_STORAGE_KEY);
      if (BUILD_TYPE_FILTERS.some((f) => f.id === stored)) {
        setTypeFilter(stored as BuildTypeFilter);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BUILD_TYPE_FILTER_STORAGE_KEY, typeFilter);
    } catch {
      /* ignore */
    }
  }, [typeFilter]);

  async function startEdit(appId: string) {
    setEditBusyId(appId);
    setLoadError(null);
    try {
      const r = await fetch("/api/builds/edit-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: appId }),
      });
      const d = (await r.json()) as { sessionId?: string; error?: string };
      if (!r.ok) {
        throw new Error(
          typeof d.error === "string" ? d.error : "Could not start edit"
        );
      }
      const sid = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
      if (!sid) throw new Error("Invalid response");
      navigateToWebchatSession(router, sid);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not start edit session"
      );
    } finally {
      setEditBusyId(null);
    }
  }

  async function archiveBuild(app: BuildApp) {
    if (archiveBusyId) return;
    setArchiveBusyId(app.id);
    setLoadError(null);
    try {
      const r = await fetch("/api/builds/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        app?: ArchivedBuildApp;
        error?: string;
      };
      if (!r.ok || !d.app) {
        throw new Error(d.error || "Could not archive");
      }
      setArchiveNotice({
        name: d.app.name,
        originalBytes: d.app.originalBytes,
        archiveBytes: d.app.archiveBytes,
        compressionRatio: d.app.compressionRatio,
      });
      await loadBuildData();
      window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not archive");
    } finally {
      setArchiveBusyId(null);
    }
  }

  async function restoreBuild(app: ArchivedBuildApp) {
    if (restoreBusyId) return;
    setRestoreBusyId(app.id);
    setLoadError(null);
    try {
      const r = await fetch(
        `/api/builds/archive/${encodeURIComponent(app.id)}/restore`,
        { method: "POST" }
      );
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        throw new Error(d.error || "Could not restore");
      }
      await loadBuildData();
      window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not restore");
    } finally {
      setRestoreBusyId(null);
    }
  }

  async function startCreativeStudioSession(
    intent: CreativeStudioIntent,
    hint: string,
    referenceVault: { slug: string; name: string } | null,
    createBrief?: CreateProductionBrief
  ) {
    if (createStudioBusy) return;
    setCreateStudioBusy(true);
    setLoadError(null);
    try {
      const hintTrim = hint.trim();
      const r = await fetch("/api/builds/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          ...(hintTrim ? { seedPrompt: hintTrim } : {}),
          ...(createBrief ? { createBrief } : {}),
          ...(referenceVault
            ? {
                referenceVaultSlug: referenceVault.slug,
                referenceVaultName: referenceVault.name,
              }
            : {}),
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!r.ok) {
        throw new Error(
          typeof d.error === "string"
            ? d.error
            : "Could not start create session"
        );
      }
      const sid = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
      if (!sid) throw new Error("Invalid response");
      if (hintTrim && typeof window !== "undefined") {
        const pending: CreativeStudioDraftInitialPayload = {
          sessionId: sid,
          nonce: crypto.randomUUID(),
          text: hintTrim,
        };
        sessionStorage.setItem(
          CREATIVE_STUDIO_DRAFT_INITIAL_KEY,
          JSON.stringify(pending)
        );
      }
      setCreateStudioOpen(false);
      navigateToWebchatSession(router, sid);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not start create session"
      );
    } finally {
      setCreateStudioBusy(false);
    }
  }

  const loading = apps === null;
  const selectedFilterLabel =
    BUILD_TYPE_FILTERS.find((f) => f.id === typeFilter)?.label ?? "All";
  const sortedApps = apps
    ? [...apps].sort((a, b) => {
        const aType = typeFilter !== "all" && inferBuildType(a).id === typeFilter;
        const bType = typeFilter !== "all" && inferBuildType(b).id === typeFilter;
        if (aType !== bType) return aType ? -1 : 1;
        return (
          (b.updatedAt ?? b.createdAt ?? 0) -
          (a.updatedAt ?? a.createdAt ?? 0)
        );
      })
    : null;

  return (
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
      <ChatHeader
        title="Create"
        subline="Things you've published — open in a new tab, download a ZIP, or edit in chat"
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-5 lg:px-7">
        {!loading ? (
          <div className="mb-4 flex w-full flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className={`neu-raised inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground ${
                archiveOpen ? "text-sidebar-primary" : ""
              }`}
            >
              <Archive className="size-4 shrink-0 text-sidebar-primary" aria-hidden />
              <span>{archiveOpen ? "Hide archive" : "View archive"}</span>
              {archivedApps.length > 0 ? (
                <span className="rounded-md bg-[var(--sidebar-depth-input)] px-1.5 py-0.5 text-[0.68rem] text-sidebar-primary">
                  {archivedApps.length}
                </span>
              ) : null}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className={`neu-raised inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground ${
                  typeFilter !== "all" ? "text-sidebar-primary" : ""
                }`}
              >
                <Filter className="size-4 shrink-0 text-sidebar-primary" aria-hidden />
                <span>{typeFilter === "all" ? "Newest" : `${selectedFilterLabel} first`}</span>
              </button>
              {filterOpen ? (
                <div className="absolute right-0 z-30 mt-2 w-44 rounded-lg border border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] p-1.5 shadow-2xl">
                  {BUILD_TYPE_FILTERS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setTypeFilter(option.id);
                        setFilterOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-medium ${
                        typeFilter === option.id
                          ? "bg-sidebar-accent/20 text-sidebar-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/15 hover:text-sidebar-foreground"
                      }`}
                    >
                      <span>{option.label}</span>
                      {typeFilter === option.id ? (
                        <span className="size-1.5 rounded-full bg-sidebar-primary" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
            <div className="relative size-64 shrink-0">
              <Orb
                agentState="thinking"
                colors={["#a3c4f3", "#6b8cce"]}
                className="size-full"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Let me get that for you.
            </p>
          </div>
        ) : apps.length === 0 && !archiveOpen ? (
          <div className="flex max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex-1 flex-col items-center justify-center gap-5 px-6 py-8">
            <div className="relative size-64">
              <Orb
                agentState="listening"
                colors={["#a3c4f3", "#6b8cce"]}
                className="size-full"
              />
            </div>
            <div className="max-w-md text-center">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                I&apos;m {agentName}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Create websites, PDFs, slide decks, docs, images, and emails from
                a short brief. Add files, images, or people when they help shape
                the result.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getOrbHelper({ surface: "builds-empty" })}
              </p>
              <button
                type="button"
                onClick={() => router.push("/chat")}
                className="neu-raised mt-6 rounded-full px-5 py-2.5 text-sm font-medium text-sidebar-foreground"
              >
                Start in chat
              </button>
              {loadError ? (
                <p className="mt-4 text-xs text-destructive/90">
                  {loadError}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="w-full">
            {loadError ? (
              <p className="mb-4 text-center text-xs text-destructive/90">
                {loadError}
              </p>
            ) : null}
            {archiveOpen ? (
              <section className="neu-raised mb-4 rounded-lg border border-sidebar-border/20 bg-[var(--sidebar-depth-canvas)] p-3">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Archive
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Compressed creations live here until you restore them.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setArchiveOpen(false)}
                    className="neu-raised inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-sidebar-foreground"
                    aria-label="Hide archive"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                {archivedApps.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-sidebar-border/30 px-3 py-5 text-center text-xs text-muted-foreground">
                    Nothing archived yet.
                  </div>
                ) : (
                  <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {archivedApps.map((app) => (
                      <li
                        key={app.id}
                        className="rounded-lg border border-sidebar-border/25 bg-black/10 p-3"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-foreground">
                              {app.name}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatBytes(app.originalBytes)} to{" "}
                              {formatBytes(app.archiveBytes)} ·{" "}
                              {formatReduction(app.compressionRatio)}
                            </p>
                          </div>
                          <span className="shrink-0 text-[0.68rem] uppercase text-sidebar-primary/80">
                            Archived
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={restoreBusyId === app.id}
                            onClick={() => void restoreBuild(app)}
                            className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground disabled:opacity-60"
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                            {restoreBusyId === app.id ? "..." : "Restore"}
                          </button>
                          <a
                            href={`/api/builds/archive/${encodeURIComponent(app.id)}/download`}
                            className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground"
                          >
                            <Download className="size-3.5" aria-hidden />
                            Download
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
            {apps.length === 0 ? (
              <div className="rounded-lg border border-sidebar-border/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No live creations. Restore one from the archive or make a new one.
              </div>
            ) : (
            <ul className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {(sortedApps ?? []).map((app) => {
                const canZip = Boolean(app.appFolder);
                const typeMeta = inferBuildType(app);
                const TypeIcon = typeMeta.Icon;
                const createdLabel = formatCardTimestamp(app.createdAt);
                return (
                  <li
                    key={app.id}
                    className="neu-raised group flex min-h-[10rem] flex-col rounded-lg border border-sidebar-border/20 bg-[var(--sidebar-depth-canvas)] p-3 transition-colors hover:border-sidebar-primary/25"
                  >
                    <div className="flex min-w-0 gap-3">
                      <div className="relative flex h-20 w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/20">
                        {app.thumbnailUrl ? (
                          <img
                            src={app.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[var(--sidebar-depth-input)]">
                            <span className="text-lg font-semibold text-sidebar-primary/85">
                              {initialsFor(app.name)}
                            </span>
                          </div>
                        )}
                        <div className="absolute bottom-1.5 left-1.5 rounded-md border border-white/10 bg-black/45 p-1 text-white/85 backdrop-blur">
                          <TypeIcon className="size-3.5" aria-hidden />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                            {app.name}
                          </h3>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[0.68rem] font-medium uppercase text-sidebar-primary/80">
                              {typeMeta.label}
                            </span>
                            <div className="flex items-center gap-1">
                              {canZip ? (
                                <button
                                  type="button"
                                  disabled={archiveBusyId === app.id}
                                  onClick={() => void archiveBuild(app)}
                                  className="inline-flex items-center gap-1 rounded-md border border-sidebar-border/25 bg-black/10 px-1.5 py-1 text-[0.68rem] font-medium text-muted-foreground hover:border-sidebar-primary/25 hover:text-sidebar-foreground disabled:opacity-50"
                                >
                                  <Archive className="size-3" aria-hidden />
                                  <span>
                                    {archiveBusyId === app.id ? "..." : "Archive"}
                                  </span>
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={deleteTarget?.id === app.id}
                                onClick={() => setDeleteTarget(app)}
                                className="inline-flex size-7 items-center justify-center rounded-md border border-sidebar-border/25 bg-black/10 text-muted-foreground hover:border-red-400/35 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                                aria-label={`Delete ${app.name}`}
                                data-hermes-tip="Delete this creation permanently."
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </button>
                            </div>
                          </div>
                        </div>
                        {app.description ? (
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {app.description}
                          </p>
                        ) : null}
                        {createdLabel ? (
                          <p className="mt-2 text-[0.68rem] leading-none text-muted-foreground/75">
                            Created {createdLabel}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-auto grid min-w-0 grid-cols-4 gap-2 pt-3">
                      <a
                        href={buildOpenHref(app)}
                        className="neu-raised col-span-2 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground"
                      >
                        <ExternalLink
                          className="size-3.5 shrink-0 opacity-85"
                          aria-hidden
                        />
                        Open
                      </a>
                      <button
                        type="button"
                        disabled={editBusyId === app.id}
                        onClick={() => void startEdit(app.id)}
                        className="neu-raised col-span-1 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-sidebar-foreground disabled:opacity-60"
                        aria-label={`Edit ${app.name}`}
                      >
                        <PencilLine
                          className="size-3.5 shrink-0 opacity-85"
                          aria-hidden
                        />
                        <span className="truncate">
                          {editBusyId === app.id ? "..." : "Edit"}
                        </span>
                      </button>
                      {canZip ? (
                        app.emailHtmlUrl ? (
                          <BuildEmailSendButton
                            buildId={app.id}
                            name={app.name}
                            className="neu-raised col-span-1 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-sidebar-foreground"
                          >
                            <Mail
                              className="size-3.5 shrink-0 opacity-85"
                              aria-hidden
                            />
                            <span className="truncate">Send</span>
                          </BuildEmailSendButton>
                        ) : (
                          <a
                            href={`/api/builds/download?id=${encodeURIComponent(app.id)}`}
                            className="neu-raised col-span-1 inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-sidebar-foreground"
                            aria-label={`Download ${app.name}`}
                          >
                            <Download
                              className="size-3.5 shrink-0 opacity-85"
                              aria-hidden
                            />
                            <span className="truncate">Download</span>
                          </a>
                        )
                      ) : (
                        <span aria-hidden className="col-span-1" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        )}
      </div>
      {archiveNotice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-complete-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setArchiveNotice(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-sidebar-primary/25 bg-[var(--sidebar-depth-canvas)] p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="neu-raised flex size-10 shrink-0 items-center justify-center rounded-lg text-sidebar-primary">
                <Archive className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id="archive-complete-title"
                  className="text-base font-semibold text-foreground"
                >
                  Archived {archiveNotice.name}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Reduced from {formatBytes(archiveNotice.originalBytes)} to{" "}
                  {formatBytes(archiveNotice.archiveBytes)} (
                  {formatReduction(archiveNotice.compressionRatio)}). Use{" "}
                  <span className="font-medium text-foreground">View archive</span>{" "}
                  and press{" "}
                  <span className="font-medium text-foreground">Restore</span>{" "}
                  to bring it back.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setArchiveNotice(null)}
              className="neu-raised mt-5 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground"
            >
              Okay
            </button>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <DeletePublishedAppDialog
          open
          buildId={deleteTarget.id}
          name={deleteTarget.name}
          title="Delete creation?"
          confirmLabel="Delete creation"
          description={
            <>
              <span className="font-medium text-foreground">
                {deleteTarget.name}
              </span>{" "}
              will be removed from Create, its local files will be deleted if
              it has them, and linked Create / Edit chats will be removed. Use
              Archive instead if you might want it back. This cannot be undone.
            </>
          }
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setApps((prev) =>
              prev ? prev.filter((app) => app.id !== deleteTarget.id) : prev
            );
            void loadBuildData();
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
          }}
        />
      ) : null}
      <CreateStudioIntentDialog
        open={createStudioOpen}
        busy={createStudioBusy}
        onCancel={() => !createStudioBusy && setCreateStudioOpen(false)}
        onContinue={(intent, hint, ref, createBrief) =>
          void startCreativeStudioSession(intent, hint, ref, createBrief)
        }
      />
    </div>
  );
}
