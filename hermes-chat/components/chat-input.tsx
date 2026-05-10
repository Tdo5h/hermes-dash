"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { SendIcon, MicIcon, XIcon, ImageIcon } from "lucide-react";
import {
  OneOffModelPickerSheet,
  type OneOffPlanPick,
  type OneOffTier,
} from "@/components/OneOffModelPickerSheet";
import { postHermesStackActive } from "@/lib/post-hermes-stack";
import {
  readStackPlanDriftPersisted,
  writeStackPlanDriftPersisted,
  clearStackPlanDriftPersisted,
  reconcileStackPlanDriftPersistedWithServer,
  STACK_PLAN_DRIFT_CHANGED_EVENT,
} from "@/lib/stack-plan-drift-persist";
import { StackGatewayApplyOverlay } from "@/components/StackGatewayApplyOverlay";
import { InferencePipelineDialog } from "@/components/InferencePipelineDialog";
import { waitMinApplyDuration } from "@/lib/wait-min-apply";
import { AttachMenu } from "@/components/AttachMenu";
import { VaultPasteIngestModal } from "@/components/VaultPasteIngestModal";
import {
  WorkspacePickDialog,
  type WorkspacePickResult,
} from "@/components/WorkspacePickDialog";
import {
  OrgLibraryUploadConfirmDialog,
  VaultFileAlreadyPresentDialog,
  type VaultDuplicateKind,
} from "@/components/VaultUploadGateDialogs";
import { fetchVaultHasUploadBasename } from "@/lib/vault-upload-basename";
import { SuggestedPromptConfirmDialog } from "@/components/SuggestedPromptConfirmDialog";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import { sha256HexFile } from "@/lib/vault-file-hash";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { AddingImageOverlay } from "@/components/AddingImageOverlay";
import { useDeepgramDictation } from "@/lib/use-deepgram-dictation";
import {
  getComposerSuggestions,
  type ComposerHelperScope,
} from "@/lib/helper-suggestions";
import { useRotatingHelper } from "@/lib/use-rotating-helper";
import type { OpenRouterCreditsPayload } from "@/lib/openrouter-credits";
import {
  buildOpenRouterLowBalanceInputLine,
  isOpenRouterLowBalance,
  parseStackActiveTier,
} from "@/lib/openrouter-credit-thresholds";
import type { PresetId } from "@/lib/or-model-ids";
import { planDisplayLabelForTier, type PresetsForCompare } from "@/lib/or-plan-compare";
import { fetchChatSessions } from "@/lib/sessions";

/** True if any sidebar session reports `processing` (may differ from this thread's `isLoading` after switching chats). */
async function anyChatSessionProcessing(): Promise<boolean> {
  const { sessions, buildEditSessions, creativeStudioSessions } =
    await fetchChatSessions();
  return [...sessions, ...buildEditSessions, ...creativeStudioSessions].some(
    (s) => s.processing
  );
}

export type VaultIngestCompletePayload = {
  slug: string;
  ingestText: string;
  workspaceSessionId: string;
  workspaceSessionKey: string;
  /** Background ingest job id. Shared jobs use the shared worker; private jobs stay tenant-local. */
  visibility?: "private" | "shared";
  fileName?: string;
  ingestJobId?: string;
  assetRole?: VaultAssetRole;
};

export type ChatInputHandle = {
  /** Opens the vault document picker (same as Attach → file). No-op if vault uploads are unavailable. */
  openVaultFilePicker: () => void;
  /** Opens paste-to-vault modal (when wired + workspace mode). */
  openVaultPasteIngestModal: () => void;
};

export type ChatSubmitOptions = {
  /** Use this model id for this message only (normal chat, not vault ingest). */
  oneOffModelId?: string;
};

interface ChatInputProps {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, images?: string[], options?: ChatSubmitOptions) => void;
  isLoading: boolean;
  /** Shown when send is blocked (e.g. rate-limit backoff). */
  cooldownHint?: string;
  /** Server has HERMES_DATA_DIR and project APIs are available. */
  vaultUploadEnabled?: boolean;
  /** After upload: parent resolves workspace session and may navigate before ingest. */
  onVaultIngestComplete?: (payload: VaultIngestCompletePayload) => void;
  /** When set and upload `slug` matches, ingest uses this session instead of the default workspace thread. */
  activeWorkspaceSlug?: string | null;
  currentSessionId?: string;
  currentSessionKey?: string;
  /**
   * Workspace draft page: no session id yet — create a new sub-chat via POST …/chats before ingest
   * instead of resolving the default workspace thread.
   */
  ensureNewWorkspaceSessionBeforeIngest?: boolean;
  /** Display name for the active vault (paste ingest message). */
  workspaceProjectName?: string | null;
  /** `chat`: image-only button. `workspace`: plus menu (image + file). */
  attachMode?: "chat" | "workspace";
  /** Which helper suggestions to show when the composer is empty (no images). */
  suggestionScope?: ComposerHelperScope;
  /** Use follow-up-style suggestions after there are messages in the thread. */
  threadHasMessages?: boolean;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Known image extensions when the browser omits `File.type` (common for Downloads / exports).
 */
const IMAGE_FILENAME_RE =
  /\.(jpe?g|jfi|jfif|png|gif|webp|heic|heif|bmp|svg|tif|tiff|avif|ico|cur)$/i;

function shouldTryAsChatImage(f: File): boolean {
  if (f.size <= 0 || f.size > MAX_IMAGE_SIZE) return false;
  const t = f.type.trim().toLowerCase();
  if (t.startsWith("image/")) return true;
  if (
    t.startsWith("video/") ||
    t.startsWith("audio/") ||
    t.startsWith("text/")
  ) {
    return false;
  }
  if (t === "application/pdf") return false;
  if (IMAGE_FILENAME_RE.test(f.name)) return true;
  if (!t) return true;
  if (t === "application/octet-stream") return true;
  return true;
}

