"use client";

import { Fragment, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/conversation";
import { Message, MessageContent } from "@/components/ui/message";
import { Response } from "@/components/ui/response";
import { MarkdownImageWithActions } from "@/components/ui/markdown-image";
import { Orb } from "@/components/ui/orb";
import { OrbDoubleTapStop } from "@/components/OrbDoubleTapStop";
import { ChatHeader } from "@/components/chat-header";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import {
  WorkspaceVaultFilesBar,
  type WorkspaceVaultFileRow,
} from "@/components/WorkspaceVaultFilesBar";
import { SharedIngestArchitectHero } from "@/components/SharedIngestArchitectHero";
import { PrivateHermesReingestHero } from "@/components/PrivateHermesReingestHero";
import type { SharedIngestJobPublic } from "@/lib/shared-ingest-job-store";
import {
  SHARED_INGEST_HERO_KEY,
  type SharedIngestHeroPayload,
} from "@/lib/shared-ingest-hero-storage";
import {
  PRIVATE_REINGEST_HERO_KEY,
  type PrivateReingestHeroPayload,
} from "@/lib/private-reingest-hero-storage";
import type {
  HermesPrivateReingestJobPublic,
  WorkspaceVaultIngestJob,
} from "@/lib/workspace-vault-ingest-jobs";
import { useChatIdentity } from "@/ChatIdentity";
import { SpeakReplyButton } from "@/components/speak-reply-button";
import { CopyReplyButton } from "@/components/copy-reply-button";
import { PrintReplyButton } from "@/components/print-reply-button";
import {
  fetchChatMessages,
  getTextContent,
  getImageUrls,
  noticePrefixForBannerKind,
  type ChatMessage,
  type ChatCostBasis,
  type ChatCostSource,
  type MessageContentPart,
  PENDING_HERMESCHAT_SUMMARIZE_KEY,
  HERMESCHAT_SUMMARIZE_EVENT,
  HERMESCHAT_SUMMARIZE_PROMPT,
} from "@/lib/sessions";
import { compactThinkingSummary } from "@/lib/thinking-headline";
import { formatAssistantMessageMeta } from "@/lib/format-assistant-message-meta";
import { useDisplayCurrency } from "@/lib/use-display-currency";
import {
  VAULT_PENDING_INGEST_KEY,
  type VaultPendingIngestPayload,
} from "@/lib/vault-pending-ingest";
import {
  WORKSPACE_DRAFT_INITIAL_KEY,
  type WorkspaceDraftInitialPayload,
} from "@/lib/workspace-draft-send";
import {
  CREATIVE_STUDIO_DRAFT_INITIAL_KEY,
  type CreativeStudioDraftInitialPayload,
} from "@/lib/creative-studio-draft-send";
import { useSmoothedStreamText } from "@/lib/use-smoothed-stream-text";
import { normalizeIngestModelOverride } from "@/lib/ingest-model-override";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import { ActiveWorkspaceSlugProvider } from "@/lib/active-workspace-slug-context";
import type { SharedVaultGapHint } from "@/lib/shared-vault-gap-types";
import { useSettings } from "@/app/chat/layout";
import { cn } from "@/lib/utils";
import { shouldSuppressAssistantNarration } from "@/lib/assistant-chatter-filters";
import { getOrbHelper } from "@/lib/helper-suggestions";
import { CreativeStudioOrbTips } from "@/components/CreativeStudioOrbTips";
import { CreateKanbanFeed } from "@/components/CreateKanbanFeed";
import { VaultArchitectIngestIdleHero } from "@/components/VaultArchitectIngestIdleHero";
import type { BuildEditSessionPayload } from "@/lib/builds-manifest";
import type { CreativeStudioSessionPayload } from "@/lib/creative-studio-session";
import type { CreateKanbanTask } from "@/lib/hermes-kanban";
import {
  createCreativeStudioSessionLabel,
  creativeStudioIntentLabel,
} from "@/lib/creative-studio-session";
import { AssistantFollowUpChips } from "@/components/AssistantFollowUpChips";
import { extractAssistantFollowUpSuggestions } from "@/lib/assistant-follow-up-suggestions";
import { BookmarkPlusIcon, CheckIcon } from "lucide-react";

/** Transcript refresh while a reply is in flight (see `startPolling` in this file). */
const TRANSCRIPT_POLL_MS_WITH_PARTIAL = 100;
const TRANSCRIPT_POLL_MS_NO_PARTIAL = 500;
const TRANSCRIPT_POLL_MS_EMPTY_AWAIT = 500;

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string | MessageContentPart[];
  model?: string | null;
  modelIdRaw?: string | null;
  costUsd?: number | null;
  promptCostUsd?: number | null;
  completionCostUsd?: number | null;
  toolCostUsd?: number | null;
  costSource?: ChatCostSource | null;
  costBasis?: ChatCostBasis | null;
  nousToolCostDisclaimer?: boolean;
  usageTokens?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
  timestamp?: number | string | null;
  toolModels?: string[];
  validatorModel?: string | null;
}

function UserTurnDivider() {
  return (
    <div
      data-chat-turn-anchor="user"
      className="-mx-4 my-4 flex scroll-mt-3 items-center px-1"
    >
      <div className="h-1 flex-1 bg-gradient-to-r from-transparent via-sidebar-border/35 via-35% to-sidebar-border/85" />
      <div className="h-1 w-12 bg-sidebar-border/85" />
      <div className="h-1 flex-1 bg-gradient-to-r from-sidebar-border/85 via-sidebar-border/35 via-65% to-transparent" />
    </div>
  );
}

type AccountUsageSummary = {
  active: boolean;
  plan?: string | null;
  windows?: {
    label: "Session" | "Weekly";
    usedPercent: number;
    remainingPercent: number;
    resetAt: string | null;
    resetAfterSeconds: number | null;
  }[];
  line: string | null;
  title: string | null;
};

type AssistantFooterMeta = { line: string; title?: string };

function compactResetDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "?";
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? `${days}d${remHours}h` : `${days}d`;
  }
  if (hours > 0) return minutes ? `${hours}h${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatFooterSentDate(timestamp: number | string | null | undefined): string | null {
  if (timestamp == null) return null;
  const d = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yy = (d.getFullYear() % 100).toString().padStart(2, "0");
  const hour12 = d.getHours() % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "pm" : "am";
  return `${dd}/${mm}/${yy} ${hour12.toString().padStart(2, "0")}:${min}${ampm}`;
}

function formatAccountUsageMeta(
  usage: AccountUsageSummary | null,
  timestamp?: number | string | null
): AssistantFooterMeta | null {
  if (!usage?.active) return null;
  const windows = Array.isArray(usage.windows) ? usage.windows : [];
  const session = windows.find((w) => w.label === "Session");
  const sentDate = formatFooterSentDate(timestamp);
  if (!session) {
    const line = [usage.line, sentDate].filter(Boolean).join(" · ");
    return line ? { line, title: usage.title ?? undefined } : null;
  }

  const sessionLine = [
    `5h ${Math.round(session.remainingPercent)}%`,
    `R ${compactResetDuration(session.resetAfterSeconds)}`,
  ].join(" · ");

  const weekly = windows.find((w) => w.label === "Weekly");
  const showWeekly =
    weekly &&
    weekly.remainingPercent <= 10;
  const weeklyLine =
    showWeekly && weekly
      ? [
          `W ${Math.round(weekly.remainingPercent)}%`,
          `R ${compactResetDuration(weekly.resetAfterSeconds)}`,
        ].join(" · ")
      : null;

  const line = [sessionLine, weeklyLine, sentDate].filter(Boolean).join(" · ");
  const title = [usage.title]
    .filter(Boolean)
    .join(" · ");
  return { line, title: title || undefined };
}

function makeDraftTitle(text: string, hasImages: boolean): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return hasImages ? "Image chat" : "New chat";
  if (cleaned.length <= 64) return cleaned;
  const clipped = cleaned.slice(0, 64);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trim();
}

function isCreateBriefText(text: string): boolean {
  return /^\s*CREATE\s+BRIEF\b/i.test(text);
}

function createBriefField(text: string, label: string): string | null {
  const re = new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "i");
  const match = text.match(re);
  return match?.[1]?.trim() || null;
}

function createBriefGoalSummary(text: string): string | null {
  const match = text.match(/(?:^|\n)Goal:\s*\n?([\s\S]*?)(?:\n\n[A-Z][A-Za-z /-]+:|$)/);
  const goal = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!goal) return null;
  return goal.length > 160 ? `${goal.slice(0, 157).trim()}...` : goal;
}

function CreateBriefPreview({ text }: { text: string }) {
  const mode = createBriefField(text, "Mode");
  const output = createBriefField(text, "Output");
  const subtype =
    createBriefField(text, "Subtype selected") ?? createBriefField(text, "Subtype");
  const vault = createBriefField(text, "Vault source");
  const goal = createBriefGoalSummary(text);
  const chips = [mode, output, subtype].filter(Boolean);
  return (
    <MessageContent variant="contained" className="w-full max-w-[min(100%,42rem)]">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Create brief</div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="max-w-full rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-blue-400/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-200">
            Hidden context
          </span>
        </div>
        {goal ? <p className="text-sm leading-relaxed text-foreground/85">{goal}</p> : null}
        {vault ? <p className="text-xs text-muted-foreground">Vault: {vault}</p> : null}
        <details className="group rounded-md border border-white/10 bg-black/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            View full Create brief
          </summary>
          <pre className="max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words border-t border-white/10 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground">
            {text}
          </pre>
        </details>
      </div>
    </MessageContent>
  );
}

function latestAssistantNotesForRecipe(messages: LocalMessage[]): string | undefined {
  const last = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant" && getTextContent(msg.content).trim());
  if (!last) return undefined;
  return getTextContent(last.content).trim().slice(0, 5000);
}

type SavePatternUserField =
  | "brief"
  | "reviewedBrief"
  | "sourceMaterial"
  | "exactCopy"
  | "dataNotes";

type SavePatternAssetRow = {
  id: string;
  kind: "themeImages" | "includeImages" | "useImages";
  label: string;
  detail: string;
  url: string;
};

type SavePatternTextRow = {
  id: SavePatternUserField;
  label: string;
  detail: string;
  preview: string;
};

function compactSavePatternPreview(value: string | undefined, max = 96): string {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max - 3).trim()}...` : cleaned;
}

function createBriefReusableAssetRows(
  brief?: CreativeStudioSessionPayload["createBrief"]
): SavePatternAssetRow[] {
  if (!brief?.assets) return [];
  const groups: {
    kind: SavePatternAssetRow["kind"];
    label: string;
    items?: NonNullable<NonNullable<typeof brief.assets>["themeImages"]>;
  }[] = [
    { kind: "themeImages", label: "Style image", items: brief.assets.themeImages },
    { kind: "includeImages", label: "Include image", items: brief.assets.includeImages },
    { kind: "useImages", label: "Editable image", items: brief.assets.useImages },
  ];
  return groups.flatMap((group) =>
    (group.items ?? []).map((asset) => ({
      id: asset.id,
      kind: group.kind,
      label: asset.caption?.trim() || asset.name || group.label,
      detail: [group.label, asset.tags?.slice(0, 2).join(", ")]
        .filter(Boolean)
        .join(" · "),
      url: asset.url,
    }))
  );
}

