"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useParams, usePathname } from "next/navigation";
import {
  PlusIcon,
  MessageSquareIcon,
  SearchIcon,
  XIcon,
  ClockIcon,
  ImageIcon,
  FolderIcon,
  ChevronDownIcon,
  Layers,
} from "lucide-react";
import {
  fetchChatSessions,
  searchSessions,
  type ChatSession,
  PENDING_HERMESCHAT_SUMMARIZE_KEY,
  HERMESCHAT_SUMMARIZE_PROMPT,
  HERMESCHAT_SUMMARIZE_EVENT,
} from "@/lib/sessions";
import { useSidebar } from "@/app/chat/layout";
import { Orb } from "@/components/ui/orb";
import {
  WORKSPACES_UPDATED_EVENT,
  notifyWorkspacesUpdated,
} from "@/lib/workspace-events";
import { CreateStudioIntentDialog } from "@/components/CreateStudioIntentDialog";
import { RenameChatDialog } from "@/components/RenameChatDialog";
import { RenameVaultDialog } from "@/components/RenameVaultDialog";
import { DeleteVaultDialog } from "@/components/DeleteVaultDialog";
import { RenamePublishedAppDialog } from "@/components/RenamePublishedAppDialog";
import { DeletePublishedAppDialog } from "@/components/DeletePublishedAppDialog";
import { OrphanChatsPurgeDialog } from "@/components/OrphanChatsPurgeDialog";
import { useLongPressOrClick } from "@/lib/use-long-press-or-click";
import { ARCHITECT_ORB_COLORS } from "@/lib/architect-orb-presets";
import type {
  ChatProcessingSurface,
  SessionProcessingKind,
} from "@/lib/sessions";
import type { CreativeStudioIntent } from "@/lib/creative-studio-session";
import type { CreateProductionBrief } from "@/lib/create-production-types";
import {
  CREATIVE_STUDIO_DRAFT_INITIAL_KEY,
  type CreativeStudioDraftInitialPayload,
} from "@/lib/creative-studio-draft-send";

type WorkspaceRow = {
  slug: string;
  name: string;
  visibility: "private" | "shared";
};

type WorkspaceChatRow = {
  id: string;
  key: string;
  label: string;
  updatedAt: number;
  processing?: boolean;
  processingKind?: SessionProcessingKind;
};

const DEFAULT_ORB: [string, string] = ["#a3c4f3", "#6b8cce"];

function orbColorsFor(
  processing: boolean,
  kind: SessionProcessingKind | undefined
): [string, string] {
  if (!processing) return DEFAULT_ORB;
  return kind === "architect" ? ARCHITECT_ORB_COLORS : DEFAULT_ORB;
}

const EMPTY_PROCESSING: ChatProcessingSurface = {
  byWebchatId: {},
  hasMain: false,
  hasBuilds: false,
  vaults: {},
  mainProcessingWebchatIds: [],
  buildsProcessingWebchatIds: [],
  vaultProcessingWebchatIds: [],
};

function sidebarTabFromPath(
  pathname: string | null | undefined
): "chats" | "vault" | "builds" {
  const p = pathname || "";
  if (p.startsWith("/chat/builds")) return "builds";
  if (p.startsWith("/chat/workspace/")) return "vault";
  return "chats";
}

function tabPipClass(architect: boolean): string {
  return `ml-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full shadow-sm ${
    architect
      ? "bg-gradient-to-br from-amber-300 to-amber-600"
      : "bg-sidebar-primary"
  }`;
}

const RENAME_ROW_HINT = "Double-click or long-press to rename";
const VAULT_ROW_HINT = "Long-press to rename · double-click to delete";
const MANIFEST_APP_IDS_STORAGE_KEY = "hermeschat-manifest-app-ids";

function SidebarPressableChatRow({
  className,
  onNavigate,
  onRename,
  children,
}: {
  className: string;
  onNavigate: () => void;
  onRename: () => void;
  children: ReactNode;
}) {
  const press = useLongPressOrClick({
    onLongPress: onRename,
    onShortClick: onNavigate,
  });
  return (
    <button
      type="button"
      data-hermes-tip={RENAME_ROW_HINT}
      className={className}
      {...press}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRename();
      }}
    >
      {children}
    </button>
  );
}