function sentenceStart(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const VAULT_FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.eml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,message/rfc822";

interface AttachedImage {
  previewUrl: string;
  serverUrl: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImage(dataUrl: string): Promise<{ previewUrl: string; serverUrl: string }> {
  const res = await fetch("/api/images/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Upload failed (${res.status})`
    );
  }
  if (typeof data.url !== "string") {
    throw new Error("Upload failed: invalid response");
  }
  return { previewUrl: data.url, serverUrl: data.url };
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      input,
      onChange,
      onSubmit,
      isLoading,
      cooldownHint,
      vaultUploadEnabled = false,
      onVaultIngestComplete,
      activeWorkspaceSlug = null,
      currentSessionId,
      currentSessionKey,
      ensureNewWorkspaceSessionBeforeIngest = false,
      workspaceProjectName = null,
      attachMode = "chat",
      suggestionScope = "chat",
      threadHasMessages = false,
    },
    ref
  ) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vaultFileInputRef = useRef<HTMLInputElement>(null);
  const vaultImageInputRef = useRef<HTMLInputElement>(null);
  const {
    voiceState,
    voiceErrorHint,
    toggleRecording: handleVoicePress,
    cleanupSession: cleanupVoiceSession,
  } = useDeepgramDictation({
    getBaseText: () => input,
    applyText: onChange,
  });

  const [vaultPasteModalOpen, setVaultPasteModalOpen] = useState(false);
  const [vaultPasteInitialImages, setVaultPasteInitialImages] = useState<File[]>([]);
  const canPasteIngest = Boolean(
    attachMode === "workspace" &&
      activeWorkspaceSlug?.trim() &&
      workspaceProjectName?.trim() &&
      onVaultIngestComplete
  );

  useImperativeHandle(
    ref,
    () => ({
      openVaultFilePicker: () => {
        if (!vaultUploadEnabled || !onVaultIngestComplete) return;
        setVaultErr(null);
        setVaultHint(null);
        vaultFileInputRef.current?.click();
      },
      openVaultPasteIngestModal: () => {
        if (!canPasteIngest) return;
        setVaultPasteModalOpen(true);
      },
    }),
    [canPasteIngest, vaultUploadEnabled, onVaultIngestComplete]
  );
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const [workspacePickOpen, setWorkspacePickOpen] = useState(false);
  const [orgLibraryUploadConfirmOpen, setOrgLibraryUploadConfirmOpen] =
    useState(false);
  const [vaultDuplicateDialog, setVaultDuplicateDialog] = useState<{
    kind: VaultDuplicateKind;
    fileName?: string;
    vaultLabel?: string;
  } | null>(null);
  const [pendingWorkspacePickFileName, setPendingWorkspacePickFileName] =
    useState("");
  const [vaultHint, setVaultHint] = useState<string | null>(null);
  const [vaultErr, setVaultErr] = useState<string | null>(null);
  const [backgroundIngestNotice, setBackgroundIngestNotice] = useState<{
    fileName?: string;
    visibility?: "private" | "shared";
    mode?: "light" | "full";
    payload: VaultIngestCompletePayload;
  } | null>(null);
  const [imageAttachErr, setImageAttachErr] = useState<string | null>(null);
  /** File picked in the same user gesture as "Add file" (required on mobile); workspace chosen after. */
  const stagedVaultFileRef = useRef<File | null>(null);
  const [openRouterCredits, setOpenRouterCredits] =
    useState<OpenRouterCreditsPayload | null>(null);
  const [activeStackTier, setActiveStackTier] = useState<PresetId | null>(null);
  const [stackPresetsForLabel, setStackPresetsForLabel] =
    useState<PresetsForCompare | null>(null);
  const [planBanner, setPlanBanner] = useState<
    | {
        kind: "stack";
        revertTo: OneOffTier;
        pickedTier: OneOffTier;
        pickedLabel: string;
        homeLabel: string;
      }
    | { kind: "oneoff"; errorNote?: string }
    | null
  >(null);

  const loadCreditsAndStack = useCallback(() => {
    void (async () => {
      const [creditsResult, stackResult] = await Promise.allSettled([
        fetch("/api/openrouter/credits", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null
        ),
        fetch("/api/hermes/stack", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null
        ),
      ]);
      if (creditsResult.status === "fulfilled" && creditsResult.value) {
        setOpenRouterCredits(creditsResult.value as OpenRouterCreditsPayload);
      }
      const stack = (stackResult.status === "fulfilled" ? stackResult.value : null) as {
        presets?: {
          active?: string;
          presets?: Record<string, { label?: string; mainModel?: string }>;
        };
      } | null;
      const activeTier = stack?.presets
        ? parseStackActiveTier(stack.presets.active)
        : null;
      if (stack?.presets) {
        setActiveStackTier(activeTier);
        if (stack.presets.presets) {
          setStackPresetsForLabel({ presets: stack.presets.presets });
        } else {
          setStackPresetsForLabel(null);
        }
      } else {
        setActiveStackTier(null);
        setStackPresetsForLabel(null);
      }
      reconcileStackPlanDriftPersistedWithServer(activeTier);
      setPlanBanner((prev) => {
        if (prev?.kind === "oneoff") return prev;
        const p = readStackPlanDriftPersisted();
        if (!p) return null;
        return {
          kind: "stack",
          revertTo: p.revertTo,
          pickedTier: p.pickedTier,
          pickedLabel: p.pickedLabel,
          homeLabel: p.homeLabel,
        };
      });
    })();
  }, []);

  useEffect(() => {
    loadCreditsAndStack();
    function onVis() {
      if (document.visibilityState === "visible") loadCreditsAndStack();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadCreditsAndStack]);

  useEffect(() => {
    function onDrift() {
      loadCreditsAndStack();
    }
    window.addEventListener(STACK_PLAN_DRIFT_CHANGED_EVENT, onDrift);
    return () =>
      window.removeEventListener(STACK_PLAN_DRIFT_CHANGED_EVENT, onDrift);
  }, [loadCreditsAndStack]);

  async function addImagesFromFiles(rawFiles: File[]) {
    if (isLoading || uploading) return;
    setImageAttachErr(null);
    const imageFiles = Array.from(rawFiles).filter(shouldTryAsChatImage);
    const remaining = MAX_IMAGES - attachedImages.length;
    const toProcess = imageFiles.slice(0, remaining);
    if (toProcess.length === 0) {
      setImageAttachErr(
        "No file to upload, or type not allowed (e.g. PDF/video). Pick an image up to 20 MB, or try a common format (.jpg, .png, .webp)."
      );
      return;
    }

    setUploading(true);
    setAddingImages(true);
    try {
      for (const file of toProcess) {
        const dataUrl = await fileToDataUrl(file);
        const uploaded = await uploadImage(dataUrl);
        setAttachedImages((prev) => [...prev, uploaded].slice(0, MAX_IMAGES));
      }
    } catch (e: unknown) {
      setImageAttachErr(
        e instanceof Error ? e.message : "Image upload failed. Try again."
      );
    } finally {
      setAddingImages(false);
      setUploading(false);
    }
  }

  async function uploadVaultAndIngest(
    slug: string,
    file: File,
    pick: WorkspacePickResult
  ) {
    if (!onVaultIngestComplete) return;
    setVaultErr(null);
    setVaultHint("Preparing file…");
    setUploading(true);
    try {
      const sha256 = await sha256HexFile(file);
      setVaultHint("Uploading file…");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("sha256", sha256);
      fd.set("assetRole", pick.assetRole);
      if (pick.assetRole === "org_global" && activeWorkspaceSlug?.trim()) {
        fd.set("contextVaultSlug", activeWorkspaceSlug.trim());
      }
      if (currentSessionId?.trim() && slug === activeWorkspaceSlug?.trim()) {
        fd.set("sourceWebchatId", currentSessionId.trim());
      }
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/files`,
        { method: "POST", body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as {
        relativePath?: string;
        fileName?: string;
        mimeType?: string;
        projectSlug?: string;
        projectName?: string;
        visibility?: "private" | "shared";
        ingestJobId?: string;
        assetRole?: string;
        error?: string;
        duplicate?: boolean;
        duplicatePath?: string | null;
      };
      if (!res.ok) {
        setVaultErr(data.error || `Upload failed (HTTP ${res.status})`);
        setVaultHint(null);
        return;
      }
      if (
        !data.relativePath ||
        !data.fileName ||
        !data.projectSlug ||
        !data.projectName
      ) {
        setVaultErr("Upload succeeded but the server response was incomplete.");
        setVaultHint(null);
        return;
      }
      const vis = data.visibility ?? "private";
      if (data.duplicate) {
        setVaultHint(null);
        setUploading(false);
        const kind: VaultDuplicateKind =
          pick.assetRole === "org_global"
            ? "org"
            : vis === "shared"
              ? "shared"
              : "private";
        setVaultDuplicateDialog({
          kind,
          fileName: data.fileName,
          vaultLabel: data.projectName,
        });
        return;
      }
      let wsSessionId!: string;
      let wsSessionKey!: string;

      const createWorkspaceChat = async (
        reuseIfEmpty: boolean
      ): Promise<boolean> => {
        const cr = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/chats`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reuseIfEmpty }),
          }
        );
        const cd = (await cr.json().catch(() => ({}))) as {
          sessionId?: string;
          sessionKey?: string;
          error?: string;
        };
        if (!cr.ok || !cd.sessionId || !cd.sessionKey) {
          setVaultErr(cd.error || "Could not create vault chat.");
          setVaultHint(null);
          return false;
        }
        wsSessionId = cd.sessionId;
        wsSessionKey = cd.sessionKey;
        return true;
      };

      if (vis === "shared") {
        if (!(await createWorkspaceChat(true))) return;
      } else if (
        activeWorkspaceSlug &&
        slug === activeWorkspaceSlug &&
        currentSessionId &&
        currentSessionKey
      ) {
        wsSessionId = currentSessionId;
        wsSessionKey = currentSessionKey;
      } else if (
        ensureNewWorkspaceSessionBeforeIngest &&
        activeWorkspaceSlug &&
        slug === activeWorkspaceSlug
      ) {
        if (!(await createWorkspaceChat(true))) return;
      } else {
        const trRes = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/thread`,
          { cache: "no-store" }
        );
        const tr = (await trRes.json().catch(() => ({}))) as {
          sessionId?: string;
          sessionKey?: string;
          error?: string;
        };
        if (!trRes.ok || !tr.sessionId || !tr.sessionKey) {
          setVaultErr(tr.error || "Could not open vault chat.");
          setVaultHint(null);
          return;
        }
        wsSessionId = tr.sessionId;
        wsSessionKey = tr.sessionKey;
      }
      if (vis === "shared" && data.ingestJobId) {
        void fetch(
          `/api/projects/${encodeURIComponent(slug)}/ingest-job-attribution`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: data.ingestJobId,
              sourceWebchatId: wsSessionId,
            }),
          }
        )
          .then(() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            }
          })
          .catch(() => {});
      }
      let privateIngestJobId: string | undefined;
      if (vis !== "shared") {
        const pr = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/reingest-hermes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              relativePath: data.relativePath,
              sourceWebchatId: wsSessionId,
              reingestVerify: false,
            }),
          }
        );
        const pd = (await pr.json().catch(() => ({}))) as {
          jobId?: string;
          error?: string;
        };
        if (!pr.ok || !pd.jobId) {
          setVaultErr(pd.error || "Could not start private ingest.");
          setVaultHint(null);
          return;
        }
        privateIngestJobId = pd.jobId;
      }
      setVaultHint(
        vis === "shared"
          ? "File saved — Hermes is processing this in the shared vault."
          : "File saved — Hermes is processing this private vault."
      );
      setBackgroundIngestNotice({
        fileName: data.fileName,
        visibility: vis,
        payload: {
        slug,
        ingestText: "",
        workspaceSessionId: wsSessionId,
        workspaceSessionKey: wsSessionKey,
        visibility: vis,
        fileName: data.fileName,
        ingestJobId: vis === "shared" ? data.ingestJobId : privateIngestJobId,
        ...(typeof data.assetRole === "string" && data.assetRole.trim()
          ? { assetRole: normalizeVaultAssetRole(data.assetRole) }
          : pick.assetRole
            ? { assetRole: normalizeVaultAssetRole(pick.assetRole) }
            : {}),
        },
      });
      setVaultHint(null);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "";
      const looksUnreachable =
        raw === "Failed to fetch" ||
        /failed to fetch|networkerror|network request failed/i.test(raw);
      setVaultErr(
        looksUnreachable
          ? "Could not reach the app server. Confirm Hermes Chat is running and this page’s address matches how you open the app (same host and port—for example your published URL or Docker-mapped port)."
          : raw || "Upload failed (network error)."
      );
      setVaultHint(null);
    } finally {
      setUploading(false);
    }
  }

  async function uploadVaultPasteAndIngest(
    slug: string,
    pastedText: string,
    assetRole: VaultAssetRole,
    imageFiles: File[]
  ) {
    if (!onVaultIngestComplete) return;
    const slugTrim = slug.trim();
    setVaultErr(null);
    setVaultHint("Saving paste to vault…");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("text", pastedText);
      fd.set("assetRole", assetRole);
      if (assetRole === "org_global" && activeWorkspaceSlug?.trim()) {
        fd.set("contextVaultSlug", activeWorkspaceSlug.trim());
      }
      for (const f of imageFiles) {
        fd.append("image", f);
      }
      if (currentSessionId?.trim() && slug === activeWorkspaceSlug?.trim()) {
        fd.set("sourceWebchatId", currentSessionId.trim());
      }
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/paste-ingest`,
        { method: "POST", body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as {
        relativePath?: string;
        fileName?: string;
        mimeType?: string;
        projectSlug?: string;
        projectName?: string;
        visibility?: "private" | "shared";
        ingestJobId?: string;
        ingestMode?: "light" | "full";
        assetRole?: string;
        error?: string;
        duplicate?: boolean;
        duplicatePath?: string | null;
      };
      if (!res.ok) {
        setVaultErr(data.error || `Paste ingest failed (HTTP ${res.status})`);
        setVaultHint(null);
        return;
      }
      if (
        !data.relativePath ||
        !data.fileName ||
        !data.projectSlug ||
        !data.projectName
      ) {
        setVaultErr("Paste saved but the server response was incomplete.");
        setVaultHint(null);
        return;
      }
      const vis = data.visibility ?? "private";
      if (data.duplicate) {
        setVaultHint(null);
        setUploading(false);
        const kind: VaultDuplicateKind =
          assetRole === "org_global"
            ? "org"
            : vis === "shared"
              ? "shared"
              : "private";
        setVaultDuplicateDialog({
          kind,
          fileName: data.fileName,
          vaultLabel: data.projectName,
        });
        return;
      }
      let wsSessionId!: string;
      let wsSessionKey!: string;

      const createWorkspaceChat = async (
        reuseIfEmpty: boolean
      ): Promise<boolean> => {
        const cr = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/chats`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reuseIfEmpty }),
          }
        );
        const cd = (await cr.json().catch(() => ({}))) as {
          sessionId?: string;
          sessionKey?: string;
          error?: string;
        };
        if (!cr.ok || !cd.sessionId || !cd.sessionKey) {
          setVaultErr(cd.error || "Could not create vault chat.");
          setVaultHint(null);
          return false;
        }
        wsSessionId = cd.sessionId;
        wsSessionKey = cd.sessionKey;
        return true;
      };

      if (vis === "shared") {
        if (!(await createWorkspaceChat(true))) return;
      } else if (
        activeWorkspaceSlug &&
        slug === activeWorkspaceSlug &&
        currentSessionId &&
        currentSessionKey
      ) {
        wsSessionId = currentSessionId;
        wsSessionKey = currentSessionKey;
      } else if (
        ensureNewWorkspaceSessionBeforeIngest &&
        activeWorkspaceSlug &&
        slug === activeWorkspaceSlug
      ) {
        if (!(await createWorkspaceChat(true))) return;
      } else {
        const trRes = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/thread`,
          { cache: "no-store" }
        );
        const tr = (await trRes.json().catch(() => ({}))) as {
          sessionId?: string;
          sessionKey?: string;
          error?: string;
        };
        if (!trRes.ok || !tr.sessionId || !tr.sessionKey) {
          setVaultErr(tr.error || "Could not open vault chat.");
          setVaultHint(null);
          return;
        }
        wsSessionId = tr.sessionId;
        wsSessionKey = tr.sessionKey;
      }
      if (vis === "shared" && data.ingestJobId) {
        void fetch(
          `/api/projects/${encodeURIComponent(slug)}/ingest-job-attribution`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: data.ingestJobId,
              sourceWebchatId: wsSessionId,
            }),
          }
        )
          .then(() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            }
          })
          .catch(() => {});
      }
      let privateIngestJobId: string | undefined;
      const lightIngest = data.ingestMode === "light";
      if (vis !== "shared" && !lightIngest) {
        const pr = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/reingest-hermes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              relativePath: data.relativePath,
              sourceWebchatId: wsSessionId,
              reingestVerify: false,
            }),
          }
        );
        const pd = (await pr.json().catch(() => ({}))) as {
          jobId?: string;
          error?: string;
        };
        if (!pr.ok || !pd.jobId) {
          setVaultErr(pd.error || "Could not start private ingest.");
          setVaultHint(null);
          return;
        }
        privateIngestJobId = pd.jobId;
      }
      setVaultHint(
        lightIngest
          ? "Saved to vault."
          : vis === "shared"
            ? "Paste saved — Hermes is processing this in the shared vault."
            : "Paste saved — Hermes is processing this private vault."
      );
      setBackgroundIngestNotice({
        fileName: data.fileName,
        visibility: vis,
        mode: lightIngest ? "light" : "full",
        payload: {
        slug,
        ingestText: "",
        workspaceSessionId: wsSessionId,
        workspaceSessionKey: wsSessionKey,
        visibility: vis,
        fileName: data.fileName,
        ingestJobId: vis === "shared" ? data.ingestJobId : privateIngestJobId,
        ...(typeof data.assetRole === "string" && data.assetRole.trim()
          ? { assetRole: normalizeVaultAssetRole(data.assetRole) }
          : { assetRole }),
        },
      });
      setVaultHint(null);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "";
      const looksUnreachable =
        raw === "Failed to fetch" ||
        /failed to fetch|networkerror|network request failed/i.test(raw);
      setVaultErr(
        looksUnreachable
          ? "Could not reach the app server. Confirm Hermes Chat is running and this page’s address matches how you open the app (same host and port—for example your published URL or Docker-mapped port)."
          : raw || "Paste ingest failed (network error)."
      );
      setVaultHint(null);
    } finally {
      setUploading(false);
    }
  }

  function handleVaultFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    const file = files?.[0];
    if (vaultFileInputRef.current) vaultFileInputRef.current.value = "";
    if (!file || file.size <= 0) {
      setVaultErr(
        "No file was read. Try again, or export as .docx / .pdf if the picker rejected this format."
      );
      return;
    }
    setVaultErr(null);
    setVaultHint(null);
    const orgSlug = getOrgGlobalSlug();
    if (activeWorkspaceSlug?.trim() === orgSlug) {
      stagedVaultFileRef.current = file;
      setOrgLibraryUploadConfirmOpen(true);
      return;
    }
    stagedVaultFileRef.current = file;
    setPendingWorkspacePickFileName(file.name);
    setWorkspacePickOpen(true);
  }

  function handleVaultImageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(
      (file) => file.type.startsWith("image/") && file.size > 0
    );
    if (vaultImageInputRef.current) vaultImageInputRef.current.value = "";
    setImageAttachErr(null);
    if (files.length === 0) {
      setImageAttachErr("Pick an image file, like PNG, JPEG, or WebP.");
      return;
    }
    setVaultPasteInitialImages(files);
    setVaultPasteModalOpen(true);
  }

  function handleVaultDialogClose() {
    stagedVaultFileRef.current = null;
    setPendingWorkspacePickFileName("");
    setWorkspacePickOpen(false);
  }

  function handleOrgLibraryUploadCancel() {
    setOrgLibraryUploadConfirmOpen(false);
    stagedVaultFileRef.current = null;
  }

  function handleOrgLibraryUploadConfirmed() {
    const file = stagedVaultFileRef.current;
    const orgSlug = getOrgGlobalSlug();
    setOrgLibraryUploadConfirmOpen(false);
    if (!file || file.size <= 0) {
      stagedVaultFileRef.current = null;
      return;
    }
    void (async () => {
      if (await fetchVaultHasUploadBasename(orgSlug, file.name)) {
        stagedVaultFileRef.current = null;
        setVaultDuplicateDialog({
          kind: "org",
          fileName: file.name,
        });
        return;
      }
      stagedVaultFileRef.current = null;
      void uploadVaultAndIngest(orgSlug, file, {
        userNotes: "",
        assetRole: "org_global",
      });
    })();
  }

  function handleVaultChosen(
    slug: string,
    _name: string,
    pick: WorkspacePickResult
  ) {
    const file = stagedVaultFileRef.current;
    stagedVaultFileRef.current = null;
    setWorkspacePickOpen(false);
    if (!file) {
      setVaultErr("No file to upload — use Add file and choose a file first.");
      return;
    }
    void uploadVaultAndIngest(slug, file, pick);
  }

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length) return;
    const copied = Array.from(list);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await addImagesFromFiles(copied);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
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

    const fromFiles = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
    const merged = fromItems.length > 0 ? fromItems : fromFiles;
    if (merged.length === 0) return;

    e.preventDefault();
    if (attachMode === "workspace" && canPasteIngest) {
      setVaultPasteInitialImages(merged);
      setVaultPasteModalOpen(true);
      return;
    }
    void addImagesFromFiles(merged);
  }

  function removeImage(index: number) {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(resize, [input, resize]);

  const planLabel = useMemo(
    () =>
      activeStackTier
        ? planDisplayLabelForTier(activeStackTier, stackPresetsForLabel ?? { presets: {} })
        : "this plan",
    [activeStackTier, stackPresetsForLabel]
  );
  const creditLine = useMemo(() => {
    if (!openRouterCredits || !openRouterCredits.ok) return "";
    if (!isOpenRouterLowBalance(openRouterCredits.remaining, activeStackTier)) return "";
    return buildOpenRouterLowBalanceInputLine(
      openRouterCredits.remaining,
      activeStackTier,
      planLabel
    );
  }, [openRouterCredits, activeStackTier, planLabel]);
  const helperSource = useMemo(
    () =>
      getComposerSuggestions({
        scope: suggestionScope,
        threadHasMessages,
        hasImages: attachedImages.length > 0,
      }),
    [attachedImages.length, suggestionScope, threadHasMessages]
  );
  const [composerFocused, setComposerFocused] = useState(false);
  const { text: helperText, transitioning: helperTransitioning } =
    useRotatingHelper(helperSource, {
      pause: Boolean(input.trim()) || composerFocused,
    });
  const showHelper = !input;
  const helperSuggestion = helperText.trim();
  const helperDisplayText = creditLine ? creditLine : sentenceStart(helperSuggestion);
  const sendableHelperSuggestion = creditLine ? "" : sentenceStart(helperSuggestion);

  const [suggestedPromptDialogOpen, setSuggestedPromptDialogOpen] =
    useState(false);
  const [pendingSuggestedPrompt, setPendingSuggestedPrompt] = useState("");
  const [oneOffPickerOpen, setOneOffPickerOpen] = useState(false);
  const [stackSwitching, setStackSwitching] = useState(false);
  const [pipelineBlockDialog, setPipelineBlockDialog] = useState<{
    title: string;
    description: ReactNode;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOpenedRef = useRef(false);
  const suggestionLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionLongPressInsertedRef = useRef(false);
  /** Avoids the plan sheet’s tap “falling through” to Send and opening the suggested-prompt dialog. */
  const suppressSendClickUntilMsRef = useRef(0);

  function armSuppressAccidentalSendClick() {
    suppressSendClickUntilMsRef.current = Date.now() + 800;
  }

  function isSendClickSuppressed() {
    return Date.now() < suppressSendClickUntilMsRef.current;
  }

  function performSend(
    text: string,
    images?: string[],
    options?: ChatSubmitOptions
  ) {
    cleanupVoiceSession();
    if (images && images.length > 0) {
      const urls = images;
      onChange("");
      setAttachedImages([]);
      onSubmit(text, urls, options);
      return;
    }
    onChange("");
    onSubmit(text, undefined, options);
  }

  async function runPlanPickAndSend(pick: OneOffPlanPick) {
    if (isLoading || uploading) {
      setPipelineBlockDialog({
        title: "Reply in progress",
        description:
          "A response is still being generated. Switch plans or pick a one-off model after this reply finishes.",
      });
      return;
    }
    if (await anyChatSessionProcessing()) {
      setPipelineBlockDialog({
        title: "Reply in progress",
        description:
          "Another chat still has a reply in progress. Finish or leave it idle before switching plans — reloading the gateway would interrupt that work.",
      });
      return;
    }
    const trimmed = input.trim();
    const imageUrls = attachedImages.map((img) => img.serverUrl);
    const hasPayload = Boolean(trimmed) || imageUrls.length > 0;

    armSuppressAccidentalSendClick();

    if (pick.allowEdits) {
      setStackSwitching(true);
      let fallback = false;
      try {
        await postHermesStackActive({
          presetBundles: pick.presetBundles as Record<string, unknown>,
          active: pick.tier,
        });
        loadCreditsAndStack();
        await waitMinApplyDuration(Date.now());
      } catch (e) {
        fallback = true;
        setPlanBanner({
          kind: "oneoff",
          errorNote: hasPayload
            ? e instanceof Error
              ? `${e.message} — sent with a one-off model.`
              : "Stack update failed. Sent with a one-off model."
            : e instanceof Error
              ? e.message
              : "Stack update failed. Plan was not changed.",
        });
      } finally {
        setStackSwitching(false);
      }
      if (fallback) {
        if (hasPayload) {
          performSend(
            trimmed,
            imageUrls.length > 0 ? imageUrls : undefined,
            { oneOffModelId: pick.modelId }
          );
        }
        return;
      }
      setPlanBanner({
        kind: "stack",
        revertTo: pick.revertTo,
        pickedTier: pick.tier,
        pickedLabel: pick.pickedTitle,
        homeLabel: pick.revertTitle,
      });
      writeStackPlanDriftPersisted({
        revertTo: pick.revertTo,
        pickedTier: pick.tier,
        pickedLabel: pick.pickedTitle,
        homeLabel: pick.revertTitle,
      });
      if (!hasPayload) return;
      performSend(trimmed, imageUrls.length > 0 ? imageUrls : undefined);
      return;
    } else {
      if (!hasPayload) return;
      setPlanBanner({ kind: "oneoff" });
    }
    performSend(
      trimmed,
      imageUrls.length > 0 ? imageUrls : undefined,
      { oneOffModelId: pick.modelId }
    );
  }

  async function revertStackToDefaultPlan() {
    if (!planBanner || planBanner.kind !== "stack") return;
    if (isLoading) {
      setPipelineBlockDialog({
        title: "Reply in progress",
        description:
          "Wait for the assistant to finish before reverting the stack plan — reloading the gateway now would interrupt this reply.",
      });
      return;
    }
    if (await anyChatSessionProcessing()) {
      setPipelineBlockDialog({
        title: "Reply in progress",
        description:
          "Another chat still has a reply in progress. Wait before reverting the stack plan — reloading the gateway would interrupt that work.",
      });
      return;
    }
    setStackSwitching(true);
    try {
      const r = await fetch("/api/hermes/stack", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { presets?: { presets?: Record<string, unknown> } };
      const bundles = j.presets?.presets;
      if (!bundles) return;
      await postHermesStackActive({
        presetBundles: bundles,
        active: planBanner.revertTo,
      });
      await waitMinApplyDuration(Date.now());
      clearStackPlanDriftPersisted();
      loadCreditsAndStack();
    } catch {
      /* keep banner; user can retry */
    } finally {
      setStackSwitching(false);
    }
  }

  function handleSend(override?: ChatSubmitOptions) {
    if (isSendClickSuppressed()) return;
    if (isLoading || uploading) return;
    const trimmed = input.trim();

    if (attachedImages.length > 0) {
      if (!trimmed) {
        performSend(
          "",
          attachedImages.map((img) => img.serverUrl),
          override
        );
        return;
      }
      performSend(
        trimmed,
        attachedImages.map((img) => img.serverUrl),
        override
      );
      return;
    }

    if (trimmed) {
      performSend(trimmed, undefined, override);
      return;
    }

    if (!sendableHelperSuggestion) return;
    setPendingSuggestedPrompt(sendableHelperSuggestion);
    setSuggestedPromptDialogOpen(true);
  }

  const canSend =
    !isLoading &&
    !uploading &&
    (Boolean(input.trim()) ||
      attachedImages.length > 0 ||
      Boolean(sendableHelperSuggestion));

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function insertHelperSuggestion() {
    if (!helperSuggestion || creditLine || !sendableHelperSuggestion) return;
    onChange(sendableHelperSuggestion);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function clearSuggestionLongPressTimer() {
    if (suggestionLongPressTimerRef.current) {
      clearTimeout(suggestionLongPressTimerRef.current);
      suggestionLongPressTimerRef.current = null;
    }
  }

  function onSuggestionPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!helperSuggestion || creditLine) return;
    suggestionLongPressInsertedRef.current = false;
    clearSuggestionLongPressTimer();
    if (e.pointerType !== "mouse") {
      suggestionLongPressTimerRef.current = setTimeout(() => {
        suggestionLongPressInsertedRef.current = true;
        insertHelperSuggestion();
        suggestionLongPressTimerRef.current = null;
      }, 650);
    }
  }

  function onSuggestionPointerUpOrCancel() {
    clearSuggestionLongPressTimer();
  }

  function onSuggestionClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (typeof window === "undefined") return;
    if (suggestionLongPressInsertedRef.current) {
      suggestionLongPressInsertedRef.current = false;
      return;
    }
    if (window.matchMedia("(pointer: coarse)").matches) {
      textareaRef.current?.focus();
      return;
    }
    insertHelperSuggestion();
  }

  function onSendPointerDown() {
    if (!canSend || isLoading || uploading) return;
    longPressOpenedRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      longPressOpenedRef.current = true;
      setOneOffPickerOpen(true);
      longPressTimerRef.current = null;
    }, 550);
  }

  function onSendPointerUpOrCancel() {
    clearLongPressTimer();
  }

  function onSendButtonClick(e: React.MouseEvent) {
    if (isSendClickSuppressed()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (longPressOpenedRef.current) {
      e.preventDefault();
      longPressOpenedRef.current = false;
      return;
    }
    handleSend();
  }

  function handleSuggestedPromptCancel() {
    setSuggestedPromptDialogOpen(false);
    setPendingSuggestedPrompt("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSuggestedPromptConfirm() {
    const text = pendingSuggestedPrompt.trim();
    setSuggestedPromptDialogOpen(false);
    setPendingSuggestedPrompt("");
    if (!text) return;
    performSend(text, undefined);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      className="main-chat-depth flex flex-shrink-0 flex-col border-t border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] px-3 pt-3 pb-safe-bottom max-md:fixed max-md:inset-x-0 max-md:bottom-[var(--hermes-visual-bottom-inset)] max-md:z-20 max-md:w-full max-md:shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
    >
      <AddingImageOverlay open={addingImages} />
      <StackGatewayApplyOverlay open={stackSwitching} />
      <InferencePipelineDialog
        open={pipelineBlockDialog !== null}
        onOpenChange={(o) => {
          if (!o) setPipelineBlockDialog(null);
        }}
        variant="block"
        title={pipelineBlockDialog?.title ?? ""}
        description={pipelineBlockDialog?.description ?? ""}
      />
      {planBanner ? (
        <div
          className="mb-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-foreground/90"
          role="status"
        >
          {planBanner.kind === "stack" ? (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <p>
                You’re outside your default set plan. The stack is on{" "}
                <span className="font-medium text-foreground">{planBanner.pickedLabel}</span> (you
                were on <span className="font-medium">{planBanner.homeLabel}</span> before this
                send).
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void revertStackToDefaultPlan()}
                  className="rounded-md border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent/30"
                >
                  Revert to default
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <p>
                {planBanner.errorNote
                  ? planBanner.errorNote
                  : "This send used another plan’s main model. Your live stack was not changed. Ask your host to enable stack writes for full plan switches."}
              </p>
              <button
                type="button"
                onClick={() => setPlanBanner(null)}
                className="self-end rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground sm:self-auto"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      ) : null}
      <WorkspacePickDialog
        open={workspacePickOpen}
        onClose={handleVaultDialogClose}
        onChosen={handleVaultChosen}
        pendingFileName={pendingWorkspacePickFileName}
        onDuplicateInVault={(info) => {
          setVaultDuplicateDialog({
            kind: info.kind,
            fileName: info.fileName,
            vaultLabel: info.vaultLabel,
          });
        }}
        initialWorkspaceSlug={activeWorkspaceSlug}
      />
      <OrgLibraryUploadConfirmDialog
        open={orgLibraryUploadConfirmOpen}
        onClose={handleOrgLibraryUploadCancel}
        onConfirm={handleOrgLibraryUploadConfirmed}
      />
      <VaultFileAlreadyPresentDialog
        open={vaultDuplicateDialog != null}
        onClose={() => setVaultDuplicateDialog(null)}
        kind={vaultDuplicateDialog?.kind ?? "private"}
        fileName={vaultDuplicateDialog?.fileName}
        vaultLabel={vaultDuplicateDialog?.vaultLabel}
      />
      <SuggestedPromptConfirmDialog
        open={suggestedPromptDialogOpen}
        suggestedText={pendingSuggestedPrompt}
        onCancel={handleSuggestedPromptCancel}
        onConfirm={handleSuggestedPromptConfirm}
      />
      <OneOffModelPickerSheet
        open={oneOffPickerOpen}
        onClose={() => setOneOffPickerOpen(false)}
        onPick={(pick) => void runPlanPickAndSend(pick)}
      />
      <VaultPasteIngestModal
        open={vaultPasteModalOpen}
        onClose={() => {
          setVaultPasteModalOpen(false);
          setVaultPasteInitialImages([]);
        }}
        activeWorkspaceSlug={activeWorkspaceSlug}
        activeWorkspaceName={workspaceProjectName}
        initialImageFiles={vaultPasteInitialImages}
        onConfirm={({ pastedText, targetSlug, assetRole, imageFiles }) => {
          void uploadVaultPasteAndIngest(
            targetSlug,
            pastedText,
            assetRole,
            imageFiles
          );
        }}
      />
      {backgroundIngestNotice ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Vault ingest queued"
        >
          <div className="w-full max-w-sm rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] p-5 text-center shadow-xl">
            <h2 className="text-base font-semibold text-foreground">
              {backgroundIngestNotice.mode === "light"
                ? "Saved to vault"
                : "Hermes is working on it"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {backgroundIngestNotice.mode === "light" && backgroundIngestNotice.fileName
                ? `${backgroundIngestNotice.fileName} is saved and ready.`
                : backgroundIngestNotice.mode === "light"
                  ? "Your vault item is saved and ready."
                  : backgroundIngestNotice.fileName
                ? `${backgroundIngestNotice.fileName} is saved and processing in the background.`
                : "Your vault item is saved and processing in the background."}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {backgroundIngestNotice.mode === "light"
                ? "You can keep working, add more material, or ask Hermes about it now."
                : "You do not need to keep this tab, phone, or computer open. You can add more files or pasted text now; Hermes will queue them and work through them."}
            </p>
            <button
              type="button"
              onClick={() => {
                const payload = backgroundIngestNotice.payload;
                setBackgroundIngestNotice(null);
                onVaultIngestComplete?.(payload);
              }}
              className="neu-raised mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground"
            >
              Okay
            </button>
          </div>
        </div>
      ) : null}
      <input
        ref={vaultFileInputRef}
        type="file"
        accept={VAULT_FILE_ACCEPT}
        className="hidden"
        onChange={handleVaultFileInputChange}
      />
      <input
        ref={vaultImageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleVaultImageInputChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImagePick}
      />

      {(attachedImages.length > 0 || uploading) && (
        <div className="mx-auto flex w-full max-w-3xl gap-2 mb-2 overflow-x-auto pb-1 md:max-w-6xl lg:max-w-7xl 2xl:max-w-[min(88rem,92vw)] md:gap-3">
          {attachedImages.map((img, i) => (
            <div key={i} className="neu-raised relative size-16 flex-shrink-0 overflow-hidden rounded-lg">
              <img src={img.previewUrl} alt="" className="size-full object-cover" />
              <button
                onClick={() => removeImage(i)}
                className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="neu-recessed flex size-16 flex-shrink-0 items-center justify-center rounded-lg">
              <div className="size-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
            </div>
          )}
        </div>
      )}

      {cooldownHint ? (
        <div className="mx-auto w-full max-w-3xl px-1 pb-2 text-center text-xs text-amber-100/90 md:max-w-6xl">
          {cooldownHint}
        </div>
      ) : null}
      {voiceErrorHint ? (
        <div className="mx-auto w-full max-w-3xl px-1 pb-2 text-center text-xs text-destructive/90 md:max-w-6xl">
          {voiceErrorHint}
        </div>
      ) : null}
      {vaultErr ? (
        <div className="mx-auto w-full max-w-3xl px-1 pb-2 text-center text-xs text-destructive/90 md:max-w-6xl">
          {vaultErr}
        </div>
      ) : null}
      {imageAttachErr ? (
        <div className="mx-auto w-full max-w-3xl px-1 pb-2 text-center text-xs text-destructive/90 md:max-w-6xl">
          {imageAttachErr}
        </div>
      ) : null}
      {vaultHint ? (
        <div className="mx-auto w-full max-w-3xl px-1 pb-2 text-center text-xs text-muted-foreground md:max-w-6xl">
          {vaultHint}
        </div>
      ) : null}

      <div className="relative mx-auto flex w-full max-w-3xl items-center gap-2 pb-3 md:max-w-6xl lg:max-w-7xl 2xl:max-w-[min(88rem,92vw)] md:gap-4 lg:gap-6">
      {showHelper && (
          <button
            type="button"
            onClick={onSuggestionClick}
            onPointerDown={onSuggestionPointerDown}
            onPointerUp={onSuggestionPointerUpOrCancel}
            onPointerCancel={onSuggestionPointerUpOrCancel}
            onPointerLeave={onSuggestionPointerUpOrCancel}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute bottom-3 left-1/2 top-0 z-20 flex max-w-[calc(100%-9rem)] -translate-x-1/2 items-center justify-center rounded-md px-2 py-1 text-center text-[17px] font-medium leading-tight transition-[opacity,background,color] duration-700 max-sm:text-[16px] sm:max-w-[36rem] ${
              creditLine
                ? "pointer-events-none text-red-500"
                : "text-muted-foreground/90 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
            }`}
            style={{
              opacity: helperTransitioning ? 0 : 1,
            }}
            tabIndex={-1}
            aria-hidden={creditLine ? true : undefined}
          >
            <span className="truncate">{helperDisplayText}</span>
          </button>
        )}
        {attachMode === "workspace" ? (
          <AttachMenu
            onPickImage={() => {
              setImageAttachErr(null);
              vaultImageInputRef.current?.click();
            }}
            onPickFile={() => {
              if (!vaultUploadEnabled || !onVaultIngestComplete) return;
              setVaultErr(null);
              setVaultHint(null);
              vaultFileInputRef.current?.click();
            }}
            onPickPaste={
              canPasteIngest ? () => setVaultPasteModalOpen(true) : undefined
            }
            pasteEnabled={canPasteIngest}
            disabled={isLoading}
            filePickEnabled={Boolean(vaultUploadEnabled && onVaultIngestComplete)}
          />
        ) : (
          <button
            type="button"
            data-hermes-tip="Add an image to this message."
            onClick={() => {
              setImageAttachErr(null);
              fileInputRef.current?.click();
            }}
            disabled={isLoading || uploading}
            className="neu-selected flex size-10 flex-shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ImageIcon className="size-4" />
          </button>
        )}

        <button
          type="button"
          onClick={handleVoicePress}
          disabled={voiceState === "processing"}
          className="neu-selected relative flex size-12 flex-shrink-0 items-center justify-center rounded-full text-sidebar-foreground transition-[box-shadow,background] duration-200 disabled:opacity-40"
        >
          {voiceState === "recording" ? (
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
              <LiveWaveform
                active={false}
                processing={true}
                barWidth={2}
                barGap={1}
                barColor="#a3c4f3"
                height={36}
                mode="static"
                fadeEdges={true}
                fadeWidth={8}
                className="w-full"
              />
            </div>
          ) : (
            <MicIcon className="size-5" />
          )}
        </button>

        <div className="hermes-composer-input relative min-h-10 flex-1 rounded-lg">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              setComposerFocused(true);
              if (typeof window === "undefined") return;
              /** Pairs with `app/chat/layout` visualViewport sync — iOS PWAs sometimes omit early resize events. */
              window.dispatchEvent(new Event("hermeschat-visual-viewport-nudge"));
            }}
            onBlur={() => setComposerFocused(false)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            className="relative z-10 w-full resize-none bg-transparent px-4 py-2.5 text-sm text-foreground placeholder:text-transparent focus:outline-none"
            style={{ maxHeight: 200 }}
          />
        </div>

        <button
          type="button"
          onClick={onSendButtonClick}
          onPointerDown={onSendPointerDown}
          onPointerUp={onSendPointerUpOrCancel}
          onPointerCancel={onSendPointerUpOrCancel}
          onPointerLeave={onSendPointerUpOrCancel}
          disabled={!canSend}
          className={`flex size-12 flex-shrink-0 items-center justify-center rounded-full transition-[box-shadow,opacity] duration-200 disabled:cursor-not-allowed ${
            canSend ? "neu-selected text-sidebar-foreground" : "neu-raised text-muted-foreground opacity-35"
          }`}
          data-hermes-tip={
            creditLine
              ? "Send · long-press to switch plan or pick a one-off model"
              : "Send · long-press to pick a one-off model"
          }
          aria-label={
            creditLine
              ? "Send message. Long-press to switch plan or choose a one-off model."
              : "Send message. Long-press to choose model for this message only."
          }
        >
          <SendIcon className="size-5" />
        </button>
      </div>
    </div>
  );
});