function createBriefReusableTextRows(
  brief?: CreativeStudioSessionPayload["createBrief"]
): SavePatternTextRow[] {
  if (!brief?.user) return [];
  const rows: SavePatternTextRow[] = [
    {
      id: "brief",
      label: "Goal prompt",
      detail: "Only keep if the goal itself is reusable.",
      preview: compactSavePatternPreview(brief.user.brief),
    },
    {
      id: "reviewedBrief",
      label: "Reviewed brief",
      detail: "Keep the edited brief text.",
      preview: compactSavePatternPreview(brief.user.reviewedBrief),
    },
    {
      id: "sourceMaterial",
      label: "Source text",
      detail: "Reusable background, examples, or notes.",
      preview: compactSavePatternPreview(brief.user.sourceMaterial),
    },
    {
      id: "exactCopy",
      label: "Exact copy",
      detail: "Footer, CTA, legal wording, names, or fixed text.",
      preview: compactSavePatternPreview(brief.user.exactCopy),
    },
    {
      id: "dataNotes",
      label: "Extra notes",
      detail: "Reusable placement/context guidance.",
      preview: compactSavePatternPreview(brief.user.dataNotes),
    },
  ];
  return rows.filter((row) => row.preview);
}

/**
 * `v=` query (workspace slug hint from draft). Allow same chars as project slugs.
 * Server remains authoritative; hint only fills the gap before GET /api/sessions returns projectId.
 */
const VAULT_SLUG_HINT_RE = /^[a-zA-Z0-9._-]{1,256}$/;

function parseVaultSlugHintFromSearch(v: string | null): string | null {
  if (!v || !VAULT_SLUG_HINT_RE.test(v)) return null;
  return v;
}

function projectIdOrVaultHint(
  projectId: string | null | undefined,
  vaultHint: string | null
): string | null {
  const fromApi =
    typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
  if (fromApi) return fromApi;
  return vaultHint;
}

/** Session keys embed the webchat id after the last `webchat:`. Reject stale `k` from a previous route during client-side navigation. */
function sessionKeyForRoute(sessionId: string, kFromUrl: string | null): string {
  if (kFromUrl) {
    const idx = kFromUrl.lastIndexOf("webchat:");
    const embedded = idx >= 0 ? kFromUrl.slice(idx + 8) : kFromUrl;
    if (embedded === sessionId) return kFromUrl;
  }
  return `webchat:${sessionId}`;
}

/** Orb should stay until the mapped transcript has real assistant text (or images), not an empty/thinking-only row. */
function assistantHasVisibleUserReply(msg: ChatMessage | LocalMessage): boolean {
  if (msg.role !== "assistant") return false;
  if (getImageUrls(msg.content).length > 0) return true;
  return getTextContent(msg.content).trim().length > 0;
}

