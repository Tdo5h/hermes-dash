"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ChatHeader } from "@/components/chat-header";
import { ChatInput } from "@/components/chat-input";
import { generateId } from "@/lib/sessions";
import { Orb } from "@/components/ui/orb";
import { useChatIdentity } from "@/ChatIdentity";
import {
  VAULT_PENDING_INGEST_KEY,
  type VaultPendingIngestPayload,
} from "@/lib/vault-pending-ingest";
import {
  SHARED_INGEST_HERO_KEY,
  type SharedIngestHeroPayload,
} from "@/lib/shared-ingest-hero-storage";
import { getOrbHelper } from "@/lib/helper-suggestions";
/**
 * Full-width landing when the user opens the Vault sidebar tab with no projects yet
 * and is on /chat — mirrors the home orb + composer, with + attach (files + images) and friendly copy.
 */
export function WorkspacesEmptyMain() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const { agentName } = useChatIdentity();
  const [vaultUploadEnabled, setVaultUploadEnabled] = useState(false);

  useEffect(() => {
    void fetch("/api/projects")
      .then((r) => setVaultUploadEnabled(r.ok))
      .catch(() => setVaultUploadEnabled(false));
  }, []);

  function handleSubmit(
    text: string,
    images?: string[],
    options?: { oneOffModelId?: string }
  ) {
    const msg = text.trim();
    if (!msg && (!images || images.length === 0)) return;
    const id = generateId();
    if (images && images.length > 0) {
      try {
        sessionStorage.setItem(`pending-images-${id}`, JSON.stringify(images));
      } catch {
        /* ignore */
      }
    }
    const encoded = encodeURIComponent(msg || "What's in this image?");
    const oom = options?.oneOffModelId?.trim();
    const oomQ = oom ? `&oom=${encodeURIComponent(oom)}` : "";
    router.push(`/chat/${id}?q=${encoded}${oomQ}`);
  }

  return (
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
      <ChatHeader title="Vault" subline="Your documents, connected" />
      <div className="flex max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex-1 flex-col items-center justify-center gap-5 px-6">
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
            {getOrbHelper({ surface: "vault-empty" })}
          </p>
        </div>
      </div>
      <ChatInput
        input={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={false}
        attachMode="workspace"
        suggestionScope="vault"
        threadHasMessages={false}
        vaultUploadEnabled={vaultUploadEnabled}
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
  );
}
