"use client";

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChatHeader } from "@/components/chat-header";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import {
  WorkspaceVaultFilesBar,
  type WorkspaceVaultFileRow,
} from "@/components/WorkspaceVaultFilesBar";
import { Orb } from "@/components/ui/orb";
import { useChatIdentity } from "@/ChatIdentity";
import { VaultArchitectIngestIdleHero } from "@/components/VaultArchitectIngestIdleHero";
import { PrivateHermesReingestHero } from "@/components/PrivateHermesReingestHero";
import { getOrbHelper } from "@/lib/helper-suggestions";
import { VAULT_PENDING_INGEST_KEY } from "@/lib/vault-pending-ingest";
import type { VaultPendingIngestPayload } from "@/lib/vault-pending-ingest";
import {
  SHARED_INGEST_HERO_KEY,
  type SharedIngestHeroPayload,
} from "@/lib/shared-ingest-hero-storage";
import { SharedIngestArchitectHero } from "@/components/SharedIngestArchitectHero";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";
import type { SharedIngestJobPublic } from "@/lib/shared-ingest-job-store";
import type { SharedVaultGapHint } from "@/lib/shared-vault-gap-types";
import type {
  HermesPrivateReingestJobPublic,
  WorkspaceVaultIngestJob,
} from "@/lib/workspace-vault-ingest-jobs";
import {
  PRIVATE_REINGEST_HERO_KEY,
  type PrivateReingestHeroPayload,
} from "@/lib/private-reingest-hero-storage";

function isHiddenVaultArtifactPath(name: string, relativePath: string): boolean {
  const n = (name || "").toLowerCase();
  const p = (relativePath || "").toLowerCase();
  return n.endsWith(".py") || p.endsWith(".py");
}