export default function ChatSessionPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;
  const initialQuery = searchParams.get("q");
  const initialOneOffModel = searchParams.get("oom");
  const paramKey = searchParams.get("k");
  const vaultSlugHint = useMemo(
    () => parseVaultSlugHintFromSearch(searchParams.get("v")),
    [searchParams]
  );
  const vaultSlugHintRef = useRef<string | null>(null);
  vaultSlugHintRef.current = vaultSlugHint;
  const didInit = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCancelledRef = useRef(false);
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("New chat");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const messagesRef = useRef<LocalMessage[]>([]);
  messagesRef.current = messages;
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  isLoadingRef.current = isLoading;
  /** True until the first `loadMessages` for the current `sessionId` finishes (chat switch / initial load). */
  const [transcriptPending, setTranscriptPending] = useState(true);
  const [statusText, setStatusText] = useState("Thinking");
  /** Longer activity from session poll when streaming (for auto-expand thinking). */
  const [statusDetailText, setStatusDetailText] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string | null>(null);
  const smoothedPartial = useSmoothedStreamText(partialText);
  const messageCountAtSend = useRef(0);
  /**
   * Gateway may return a longer canonical key after the first fetch. Scoped to `sessionId` so client-side
   * navigations never reuse another chat’s resolved key on the first render (useEffect runs too late).
   */
  const [serverResolved, setServerResolved] = useState<{
    sessionId: string;
    key: string;
  } | null>(null);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while we expect an assistant reply for the current send (or resumed processing). Avoids stale `isLoading` in setTimeout callbacks. */
  const awaitingReplyRef = useRef(false);
  /**
   * True after a successful /api/chat/send until we see an assistant row from the server.
   * The API can briefly report awaitingReply=false before the gateway flushes the transcript — if we stop
   * polling then, the desktop shows an empty reply until refresh (push/mobile still see the answer).
   */
  const expectingAssistantRef = useRef(false);

  const sessionKey =
    (serverResolved?.sessionId === sessionId ? serverResolved.key : null) ??
    sessionKeyForRoute(sessionId, paramKey);
  /** Dedupe one-shot sessionNotice from API (same text on every poll). */
  const lastSessionNoticeRef = useRef<string | null>(null);
  const orbState = isLoading ? ("thinking" as const) : ("listening" as const);
  const localImagesRef = useRef<Map<number, MessageContentPart[]>>(new Map());
  /** Hermes `config.yaml` primary model — corrects footer when stored `model` is `hermes-agent`. */
  const [primaryModelFallback, setPrimaryModelFallback] = useState<string | null>(null);
  const [accountUsageSummary, setAccountUsageSummary] =
    useState<AccountUsageSummary | null>(null);
  const { currency: displayCurrency, rates: fxRates } = useDisplayCurrency();
  const [headerSubline, setHeaderSubline] = useState<string | null>(null);
  const [vaultUploadEnabled, setVaultUploadEnabled] = useState(false);
  /** Workspace (vault) slug when this session is a workspace chat — for vault upload routing. */
  const [activeProjectSlug, setActiveProjectSlug] = useState<string | null>(null);
  /** Builds tab → Edit: gateway targets existing published app; no workspace vault. */
  const [buildEditContext, setBuildEditContext] =
    useState<BuildEditSessionPayload | null>(null);
  /** Create tab → New create: Open Design first preamble; no workspace vault. */
  const [creativeStudioContext, setCreativeStudioContext] =
    useState<CreativeStudioSessionPayload | null>(null);
  const [saveCreateDesignBusy, setSaveCreateDesignBusy] = useState(false);
  const [saveCreateDesignStatus, setSaveCreateDesignStatus] = useState<string | null>(null);
  const [savePatternDialogOpen, setSavePatternDialogOpen] = useState(false);
  const [savePatternName, setSavePatternName] = useState("");
  const [savePatternAssetIds, setSavePatternAssetIds] = useState<string[]>([]);
  const [savePatternUserFields, setSavePatternUserFields] = useState<
    SavePatternUserField[]
  >([]);
  const [createKanbanTasks, setCreateKanbanTasks] = useState<CreateKanbanTask[]>(
    []
  );
  const [createKanbanCleanedAt, setCreateKanbanCleanedAt] = useState<string | null>(
    null
  );
  /** Vault files for empty-workspace hero copy and download bar (null = unknown / loading). */
  const [workspaceVaultFiles, setWorkspaceVaultFiles] = useState<
    WorkspaceVaultFileRow[] | null
  >(null);
  const [sharedIngestJobs, setSharedIngestJobs] = useState<SharedIngestJobPublic[]>(
    []
  );
  const [sharedIngestHero, setSharedIngestHero] = useState<SharedIngestHeroPayload | null>(
    null
  );
  const [privateReingestHero, setPrivateReingestHero] =
    useState<PrivateReingestHeroPayload | null>(null);
  const [privateHermesReingestJobs, setPrivateHermesReingestJobs] = useState<
    HermesPrivateReingestJobPublic[]
  >([]);
  const [activeWorkspaceVisibility, setActiveWorkspaceVisibility] = useState<
    "private" | "shared" | null
  >(null);
  const lastAssistantMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const creativeStudioHasUserMessage = useMemo(
    () => messages.some((m) => m.role === "user"),
    [messages]
  );
  const savePatternAssetRows = useMemo(
    () => createBriefReusableAssetRows(creativeStudioContext?.createBrief),
    [creativeStudioContext?.createBrief]
  );
  const savePatternTextRows = useMemo(
    () => createBriefReusableTextRows(creativeStudioContext?.createBrief),
    [creativeStudioContext?.createBrief]
  );

  useEffect(() => {
    const boardSlug = creativeStudioContext?.kanbanBoardSlug?.trim();
    if (!boardSlug) {
      const snapshot = creativeStudioContext?.kanbanSnapshot;
      setCreateKanbanTasks(Array.isArray(snapshot?.tasks) ? snapshot.tasks : []);
      setCreateKanbanCleanedAt(
        creativeStudioContext?.kanbanCleanedAt ?? snapshot?.cleanedAt ?? null
      );
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const qs = sessionKey ? `?k=${encodeURIComponent(sessionKey)}` : "";
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/kanban${qs}`,
          { cache: "no-store" }
        );
        const d = (await r.json().catch(() => ({}))) as {
          tasks?: CreateKanbanTask[];
          cleanedAt?: string | null;
        };
        if (!cancelled) {
          setCreateKanbanTasks(Array.isArray(d.tasks) ? d.tasks : []);
          setCreateKanbanCleanedAt(
            typeof d.cleanedAt === "string" && d.cleanedAt.trim()
              ? d.cleanedAt.trim()
              : null
          );
        }
      } catch {
        if (!cancelled) {
          setCreateKanbanTasks([]);
          setCreateKanbanCleanedAt(null);
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, isLoading ? 1500 : 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    creativeStudioContext?.kanbanBoardSlug,
    creativeStudioContext?.kanbanCleanedAt,
    creativeStudioContext?.kanbanSnapshot?.boardSlug,
    isLoading,
    sessionId,
    sessionKey,
  ]);

  const [sharedVaultGapHints, setSharedVaultGapHints] = useState<
    SharedVaultGapHint[]
  >([]);
  /** Next shared-ingest-status poll uses forceScan=1 (slug change, upload, manual refresh). */
  const sharedIngestForceScanRef = useRef(true);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const { agentName } = useChatIdentity();
  const { thinkingOutputAuto } = useSettings();
  const pendingVaultNonceConsumed = useRef<string | null>(null);
  const pendingWorkspaceDraftNonceConsumed = useRef<string | null>(null);
  const pendingCreativeStudioDraftNonceConsumed = useRef<string | null>(null);
  const creativeStudioInitialSendStarted = useRef<string | null>(null);
  const sendToServerRef = useRef<
    (
      text: string,
      imageUrls?: string[],
      ingestModelOverrideExplicit?: string | null,
      oneOffModelId?: string | null
    ) => Promise<void>
  >(async () => {});

  function applyProjectSubline(
    snapshotId: string,
    projectLabel: string | null | undefined
  ) {
    if (sessionIdRef.current !== snapshotId) return;
    const sub =
      typeof projectLabel === "string" && projectLabel.trim()
        ? projectLabel.trim()
        : null;
    setHeaderSubline(sub);
  }

  function applyBuildEditOrWorkspaceBinding(
    snapshotId: string,
    args: {
      buildEdit: BuildEditSessionPayload | null | undefined;
      creativeStudio: CreativeStudioSessionPayload | null | undefined;
      projectLabel: string | null | undefined;
      projectId: string | null | undefined;
    }
  ) {
    if (sessionIdRef.current !== snapshotId) return;
    if (args.buildEdit) {
      setCreativeStudioContext(null);
      setBuildEditContext(args.buildEdit);
      setHeaderSubline(
        args.buildEdit.gatewayAppDir
          ? `Editing files in place — ${args.buildEdit.gatewayAppDir}`
          : "URL-only in manifest — describe launcher or metadata changes"
      );
      setActiveProjectSlug(null);
      return;
    }
    if (args.creativeStudio) {
      setBuildEditContext(null);
      setCreativeStudioContext(args.creativeStudio);
      const cs = args.creativeStudio;
      const refSlug = cs.referenceVaultSlug?.trim();
      setHeaderSubline(
        refSlug
          ? `Create · ${creativeStudioIntentLabel(cs.intent)} · ${cs.referenceVaultName?.trim() || refSlug}`
          : `Create · ${creativeStudioIntentLabel(cs.intent)}`
      );
      setActiveProjectSlug(null);
      return;
    }
    setBuildEditContext(null);
    setCreativeStudioContext(null);
    applyProjectSubline(snapshotId, args.projectLabel);
    setActiveProjectSlug(
      projectIdOrVaultHint(
        args.projectId ?? null,
        vaultSlugHintRef.current
      )
    );
  }

  useEffect(() => {
    void fetch("/api/projects")
      .then((r) => setVaultUploadEnabled(r.ok))
      .catch(() => setVaultUploadEnabled(false));
  }, []);

  /** Keep `?v=` aligned with the session’s vault once the server returns `projectId`. */
  useEffect(() => {
    if (!activeProjectSlug || !vaultSlugHint) return;
    if (activeProjectSlug === vaultSlugHint) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("v", activeProjectSlug);
    const q = next.toString();
    router.replace(q ? `/chat/${sessionId}?${q}` : `/chat/${sessionId}`);
  }, [activeProjectSlug, vaultSlugHint, sessionId, searchParams, router]);

  useEffect(() => {
    void fetch("/api/hermes/primary-model")
      .then((r) => r.json())
      .then((d: { model?: unknown }) => {
        if (typeof d?.model === "string" && d.model.trim()) {
          setPrimaryModelFallback(d.model.trim());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAccountUsage = () => {
      void fetch("/api/hermes/account-usage", { cache: "no-store" })
        .then((r) => r.json().catch(() => null))
        .then((d: AccountUsageSummary | null) => {
          if (!cancelled) setAccountUsageSummary(d?.active ? d : null);
        })
        .catch(() => {
          if (!cancelled) setAccountUsageSummary(null);
        });
    };
    loadAccountUsage();
    const timer = window.setInterval(loadAccountUsage, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setTranscriptPending(true);
    setMessages([]);
    setPartialText(null);
    setStatusDetailText(null);
    /** Stale `isLoading` from the previous session shows the inline “thinking” row (e.g. “Let me find that.”) after navigation — wrong surface for chat switches. */
    setIsLoading(false);
    lastSessionNoticeRef.current = null;
    localImagesRef.current = new Map();
    expectingAssistantRef.current = false;
    setHeaderSubline(null);
    setWorkspaceVaultFiles(null);
    setSharedIngestJobs([]);
    setSharedIngestHero(null);
    setPrivateReingestHero(null);
    setPrivateHermesReingestJobs([]);
    setActiveWorkspaceVisibility(null);
    setSharedVaultGapHints([]);
    setBuildEditContext(null);
    setCreativeStudioContext(null);
    setActiveProjectSlug(null);
  }, [sessionId]);

  useEffect(() => {
    function onSessionLabel(ev: Event) {
      const e = ev as CustomEvent<{ sessionId?: string; label?: string }>;
      const sid =
        typeof e.detail?.sessionId === "string" ? e.detail.sessionId : "";
      const lab = typeof e.detail?.label === "string" ? e.detail.label : "";
      if (!lab || sid !== sessionId) return;
      setTitle(lab);
    }
    window.addEventListener("hermeschat-session-label", onSessionLabel);
    return () =>
      window.removeEventListener("hermeschat-session-label", onSessionLabel);
  }, [sessionId]);

  /** Keep the vault files bar focused on uploaded source files, not generated source-tree artifacts. */
  function isHiddenVaultArtifactPath(name: string, relativePath: string): boolean {
    const n = (name || "").toLowerCase();
    const p = (relativePath || "").replace(/\\/g, "/").toLowerCase();
    const marker = "/sources/";
    const markerIndex = p.indexOf(marker);
    const underSources =
      markerIndex >= 0
        ? p.slice(markerIndex + marker.length)
        : p.startsWith("sources/")
          ? p.slice("sources/".length)
          : n.replace(/\\/g, "/");
    return (
      n.endsWith(".py") ||
      p.endsWith(".py") ||
      underSources.split("/").filter(Boolean).length > 1
    );
  }

  const fetchWorkspaceVaultFileRows = useCallback(
    async (slug: string): Promise<WorkspaceVaultFileRow[] | null> => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/files`, {
          cache: "no-store",
        });
        if (!r.ok) return null;
        const d = (await r.json()) as {
          files?: {
            name?: string;
            relativePath?: string;
            size?: number;
            assetRole?: string | null;
          }[];
        };
        const rows = Array.isArray(d.files)
          ? d.files
              .map((f) => ({
                name: typeof f.name === "string" ? f.name : "",
                relativePath:
                  typeof f.relativePath === "string" ? f.relativePath : "",
                size: typeof f.size === "number" ? f.size : 0,
                ...(f.assetRole != null && String(f.assetRole).trim()
                  ? { assetRole: String(f.assetRole).trim() }
                  : {}),
              }))
              .filter(
                (f) =>
                  f.name &&
                  f.relativePath &&
                  !isHiddenVaultArtifactPath(f.name, f.relativePath)
              )
          : [];
        return rows;
      } catch {
        return null;
      }
    },
    []
  );

  const onVaultReingestQueued = useCallback(
    (p: {
      jobId: string;
      fileName: string;
      projectSlug: string;
      assetRole?: string | null;
    }) => {
      if (p.projectSlug !== activeProjectSlug) return;
      const payload: SharedIngestHeroPayload = {
        jobId: p.jobId,
        projectSlug: p.projectSlug,
        fileName: p.fileName,
        workspaceSessionKey: sessionKey,
        nonce: crypto.randomUUID(),
        ...(p.assetRole != null && String(p.assetRole).trim()
          ? { assetRole: normalizeVaultAssetRole(p.assetRole) }
          : {}),
      };
      setSharedIngestHero(payload);
      try {
        sessionStorage.setItem(
          SHARED_INGEST_HERO_KEY,
          JSON.stringify(payload)
        );
      } catch {
        /* ignore */
      }
      sharedIngestForceScanRef.current = true;
      void fetchWorkspaceVaultFileRows(p.projectSlug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
    },
    [activeProjectSlug, sessionKey, fetchWorkspaceVaultFileRows]
  );

  const onVaultPrivateReingestStarted = useCallback(
    (p: {
      jobId: string;
      fileName: string;
      projectSlug: string;
      assetRole?: string | null;
    }) => {
      if (p.projectSlug !== activeProjectSlug) return;
      const payload: PrivateReingestHeroPayload = {
        jobId: p.jobId,
        projectSlug: p.projectSlug,
        fileName: p.fileName,
        workspaceSessionKey: sessionKey,
        nonce: crypto.randomUUID(),
        ...(p.assetRole != null && String(p.assetRole).trim()
          ? { assetRole: normalizeVaultAssetRole(p.assetRole) }
          : {}),
      };
      setPrivateReingestHero(payload);
      try {
        sessionStorage.setItem(
          PRIVATE_REINGEST_HERO_KEY,
          JSON.stringify(payload)
        );
      } catch {
        /* ignore */
      }
      void fetchWorkspaceVaultFileRows(p.projectSlug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
      try {
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      } catch {
        /* ignore */
      }
    },
    [activeProjectSlug, sessionKey, fetchWorkspaceVaultFileRows]
  );

  const dismissPrivateReingestJob = useCallback(
    (jobId: string) => {
      try {
        sessionStorage.removeItem(PRIVATE_REINGEST_HERO_KEY);
      } catch {
        /* ignore */
      }
      setPrivateReingestHero(null);
      if (activeProjectSlug) {
        void fetch(
          `/api/projects/${encodeURIComponent(activeProjectSlug)}/private-reingest-status`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          }
        ).catch(() => {});
        void fetchWorkspaceVaultFileRows(activeProjectSlug).then((rows) => {
          if (rows) setWorkspaceVaultFiles(rows);
        });
      }
      try {
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      } catch {
        /* ignore */
      }
    },
    [activeProjectSlug, fetchWorkspaceVaultFileRows]
  );

  const dismissSharedIngestHero = useCallback(() => {
    try {
      sessionStorage.removeItem(SHARED_INGEST_HERO_KEY);
    } catch {
      /* ignore */
    }
    setSharedIngestHero(null);
    if (activeProjectSlug) {
      sharedIngestForceScanRef.current = true;
      void fetch(
        `/api/projects/${encodeURIComponent(activeProjectSlug)}/shared-ingest-status?forceScan=1`,
        { cache: "no-store" }
      )
        .then((r) => r.json())
        .then(
          (d: {
            jobs?: SharedIngestJobPublic[];
            gapHints?: SharedVaultGapHint[] | null;
          }) => {
            setSharedIngestJobs(Array.isArray(d.jobs) ? d.jobs : []);
            setSharedVaultGapHints(Array.isArray(d.gapHints) ? d.gapHints : []);
          }
        )
        .catch(() => {});
      void fetchWorkspaceVaultFileRows(activeProjectSlug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
    }
  }, [activeProjectSlug, fetchWorkspaceVaultFileRows]);

  const vaultFilesForBar = useMemo(() => {
    const base = workspaceVaultFiles ?? [];
    let rows =
      base.length > 0
        ? base
        : (() => {
            const fromJobs = [
              ...sharedIngestJobs.map((j) => ({
                name: j.fileName,
                relativePath: j.relativePath,
                size: 0,
              })),
              ...privateHermesReingestJobs.map((j) => ({
                name: j.fileName,
                relativePath: j.relativePath,
                size: 0,
              })),
            ];
            const seen = new Set<string>();
            return fromJobs.filter((f) => {
              if (seen.has(f.relativePath)) return false;
              seen.add(f.relativePath);
              return true;
            });
          })();
    if (sharedVaultGapHints.length > 0) {
      const seen = new Set(rows.map((r) => r.relativePath));
      for (const h of sharedVaultGapHints) {
        if (!seen.has(h.relativePath)) {
          rows = [
            ...rows,
            { name: h.name, relativePath: h.relativePath, size: 0 },
          ];
          seen.add(h.relativePath);
        }
      }
    }
    return rows.filter(
      (r) => !isHiddenVaultArtifactPath(r.name, r.relativePath)
    );
  }, [
    workspaceVaultFiles,
    sharedIngestJobs,
    privateHermesReingestJobs,
    sharedVaultGapHints,
  ]);

  useEffect(() => {
    sharedIngestForceScanRef.current = true;
  }, [activeProjectSlug]);

  useEffect(() => {
    if (!activeProjectSlug) {
      setActiveWorkspaceVisibility(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/projects/${encodeURIComponent(activeProjectSlug)}`, {
      cache: "no-store",
    })
      .then((r) => r.json().catch(() => ({})))
      .then((d: { visibility?: unknown }) => {
        if (cancelled) return;
        const v = d?.visibility;
        if (v === "shared" || v === "private") {
          setActiveWorkspaceVisibility(v);
        } else {
          setActiveWorkspaceVisibility(null);
        }
      })
      .catch(() => {
        if (!cancelled) setActiveWorkspaceVisibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectSlug]);

  const refreshVaultFilesAndIngestHints = useCallback(() => {
    sharedIngestForceScanRef.current = true;
    if (activeProjectSlug) {
      void fetchWorkspaceVaultFileRows(activeProjectSlug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
    }
  }, [activeProjectSlug, fetchWorkspaceVaultFileRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(SHARED_INGEST_HERO_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as SharedIngestHeroPayload;
      if (p.workspaceSessionKey !== sessionKey) return;
      setSharedIngestHero(p);
    } catch {
      /* ignore */
    }
  }, [sessionKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(PRIVATE_REINGEST_HERO_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as PrivateReingestHeroPayload;
      if (p.workspaceSessionKey !== sessionKey) return;
      setPrivateReingestHero(p);
    } catch {
      /* ignore */
    }
  }, [sessionKey]);

  useEffect(() => {
    if (!activeProjectSlug || !vaultUploadEnabled) {
      setSharedIngestJobs([]);
      setSharedVaultGapHints([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const qs = new URLSearchParams();
        if (sharedIngestForceScanRef.current) {
          qs.set("forceScan", "1");
          sharedIngestForceScanRef.current = false;
        }
        const q = qs.toString();
        const r = await fetch(
          `/api/projects/${encodeURIComponent(activeProjectSlug)}/shared-ingest-status${q ? `?${q}` : ""}`,
          { cache: "no-store" }
        );
        const d = (await r.json()) as {
          jobs?: SharedIngestJobPublic[];
          gapHints?: SharedVaultGapHint[] | null;
        };
        if (!cancelled) {
          setSharedIngestJobs(Array.isArray(d.jobs) ? d.jobs : []);
          setSharedVaultGapHints(
            Array.isArray(d.gapHints) ? d.gapHints : []
          );
        }
      } catch {
        if (!cancelled) {
          setSharedIngestJobs([]);
          setSharedVaultGapHints([]);
        }
      }
    };
    void tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeProjectSlug, vaultUploadEnabled]);

  useEffect(() => {
    if (
      !activeProjectSlug ||
      !vaultUploadEnabled ||
      activeWorkspaceVisibility !== "private"
    ) {
      setPrivateHermesReingestJobs([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/projects/${encodeURIComponent(activeProjectSlug)}/private-reingest-status`,
          { cache: "no-store" }
        );
        const d = (await r.json()) as {
          jobs?: HermesPrivateReingestJobPublic[];
        };
        if (!cancelled) {
          setPrivateHermesReingestJobs(Array.isArray(d.jobs) ? d.jobs : []);
        }
      } catch {
        if (!cancelled) setPrivateHermesReingestJobs([]);
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeProjectSlug, vaultUploadEnabled, activeWorkspaceVisibility]);

  useEffect(() => {
    if (!activeProjectSlug) {
      setWorkspaceVaultFiles(null);
      return;
    }
    let cancelled = false;
    void fetchWorkspaceVaultFileRows(activeProjectSlug).then((rows) => {
      if (cancelled) return;
      setWorkspaceVaultFiles(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectSlug, fetchWorkspaceVaultFileRows]);

  const ingestUiActive = useMemo(
    () =>
      sharedIngestHero != null ||
      privateReingestHero != null ||
      sharedIngestJobs.some(
        (j) => j.status === "queued" || j.status === "running"
      ) ||
      privateHermesReingestJobs.some((j) => j.status === "running"),
    [
      sharedIngestHero,
      privateReingestHero,
      sharedIngestJobs,
      privateHermesReingestJobs,
    ]
  );

  const vaultIngestJobsMerged = useMemo((): WorkspaceVaultIngestJob[] => {
    return [...sharedIngestJobs, ...privateHermesReingestJobs];
  }, [sharedIngestJobs, privateHermesReingestJobs]);

  const privateReingestStrip = useMemo(() => {
    if (!activeProjectSlug || activeWorkspaceVisibility !== "private") {
      return null;
    }
    if (
      privateReingestHero &&
      privateReingestHero.projectSlug === activeProjectSlug
    ) {
      return {
        projectSlug: privateReingestHero.projectSlug,
        jobId: privateReingestHero.jobId,
        fileName: privateReingestHero.fileName,
        assetRole: privateReingestHero.assetRole,
      };
    }
    const active = privateHermesReingestJobs.find(
      (j) => j.status === "running" || j.status === "error"
    );
    if (!active) return null;
    return {
      projectSlug: active.projectSlug,
      jobId: active.jobId,
      fileName: active.fileName,
      assetRole: active.assetRole ?? undefined,
    };
  }, [
    activeProjectSlug,
    activeWorkspaceVisibility,
    privateReingestHero,
    privateHermesReingestJobs,
  ]);

  const sharedIngestStrip = useMemo(() => {
    if (!activeProjectSlug) return null;
    if (
      sharedIngestHero &&
      sharedIngestHero.projectSlug === activeProjectSlug
    ) {
      return {
        projectSlug: sharedIngestHero.projectSlug,
        jobId: sharedIngestHero.jobId,
        fileName: sharedIngestHero.fileName,
        assetRole: sharedIngestHero.assetRole,
      };
    }
    const active = sharedIngestJobs.find(
      (j) => j.status === "queued" || j.status === "running"
    );
    if (!active) return null;
    return {
      projectSlug: activeProjectSlug,
      jobId: active.jobId,
      fileName: active.fileName,
      assetRole: active.assetRole,
    };
  }, [activeProjectSlug, sharedIngestHero, sharedIngestJobs]);

  const inlineIngestStrip = useMemo(() => {
    if (privateReingestStrip) return { kind: "private" as const, ...privateReingestStrip };
    if (sharedIngestStrip) return { kind: "shared" as const, ...sharedIngestStrip };
    return null;
  }, [privateReingestStrip, sharedIngestStrip]);

  const showWorkspaceEmptyHero =
    Boolean(activeProjectSlug) &&
    !buildEditContext &&
    !creativeStudioContext &&
    messages.length === 0 &&
    !isLoading &&
    !ingestUiActive;

  const showCreativeStudioEmptyHero =
    Boolean(creativeStudioContext) &&
    messages.length === 0 &&
    !isLoading &&
    !ingestUiActive &&
    !showWorkspaceEmptyHero;

  const showBuildEditEmptyHero =
    Boolean(buildEditContext) &&
    !creativeStudioContext &&
    messages.length === 0 &&
    !isLoading &&
    !ingestUiActive &&
    !showWorkspaceEmptyHero;

  const showVaultArchitectIngestIdleHero =
    Boolean(activeProjectSlug) &&
    ingestUiActive &&
    !buildEditContext &&
    !creativeStudioContext &&
    messages.length === 0 &&
    !isLoading;

  /** Full-column hero outside Conversation scroll — matches `/chat` new-chat vertical slot (header → flex-1 orb → composer). */
  const showTranscriptLoadingHero =
    transcriptPending &&
    !showWorkspaceEmptyHero &&
    !showCreativeStudioEmptyHero &&
    !showBuildEditEmptyHero &&
    !showVaultArchitectIngestIdleHero;

  /** Keep inline Orb / partial row until transcript has real assistant text (not empty/thinking-only). */
  const showInlineThinking = useMemo(() => {
    if (!isLoading) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    if (last.role === "assistant" && !assistantHasVisibleUserReply(last))
      return true;
    return false;
  }, [isLoading, messages]);

  function showErrorAsMessage(
    errorText: string,
    opts?: {
      /** When set, replace client transcript with server messages + error (preserves history on reload / serverError). */
      serverMsgs?: ChatMessage[];
      label?: string | null;
    }
  ) {
    expectingAssistantRef.current = false;
    const errorMsg: LocalMessage = {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: errorText,
    };
    const serverMsgs = opts?.serverMsgs;
    if (serverMsgs && serverMsgs.length > 0) {
      const merged = mergeWithLocalImages(serverMsgs as LocalMessage[]);
      setMessages([...merged, errorMsg]);
      if (opts?.label) {
        setTitle(opts.label);
      } else {
        const firstUser = serverMsgs.find((m) => m.role === "user");
        if (firstUser) {
          const text = getTextContent(firstUser.content);
          setTitle(
            makeDraftTitle(text, getImageUrls(firstUser.content).length > 0)
          );
        }
      }
    } else {
      setMessages((prev) => [...prev, errorMsg]);
    }
    setIsLoading(false);
    setPartialText(null);
    setStatusDetailText(null);
    stopPolling();
    clearSafetyTimeout();
    window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
  }

  function startSafetyTimeout() {
    clearSafetyTimeout();
    awaitingReplyRef.current = true;
    safetyTimeoutRef.current = setTimeout(() => {
      if (!awaitingReplyRef.current) return;
      showErrorAsMessage(
        "No reply yet after a long wait. The run may still be queued or failed — wait a bit, check Hermes, or retry. This message is a client timeout."
      );
    }, 90 * 1000);
  }

  function clearSafetyTimeout() {
    awaitingReplyRef.current = false;
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  }

  function mergeWithLocalImages(serverMsgs: LocalMessage[]): LocalMessage[] {
    if (localImagesRef.current.size === 0) return serverMsgs;
    return serverMsgs.map((msg, idx) => {
      if (msg.role !== "user") return msg;
      const localParts = localImagesRef.current.get(idx);
      if (!localParts) return msg;

      const serverImages = getImageUrls(msg.content);
      if (serverImages.length > 0) return msg;

      const serverText = getTextContent(msg.content);
      const localImages = localParts.filter((p) => p.type === "image_url");
      if (localImages.length === 0) return msg;

      return {
        ...msg,
        content: [
          ...localImages,
          ...(serverText ? [{ type: "text" as const, text: serverText }] : []),
        ],
      };
    });
  }

  const loadMessages = useCallback(async () => {
    const snapshotId = sessionId;
    const {
      messages: msgs,
      status,
      statusDetail,
      partial,
      label,
      resolvedKey,
      serverError,
      awaitingReply,
      replyInFlight,
      sessionBanner,
      sessionNotice,
      notFound,
      fetchFailed,
      projectLabel,
      projectId,
      buildEdit,
      creativeStudio,
    } = await fetchChatMessages(sessionId, sessionKey);
    if (sessionIdRef.current !== snapshotId) {
      return {
        msgs: [],
        status: null,
        label: null,
        awaitingReply: false,
        replyInFlight: false,
        sessionNotice: null,
        fetchFailed: false,
      };
    }
    if (fetchFailed) {
      return {
        msgs: messagesRef.current,
        status: null,
        label: null,
        awaitingReply: awaitingReplyRef.current || expectingAssistantRef.current,
        replyInFlight:
          isLoadingRef.current ||
          awaitingReplyRef.current ||
          expectingAssistantRef.current,
        sessionNotice: null,
        fetchFailed: true,
      };
    }
    applyBuildEditOrWorkspaceBinding(snapshotId, {
      buildEdit: buildEdit ?? null,
      creativeStudio: creativeStudio ?? null,
      projectLabel,
      projectId,
    });
    if (notFound) {
      setBuildEditContext(null);
      setCreativeStudioContext(null);
      applyProjectSubline(snapshotId, null);
      setActiveProjectSlug(null);
      setIsLoading(false);
      stopPolling();
      clearSafetyTimeout();
      return {
        msgs: [],
        status: null,
        label: null,
        awaitingReply: false,
        replyInFlight: false,
        sessionNotice: null,
        fetchFailed: false,
      };
    }
    if (resolvedKey && resolvedKey !== sessionKey) {
      setServerResolved({ sessionId, key: resolvedKey });
    }
    if (serverError) {
      showErrorAsMessage(serverError, { serverMsgs: msgs, label });
      return {
        msgs,
        status: null,
        label,
        awaitingReply: false,
        replyInFlight: false,
        sessionNotice: null,
        fetchFailed: false,
      };
    }
    if (!sessionNotice) lastSessionNoticeRef.current = null;
    if (status) {
      setStatusText(status);
      setStatusDetailText(statusDetail ?? null);
    } else {
      setStatusDetailText(null);
    }
    if (partial !== undefined) setPartialText(partial);
    if (label) setTitle(label);
    else if (buildEdit) setTitle(`Edit: ${buildEdit.name}`);
    else if (creativeStudio)
      setTitle(createCreativeStudioSessionLabel(creativeStudio));
    if (msgs.length > 0) {
      const merged = mergeWithLocalImages(msgs);
      const appendNotice =
        sessionNotice && sessionNotice !== lastSessionNoticeRef.current;
      if (appendNotice) {
        expectingAssistantRef.current = false;
        lastSessionNoticeRef.current = sessionNotice;
        const noticeText =
          noticePrefixForBannerKind(sessionBanner) + sessionNotice;
        setMessages([
          ...merged,
          {
            id: `session-notice-${Date.now()}`,
            role: "assistant",
            content: noticeText,
          },
        ]);
        setIsLoading(false);
        setPartialText(null);
        setStatusDetailText(null);
        stopPolling();
        clearSafetyTimeout();
      } else {
        setMessages(merged);
      }
      if (!label) {
        const firstUser = msgs.find((m) => m.role === "user");
        if (firstUser) {
          const text = getTextContent(firstUser.content);
          setTitle(makeDraftTitle(text, getImageUrls(firstUser.content).length > 0));
        }
      }
      if (!label && !msgs.some((m) => m.role === "user")) {
        setTitle(
          buildEdit
            ? `Edit: ${buildEdit.name}`
            : creativeStudio
              ? createCreativeStudioSessionLabel(creativeStudio)
              : "New chat"
        );
      }
    } else if (!label) {
      setTitle(
        buildEdit
          ? `Edit: ${buildEdit.name}`
          : creativeStudio
            ? createCreativeStudioSessionLabel(creativeStudio)
            : "New chat"
      );
    }
    if (msgs.length === 0 && sessionNotice && sessionNotice !== lastSessionNoticeRef.current) {
      expectingAssistantRef.current = false;
      lastSessionNoticeRef.current = sessionNotice;
      const noticeText =
        noticePrefixForBannerKind(sessionBanner) + sessionNotice;
      setMessages((prev) => [
        ...prev,
        {
          id: `session-notice-${Date.now()}`,
          role: "assistant",
          content: noticeText,
        },
      ]);
      setIsLoading(false);
      setPartialText(null);
      setStatusDetailText(null);
      stopPolling();
      clearSafetyTimeout();
    }
    return {
      msgs,
      status,
      label,
      awaitingReply,
      replyInFlight,
      sessionBanner,
      sessionNotice,
      fetchFailed: false,
    };
  }, [sessionId, sessionKey, router, vaultSlugHint]);

  /** Cron / webhook push: refetch transcript when the tab is open (SW skips OS notification if visible). */
  useEffect(() => {
    const timers: number[] = [];
    let settled = false;

    function reconcilePushWakeResult({
      msgs,
      awaitingReply,
      replyInFlight: inFlight,
      sessionNotice,
      fetchFailed,
    }: {
      msgs: LocalMessage[];
      awaitingReply?: boolean;
      replyInFlight?: boolean;
      sessionNotice?: string | null;
      fetchFailed?: boolean;
    }) {
      if (fetchFailed) {
        if (
          isLoadingRef.current ||
          awaitingReplyRef.current ||
          expectingAssistantRef.current
        ) {
          expectingAssistantRef.current = true;
          setIsLoading(true);
          if (!pollRef.current) startPolling();
          if (!safetyTimeoutRef.current) startSafetyTimeout();
        }
        return;
      }
      const stillWorking = awaitingReply || inFlight;
      if (stillWorking) {
        expectingAssistantRef.current = true;
        setIsLoading(true);
        if (!pollRef.current) startPolling();
        if (!safetyTimeoutRef.current) startSafetyTimeout();
        return;
      }
      settled = true;
      expectingAssistantRef.current = false;
      awaitingReplyRef.current = false;
      setIsLoading(false);
      setPartialText(null);
      setStatusDetailText(null);
      stopPolling();
      clearSafetyTimeout();
      if (msgs.length > 0 || sessionNotice) {
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      }
    }

    function onSwPush() {
      settled = false;
      while (timers.length > 0) {
        const timer = timers.pop();
        if (timer != null) window.clearTimeout(timer);
      }
      const delays = [0, 600, 1500, 3500];
      for (const delay of delays) {
        const timer = window.setTimeout(() => {
          if (settled) return;
          void loadMessages().then(reconcilePushWakeResult);
        }, delay);
        timers.push(timer);
      }
    }
    window.addEventListener("hermeschat-sw-push", onSwPush);
    return () => {
      window.removeEventListener("hermeschat-sw-push", onSwPush);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loadMessages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("fromPush")) return;
    window.dispatchEvent(new Event("hermeschat-sw-push"));
  }, [sessionId]);

  function stopPolling() {
    pollCancelledRef.current = true;
    if (pollRef.current !== null) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollCancelledRef.current = false;
    const run = async () => {
      if (pollCancelledRef.current) return;
      const snapshotId = sessionId;
      const {
        messages: msgs,
        status,
        statusDetail,
        partial,
        label,
        serverError,
        awaitingReply,
        replyInFlight,
        sessionBanner,
        sessionNotice,
        notFound,
        fetchFailed,
        projectLabel,
        projectId,
        buildEdit,
        creativeStudio,
      } = await fetchChatMessages(sessionId, sessionKey);

      if (pollCancelledRef.current || sessionIdRef.current !== snapshotId) return;
      if (fetchFailed) {
        expectingAssistantRef.current = true;
        setIsLoading(true);
        if (!pollCancelledRef.current) {
          startSafetyTimeout();
          pollRef.current = setTimeout(run, TRANSCRIPT_POLL_MS_NO_PARTIAL);
        }
        return;
      }
      applyBuildEditOrWorkspaceBinding(snapshotId, {
        buildEdit: buildEdit ?? null,
        creativeStudio: creativeStudio ?? null,
        projectLabel,
        projectId,
      });

      if (notFound) {
        stopPolling();
        setIsLoading(false);
        setBuildEditContext(null);
        setCreativeStudioContext(null);
        setActiveProjectSlug(null);
        return;
      }

      if (serverError) {
        showErrorAsMessage(serverError, { serverMsgs: msgs, label });
        return;
      }

      if (!sessionNotice) lastSessionNoticeRef.current = null;

      const lastPollMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      /** Server transcript can lag behind the optimistic user row or status file — don't stop polling too early. */
      const serverBehind =
        expectingAssistantRef.current &&
        !sessionNotice &&
        msgs.length < messageCountAtSend.current;

      /** Keep in sync with `onVisibility` lagWait: empty transcript + expecting reply must not wipe optimistic UI. */
      const keepPollingForTranscriptLag =
        awaitingReply ||
        replyInFlight ||
        serverBehind ||
        (expectingAssistantRef.current &&
          !sessionNotice &&
          (lastPollMsg?.role === "user" || msgs.length === 0));

      if (keepPollingForTranscriptLag) {
        if (status) {
          setStatusText(status);
          setStatusDetailText(statusDetail ?? null);
        } else {
          setStatusDetailText(null);
        }
        if (partial !== undefined) setPartialText(partial);
      }

      if (!keepPollingForTranscriptLag) {
        if (msgs.length === 0 && awaitingReplyRef.current) {
          if (!pollCancelledRef.current) {
            pollRef.current = setTimeout(run, TRANSCRIPT_POLL_MS_EMPTY_AWAIT);
          }
          return;
        }
        expectingAssistantRef.current = false;
        const merged = mergeWithLocalImages(msgs);
        const appendNotice =
          sessionNotice && sessionNotice !== lastSessionNoticeRef.current;
        if (appendNotice) {
          lastSessionNoticeRef.current = sessionNotice;
          const noticeText =
            noticePrefixForBannerKind(sessionBanner) + sessionNotice;
          setMessages([
            ...merged,
            {
              id: `session-notice-${Date.now()}`,
              role: "assistant",
              content: noticeText,
            },
          ]);
        } else {
          setMessages(merged);
        }
        setIsLoading(false);
        setPartialText(null);
        setStatusDetailText(null);
        stopPolling();
        clearSafetyTimeout();
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
        {
          const wsSlug =
            typeof projectId === "string" && projectId.trim()
              ? projectId.trim()
              : null;
          if (wsSlug) {
            void fetchWorkspaceVaultFileRows(wsSlug).then((rows) => {
              if (rows) setWorkspaceVaultFiles(rows);
            });
          }
        }
        return;
      }

      if (label) setTitle(label);

      if (msgs.length > messageCountAtSend.current) {
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role === "assistant" && assistantHasVisibleUserReply(lastMsg)) {
          expectingAssistantRef.current = false;
          setMessages(mergeWithLocalImages(msgs));
          setIsLoading(false);
          setPartialText(null);
          setStatusDetailText(null);
          stopPolling();
          clearSafetyTimeout();
          window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
          {
            const wsSlug =
              typeof projectId === "string" && projectId.trim()
                ? projectId.trim()
                : null;
            if (wsSlug) {
              void fetchWorkspaceVaultFileRows(wsSlug).then((rows) => {
                if (rows) setWorkspaceVaultFiles(rows);
              });
            }
          }
          return;
        } else if (msgs.length > 0) {
          setMessages(mergeWithLocalImages(msgs));
        }
      } else if (msgs.length > 0) {
        setMessages(mergeWithLocalImages(msgs));
      }

      const nextMs =
        partial != null && partial !== ""
          ? TRANSCRIPT_POLL_MS_WITH_PARTIAL
          : TRANSCRIPT_POLL_MS_NO_PARTIAL;
      if (!pollCancelledRef.current) {
        startSafetyTimeout();
        pollRef.current = setTimeout(run, nextMs);
      }
    };
    pollRef.current = setTimeout(run, 0);
  }

  useEffect(() => {
    stopPolling();
    clearSafetyTimeout();
  }, [sessionId]);

  useEffect(() => {
    pendingVaultNonceConsumed.current = null;
    pendingWorkspaceDraftNonceConsumed.current = null;
    pendingCreativeStudioDraftNonceConsumed.current = null;
    creativeStudioInitialSendStarted.current = null;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      stopPolling();
      clearSafetyTimeout();
    };
  }, []);

  useEffect(() => {
    const sid = sessionId;
    loadMessages()
      .then(({ msgs, awaitingReply, replyInFlight: inFlight, fetchFailed }) => {
        if (sessionIdRef.current !== sid) return;
        if (fetchFailed) {
          if (
            isLoadingRef.current ||
            awaitingReplyRef.current ||
            expectingAssistantRef.current
          ) {
            expectingAssistantRef.current = true;
            setIsLoading(true);
            if (!pollRef.current) startPolling();
            if (!safetyTimeoutRef.current) startSafetyTimeout();
          }
          return;
        }
        if (awaitingReply || inFlight) {
          expectingAssistantRef.current = true;
          setIsLoading(true);
          messageCountAtSend.current = msgs.length;
          startPolling();
          startSafetyTimeout();
        } else {
          /** Do not clear loading if the client already sent and is waiting for the server transcript / awaitingReply to flip true (common on first message after `?q=` navigation). */
          if (!expectingAssistantRef.current) {
            setIsLoading(false);
            clearSafetyTimeout();
          }
        }
      })
      .finally(() => {
        if (sessionIdRef.current !== sid) return;
        setTranscriptPending(false);
      });
  }, [loadMessages, sessionId]);

  useEffect(() => {
    const timers: number[] = [];

    const clearResumeTimers = () => {
      while (timers.length > 0) {
        const timer = timers.pop();
        if (timer != null) window.clearTimeout(timer);
      }
    };

    function reconcileResumeRead({
      msgs,
      awaitingReply,
      replyInFlight: inFlight,
      sessionNotice,
      fetchFailed,
    }: {
      msgs: LocalMessage[];
      awaitingReply?: boolean;
      replyInFlight?: boolean;
      sessionNotice?: string | null;
      fetchFailed?: boolean;
    }) {
      if (fetchFailed) {
        if (
          isLoadingRef.current ||
          awaitingReplyRef.current ||
          expectingAssistantRef.current
        ) {
          expectingAssistantRef.current = true;
          setIsLoading(true);
          if (!pollRef.current) startPolling();
          if (!safetyTimeoutRef.current) startSafetyTimeout();
        }
        return;
      }

      const lastM = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const serverBehindVis =
        expectingAssistantRef.current &&
        !sessionNotice &&
        msgs.length < messageCountAtSend.current;
      const lagWait =
        awaitingReply ||
        inFlight ||
        serverBehindVis ||
        (expectingAssistantRef.current &&
          !sessionNotice &&
          (lastM?.role === "user" || msgs.length === 0));
      if (lagWait) {
        expectingAssistantRef.current = true;
        if (!isLoadingRef.current) {
          setIsLoading(true);
          messageCountAtSend.current = msgs.length;
        }
        if (!pollRef.current) startPolling();
        if (!safetyTimeoutRef.current) startSafetyTimeout();
      } else {
        expectingAssistantRef.current = false;
        awaitingReplyRef.current = false;
        setIsLoading(false);
        setPartialText(null);
        setStatusDetailText(null);
        stopPolling();
        clearSafetyTimeout();
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      }
    }

    function scheduleResumeSync() {
      if (document.visibilityState === "hidden") return;
      clearResumeTimers();
      for (const delay of [0, 400, 1200, 3000]) {
        const timer = window.setTimeout(() => {
          void loadMessages().then(reconcileResumeRead);
        }, delay);
        timers.push(timer);
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") scheduleResumeSync();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", scheduleResumeSync);
    window.addEventListener("focus", scheduleResumeSync);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", scheduleResumeSync);
      window.removeEventListener("focus", scheduleResumeSync);
      clearResumeTimers();
    };
  }, [loadMessages]);

  async function sendToServer(
    text: string,
    imageUrls?: string[],
    ingestModelOverrideExplicit?: string | null,
    oneOffModelId?: string | null
  ) {
    const hasImages = imageUrls && imageUrls.length > 0;
    const contentParts: MessageContentPart[] | null = hasImages
      ? [
          ...imageUrls.map((url): MessageContentPart => ({ type: "image_url", image_url: { url } })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ]
      : null;

    const content: string | MessageContentPart[] = contentParts || text;

    const userMsg: LocalMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const prior = messagesRef.current;
    const isFirstMessage = prior.length === 0;
    const msgIndex = prior.length;

    if (isFirstMessage) {
      setTitle(makeDraftTitle(text, !!hasImages));
    }

    if (contentParts) {
      localImagesRef.current.set(msgIndex, contentParts.filter((p) => p.type === "image_url"));
    }

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    /** Set before fetch so late `loadMessages()` completions cannot clear thinking while the request is in flight. */
    expectingAssistantRef.current = true;
    setStatusText("Thinking");
    setStatusDetailText(null);
    setPartialText(null);
    lastSessionNoticeRef.current = null;
    messageCountAtSend.current = prior.length + 1;

    const apiMessages = [
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content },
    ];

    const ingestModelOverride = normalizeIngestModelOverride(
      ingestModelOverrideExplicit ?? undefined
    );

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          sessionKey,
          chatSessionId: sessionId,
          isFirstMessage,
          ...(ingestModelOverride ? { ingestModelOverride } : {}),
          ...(oneOffModelId ? { oneOffModelId } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setIsLoading(false);
        setStatusText("Error");
        setStatusDetailText(null);
        setPartialText(
          data.error ||
            (res.status === 503
              ? "Server misconfiguration: set HERMES_URL and HERMES_TOKEN (same as Hermes API_SERVER_KEY in hermes-data/.env)."
              : "Could not send message.")
        );
        awaitingReplyRef.current = false;
        expectingAssistantRef.current = false;
        return;
      }
    } catch {
      setIsLoading(false);
      setStatusText("Error");
      setStatusDetailText(null);
      setPartialText("Network error.");
      awaitingReplyRef.current = false;
      expectingAssistantRef.current = false;
      return;
    }

    /** Prime status/partial from disk immediately now that POST returns before the stream finishes. */
    void loadMessages();
    startPolling();
    startSafetyTimeout();
  }

  sendToServerRef.current = sendToServer;

  /** Resume vault ingest after navigate to workspace session (sessionStorage bridge). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const raw = sessionStorage.getItem(VAULT_PENDING_INGEST_KEY);
          if (!raw) return;
          const p = JSON.parse(raw) as VaultPendingIngestPayload;
          if (p.targetSessionKey !== sessionKey) return;
          if (pendingVaultNonceConsumed.current === p.nonce) return;
          pendingVaultNonceConsumed.current = p.nonce;
          sessionStorage.removeItem(VAULT_PENDING_INGEST_KEY);
          await loadMessages();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              void sendToServerRef.current(
                p.ingestText,
                undefined,
                p.ingestModelOverride ?? null
              );
            });
          });
        } catch {
          /* ignore */
        }
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [sessionKey, sessionId, loadMessages]);

  /** First message from workspace draft page (text / plain ingest) after session creation. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const raw = sessionStorage.getItem(WORKSPACE_DRAFT_INITIAL_KEY);
          if (!raw) return;
          const p = JSON.parse(raw) as WorkspaceDraftInitialPayload;
          if (p.sessionId !== sessionId) return;
          if (pendingWorkspaceDraftNonceConsumed.current === p.nonce) return;
          pendingWorkspaceDraftNonceConsumed.current = p.nonce;
          sessionStorage.removeItem(WORKSPACE_DRAFT_INITIAL_KEY);
          await loadMessages();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              void sendToServerRef.current(
                p.text,
                undefined,
                p.ingestModelOverride ?? null
              );
            });
          });
        } catch {
          /* ignore */
        }
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [sessionKey, sessionId, loadMessages]);

  /** Reviewed Create brief after /api/builds/create-session navigation. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let text = "";
          const marker = `hermes-creative-studio-autosent:${sessionId}`;
          const raw = sessionStorage.getItem(CREATIVE_STUDIO_DRAFT_INITIAL_KEY);
          if (raw) {
            const p = JSON.parse(raw) as CreativeStudioDraftInitialPayload;
            if (p.sessionId === sessionId) {
              text = typeof p.text === "string" ? p.text.trim() : "";
              sessionStorage.removeItem(CREATIVE_STUDIO_DRAFT_INITIAL_KEY);
            }
          }

          if (!text && creativeStudioContext?.seedPrompt && messages.length === 0 && !isLoading) {
            if (!sessionStorage.getItem(marker)) {
              text = creativeStudioContext.seedPrompt.trim();
            }
          }

          if (!text) return;
          if (
            pendingCreativeStudioDraftNonceConsumed.current === marker ||
            creativeStudioInitialSendStarted.current === sessionId ||
            sessionStorage.getItem(marker)
          ) {
            return;
          }
          pendingCreativeStudioDraftNonceConsumed.current = marker;
          creativeStudioInitialSendStarted.current = sessionId;
          sessionStorage.setItem(marker, "1");

          const { msgs, awaitingReply, replyInFlight } = await loadMessages();
          if (msgs.length > 0 || awaitingReply || replyInFlight) {
            creativeStudioInitialSendStarted.current = null;
            return;
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              void sendToServerRef.current(text);
            });
          });
        } catch {
          /* ignore */
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [
    creativeStudioContext?.seedPrompt,
    isLoading,
    loadMessages,
    messages.length,
    sessionId,
  ]);

  useEffect(() => {
    if (didInit.current || !initialQuery) return;
    didInit.current = true;

    const alreadySent = sessionStorage.getItem(`oc-sent-${sessionId}`);
    if (alreadySent) return;

    const timer = setTimeout(async () => {
      sessionStorage.setItem(`oc-sent-${sessionId}`, "1");

      window.history.replaceState(null, "", `/chat/${sessionId}`);

      let imageUrls: string[] | undefined;
      try {
        const stored = sessionStorage.getItem(`pending-images-${sessionId}`);
        if (stored) {
          sessionStorage.removeItem(`pending-images-${sessionId}`);
          const pending: string[] = JSON.parse(stored);
          const resolved: string[] = [];
          for (const img of pending) {
            if (img.startsWith("/api/images/")) {
              resolved.push(img);
            } else if (img.startsWith("data:image/")) {
              try {
                const res = await fetch("/api/images/upload", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image: img }),
                });
                if (res.ok) {
                  const { url } = await res.json();
                  resolved.push(url);
                }
              } catch {}
            }
          }
          if (resolved.length > 0) imageUrls = resolved;
        }
      } catch {}
      sendToServer(
        initialQuery,
        imageUrls,
        undefined,
        initialOneOffModel?.trim() || null
      );
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialOneOffModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onSummarizeRequest(ev: Event) {
      const e = ev as CustomEvent<{
        sessionId?: string;
        sessionKey?: string;
        text?: string;
      }>;
      if (e.detail?.sessionId !== sessionId) return;
      const text =
        typeof e.detail?.text === "string" && e.detail.text.trim()
          ? e.detail.text.trim()
          : HERMESCHAT_SUMMARIZE_PROMPT;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void sendToServerRef.current(text);
        });
      });
    }
    window.addEventListener(HERMESCHAT_SUMMARIZE_EVENT, onSummarizeRequest);
    return () =>
      window.removeEventListener(HERMESCHAT_SUMMARIZE_EVENT, onSummarizeRequest);
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const raw = sessionStorage.getItem(
            PENDING_HERMESCHAT_SUMMARIZE_KEY
          );
          if (!raw) return;
          const p = JSON.parse(raw) as {
            sessionId?: string;
            text?: string;
          };
          if (p.sessionId !== sessionId) return;
          sessionStorage.removeItem(PENDING_HERMESCHAT_SUMMARIZE_KEY);
          const text =
            typeof p.text === "string" && p.text.trim()
              ? p.text.trim()
              : HERMESCHAT_SUMMARIZE_PROMPT;
          await loadMessages();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              void sendToServerRef.current(text);
            });
          });
        } catch {
          /* ignore */
        }
      })();
    }, 200);
    return () => clearTimeout(t);
  }, [sessionId, loadMessages]);

  function handleSubmit(
    text: string,
    imageUrls?: string[],
    options?: { oneOffModelId?: string }
  ) {
    const msg = text.trim();
    if ((!msg && (!imageUrls || imageUrls.length === 0)) || isLoading) return;
    sendToServer(
      msg,
      imageUrls,
      undefined,
      options?.oneOffModelId?.trim() || null
    );
  }

  function openSaveCreatePatternDialog() {
    const createBrief = creativeStudioContext?.createBrief;
    if (!createBrief || saveCreateDesignBusy) return;
    const fallbackName =
      title.trim() && title.trim() !== "New chat"
        ? title.trim()
        : `${createBrief.output.displayName} · ${createBrief.subtype.label}`;
    setSavePatternName(fallbackName);
    setSavePatternAssetIds([]);
    setSavePatternUserFields(
      createBrief.user.exactCopy?.trim() ? ["exactCopy"] : []
    );
    setSaveCreateDesignStatus(null);
    setSavePatternDialogOpen(true);
  }

  function toggleSavePatternAsset(id: string) {
    setSavePatternAssetIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function toggleSavePatternUserField(id: SavePatternUserField) {
    setSavePatternUserFields((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  async function handleSaveCreateDesign() {
    const createBrief = creativeStudioContext?.createBrief;
    if (!createBrief || saveCreateDesignBusy) return;
    setSaveCreateDesignBusy(true);
    setSaveCreateDesignStatus(null);
    try {
      const r = await fetch("/api/create-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savePatternName.trim() || undefined,
          createBrief,
          persist: {
            assetIds: savePatternAssetIds,
            userFields: savePatternUserFields,
          },
          resultNotes: latestAssistantNotesForRecipe(messagesRef.current),
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        throw new Error(d.error || "Could not save pattern");
      }
      setSavePatternDialogOpen(false);
      setSaveCreateDesignStatus("Saved to Patterns");
      window.setTimeout(() => setSaveCreateDesignStatus(null), 3500);
    } catch (error) {
      setSaveCreateDesignStatus(
        error instanceof Error ? error.message : "Could not save pattern"
      );
    } finally {
      setSaveCreateDesignBusy(false);
    }
  }

  return (
    <ActiveWorkspaceSlugProvider value={activeProjectSlug}>
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
      {buildEditContext || creativeStudioContext ? (
        <div className="flex flex-shrink-0 flex-col border-b border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)]">
          <div className="flex items-center justify-between gap-3 px-4 py-1.5">
            <button
              type="button"
              onClick={() => router.push("/chat/builds")}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              ← Create
            </button>
            {creativeStudioContext?.createBrief ? (
              <div className="flex min-w-0 items-center gap-2">
                {saveCreateDesignStatus ? (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {saveCreateDesignStatus}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={openSaveCreatePatternDialog}
                  disabled={saveCreateDesignBusy}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-sidebar-border/40 bg-sidebar-accent/25 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/45 hover:text-foreground disabled:opacity-60"
                  title="Open a chooser for saving this Create setup as an output-specific pattern."
                >
                  {saveCreateDesignStatus === "Saved to Patterns" ? (
                    <CheckIcon className="size-3.5" aria-hidden />
                  ) : (
                    <BookmarkPlusIcon className="size-3.5" aria-hidden />
                  )}
                  Save pattern
                </button>
              </div>
            ) : null}
          </div>
          {creativeStudioContext?.referenceVaultSlug &&
          !creativeStudioHasUserMessage ? (
            <p
              className="truncate px-4 pb-1.5 text-[11px] leading-snug text-muted-foreground"
              title={`${creativeStudioContext.referenceVaultName?.trim() || creativeStudioContext.referenceVaultSlug} · ${creativeStudioContext.referenceVaultSlug}`}
            >
              Reference vault:{" "}
              <span className="font-medium text-foreground/90">
                {creativeStudioContext.referenceVaultName?.trim() ||
                  creativeStudioContext.referenceVaultSlug}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      {savePatternDialogOpen && creativeStudioContext?.createBrief ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Save Create pattern"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saveCreateDesignBusy) {
              setSavePatternDialogOpen(false);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-lg border border-sidebar-border/60 bg-sidebar p-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-foreground">Save Create pattern</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              This saves the reusable setup into{" "}
              <span className="font-medium text-foreground">
                {creativeStudioContext.createBrief.output.displayName}
              </span>
              {" "}Saved patterns. It keeps mode, output/subtype, template, DNA, carry choices,
              route extras, and tuning. Extras below are off by default; tick
              only what should come back every time.
            </p>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              Pattern name
              <input
                value={savePatternName}
                onChange={(e) => setSavePatternName(e.target.value)}
                disabled={saveCreateDesignBusy}
                className="mt-1.5 w-full rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 px-3 py-2 text-sm text-foreground outline-none focus:border-sidebar-primary/70"
                placeholder="Name this reusable setup"
              />
            </label>
            <div className="mt-4 rounded-lg border border-sidebar-border/45 bg-sidebar-accent/15 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Reusable extras</h3>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Useful for logos, icons, fixed footers, CTAs, or placement notes.
                  </p>
                </div>
                {savePatternAssetIds.length + savePatternUserFields.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSavePatternAssetIds([]);
                      setSavePatternUserFields([]);
                    }}
                    disabled={saveCreateDesignBusy}
                    className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              {savePatternAssetRows.length === 0 && savePatternTextRows.length === 0 ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  This run has no images or reusable text buckets to keep.
                </p>
              ) : (
                <div className="mt-3 grid max-h-[34dvh] gap-2 overflow-auto pr-1">
                  {savePatternAssetRows.map((asset) => (
                    <label
                      key={asset.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-sidebar-border/35 bg-sidebar/45 p-2"
                    >
                      <input
                        type="checkbox"
                        checked={savePatternAssetIds.includes(asset.id)}
                        onChange={() => toggleSavePatternAsset(asset.id)}
                        disabled={saveCreateDesignBusy}
                        className="size-3.5 shrink-0"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.url}
                        alt=""
                        className="size-8 shrink-0 rounded border border-sidebar-border/35 object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {asset.label}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {asset.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                  {savePatternTextRows.map((row) => (
                    <label
                      key={row.id}
                      className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-sidebar-border/35 bg-sidebar/45 p-2"
                    >
                      <input
                        type="checkbox"
                        checked={savePatternUserFields.includes(row.id)}
                        onChange={() => toggleSavePatternUserField(row.id)}
                        disabled={saveCreateDesignBusy}
                        className="mt-0.5 size-3.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-foreground">
                          {row.label}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {row.detail}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-foreground/70">
                          {row.preview}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {saveCreateDesignStatus ? (
              <p className="mt-3 text-xs text-muted-foreground">{saveCreateDesignStatus}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSavePatternDialogOpen(false)}
                disabled={saveCreateDesignBusy}
                className="rounded-md border border-sidebar-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveCreateDesign()}
                disabled={saveCreateDesignBusy}
                className="rounded-md border border-sidebar-primary/50 bg-sidebar-primary/20 px-3 py-1.5 text-xs font-semibold text-sidebar-primary hover:bg-sidebar-primary/30 disabled:opacity-60"
              >
                {saveCreateDesignBusy ? "Saving..." : "Save pattern"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ChatHeader
        title={title}
        subline={
          activeProjectSlug
            ? headerSubline?.trim() || activeProjectSlug
            : headerSubline
        }
        vaultHeader={Boolean(activeProjectSlug)}
        renameSessionId={sessionId}
        renameSessionKey={sessionKey}
        onChatTitleSaved={(label) => setTitle(label)}
        onChatSessionDeleted={() => {
          router.push("/chat?new=1");
        }}
      />
      {activeProjectSlug && vaultUploadEnabled ? (
        <WorkspaceVaultFilesBar
          projectSlug={activeProjectSlug}
          workspaceSessionId={sessionId}
          files={vaultFilesForBar}
          ingestJobs={vaultIngestJobsMerged}
          gapHints={
            sharedVaultGapHints.length > 0 ? sharedVaultGapHints : null
          }
          workspaceIsShared={activeWorkspaceVisibility === "shared"}
          onVaultRefresh={refreshVaultFilesAndIngestHints}
          onReingestQueued={onVaultReingestQueued}
          onPrivateReingestStarted={onVaultPrivateReingestStarted}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
      {showTranscriptLoadingHero ? (
        <div
          className="flex flex-1 min-h-0 flex-col items-center justify-center gap-6 px-6 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="relative size-64">
            <Orb
              agentState="listening"
              colors={["#a3c4f3", "#6b8cce"]}
              className="size-full"
            />
          </div>
          <div className="max-w-sm text-center">
            <p className="text-sm text-muted-foreground">
              Let me get that for you.
            </p>
          </div>
        </div>
      ) : (
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="px-4 py-2 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]">
          {showWorkspaceEmptyHero ? (
            <div className="flex min-h-[min(70dvh,28rem)] flex-1 flex-col items-center justify-center gap-6 px-2 py-8 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]">
              <div className="relative size-64">
                <Orb
                  agentState="listening"
                  colors={["#a3c4f3", "#6b8cce"]}
                  className="size-full"
                />
              </div>
              <div className="max-w-sm text-center">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  I&apos;m {agentName}
                </h2>
                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                  {getOrbHelper({ surface: "vault-empty" })}
                </p>
              </div>
            </div>
          ) : null}
          {showCreativeStudioEmptyHero && creativeStudioContext ? (
            <div className="flex min-h-[min(70dvh,28rem)] flex-1 flex-col items-center justify-center gap-6 px-2 py-8 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]">
              <CreativeStudioOrbTips
                intent={creativeStudioContext.intent}
                enabled
                agentState={orbState}
                layout="hero"
              />
              <div className="max-w-sm text-center">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  I&apos;m {agentName}
                </h2>
                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                  {creativeStudioIntentLabel(creativeStudioContext.intent)}
                </p>
              </div>
            </div>
          ) : null}
          {showBuildEditEmptyHero && buildEditContext ? (
            <div className="flex min-h-[min(70dvh,28rem)] flex-1 flex-col items-center justify-center gap-6 px-2 py-8 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]">
              <div className="relative size-64 shrink-0">
                <Orb
                  agentState={orbState}
                  colors={["#a3c4f3", "#6b8cce"]}
                  className="size-full"
                />
              </div>
              <div className="max-w-sm text-center">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  I&apos;m {agentName}
                </h2>
                <p className="mt-2 text-sm font-medium leading-snug text-foreground">
                  {buildEditContext.name}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Describe what you want to change — copy, layout, styling, or new
                  sections. I&apos;ll update the published app files in your builds
                  folder when we&apos;re done.
                </p>
              </div>
            </div>
          ) : null}
          {showVaultArchitectIngestIdleHero ? (
            inlineIngestStrip?.kind === "private" ? (
              <PrivateHermesReingestHero
                projectSlug={inlineIngestStrip.projectSlug}
                jobId={inlineIngestStrip.jobId}
                fileName={inlineIngestStrip.fileName}
                onComplete={(jid) => void dismissPrivateReingestJob(jid)}
              />
            ) : inlineIngestStrip?.kind === "shared" ? (
              <SharedIngestArchitectHero
                projectSlug={inlineIngestStrip.projectSlug}
                jobId={inlineIngestStrip.jobId}
                fileName={inlineIngestStrip.fileName}
                assetRole={inlineIngestStrip.assetRole}
                onComplete={dismissSharedIngestHero}
              />
            ) : (
              <VaultArchitectIngestIdleHero
                enabled={showVaultArchitectIngestIdleHero}
                agentName={agentName}
              />
            )
          ) : null}
          {creativeStudioContext?.kanbanBoardSlug ||
          creativeStudioContext?.kanbanSnapshot?.boardSlug ? (
            <CreateKanbanFeed
              boardSlug={
                creativeStudioContext.kanbanBoardSlug ||
                creativeStudioContext.kanbanSnapshot?.boardSlug ||
                ""
              }
              tasks={createKanbanTasks}
              loading={
                Boolean(creativeStudioContext.kanbanBoardSlug) &&
                (isLoading || transcriptPending)
              }
              cleanedAt={
                createKanbanCleanedAt ||
                creativeStudioContext.kanbanCleanedAt ||
                creativeStudioContext.kanbanSnapshot?.cleanedAt ||
                null
              }
            />
          ) : null}
          {!showWorkspaceEmptyHero &&
            !showCreativeStudioEmptyHero &&
            !showBuildEditEmptyHero &&
            !showVaultArchitectIngestIdleHero &&
            !transcriptPending &&
            messages.length === 0 &&
            !isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-12">
              <div className="size-24">
                <Orb
                  agentState={orbState}
                  colors={["#a3c4f3", "#6b8cce"]}
                  className="size-full"
                />
              </div>
            </div>
          )}
          {messages.map((msg, msgIndex) => {
            const messageRenderKey = `${msg.id || "message"}-${msgIndex}`;
            const text = getTextContent(msg.content);
            const images = getImageUrls(msg.content);
            const isUser = msg.role === "user";
            const isCreateBrief = isUser && isCreateBriefText(text);
            const followUpOptions =
              msg.role === "assistant" &&
              msgIndex === lastAssistantMessageIndex &&
              !isLoading
                ? extractAssistantFollowUpSuggestions(text)
                : null;

            if (
              !isUser &&
              images.length === 0 &&
              activeProjectSlug &&
              shouldSuppressAssistantNarration(text)
            ) {
              return null;
            }

            if (isUser && images.length > 0) {
              return (
                <Fragment key={messageRenderKey}>
                  <UserTurnDivider />
                  <Message from="user">
                    <div className="flex w-full min-w-0 flex-col items-end gap-2">
                      <div className="flex w-full flex-col items-end gap-2">
                        {images.map((src, i) => (
                          <MarkdownImageWithActions
                            key={i}
                            src={src}
                            alt=""
                            className="h-auto max-h-[min(48dvh,380px)] w-auto max-w-[min(100%,400px)] rounded-lg object-contain select-none"
                          />
                        ))}
                      </div>
                      {text.trim() ? (
                        isCreateBrief ? (
                          <CreateBriefPreview text={text} />
                        ) : (
                          <MessageContent variant="contained">{text}</MessageContent>
                        )
                      ) : null}
                    </div>
                  </Message>
                </Fragment>
              );
            }

            if (!isUser && images.length > 0) {
              const accountMeta = formatAccountUsageMeta(accountUsageSummary, msg.timestamp);
              const meta: AssistantFooterMeta | null = accountMeta
                ? accountMeta
                : formatAssistantMessageMeta(
                    msg,
                    displayCurrency,
                    fxRates,
                    primaryModelFallback
                  );
              return (
                <Message key={messageRenderKey} from="assistant">
                  <div className="flex w-full min-w-0 flex-col items-start gap-2">
                    <div className="flex w-full flex-col items-start gap-2">
                      {images.map((src, i) => (
                        <MarkdownImageWithActions
                          key={i}
                          src={src}
                          alt=""
                          className="h-auto max-h-[min(48dvh,380px)] w-auto max-w-[min(100%,400px)] rounded-lg object-contain select-none"
                        />
                      ))}
                    </div>
                    {text.trim() ? (
                      <MessageContent variant="flat" className="w-full min-w-0">
                        <Response>{text}</Response>
                        {followUpOptions && followUpOptions.length > 0 ? (
                          <AssistantFollowUpChips
                            options={followUpOptions}
                            disabled={isLoading}
                            onSend={(prompt) => {
                              if (isLoading) return;
                              void sendToServerRef.current(
                                prompt.trim(),
                                undefined,
                                undefined,
                                null
                              );
                            }}
                          />
                        ) : null}
	                        <div
	                          data-hermes-print-skip
	                          className="mt-1 flex w-full min-w-0 max-w-full flex-nowrap items-baseline gap-x-1.5 text-left text-[10px] leading-tight text-muted-foreground select-none"
	                        >
	                          <PrintReplyButton text={text} />
	                          {meta ? (
	                            <span data-hermes-tip={meta.title} className="min-w-0 truncate">
	                              {meta.line}
	                            </span>
	                          ) : null}
	                          <CopyReplyButton text={text} />
	                          <SpeakReplyButton text={text} messageId={msg.id} />
	                        </div>
                      </MessageContent>
                    ) : meta ? (
                      <span
	                        data-hermes-tip={meta.title}
                        className="block w-full min-w-0 shrink-0 whitespace-normal text-left text-[10px] leading-tight text-muted-foreground select-none"
                      >
                        {meta.line}
                      </span>
                    ) : null}
                  </div>
                </Message>
              );
            }

            return (
              <Fragment key={messageRenderKey}>
                {isUser ? <UserTurnDivider /> : null}
                <Message from={isUser ? "user" : "assistant"}>
                  {isCreateBrief ? (
                    <CreateBriefPreview text={text} />
                  ) : (
                    <MessageContent
                      variant={isUser ? "contained" : "flat"}
                      className={msg.role === "assistant" ? "w-full min-w-0" : undefined}
                    >
                      {msg.role === "assistant" ? (
                      <>
                        <Response>{text}</Response>
                        {followUpOptions && followUpOptions.length > 0 ? (
                          <AssistantFollowUpChips
                            options={followUpOptions}
                            disabled={isLoading}
                            onSend={(prompt) => {
                              if (isLoading) return;
                              void sendToServerRef.current(
                                prompt.trim(),
                                undefined,
                                undefined,
                                null
                              );
                            }}
                          />
                        ) : null}
                        {text.trim() ? (
                          (() => {
                            const accountMeta =
                              formatAccountUsageMeta(accountUsageSummary, msg.timestamp);
                            const meta: AssistantFooterMeta | null = accountMeta
                              ? accountMeta
                              : formatAssistantMessageMeta(
                                  msg,
                                  displayCurrency,
                                  fxRates,
                                  primaryModelFallback
                                );
                            return (
	                              <div
	                                data-hermes-print-skip
	                                className="mt-1 flex w-full min-w-0 max-w-full flex-nowrap items-baseline gap-x-1.5 text-left text-[10px] leading-tight text-muted-foreground select-none"
	                              >
	                                <PrintReplyButton text={text} />
	                                {meta ? (
	                                  <span data-hermes-tip={meta.title} className="min-w-0 truncate">
	                                    {meta.line}
	                                  </span>
	                                ) : null}
	                                <CopyReplyButton text={text} />
	                                <SpeakReplyButton text={text} messageId={msg.id} />
	                              </div>
                            );
                          })()
                        ) : (
                          (() => {
                            const accountMeta =
                              formatAccountUsageMeta(accountUsageSummary, msg.timestamp);
                            const meta: AssistantFooterMeta | null = accountMeta
                              ? accountMeta
                              : formatAssistantMessageMeta(
                                  msg,
                                  displayCurrency,
                                  fxRates,
                                  primaryModelFallback
                                );
                            return meta ? (
                              <div
                                data-hermes-print-skip
                                data-hermes-tip={meta.title}
                                className="mt-1 flex w-full min-w-0 max-w-full flex-nowrap items-baseline gap-x-1.5 text-left text-[10px] leading-tight text-muted-foreground select-none"
                              >
                                <span className="min-w-0 truncate">{meta.line}</span>
                              </div>
                            ) : null;
                          })()
                        )}
                      </>
                      ) : (
                        text || null
                      )}
                    </MessageContent>
                  )}
                </Message>
              </Fragment>
            );
          })}
          {showInlineThinking && (
            <div className="pb-4">
              <Message from="assistant">
                <MessageContent variant="flat" className="w-full min-w-0">
                  {partialText?.trim() ? (
                    <div className="flex w-full min-w-0 items-end gap-3">
                      <OrbDoubleTapStop
                        sessionKey={sessionKey}
                        enabled={showInlineThinking && isLoading}
                        onStopped={() => void loadMessages()}
                        className="size-16 shrink-0"
                      >
                        <Orb
                          agentState="typing"
                          colors={["#a3c4f3", "#6b8cce"]}
                          className="size-full"
                        />
                      </OrbDoubleTapStop>
                      <div className="min-w-0 flex-1">
                        <Response>{smoothedPartial}</Response>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "flex w-full min-w-0 gap-3",
                        thinkingOutputAuto ? "items-start" : "items-center"
                      )}
                    >
                      <OrbDoubleTapStop
                        sessionKey={sessionKey}
                        enabled={showInlineThinking && isLoading}
                        onStopped={() => void loadMessages()}
                        className="size-16 shrink-0"
                      >
                        <Orb
                          agentState="thinking"
                          colors={["#a3c4f3", "#6b8cce"]}
                          className="size-full"
                        />
                      </OrbDoubleTapStop>
                      <p
                        className={cn(
                          "min-w-0 flex-1 text-sm font-medium leading-snug text-foreground",
                          thinkingOutputAuto
                            ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere] line-clamp-5 min-h-[2.75rem]"
                            : "truncate"
                        )}
	                        data-hermes-tip={
	                          thinkingOutputAuto
                            ? statusDetailText?.trim() ||
                              statusText ||
                              undefined
                            : undefined
                        }
                      >
                        {thinkingOutputAuto
                          ? (
                              statusDetailText?.trim() ||
                              statusText
                            ).trim()
                          : compactThinkingSummary(statusText)}
                      </p>
                    </div>
                  )}
                </MessageContent>
              </Message>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      )}
      </div>

      <ChatInput
        ref={chatInputRef}
        input={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        attachMode={activeProjectSlug ? "workspace" : "chat"}
        suggestionScope={
          buildEditContext || creativeStudioContext
            ? "builds"
            : activeProjectSlug
              ? "vault"
              : "chat"
        }
        threadHasMessages={messages.length > 0}
        vaultUploadEnabled={vaultUploadEnabled}
        activeWorkspaceSlug={activeProjectSlug}
        workspaceProjectName={headerSubline ?? activeProjectSlug}
        currentSessionId={sessionId}
        currentSessionKey={sessionKey}
        onVaultIngestComplete={(p) => {
          if (p.visibility === "shared" && p.ingestJobId && p.fileName) {
            try {
              sessionStorage.setItem(
                SHARED_INGEST_HERO_KEY,
                JSON.stringify({
                  jobId: p.ingestJobId,
                  projectSlug: p.slug,
                  fileName: p.fileName,
                  workspaceSessionKey: p.workspaceSessionKey,
                  nonce: crypto.randomUUID(),
                  ...(p.assetRole ? { assetRole: p.assetRole } : {}),
                } satisfies SharedIngestHeroPayload)
              );
            } catch {
              /* ignore */
            }
            sharedIngestForceScanRef.current = true;
            void fetchWorkspaceVaultFileRows(p.slug).then((rows) => {
              if (rows) setWorkspaceVaultFiles(rows);
            });
            router.replace(
              `/chat/${p.workspaceSessionId}?k=${encodeURIComponent(p.workspaceSessionKey)}&v=${encodeURIComponent(p.slug)}`
            );
            return;
          }
	          if (activeProjectSlug === p.slug) {
	            void fetchWorkspaceVaultFileRows(p.slug).then((rows) => {
	              if (rows) setWorkspaceVaultFiles(rows);
	            });
	            if (p.visibility !== "shared" && p.ingestJobId && p.fileName) {
	              const payload: PrivateReingestHeroPayload = {
	                jobId: p.ingestJobId,
	                projectSlug: p.slug,
	                fileName: p.fileName,
	                workspaceSessionKey: p.workspaceSessionKey,
	                nonce: crypto.randomUUID(),
	                ...(p.assetRole ? { assetRole: p.assetRole } : {}),
	              };
	              setPrivateReingestHero(payload);
	              try {
	                sessionStorage.setItem(
	                  PRIVATE_REINGEST_HERO_KEY,
	                  JSON.stringify(payload)
	                );
	              } catch {
	                /* ignore */
	              }
	            } else if (p.visibility !== "shared") {
	              void sendToServer(p.ingestText, undefined, undefined);
	            }
	            return;
	          }
	          if (p.visibility !== "shared" && p.ingestJobId && p.fileName) {
	            try {
	              sessionStorage.setItem(
	                PRIVATE_REINGEST_HERO_KEY,
	                JSON.stringify({
	                  jobId: p.ingestJobId,
	                  projectSlug: p.slug,
	                  fileName: p.fileName,
	                  workspaceSessionKey: p.workspaceSessionKey,
	                  nonce: crypto.randomUUID(),
	                  ...(p.assetRole ? { assetRole: p.assetRole } : {}),
	                } satisfies PrivateReingestHeroPayload)
	              );
	            } catch {
	              /* ignore */
	            }
	          } else if (p.visibility !== "shared") {
	            try {
	              sessionStorage.setItem(
	                VAULT_PENDING_INGEST_KEY,
	                JSON.stringify({
	                  targetSessionKey: p.workspaceSessionKey,
	                  ingestText: p.ingestText,
	                  nonce: crypto.randomUUID(),
	                } satisfies VaultPendingIngestPayload)
	              );
	            } catch {
	              /* ignore */
	            }
	          }
          router.replace(
            `/chat/${p.workspaceSessionId}?k=${encodeURIComponent(p.workspaceSessionKey)}&v=${encodeURIComponent(p.slug)}`
          );
        }}
      />
    </div>
    </ActiveWorkspaceSlugProvider>
  );
}
