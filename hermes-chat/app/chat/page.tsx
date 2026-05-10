"use client";

import { useRouter } from "next/navigation";
import { ChatHeader } from "@/components/chat-header";
import { ChatInput } from "@/components/chat-input";
import { generateId, fetchChatSessions } from "@/lib/sessions";
import { useState, useEffect, useRef } from "react";
import { Orb } from "@/components/ui/orb";
import { useChatIdentity } from "@/ChatIdentity";
export default function NewChatPage() {
  const router = useRouter();
  const didCheck = useRef(false);
  const [input, setInput] = useState("");
  const { agentName } = useChatIdentity();

  useEffect(() => {
    if (didCheck.current) return;
    didCheck.current = true;
    const isExplicitNew = new URLSearchParams(window.location.search).has("new");
    if (isExplicitNew) return;
    fetchChatSessions().then(({ sessions }) => {
      try {
        if (sessionStorage.getItem("oc-push-target")) return;
      } catch {
        /* ignore */
      }
      const active = sessions.find((s) => s.processing && s.webchatId);
      if (active) router.replace(`/chat/${active.webchatId}`);
    });
  }, [router]);

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
      } catch {}
    }
    const encoded = encodeURIComponent(msg || "What's in this image?");
    const oom = options?.oneOffModelId?.trim();
    const oomQ = oom
      ? `&oom=${encodeURIComponent(oom)}`
      : "";
    router.push(`/chat/${id}?q=${encoded}${oomQ}`);
  }

  return (
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
      <ChatHeader />
      <div className="flex max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="relative size-64">
          <Orb
            agentState="listening"
            colors={["#a3c4f3", "#6b8cce"]}
            className="size-full"
          />
        </div>
        <div className="max-w-sm text-center">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">I&apos;m {agentName}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            What can I help you with?
          </p>
        </div>
      </div>
      <ChatInput
        input={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={false}
        attachMode="chat"
        suggestionScope="chat"
        threadHasMessages={false}
      />
    </div>
  );
}