export default function WorkspaceDraftPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const { agentName } = useChatIdentity();
  const [input, setInput] = useState("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [workspaceVisibility, setWorkspaceVisibility] = useState<
    "private" | "shared" | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vaultUploadEnabled, setVaultUploadEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workspaceVaultFiles, setWorkspaceVaultFiles] = useState<
    WorkspaceVaultFileRow[] | null
  >(null);
  /** Dialog hand-off before shared-ingest-status poll returns a row (no workspace chat session yet). */
  const [sharedManualHero, setSharedManualHero] = useState<{
    jobId: string;
    fileName: string;
    assetRole?: VaultAssetRole;
  } | null>(null);
  const [privateReingestHero, setPrivateReingestHero] =
    useState<PrivateReingestHeroPayload | null>(null);
  const [sharedIngestJobs, setSharedIngestJobs] = useState<
    SharedIngestJobPublic[]
  >([]);
  const [privateHermesReingestJobs, setPrivateHermesReingestJobs] = useState<
    HermesPrivateReingestJobPublic[]
  >([]);
  const [sharedVaultGapHints, setSharedVaultGapHints] = useState<
    SharedVaultGapHint[]
  >([]);
  const sharedIngestForceScanRef = useRef(true);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const fetchVaultFileRows = useCallback(async (s: string) => {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(s)}/files`, {
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
  }, []);

  useEffect(() => {
    sharedIngestForceScanRef.current = true;
  }, [slug]);

  useEffect(() => {
    if (!slug || !vaultUploadEnabled) {
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
          `/api/projects/${encodeURIComponent(slug)}/shared-ingest-status${q ? `?${q}` : ""}`,
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
  }, [slug, vaultUploadEnabled]);

  useEffect(() => {
    if (
      !slug ||
      !vaultUploadEnabled ||
      workspaceVisibility !== "private"
    ) {
      setPrivateHermesReingestJobs([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/projects/${encodeURIComponent(slug)}/private-reingest-status`,
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
  }, [slug, vaultUploadEnabled, workspaceVisibility]);

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

  const vaultIngestJobsMerged = useMemo((): WorkspaceVaultIngestJob[] => {
    return [...sharedIngestJobs, ...privateHermesReingestJobs];
  }, [sharedIngestJobs, privateHermesReingestJobs]);

  const ingestUiActive = useMemo(
    () =>
      sharedManualHero != null ||
      privateReingestHero != null ||
      sharedIngestJobs.some(
        (j) => j.status === "queued" || j.status === "running"
      ) ||
      privateHermesReingestJobs.some((j) => j.status === "running"),
    [
      sharedManualHero,
      privateReingestHero,
      sharedIngestJobs,
      privateHermesReingestJobs,
    ]
  );

  const showVaultArchitectIngestIdleHero =
    Boolean(slug) &&
    ingestUiActive &&
    workspaceVisibility !== null;

  const privateReingestStrip = useMemo(() => {
    if (!slug || workspaceVisibility !== "private") return null;
    if (
      privateReingestHero &&
      privateReingestHero.projectSlug === slug
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
  }, [slug, workspaceVisibility, privateReingestHero, privateHermesReingestJobs]);

  const sharedIngestStrip = useMemo(() => {
    if (!slug) return null;
    if (sharedManualHero) {
      return {
        projectSlug: slug,
        jobId: sharedManualHero.jobId,
        fileName: sharedManualHero.fileName,
        assetRole: sharedManualHero.assetRole,
      };
    }
    const active = sharedIngestJobs.find(
      (j) => j.status === "queued" || j.status === "running"
    );
    if (!active) return null;
    return {
      projectSlug: slug,
      jobId: active.jobId,
      fileName: active.fileName,
      assetRole: active.assetRole,
    };
  }, [slug, sharedManualHero, sharedIngestJobs]);

  const inlineIngestStrip = useMemo(() => {
    if (privateReingestStrip) return { kind: "private" as const, ...privateReingestStrip };
    if (sharedIngestStrip) return { kind: "shared" as const, ...sharedIngestStrip };
    return null;
  }, [privateReingestStrip, sharedIngestStrip]);

  const refreshVaultFilesAndIngestHints = useCallback(() => {
    sharedIngestForceScanRef.current = true;
    void fetchVaultFileRows(slug).then((rows) => {
      if (rows) setWorkspaceVaultFiles(rows);
    });
  }, [slug, fetchVaultFileRows]);

  const dismissSharedStripHero = useCallback(() => {
    setSharedManualHero(null);
    sharedIngestForceScanRef.current = true;
    void fetchVaultFileRows(slug).then((rows) => {
      if (rows) setWorkspaceVaultFiles(rows);
    });
  }, [slug, fetchVaultFileRows]);

  const dismissPrivateReingestJob = useCallback(
    (jobId: string) => {
      setPrivateReingestHero(null);
      void fetch(
        `/api/projects/${encodeURIComponent(slug)}/private-reingest-status`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        }
      ).catch(() => {});
      void fetchVaultFileRows(slug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
      try {
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      } catch {
        /* ignore */
      }
    },
    [slug, fetchVaultFileRows]
  );

  const onVaultPrivateReingestStarted = useCallback(
    (p: {
      jobId: string;
      fileName: string;
      projectSlug: string;
      assetRole?: string | null;
    }) => {
      if (p.projectSlug !== slug) return;
      setPrivateReingestHero({
        jobId: p.jobId,
        projectSlug: p.projectSlug,
        fileName: p.fileName,
        workspaceSessionKey: `draft:${slug}`,
        nonce: crypto.randomUUID(),
        ...(p.assetRole != null && String(p.assetRole).trim()
          ? { assetRole: normalizeVaultAssetRole(p.assetRole) }
          : {}),
      });
      void fetchVaultFileRows(p.projectSlug).then((rows) => {
        if (rows) setWorkspaceVaultFiles(rows);
      });
      try {
        window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
      } catch {
        /* ignore */
      }
    },
    [slug, fetchVaultFileRows]
  );

  useEffect(() => {
    void fetch("/api/projects")
      .then((r) => setVaultUploadEnabled(r.ok))
      .catch(() => setVaultUploadEnabled(false));
  }, []);

  /** Full-page `?mode=text` is deprecated; paste uses + menu or landing only. */
  useEffect(() => {
    if (!slug) return;
    if (searchParams.get("mode") === "text") {
      router.replace(`/chat/workspace/${encodeURIComponent(slug)}/draft`);
    }
  }, [slug, searchParams, router]);

  useEffect(() => {
    if (!slug) {
      setLoadError("Missing vault");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          if (!cancelled) setLoadError("Vault not found");
          return;
        }
        const d = (await r.json()) as {
          name?: string;
          visibility?: "private" | "shared";
        };
        if (!cancelled) {
          setProjectName(typeof d.name === "string" ? d.name : slug);
          setWorkspaceVisibility(
            d.visibility === "shared" ? "shared" : "private"
          );
        }
      } catch {
        if (!cancelled) setLoadError("Could not load vault");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setWorkspaceVaultFiles(null);
      return;
    }
    let cancelled = false;
    void fetchVaultFileRows(slug).then((rows) => {
      if (!cancelled) setWorkspaceVaultFiles(rows ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, fetchVaultFileRows]);

  async function createWorkspaceChat(): Promise<{
    sessionId: string;
    sessionKey: string;
  } | null> {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reuseIfEmpty: true }),
    });
    const d = (await res.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionKey?: string;
      error?: string;
    };
    if (!res.ok || !d.sessionId || !d.sessionKey) return null;
    return { sessionId: d.sessionId, sessionKey: d.sessionKey };
  }

  async function handleSubmit(
    text: string,
    imageUrls?: string[],
    options?: { oneOffModelId?: string }
  ) {
    const trimmed = text.trim();
    if (
      (!trimmed && (!imageUrls || imageUrls.length === 0)) ||
      creating ||
      !slug ||
      !projectName
    ) {
      return;
    }
    setCreating(true);
    try {
      const created = await createWorkspaceChat();
      if (!created) return;
      const { sessionId, sessionKey } = created;
      const k = encodeURIComponent(sessionKey);

      if (imageUrls && imageUrls.length > 0) {
        try {
          sessionStorage.setItem(
            `pending-images-${sessionId}`,
            JSON.stringify(imageUrls)
          );
        } catch {
          /* ignore */
        }
      }
      const q = encodeURIComponent(trimmed || "What's in this image?");
      const oom = options?.oneOffModelId?.trim();
      const oomQ = oom ? `&oom=${encodeURIComponent(oom)}` : "";
      router.replace(
        `/chat/${sessionId}?k=${k}&v=${encodeURIComponent(slug)}&q=${q}${oomQ}`
      );
    } finally {
      setCreating(false);
    }
  }

  if (!slug || loadError) {
    return (
      <div className="main-chat-depth flex h-full min-h-0 flex-col items-center justify-center px-4 text-center text-sm text-destructive/90">
        {loadError || "Invalid vault"}
      </div>
    );
  }

  return (
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
        <ChatHeader
          title="New vault chat"
          subline={projectName ?? undefined}
        />
        {vaultUploadEnabled &&
        workspaceVaultFiles !== null &&
        workspaceVisibility !== null ? (
          <WorkspaceVaultFilesBar
            projectSlug={slug}
            files={vaultFilesForBar}
            ingestJobs={vaultIngestJobsMerged}
            gapHints={
              sharedVaultGapHints.length > 0 ? sharedVaultGapHints : null
            }
            workspaceIsShared={workspaceVisibility === "shared"}
            onVaultRefresh={refreshVaultFilesAndIngestHints}
            onReingestQueued={(p) => {
              if (p.projectSlug !== slug) return;
              setSharedManualHero({
                jobId: p.jobId,
                fileName: p.fileName,
                ...(p.assetRole != null && String(p.assetRole).trim()
                  ? { assetRole: normalizeVaultAssetRole(p.assetRole) }
                  : {}),
              });
              sharedIngestForceScanRef.current = true;
            }}
            onPrivateReingestStarted={onVaultPrivateReingestStarted}
          />
        ) : null}
        <div className="flex max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex-1 min-h-0 flex-col">
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto px-6 max-md:justify-start max-md:gap-2 max-md:px-2">
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
                  onComplete={dismissSharedStripHero}
                />
              ) : (
                <VaultArchitectIngestIdleHero
                  enabled={showVaultArchitectIngestIdleHero}
                  agentName={agentName}
                />
              )
            ) : (
              <>
                <div className="relative size-64 shrink-0">
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
              </>
            )}
          </div>
        </div>
        <ChatInput
          ref={chatInputRef}
          input={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={creating || projectName === null}
          attachMode="workspace"
          suggestionScope="vault"
          threadHasMessages={false}
          vaultUploadEnabled={vaultUploadEnabled}
          activeWorkspaceSlug={slug}
          workspaceProjectName={projectName ?? slug}
          ensureNewWorkspaceSessionBeforeIngest
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
	            } else if (p.visibility !== "shared" && p.ingestJobId && p.fileName) {
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
              `/chat/${p.workspaceSessionId}?k=${encodeURIComponent(p.workspaceSessionKey)}&v=${encodeURIComponent(slug)}`
            );
          }}
        />
      </div>
  );
}