export function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const activeId = params?.sessionId as string | undefined;
  const { close, setWorkspaceZeroHero, workspaceZeroHero } = useSidebar();
  const [sidebarTab, setSidebarTab] = useState<"chats" | "vault" | "builds">(
    () => sidebarTabFromPath(pathname)
  );
  const sidebarTabRef = useRef(sidebarTab);
  sidebarTabRef.current = sidebarTab;
  const isBuildsRoute = pathname.startsWith("/chat/builds");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [buildEditSessions, setBuildEditSessions] = useState<ChatSession[]>(
    []
  );
  const [creativeStudioSessions, setCreativeStudioSessions] = useState<
    ChatSession[]
  >([]);
  const [processingSurface, setProcessingSurface] =
    useState<ChatProcessingSurface>(EMPTY_PROCESSING);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsVisibility, setNewWsVisibility] = useState<"private" | "shared">(
    "private"
  );
  const [creatingWs, setCreatingWs] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSession[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedWorkspaceSlug, setExpandedWorkspaceSlug] = useState<string | null>(
    null
  );
  const expandedWorkspaceSlugRef = useRef<string | null>(null);
  expandedWorkspaceSlugRef.current = expandedWorkspaceSlug;
  const [workspaceChatsBySlug, setWorkspaceChatsBySlug] = useState<
    Record<string, WorkspaceChatRow[]>
  >({});
  const [workspaceChatsLoading, setWorkspaceChatsLoading] = useState<string | null>(
    null
  );
  const [renameTarget, setRenameTarget] = useState<{
    sessionId: string;
    sessionKey: string;
    label: string;
  } | null>(null);
  const [vaultRename, setVaultRename] = useState<{
    slug: string;
    name: string;
  } | null>(null);
  const [vaultDelete, setVaultDelete] = useState<{
    slug: string;
    name: string;
    visibility: "private" | "shared";
  } | null>(null);
  /** Debounce single-click “open vault” so double-click can still open delete dialog. */
  const vaultOpenNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultRowLongRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultRowSuppressRef = useRef(false);
  const vaultRowLpStart = useRef({ x: 0, y: 0 });
  const [buildManifestApps, setBuildManifestApps] = useState<
    { id: string; name: string; updatedAt: number }[] | null
  >(null);
  const [buildsManifestLoading, setBuildsManifestLoading] = useState(false);
  const [expandedBuildId, setExpandedBuildId] = useState<string | null>(null);
  /** Draft create session (creative_studio, not yet linked to a manifest app). */
  const [expandedDraftSessionId, setExpandedDraftSessionId] = useState<
    string | null
  >(null);
  /** buildId or synthetic key for chats not on the current manifest. */
  const [expandedOrphanGroupKey, setExpandedOrphanGroupKey] = useState<
    string | null
  >(null);
  const [buildEditBusyId, setBuildEditBusyId] = useState<string | null>(null);
  const [createStudioOpen, setCreateStudioOpen] = useState(false);
  const [createStudioBusy, setCreateStudioBusy] = useState(false);
  const [publishedAppRenameTarget, setPublishedAppRenameTarget] = useState<{
    buildId: string;
    name: string;
  } | null>(null);
  const [publishedAppDeleteTarget, setPublishedAppDeleteTarget] = useState<{
    buildId: string;
    name: string;
  } | null>(null);
  const [orphanNoidPurgeTarget, setOrphanNoidPurgeTarget] = useState<{
    label: string;
    sessions: ChatSession[];
  } | null>(null);
  /** Debounce expand toggle so double-click can open rename/delete dialogs. */
  const publishedFolderToggleTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRefreshInFlightRef = useRef(false);
  const workspaceChatsInFlightRef = useRef<Set<string>>(new Set());
  const [newVaultPortalEl, setNewVaultPortalEl] = useState<Element | null>(null);

  const loadWorkspaces = useCallback(() => {
    setWsLoading(true);
    setWsError(null);
    void fetch("/api/projects")
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error || "Could not load your vaults");
        }
        return r.json() as Promise<WorkspaceRow[]>;
      })
      .then((rows) =>
        setWorkspaces(
          rows.map((r) => ({
            slug: r.slug,
            name: r.name,
            visibility: r.visibility === "shared" ? "shared" : "private",
          }))
        )
      )
      .catch((e: unknown) =>
        setWsError(e instanceof Error ? e.message : "Error")
      )
      .finally(() => setWsLoading(false));
  }, []);

  const loadWorkspaceChats = useCallback(async (slug: string) => {
    if (workspaceChatsInFlightRef.current.has(slug)) return;
    workspaceChatsInFlightRef.current.add(slug);
    setWorkspaceChatsLoading(slug);
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/chats`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const d = (await r.json()) as { sessions?: WorkspaceChatRow[] };
      setWorkspaceChatsBySlug((prev) => ({
        ...prev,
        [slug]: d.sessions ?? [],
      }));
    } finally {
      workspaceChatsInFlightRef.current.delete(slug);
      setWorkspaceChatsLoading((s) => (s === slug ? null : s));
    }
  }, []);

  const loadBuildManifestApps = useCallback(async () => {
    setBuildsManifestLoading(true);
    try {
      const r = await fetch("/api/builds", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { apps?: unknown };
      const raw = Array.isArray(d.apps) ? d.apps : [];
      const apps = raw
        .map((a) => {
          const o = a as {
            id?: unknown;
            name?: unknown;
            updatedAt?: unknown;
            createdAt?: unknown;
          };
          const updatedAt =
            typeof o.updatedAt === "number"
              ? o.updatedAt
              : typeof o.createdAt === "number"
                ? o.createdAt
                : 0;
          return {
            id: typeof o.id === "string" ? o.id : String(o.id ?? ""),
            name: typeof o.name === "string" ? o.name : "Build",
            updatedAt,
          };
        })
        .filter((app) => app.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setBuildManifestApps(apps);
    } catch {
      setBuildManifestApps([]);
    } finally {
      setBuildsManifestLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (sidebarRefreshInFlightRef.current) return;
    sidebarRefreshInFlightRef.current = true;
    fetchChatSessions()
      .then(
        ({
          sessions,
          buildEditSessions: be,
          creativeStudioSessions: cs,
          processingSurface: ps,
        }) => {
          setSessions(sessions);
          setBuildEditSessions(be);
          setCreativeStudioSessions(cs);
          setProcessingSurface(ps);
          const slug = expandedWorkspaceSlugRef.current;
          if (slug) void loadWorkspaceChats(slug);
          if (sidebarTabRef.current === "builds") {
            void loadBuildManifestApps();
          }
        }
      )
      .finally(() => {
        sidebarRefreshInFlightRef.current = false;
      });
  }, [loadBuildManifestApps, loadWorkspaceChats]);

  function clearPublishedFolderToggleTimer() {
    if (publishedFolderToggleTimerRef.current) {
      clearTimeout(publishedFolderToggleTimerRef.current);
      publishedFolderToggleTimerRef.current = null;
    }
  }

  const onPublishedAppHeaderClick = useCallback(
    (app: { id: string; name: string }) => (e: React.MouseEvent) => {
      if (e.detail !== 1) return;
      clearPublishedFolderToggleTimer();
      publishedFolderToggleTimerRef.current = setTimeout(() => {
        publishedFolderToggleTimerRef.current = null;
        setExpandedDraftSessionId(null);
        setExpandedOrphanGroupKey(null);
        setExpandedBuildId((cur) => (cur === app.id ? null : app.id));
      }, 300);
    },
    []
  );

  const onPublishedAppHeaderDoubleClick = useCallback(
    (app: { id: string; name: string }) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearPublishedFolderToggleTimer();
      setPublishedAppRenameTarget({ buildId: app.id, name: app.name });
    },
    []
  );

  type OrphanGroupRow = {
    key: string;
    label: string;
    sessions: ChatSession[];
  };

  const onOrphanGroupHeaderClick = useCallback(
    (g: OrphanGroupRow) => (e: React.MouseEvent) => {
      if (e.detail !== 1) return;
      clearPublishedFolderToggleTimer();
      publishedFolderToggleTimerRef.current = setTimeout(() => {
        publishedFolderToggleTimerRef.current = null;
        setExpandedBuildId(null);
        setExpandedDraftSessionId(null);
        setExpandedOrphanGroupKey((cur) => (cur === g.key ? null : g.key));
      }, 300);
    },
    []
  );

  const onOrphanGroupHeaderDoubleClick = useCallback(
    (g: OrphanGroupRow) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearPublishedFolderToggleTimer();
      if (g.key.startsWith("noid:")) {
        setOrphanNoidPurgeTarget({ label: g.label, sessions: g.sessions });
        return;
      }
      setPublishedAppDeleteTarget({ buildId: g.key, name: g.label });
    },
    []
  );

  useEffect(() => {
    refresh();
  }, [activeId, refresh]);

  useEffect(() => {
    setNewVaultPortalEl(document.body);
  }, []);

  /** Keep vault row expanded in the sidebar when viewing vault draft home. */
  useEffect(() => {
    const p = pathname || "";
    const m = p.match(/^\/chat\/workspace\/([^/]+)\/draft\/?$/);
    if (m) {
      setSidebarTab("vault");
      const slug = decodeURIComponent(m[1]);
      setExpandedWorkspaceSlug(slug);
      void loadWorkspaceChats(slug);
    }
  }, [pathname, loadWorkspaceChats]);

  useEffect(() => {
    const zero =
      sidebarTab === "vault" &&
      !wsLoading &&
      !wsError &&
      workspaces.length === 0;
    setWorkspaceZeroHero(zero);
    return () => {
      setWorkspaceZeroHero(false);
    };
  }, [
    sidebarTab,
    wsLoading,
    wsError,
    workspaces.length,
    setWorkspaceZeroHero,
  ]);

  /** When viewing the published-apps page, use the Builds tab in the sidebar. */
  useEffect(() => {
    if (isBuildsRoute) {
      setSidebarTab("builds");
    }
  }, [isBuildsRoute]);

  /** Build-edit sessions use the Builds tab; vault sessions use the Vault tab. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(activeId)}`,
          { cache: "no-store" }
        );
        if (!r.ok || cancelled) return;
        const d = (await r.json().catch(() => ({}))) as {
          projectId?: string | null;
          chatType?: string | null;
          error?: string;
        };
        if (cancelled || d.error) return;
        if (d.chatType === "build_edit" || d.chatType === "creative_studio") {
          setSidebarTab("builds");
          return;
        }
        const pid =
          typeof d.projectId === "string" && d.projectId.trim()
            ? d.projectId.trim()
            : null;
        if (pid) setSidebarTab("vault");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (sidebarTab === "vault") loadWorkspaces();
  }, [sidebarTab, loadWorkspaces]);

  useEffect(() => {
    function onVaultListRefresh() {
      loadWorkspaces();
    }
    window.addEventListener(WORKSPACES_UPDATED_EVENT, onVaultListRefresh);
    return () =>
      window.removeEventListener(WORKSPACES_UPDATED_EVENT, onVaultListRefresh);
  }, [loadWorkspaces]);

  useEffect(() => {
    window.addEventListener("hermes-chat-sessions-updated", refresh);
    function onSwPush() {
      refresh();
    }
    window.addEventListener("hermeschat-sw-push", onSwPush);
    function onVisibility() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh();
      const slug = expandedWorkspaceSlug;
      if (slug) void loadWorkspaceChats(slug);
    }, 8000);
    return () => {
      window.removeEventListener("hermes-chat-sessions-updated", refresh);
      window.removeEventListener("hermeschat-sw-push", onSwPush);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [refresh, expandedWorkspaceSlug, loadWorkspaceChats]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  /** Load Builds manifest for vault-style grouping (cached after first open). */
  useEffect(() => {
    if (sidebarTab !== "builds" || buildManifestApps !== null) return;
    void loadBuildManifestApps();
  }, [sidebarTab, buildManifestApps, loadBuildManifestApps]);

  const draftCreates = useMemo(
    () =>
      creativeStudioSessions
        .filter((s) => !s.buildId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [creativeStudioSessions]
  );

  /** Edit / create chats tied to a build id that is not on the loaded manifest (single Published tree). */
  const orphanBuildGroups = useMemo(() => {
    if (buildManifestApps === null) return [];
    const known = new Set(buildManifestApps.map((a) => a.id));
    const orphans: ChatSession[] = [];
    for (const s of buildEditSessions) {
      if (s.chatType !== "build_edit") continue;
      if (!s.buildId || !known.has(s.buildId)) {
        orphans.push(s);
      }
    }
    for (const s of creativeStudioSessions) {
      if (s.buildId && !known.has(s.buildId)) {
        orphans.push(s);
      }
    }
    const map = new Map<string, ChatSession[]>();
    for (const s of orphans) {
      const k = s.buildId ?? `noid:${s.key}`;
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .map(([key, sessions]) => ({
        key,
        sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt),
        label:
          sessions.find((x) => x.buildName?.trim())?.buildName?.trim() ??
          sessions[0]?.label ??
          "Creation",
      }))
      .sort(
        (a, b) =>
          Math.max(...b.sessions.map((x) => x.updatedAt), 0) -
          Math.max(...a.sessions.map((x) => x.updatedAt), 0)
      );
  }, [buildEditSessions, buildManifestApps, creativeStudioSessions]);

  /** Expand the Published folder that contains the active chat. */
  useEffect(() => {
    if (sidebarTab !== "builds" || !activeId) return;

    const draftHit = draftCreates.find(
      (s) => (s.webchatId || s.id) === activeId
    );
    if (draftHit) {
      setExpandedBuildId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedDraftSessionId(draftHit.webchatId || draftHit.id);
      return;
    }

    const hit = buildEditSessions.find(
      (s) => (s.webchatId || s.id) === activeId
    );
    if (
      hit?.buildId &&
      (buildManifestApps ?? []).some((a) => a.id === hit.buildId)
    ) {
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedBuildId(hit.buildId);
      return;
    }

    const csHit = creativeStudioSessions.find(
      (s) => (s.webchatId || s.id) === activeId
    );
    if (
      csHit?.buildId &&
      (buildManifestApps ?? []).some((a) => a.id === csHit.buildId)
    ) {
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedBuildId(csHit.buildId);
      return;
    }

    const inOrphan = orphanBuildGroups.find((g) =>
      g.sessions.some((s) => (s.webchatId || s.id) === activeId)
    );
    if (inOrphan) {
      setExpandedBuildId(null);
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(inOrphan.key);
      return;
    }

    if (hit?.buildId) {
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedBuildId(hit.buildId);
      return;
    }
    if (csHit?.buildId) {
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedBuildId(csHit.buildId);
      return;
    }
  }, [
    sidebarTab,
    activeId,
    buildEditSessions,
    creativeStudioSessions,
    buildManifestApps,
    draftCreates,
    orphanBuildGroups,
  ]);

  /** When the manifest gains an app and there is exactly one unlinked Create chat, link them. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sidebarTab !== "builds") return;
    if (buildManifestApps === null) return;

    const curr = buildManifestApps.map((a) => a.id);
    const prevRaw = sessionStorage.getItem(MANIFEST_APP_IDS_STORAGE_KEY);
    if (prevRaw === null) {
      sessionStorage.setItem(
        MANIFEST_APP_IDS_STORAGE_KEY,
        JSON.stringify(curr)
      );
      return;
    }
    let prev: string[] = [];
    try {
      const parsed = JSON.parse(prevRaw) as unknown;
      prev = Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      prev = [];
    }
    const newIds = curr.filter((id) => !prev.includes(id));
    if (newIds.length === 1) {
      const unlinked = creativeStudioSessions.filter((s) => !s.buildId);
      if (unlinked.length === 1) {
        const sid = unlinked[0]!.webchatId || unlinked[0]!.id;
        const newId = newIds[0]!;
        void (async () => {
          try {
            const r = await fetch("/api/builds/attach-create-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: sid, buildId: newId }),
            });
            if (r.ok) {
              sessionStorage.setItem(
                MANIFEST_APP_IDS_STORAGE_KEY,
                JSON.stringify(curr)
              );
              refresh();
              window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            }
          } catch {
            /* keep snapshot for retry */
          }
        })();
        return;
      }
    }
    sessionStorage.setItem(
      MANIFEST_APP_IDS_STORAGE_KEY,
      JSON.stringify(curr)
    );
  }, [sidebarTab, buildManifestApps, creativeStudioSessions, refresh]);

  useEffect(() => {
    return () => clearPublishedFolderToggleTimer();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      searchSessions(q).then((results) => {
        setSearchResults(results);
        setSearching(false);
      });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  function handleNew() {
    router.push("/chat?new=1");
    close();
  }

  function handleSelect(s: ChatSession) {
    const navId = s.webchatId || s.id;
    const keyParam = s.key ? `?k=${encodeURIComponent(s.key)}` : "";
    router.push(`/chat/${navId}${keyParam}`);
    close();
  }

  /** Expand sidebar and load chat list for this vault (used when opening vault from main row). */
  function expandWorkspaceInSidebar(slug: string) {
    setExpandedWorkspaceSlug(slug);
    void loadWorkspaceChats(slug);
  }

  function clearVaultOpenNavTimer() {
    if (vaultOpenNavTimerRef.current) {
      clearTimeout(vaultOpenNavTimerRef.current);
      vaultOpenNavTimerRef.current = null;
    }
  }

  function onVaultRowPointerDown(ws: WorkspaceRow) {
    return (e: React.PointerEvent) => {
      vaultRowLpStart.current = { x: e.clientX, y: e.clientY };
      vaultRowSuppressRef.current = false;
      if (vaultRowLongRef.current) clearTimeout(vaultRowLongRef.current);
      vaultRowLongRef.current = setTimeout(() => {
        vaultRowLongRef.current = null;
        vaultRowSuppressRef.current = true;
        clearVaultOpenNavTimer();
        setVaultRename({
          slug: ws.slug,
          name: ws.name,
        });
      }, 520);
    };
  }

  function onVaultRowPointerMove(e: React.PointerEvent) {
    if (!vaultRowLongRef.current) return;
    const dx = Math.abs(e.clientX - vaultRowLpStart.current.x);
    const dy = Math.abs(e.clientY - vaultRowLpStart.current.y);
    if (dx + dy > 10) {
      clearTimeout(vaultRowLongRef.current);
      vaultRowLongRef.current = null;
    }
  }

  function onVaultRowPointerUp() {
    if (vaultRowLongRef.current) {
      clearTimeout(vaultRowLongRef.current);
      vaultRowLongRef.current = null;
    }
  }

  function onVaultMainClick(ws: WorkspaceRow) {
    return (e: React.MouseEvent) => {
      if (vaultRowSuppressRef.current) {
        vaultRowSuppressRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.detail === 2) {
        clearVaultOpenNavTimer();
        setVaultDelete({
          slug: ws.slug,
          name: ws.name,
          visibility: ws.visibility,
        });
        e.preventDefault();
        return;
      }
      if (e.detail === 1) {
        clearVaultOpenNavTimer();
        vaultOpenNavTimerRef.current = setTimeout(() => {
          vaultOpenNavTimerRef.current = null;
          expandWorkspaceInSidebar(ws.slug);
          router.push(
            `/chat/workspace/${encodeURIComponent(ws.slug)}/draft`
          );
          // Keep drawer open so the user can pick a vault chat; close only in handleSelectWorkspaceChat
        }, 300);
      }
    };
  }

  function handleNewWorkspaceChat(slug: string) {
    router.push(`/chat/workspace/${encodeURIComponent(slug)}/draft`);
    close();
  }

  function handleSelectWorkspaceChat(row: WorkspaceChatRow) {
    const keyParam = row.key ? `?k=${encodeURIComponent(row.key)}` : "";
    router.push(`/chat/${row.id}${keyParam}`);
    close();
  }

  async function handleCreateWorkspace() {
    const name = newWsName.trim();
    if (!name || creatingWs) return;
    setCreatingWs(true);
    setWsError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, visibility: newWsVisibility }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        slug?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Create failed");
      if (!data.slug) throw new Error("Invalid response");
      setNewWsName("");
      setNewWsVisibility("private");
      setCreateWsOpen(false);
      loadWorkspaces();
      notifyWorkspacesUpdated();
      router.push(
        `/chat/workspace/${encodeURIComponent(data.slug)}/draft`
      );
      close();
    } catch (e: unknown) {
      setWsError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreatingWs(false);
    }
  }

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults(null);
    } else {
      setSearchOpen(true);
    }
  }

  const displaySessions = searchResults !== null ? searchResults : sessions;
  const isCronSession = (s: ChatSession) => s.chatType === "cron" || s.key?.includes(":cron-");

  function sessionMetaLine(s: ChatSession): string {
    const updated = new Date(s.updatedAt);
    const date = updated.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const time = updated.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const parts: string[] = [];
    const promptCount = s.promptCount ?? 0;
    if (promptCount > 0) parts.push(`${promptCount} prompts`);
    parts.push(date, time);
    if (s.processing) parts.push("Active");
    return parts.join(" · ");
  }

  const tabBtn =
    "flex-1 rounded-lg py-1.5 text-xs font-medium transition-[box-shadow,color] duration-200";

  function goChatsTab() {
    setSidebarTab("chats");
    router.push("/chat?new=1");
  }

  function goVaultTab() {
    setSidebarTab("vault");
    const targetSlug =
      expandedWorkspaceSlug ??
      workspaces.find((ws) => ws.slug?.trim())?.slug ??
      null;
    if (targetSlug) {
      setExpandedWorkspaceSlug(targetSlug);
      void loadWorkspaceChats(targetSlug);
      router.push(`/chat/workspace/${encodeURIComponent(targetSlug)}/draft`);
      return;
    }
    router.push("/chat?new=1");
  }

  function goBuildsTab() {
    setSidebarTab("builds");
    try {
      router.prefetch("/chat/builds");
    } catch {
      /* ignore */
    }
    router.push("/chat/builds");
  }

  const chatsTabActive = sidebarTab === "chats";
  const vaultTabActive = sidebarTab === "vault";
  const buildsTabActive = sidebarTab === "builds";

  const tabActivityPips = useMemo(() => {
    const ps = processingSurface;
    const id = activeId;
    const viewingMain = Boolean(id && ps.mainProcessingWebchatIds.includes(id));
    const viewingBuild = Boolean(
      id && ps.buildsProcessingWebchatIds.includes(id)
    );
    const viewingVault = Boolean(
      id && ps.vaultProcessingWebchatIds.includes(id)
    );
    const anyVault = Object.values(ps.vaults).some((v) => v.hasActive);
    const vaultTabArchitect = Object.values(ps.vaults).some(
      (v) => v.hasActive && v.kind === "architect"
    );
    const buildsTabArchitect = ps.buildsProcessingWebchatIds.some(
      (w) => ps.byWebchatId[w] === "architect"
    );
    const mainTabArchitect = ps.mainProcessingWebchatIds.some(
      (w) => ps.byWebchatId[w] === "architect"
    );
    return {
      chats: {
        show: ps.hasMain && sidebarTab !== "chats" && !(id && viewingMain),
        architect: mainTabArchitect,
      },
      vault: {
        show:
          anyVault && sidebarTab !== "vault" && !(id && viewingVault),
        architect: vaultTabArchitect,
      },
      builds: {
        show: ps.hasBuilds && sidebarTab !== "builds" && !(id && viewingBuild),
        architect: buildsTabArchitect,
      },
    };
  }, [processingSurface, activeId, sidebarTab]);

  function buildChatDisplayLabel(s: ChatSession): string {
    if (s.chatType === "build_edit" && s.buildName?.trim()) {
      return s.buildName.trim();
    }
    return s.label;
  }

  function sessionsForBuildId(appId: string): ChatSession[] {
    const fromEdit = buildEditSessions.filter((s) => s.buildId === appId);
    const fromCreate = creativeStudioSessions.filter((s) => s.buildId === appId);
    return [...fromCreate, ...fromEdit].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  async function startBuildEditFromSidebar(appId: string) {
    if (buildEditBusyId) return;
    setBuildEditBusyId(appId);
    try {
      const r = await fetch("/api/builds/edit-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: appId }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!r.ok) {
        throw new Error(
          typeof d.error === "string" ? d.error : "Could not start edit"
        );
      }
      const sid = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
      if (!sid) throw new Error("Invalid response");
      setExpandedDraftSessionId(null);
      setExpandedOrphanGroupKey(null);
      setExpandedBuildId(appId);
      setBuildManifestApps((current) => {
        if (!current) return current;
        const idx = current.findIndex((app) => app.id === appId);
        if (idx < 0) return current;
        const touched = { ...current[idx]!, updatedAt: Date.now() };
        return [
          touched,
          ...current.slice(0, idx),
          ...current.slice(idx + 1),
        ];
      });
      void refresh();
      const k = `webchat:${sid}`;
      window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      router.push(`/chat/${encodeURIComponent(sid)}?k=${encodeURIComponent(k)}`);
      close();
    } catch {
      /* keep prior list */
    } finally {
      setBuildEditBusyId(null);
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
      void refresh();
      const k = `webchat:${sid}`;
      window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      router.push(`/chat/${encodeURIComponent(sid)}?k=${encodeURIComponent(k)}`);
      close();
    } catch {
      /* ignore */
    } finally {
      setCreateStudioBusy(false);
    }
  }

  const privateWorkspaces = workspaces.filter((w) => w.visibility !== "shared");
  const sharedWorkspaces = workspaces.filter((w) => w.visibility === "shared");

  function workspaceSection(
    label: string,
    list: WorkspaceRow[],
    keyPrefix: string
  ) {
    if (list.length === 0) return null;
    return (
      <>
        <p className="px-3.5 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {list.map((ws) => {
          const expanded = expandedWorkspaceSlug === ws.slug;
          const nested = workspaceChatsBySlug[ws.slug];
          const chatsLoading = workspaceChatsLoading === ws.slug;
          const anyNestedOnRows = (nested ?? []).some((r) => r.processing);
          const surfaceV = processingSurface.vaults[ws.slug];
          const anyFromSurface = surfaceV?.hasActive;
          const anyNestedProcessing = anyNestedOnRows || Boolean(anyFromSurface);
          const vaultRowOrbKind: SessionProcessingKind =
            surfaceV?.hasActive
              ? surfaceV.kind
              : (nested ?? []).find((r) => r.processing)?.processingKind ??
                "default";
          const showVaultRowOrb = anyNestedProcessing && !expanded;
          return (
            <div
              key={`${keyPrefix}-${ws.slug}`}
              className={`mb-2 overflow-hidden rounded-xl transition-[background,border-color,box-shadow] ${
                expanded
                  ? "border border-sidebar-primary/45 bg-sidebar-accent/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                  : ""
              }`}
            >
              <button
                type="button"
                data-hermes-tip={VAULT_ROW_HINT}
                aria-expanded={expanded}
                aria-label={`Open ${ws.name} — vault home and chat list`}
                onPointerDown={onVaultRowPointerDown(ws)}
                onPointerMove={onVaultRowPointerMove}
                onPointerUp={onVaultRowPointerUp}
                onPointerCancel={onVaultRowPointerUp}
                onPointerLeave={onVaultRowPointerUp}
                onClick={onVaultMainClick(ws)}
                className={`neu-raised group flex w-full min-w-0 items-center gap-2 rounded-xl py-2.5 pl-3 pr-2.5 text-left ${
                  expanded
                    ? "text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground"
                }`}
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {showVaultRowOrb ? (
                    <Orb
                      agentState="talking"
                      colors={orbColorsFor(true, vaultRowOrbKind)}
                      className="size-full"
                    />
                  ) : (
                    <FolderIcon className="size-5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium leading-tight text-inherit">
                    {ws.name}
                  </span>
                </span>
                <ChevronDownIcon
                  className={`pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {expanded ? (
                <div className="mt-1 px-2 pb-2 pt-1">
                  <div className="mb-1">
                    <button
                      type="button"
                      onClick={() => handleNewWorkspaceChat(ws.slug)}
                      className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-[10px] font-medium text-sidebar-primary hover:bg-sidebar-accent/15"
                    >
                      <PlusIcon className="size-3.5 shrink-0" />
                      <span className="truncate">New chat</span>
                    </button>
                  </div>
                  {chatsLoading && !nested ? (
                    <p className="px-2 py-2 text-[10px] text-muted-foreground">
                      Loading…
                    </p>
                  ) : null}
                  {(nested ?? []).length > 0 ? (
                    <p className="mb-0.5 px-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Chats
                    </p>
                  ) : null}
                  {(nested ?? []).map((row) => {
                    const active = activeId === row.id;
                    return (
                      <SidebarPressableChatRow
                        key={row.key}
                        className={`flex w-full touch-manipulation items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                          active
                            ? "bg-sidebar-accent/25 text-sidebar-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                        }`}
                        onNavigate={() => handleSelectWorkspaceChat(row)}
                        onRename={() =>
                          setRenameTarget({
                            sessionId: row.id,
                            sessionKey: row.key,
                            label: row.label,
                          })
                        }
                      >
                        {row.processing ? (
                          <span className="flex size-3.5 shrink-0 items-center justify-center">
                            <Orb
                              agentState="talking"
                              colors={orbColorsFor(
                                true,
                                row.processingKind
                              )}
                              className="size-full"
                            />
                          </span>
                        ) : (
                          <MessageSquareIcon className="size-3.5 shrink-0 opacity-70" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      </SidebarPressableChatRow>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="chat-sidebar-depth flex h-full flex-col bg-transparent text-sidebar-foreground">
      {createWsOpen && newVaultPortalEl
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-vault-dialog-title"
              onClick={(e) =>
                e.target === e.currentTarget && !creatingWs && setCreateWsOpen(false)
              }
            >
              <div
                className="w-full max-w-md rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="border-b border-sidebar-border/30 px-6 py-4">
                  <h3
                    id="new-vault-dialog-title"
                    className="text-base font-semibold text-foreground"
                  >
                    New vault
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Choose a name and who can access this vault.
                  </p>
                </div>
                <div className="space-y-5 px-6 py-5">
                  <div>
                    <label
                      htmlFor="new-vault-name"
                      className="mb-2 block text-xs font-medium text-muted-foreground"
                    >
                      Name
                    </label>
                    <input
                      id="new-vault-name"
                      type="text"
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      placeholder="e.g. Project notes"
                      className="neu-inset-input w-full rounded-lg px-4 py-3 text-base text-foreground"
                      autoFocus
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Visibility
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setNewWsVisibility("private")}
                        className={`flex-1 rounded-lg border px-4 py-3 text-sm ${
                          newWsVisibility === "private"
                            ? "hermes-selected-choice font-medium"
                            : "border-sidebar-border/30 text-muted-foreground"
                        }`}
                      >
                        Private
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewWsVisibility("shared")}
                        className={`flex-1 rounded-lg border px-4 py-3 text-sm ${
                          newWsVisibility === "shared"
                            ? "hermes-selected-choice font-medium"
                            : "border-sidebar-border/30 text-muted-foreground"
                        }`}
                      >
                        Shared
                      </button>
                    </div>
                  </div>
                  {wsError ? (
                    <p className="text-sm text-destructive/90">{wsError}</p>
                  ) : null}
                </div>
                <div className="flex justify-end gap-3 border-t border-sidebar-border/30 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setCreateWsOpen(false)}
                    disabled={creatingWs}
                    className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateWorkspace()}
                    disabled={!newWsName.trim() || creatingWs}
                    className="neu-raised rounded-lg px-5 py-2 text-sm font-medium text-sidebar-foreground disabled:opacity-40"
                  >
                    {creatingWs ? "…" : "Create"}
                  </button>
                </div>
              </div>
            </div>,
            newVaultPortalEl
          )
        : null}

      <div className="flex gap-1 px-3 pt-2">
        <button
          type="button"
          onClick={goChatsTab}
          data-hermes-tip="Open your chats and start a new conversation."
          className={`${tabBtn} ${
            chatsTabActive
              ? "neu-selected text-sidebar-foreground"
              : "neu-raised text-muted-foreground hover:text-sidebar-foreground"
          } inline-flex items-center justify-center gap-0.5`}
        >
          Chat
          {tabActivityPips.chats.show ? (
            <span
              className={tabPipClass(tabActivityPips.chats.architect)}
              aria-hidden
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={goVaultTab}
          data-hermes-tip="Open vaults, add knowledge, and ask about saved material."
          className={`${tabBtn} ${
            vaultTabActive
              ? "neu-selected text-sidebar-foreground"
              : "neu-raised text-muted-foreground hover:text-sidebar-foreground"
          } inline-flex items-center justify-center gap-0.5`}
        >
          Vault
          {tabActivityPips.vault.show ? (
            <span
              className={tabPipClass(tabActivityPips.vault.architect)}
              aria-hidden
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={goBuildsTab}
          data-hermes-tip="Open Create for published apps, documents, decks, and builds."
          className={`${tabBtn} ${
            buildsTabActive
              ? "neu-selected text-sidebar-foreground"
              : "neu-raised text-muted-foreground hover:text-sidebar-foreground"
          } inline-flex items-center justify-center gap-0.5`}
          aria-label="Create"
        >
          Create
          {tabActivityPips.builds.show ? (
            <span
              className={tabPipClass(tabActivityPips.builds.architect)}
              aria-hidden
            />
          ) : null}
        </button>
      </div>

      {sidebarTab === "chats" ? (
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={handleNew}
            data-hermes-tip="Start a fresh Hermes chat."
            className="neu-raised group flex flex-1 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground"
          >
            <PlusIcon className="size-4 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
            New chat
          </button>
          <button
            onClick={toggleSearch}
            data-hermes-tip={searchOpen ? "Close chat search." : "Search your chats."}
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg transition-[box-shadow,color] duration-300 ease-out ${
              searchOpen
                ? "neu-raised-active text-sidebar-primary"
                : "neu-raised text-muted-foreground hover:text-sidebar-foreground"
            }`}
            aria-label="Search chats"
          >
            {searchOpen ? <XIcon className="size-4" /> : <SearchIcon className="size-4" />}
          </button>
        </div>
      ) : sidebarTab === "vault" ? (
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={() => {
              setWsError(null);
              setCreateWsOpen(true);
            }}
            data-hermes-tip="Create a new vault for files, notes, and focused chats."
            className="neu-raised group flex flex-1 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground"
          >
            <PlusIcon className="size-4 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
            New vault
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={() => setCreateStudioOpen(true)}
            data-hermes-tip="Create a website, PDF, slide deck, image, email, document, or app."
            className="neu-raised group flex min-w-0 flex-[1.25] items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground"
          >
            <PlusIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
            <span className="truncate">New create</span>
          </button>
          <button
            type="button"
            aria-label="Published apps"
            onClick={() => {
              router.push("/chat/builds");
              close();
            }}
            data-hermes-tip="View, edit, download, archive, or reopen things you have created."
            className="neu-raised group flex min-w-0 flex-[0.75] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground"
          >
            <Layers className="size-4 shrink-0 text-sidebar-primary transition-colors group-hover:text-sidebar-primary" />
            <span className="truncate">View</span>
          </button>
        </div>
      )}

      {sidebarTab === "chats" && searchOpen && (
        <div className="px-3 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="neu-inset-input w-full rounded-lg py-2 pl-9 pr-3 text-sm text-sidebar-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2.5 py-2 pb-4 [scrollbar-gutter:stable]">
        {sidebarTab === "chats" ? (
          <>
            {searching && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Searching...
              </p>
            )}

            {!searching && displaySessions.length === 0 && (
              <p className="px-3 py-10 text-center text-xs leading-relaxed text-muted-foreground">
                {searchResults !== null ? "No matches found" : "No conversations yet"}
              </p>
            )}

            {!searching && displaySessions.length > 0 && (
              <>
                <p className="px-3.5 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {searchResults !== null ? `Results (${searchResults.length})` : "Chats"}
                </p>
                {displaySessions.map((s) => {
                  const compareId = s.webchatId || s.id;
                  const active = activeId === compareId;
                  const isCron = isCronSession(s);
                  return (
                    <SidebarPressableChatRow
                      key={s.key}
                      onNavigate={() => handleSelect(s)}
                      onRename={() =>
                        setRenameTarget({
                          sessionId: compareId,
                          sessionKey: s.key,
                          label: s.label,
                        })
                      }
                      className={`
                    group relative mb-2 flex w-full touch-manipulation items-center gap-2 rounded-lg py-2 pl-2.5 pr-3.5 text-left
                    ${active
                      ? "neu-selected neu-row-active text-sidebar-foreground"
                      : "neu-raised text-muted-foreground hover:text-sidebar-foreground"}
                  `}
                    >
                      {s.processing ? (
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          <Orb
                            agentState="talking"
                            colors={orbColorsFor(
                              true,
                              s.processingKind
                            )}
                            className="size-full"
                          />
                        </span>
                      ) : isCron ? (
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          <ClockIcon
                            className={`size-5 transition-colors ${active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-primary"}`}
                          />
                        </span>
                      ) : s.hasImages ? (
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          <ImageIcon
                            className={`size-5 transition-colors ${active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-primary"}`}
                          />
                        </span>
                      ) : (
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          <MessageSquareIcon
                            className={`size-5 transition-colors ${active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-primary"}`}
                          />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium leading-tight text-inherit">
                          {s.label}
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-[10px] leading-snug tabular-nums ${active ? "text-muted-foreground" : "text-muted-foreground/85 group-hover:text-muted-foreground"}`}
                        >
                          {sessionMetaLine(s)}
                        </span>
                      </span>
                    </SidebarPressableChatRow>
                  );
                })}
              </>
            )}
          </>
        ) : sidebarTab === "vault" ? (
          <>
            {wsLoading && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
            )}
            {!wsLoading && wsError && !workspaces.length && (
              <p className="px-3 py-6 text-center text-xs text-destructive/90">{wsError}</p>
            )}
            {!wsLoading && !wsError && workspaces.length === 0 && (
              <p className="px-3 py-10 text-center text-xs leading-relaxed text-muted-foreground">
                {workspaceZeroHero
                  ? "Name it above, then add files with + in the composer."
                  : "No vaults yet — create one above."}
              </p>
            )}
            {!wsLoading && workspaces.length > 0 && (
              <>
                {workspaceSection("Private", privateWorkspaces, "p")}
                {workspaceSection("Shared", sharedWorkspaces, "s")}
              </>
            )}
          </>
        ) : (
          <>
            {buildsManifestLoading &&
            buildManifestApps === null &&
            draftCreates.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Loading…
              </p>
            ) : null}
            {draftCreates.length > 0 ||
            !buildsManifestLoading ||
            buildManifestApps !== null ? (
              <p className="px-3.5 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Published
              </p>
            ) : null}
            {draftCreates.map((s) => {
              const compareId = s.webchatId || s.id;
              const expanded = expandedDraftSessionId === compareId;
              const anyNestedProcessing = s.processing;
              const rowOrbKind = s.processingKind ?? "default";
              const showFolderOrb = anyNestedProcessing && !expanded;
              const folderTitle = s.label?.trim() || "Unnamed creation";
              return (
                <div
                  key={`draft-${s.key}`}
                  className={`mb-2 overflow-hidden rounded-xl transition-[background,border-color,box-shadow] ${
                    expanded
                      ? "border border-sidebar-primary/45 bg-sidebar-accent/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${folderTitle} — create chat`}
                    onClick={() => {
                      setExpandedBuildId(null);
                      setExpandedOrphanGroupKey(null);
                      setExpandedDraftSessionId((cur) =>
                        cur === compareId ? null : compareId
                      );
                    }}
                    className={`neu-raised group flex w-full min-w-0 items-center gap-2 rounded-xl py-2.5 pl-3 pr-2.5 text-left ${
                      expanded
                        ? "text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground"
                    }`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      {showFolderOrb ? (
                        <Orb
                          agentState="talking"
                          colors={orbColorsFor(true, rowOrbKind)}
                          className="size-full"
                        />
                      ) : (
                        <Layers className="size-5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium leading-tight text-inherit">
                        {folderTitle}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {expanded ? (
                    <div className="mt-1 px-2 pb-2 pt-1">
                      <p className="mb-0.5 px-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Chats
                      </p>
                      <SidebarPressableChatRow
                        key={s.key}
                        onNavigate={() => handleSelect(s)}
                        onRename={() =>
                          setRenameTarget({
                            sessionId: compareId,
                            sessionKey: s.key,
                            label: s.label,
                          })
                        }
                        className={`flex w-full touch-manipulation items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                          activeId === compareId
                            ? "bg-sidebar-accent/25 text-sidebar-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                        }`}
                      >
                        {s.processing ? (
                          <span className="flex size-3.5 shrink-0 items-center justify-center">
                            <Orb
                              agentState="talking"
                              colors={orbColorsFor(true, s.processingKind)}
                              className="size-full"
                            />
                          </span>
                        ) : (
                          <Layers className="size-3.5 shrink-0 opacity-70" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium leading-tight">
                            {s.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground tabular-nums">
                            {sessionMetaLine(s)}
                          </span>
                        </span>
                      </SidebarPressableChatRow>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {(buildManifestApps ?? []).map((app) => {
              const expanded = expandedBuildId === app.id;
              const nested = sessionsForBuildId(app.id);
              const anyNestedProcessing = nested.some((r) => r.processing);
              const rowOrbKind =
                nested.find((r) => r.processing)?.processingKind ?? "default";
              const showFolderOrb = anyNestedProcessing && !expanded;
              return (
                <div
                  key={`build-${app.id}`}
                  className={`mb-2 overflow-hidden rounded-xl transition-[background,border-color,box-shadow] ${
                    expanded
                      ? "border border-sidebar-primary/45 bg-sidebar-accent/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    data-hermes-tip="Open build chats. Double-click to edit the name or delete it."
                    aria-expanded={expanded}
                    aria-label={`${app.name} — build chats`}
                    onClick={onPublishedAppHeaderClick(app)}
                    onDoubleClick={onPublishedAppHeaderDoubleClick(app)}
                    className={`neu-raised group flex w-full min-w-0 items-center gap-2 rounded-xl py-2.5 pl-3 pr-2.5 text-left ${
                      expanded
                        ? "text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground"
                    }`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      {showFolderOrb ? (
                        <Orb
                          agentState="talking"
                          colors={orbColorsFor(true, rowOrbKind)}
                          className="size-full"
                        />
                      ) : (
                        <Layers className="size-5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium leading-tight text-inherit">
                        {app.name}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {expanded ? (
                    <div className="mt-1 px-2 pb-2 pt-1">
                      <div className="mb-1">
                        <button
                          type="button"
                          disabled={buildEditBusyId === app.id}
                          onClick={() => void startBuildEditFromSidebar(app.id)}
                          className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-[10px] font-medium text-sidebar-primary hover:bg-sidebar-accent/15 disabled:opacity-50"
                        >
                          <PlusIcon className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {buildEditBusyId === app.id ? "…" : "New edit chat"}
                          </span>
                        </button>
                      </div>
                      {nested.length > 0 ? (
                        <p className="mb-0.5 px-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Chats
                        </p>
                      ) : (
                        <p className="px-2 py-1 text-[10px] text-muted-foreground">
                          No edit chats yet.
                        </p>
                      )}
                      {nested.map((s) => {
                        const compareId = s.webchatId || s.id;
                        const active = activeId === compareId;
                        const NestedIcon =
                          s.chatType === "creative_studio"
                            ? Layers
                            : MessageSquareIcon;
                        return (
                          <SidebarPressableChatRow
                            key={s.key}
                            onNavigate={() => handleSelect(s)}
                            onRename={() =>
                              setRenameTarget({
                                sessionId: compareId,
                                sessionKey: s.key,
                                label: buildChatDisplayLabel(s),
                              })
                            }
                            className={`flex w-full touch-manipulation items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                              active
                                ? "bg-sidebar-accent/25 text-sidebar-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                            }`}
                          >
                            {s.processing ? (
                              <span className="flex size-3.5 shrink-0 items-center justify-center">
                                <Orb
                                  agentState="talking"
                                  colors={orbColorsFor(true, s.processingKind)}
                                  className="size-full"
                                />
                              </span>
                            ) : (
                              <NestedIcon className="size-3.5 shrink-0 opacity-70" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium leading-tight">
                                {buildChatDisplayLabel(s)}
                              </span>
                              <span className="mt-0.5 block truncate text-[9px] text-muted-foreground tabular-nums">
                                {sessionMetaLine(s)}
                              </span>
                            </span>
                          </SidebarPressableChatRow>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {orphanBuildGroups.map((g) => {
              const expanded = expandedOrphanGroupKey === g.key;
              const nested = g.sessions;
              const anyNestedProcessing = nested.some((r) => r.processing);
              const rowOrbKind =
                nested.find((r) => r.processing)?.processingKind ?? "default";
              const showFolderOrb = anyNestedProcessing && !expanded;
              const canStartEdit = !g.key.startsWith("noid:");
              return (
                <div
                  key={`orphan-${g.key}`}
                  className={`mb-2 overflow-hidden rounded-xl transition-[background,border-color,box-shadow] ${
                    expanded
                      ? "border border-sidebar-primary/45 bg-sidebar-accent/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    data-hermes-tip="Open build chats. Double-click to remove this app or its chats."
                    aria-expanded={expanded}
                    aria-label={`${g.label} — build chats`}
                    onClick={onOrphanGroupHeaderClick(g)}
                    onDoubleClick={onOrphanGroupHeaderDoubleClick(g)}
                    className={`neu-raised group flex w-full min-w-0 items-center gap-2 rounded-xl py-2.5 pl-3 pr-2.5 text-left ${
                      expanded
                        ? "text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground"
                    }`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      {showFolderOrb ? (
                        <Orb
                          agentState="talking"
                          colors={orbColorsFor(true, rowOrbKind)}
                          className="size-full"
                        />
                      ) : (
                        <Layers className="size-5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium leading-tight text-inherit">
                        {g.label}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {expanded ? (
                    <div className="mt-1 px-2 pb-2 pt-1">
                      {canStartEdit ? (
                        <div className="mb-1">
                          <button
                            type="button"
                            disabled={buildEditBusyId === g.key}
                            onClick={() =>
                              void startBuildEditFromSidebar(g.key)
                            }
                            className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-[10px] font-medium text-sidebar-primary hover:bg-sidebar-accent/15 disabled:opacity-50"
                          >
                            <PlusIcon className="size-3.5 shrink-0" />
                            <span className="truncate">
                              {buildEditBusyId === g.key
                                ? "…"
                                : "New edit chat"}
                            </span>
                          </button>
                        </div>
                      ) : null}
                      {nested.length > 0 ? (
                        <p className="mb-0.5 px-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Chats
                        </p>
                      ) : (
                        <p className="px-2 py-1 text-[10px] text-muted-foreground">
                          No chats yet.
                        </p>
                      )}
                      {nested.map((s) => {
                        const compareId = s.webchatId || s.id;
                        const active = activeId === compareId;
                        const NestedIcon =
                          s.chatType === "creative_studio"
                            ? Layers
                            : MessageSquareIcon;
                        return (
                          <SidebarPressableChatRow
                            key={s.key}
                            onNavigate={() => handleSelect(s)}
                            onRename={() =>
                              setRenameTarget({
                                sessionId: compareId,
                                sessionKey: s.key,
                                label: buildChatDisplayLabel(s),
                              })
                            }
                            className={`flex w-full touch-manipulation items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                              active
                                ? "bg-sidebar-accent/25 text-sidebar-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                            }`}
                          >
                            {s.processing ? (
                              <span className="flex size-3.5 shrink-0 items-center justify-center">
                                <Orb
                                  agentState="talking"
                                  colors={orbColorsFor(
                                    true,
                                    s.processingKind
                                  )}
                                  className="size-full"
                                />
                              </span>
                            ) : (
                              <NestedIcon className="size-3.5 shrink-0 opacity-70" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium leading-tight">
                                {buildChatDisplayLabel(s)}
                              </span>
                              <span className="mt-0.5 block truncate text-[9px] text-muted-foreground tabular-nums">
                                {sessionMetaLine(s)}
                              </span>
                            </span>
                          </SidebarPressableChatRow>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!buildsManifestLoading &&
            buildManifestApps !== null &&
            draftCreates.length === 0 &&
            (buildManifestApps ?? []).length === 0 &&
            orphanBuildGroups.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
                No published apps yet. Use{" "}
                <span className="font-medium text-foreground/90">New create</span>{" "}
                above or open{" "}
                <span className="font-medium text-foreground/90">Published apps</span>.
              </p>
            ) : null}
          </>
        )}
      </div>
      <CreateStudioIntentDialog
        open={createStudioOpen}
        busy={createStudioBusy}
        onCancel={() => !createStudioBusy && setCreateStudioOpen(false)}
        onContinue={(intent, hint, ref, createBrief) =>
          void startCreativeStudioSession(intent, hint, ref, createBrief)
        }
      />
      {renameTarget ? (
        <RenameChatDialog
          open
          sessionId={renameTarget.sessionId}
          sessionKey={renameTarget.sessionKey}
          initialLabel={renameTarget.label}
          onCancel={() => setRenameTarget(null)}
          onSaved={(label) => {
            const sid = renameTarget.sessionId;
            refresh();
            if (expandedWorkspaceSlug) void loadWorkspaceChats(expandedWorkspaceSlug);
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            window.dispatchEvent(
              new CustomEvent("hermeschat-session-label", {
                detail: { sessionId: sid, label },
              })
            );
          }}
          onSessionDeleted={(sid) => {
            refresh();
            if (expandedWorkspaceSlug) void loadWorkspaceChats(expandedWorkspaceSlug);
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            if (activeId === sid) {
              router.push("/chat?new=1");
            }
          }}
          onRequestSummarize={(sid, key) => {
            if (activeId === sid) {
              window.dispatchEvent(
                new CustomEvent(HERMESCHAT_SUMMARIZE_EVENT, {
                  detail: {
                    sessionId: sid,
                    sessionKey: key,
                    text: HERMESCHAT_SUMMARIZE_PROMPT,
                  },
                })
              );
              return;
            }
            try {
              sessionStorage.setItem(
                PENDING_HERMESCHAT_SUMMARIZE_KEY,
                JSON.stringify({
                  sessionId: sid,
                  sessionKey: key,
                  text: HERMESCHAT_SUMMARIZE_PROMPT,
                })
              );
            } catch {
              /* ignore */
            }
            router.push(
              `/chat/${encodeURIComponent(sid)}?k=${encodeURIComponent(key)}`
            );
          }}
        />
      ) : null}
      {vaultRename ? (
        <RenameVaultDialog
          open
          slug={vaultRename.slug}
          name={vaultRename.name}
          onClose={() => setVaultRename(null)}
          onRenamed={() => {
            loadWorkspaces();
            notifyWorkspacesUpdated();
          }}
        />
      ) : null}
      {publishedAppRenameTarget ? (
        <RenamePublishedAppDialog
          open
          buildId={publishedAppRenameTarget.buildId}
          name={publishedAppRenameTarget.name}
          onClose={() => setPublishedAppRenameTarget(null)}
          onRequestDelete={() => {
            const t = publishedAppRenameTarget;
            setPublishedAppRenameTarget(null);
            setPublishedAppDeleteTarget({
              buildId: t.buildId,
              name: t.name,
            });
          }}
          onRenamed={(name) => {
            const bid = publishedAppRenameTarget.buildId;
            setPublishedAppRenameTarget(null);
            setBuildManifestApps((prev) =>
              prev
                ? prev.map((a) => (a.id === bid ? { ...a, name } : a))
                : null
            );
            refresh();
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
          }}
        />
      ) : null}
      {publishedAppDeleteTarget ? (
        <DeletePublishedAppDialog
          open
          buildId={publishedAppDeleteTarget.buildId}
          name={publishedAppDeleteTarget.name}
          onClose={() => setPublishedAppDeleteTarget(null)}
          onDeleted={() => {
            const bid = publishedAppDeleteTarget.buildId;
            setPublishedAppDeleteTarget(null);
            setExpandedBuildId((cur) => (cur === bid ? null : cur));
            setExpandedOrphanGroupKey((cur) => (cur === bid ? null : cur));
            setBuildManifestApps(null);
            refresh();
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            const aid = activeId;
            if (aid) {
              void fetch(`/api/sessions/${encodeURIComponent(aid)}`, {
                cache: "no-store",
              }).then((r) => {
                if (r.status === 404) router.push("/chat?new=1");
              });
            }
          }}
        />
      ) : null}
      {orphanNoidPurgeTarget ? (
        <OrphanChatsPurgeDialog
          open
          label={orphanNoidPurgeTarget.label}
          sessions={orphanNoidPurgeTarget.sessions}
          onClose={() => setOrphanNoidPurgeTarget(null)}
          onDeleted={() => {
            setOrphanNoidPurgeTarget(null);
            setExpandedOrphanGroupKey(null);
            setBuildManifestApps(null);
            refresh();
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            const aid = activeId;
            if (aid) {
              void fetch(`/api/sessions/${encodeURIComponent(aid)}`, {
                cache: "no-store",
              }).then((r) => {
                if (r.status === 404) router.push("/chat?new=1");
              });
            }
          }}
        />
      ) : null}
      {vaultDelete ? (
        <DeleteVaultDialog
          open
          slug={vaultDelete.slug}
          name={vaultDelete.name}
          visibility={vaultDelete.visibility}
          onClose={() => setVaultDelete(null)}
          onDeleted={() => {
            const deletedSlug = vaultDelete.slug;
            setVaultDelete(null);
            setExpandedWorkspaceSlug((cur) =>
              cur === deletedSlug ? null : cur
            );
            loadWorkspaces();
            notifyWorkspacesUpdated();
            if (pathname.includes(`/chat/workspace/${encodeURIComponent(deletedSlug)}`)) {
              router.push("/chat");
            }
          }}
        />
      ) : null}
    </div>
  );
}
