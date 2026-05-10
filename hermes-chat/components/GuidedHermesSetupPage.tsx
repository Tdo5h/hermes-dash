"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  PinIcon,
  SparklesIcon,
} from "lucide-react";
import { ChatInput } from "@/components/chat-input";
import { Orb } from "@/components/ui/orb";
import { useChatIdentity } from "@/ChatIdentity";
import { generateId } from "@/lib/sessions";

type GuidedMode = "automation" | "skill";

const COPY = {
  automation: {
    title: "Create automation",
    eyebrow: "Automation setup",
    icon: CalendarClockIcon,
    body:
      "Tell me when it should run, how often, what it should do, and what you want back when it finishes.",
    placeholder:
      "Every weekday at 7am, check the vault for new notes and send me a short summary...",
    backHref: "/chat/automations",
    hidden: [
      "You are helping the user create a Hermes automation.",
      "Use the current Hermes automation/cron system, not a one-off reminder in chat.",
      "Clarify only the details needed to create a reliable automation: schedule, frequency, task, data sources or skills, delivery target, and expected output.",
      "Use plain language with the user. Internally translate their request into the correct Hermes job shape.",
      "Before creating anything, summarize the automation and ask for confirmation if the schedule or delivery is ambiguous.",
    ],
  },
  skill: {
    title: "Create skill",
    eyebrow: "Skill setup",
    icon: SparklesIcon,
    body:
      "Tell me what this skill should help with, when it should run, what rules it should follow, and what it should avoid.",
    placeholder:
      "When I ask for monthly reports, use this structure, check these details, and keep the tone concise...",
    backHref: "/chat/skills",
    hidden: [
      "You are helping the user create a user-owned Hermes skill.",
      "Create or refine a SKILL.md in Hermes' primary read/write skill library (`~/.hermes/skills/`, mounted here as `/opt/data/skills`) so Hermes can discover, edit, and use it later.",
      "Keep it user-owned, not bundled/system-owned. Add clear triggers, workflow rules, and boundaries.",
      "If the user wants the skill protected, pin it with Hermes Curator after creation. Explain that pinned skills are protected from Curator edits and archiving.",
      "Ask concise clarifying questions only when the trigger or expected behavior is unclear.",
    ],
  },
} as const;

export function GuidedHermesSetupPage({ mode }: { mode: GuidedMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editSkillId =
    mode === "skill" ? searchParams.get("edit")?.trim() || null : null;
  const editAutomationId =
    mode === "automation" ? searchParams.get("edit")?.trim() || null : null;
  const [input, setInput] = useState("");
  const { agentName } = useChatIdentity();
  const cfg = COPY[mode];
  const Icon = cfg.icon;
  const isSkillEdit = Boolean(editSkillId);
  const isAutomationEdit = Boolean(editAutomationId);

  const guidePrompt = useMemo(() => {
    if (isAutomationEdit && editAutomationId) {
      return [
        "You are helping the user edit an existing Hermes automation.",
        `Existing automation job id: ${editAutomationId}`,
        "Read the current job from the Hermes cron system before changing it.",
        "Use the current Hermes automation/cron system and PATCH the existing job; do not create a replacement unless the user explicitly asks.",
        "Help refine the schedule, frequency, task prompt, delivery target, enabled/paused state, and expected output.",
        "Use plain language with the user. Internally translate their requested change into the correct Hermes job patch.",
        "Before applying changes, summarize what will change if the schedule, delivery, or task intent is ambiguous.",
      ].join("\n");
    }
    if (!isSkillEdit || !editSkillId) return cfg.hidden.join("\n");
    return [
      "You are helping the user edit and refine an existing user-owned Hermes skill.",
      `Existing skill id: ${editSkillId}`,
      "Read the current SKILL.md from Hermes' primary read/write skill library (`~/.hermes/skills/`, mounted here as `/opt/data/skills`) before changing it.",
      "Improve triggers, workflow rules, boundaries, and examples without changing the skill's purpose unless the user asks.",
      "Keep it user-owned, not bundled/system-owned. If the skill is pinned, keep it pinned unless the user asks otherwise.",
      "Summarize the intended refinements and ask concise clarifying questions only when the requested edit is ambiguous.",
    ].join("\n");
  }, [cfg.hidden, editAutomationId, editSkillId, isAutomationEdit, isSkillEdit]);

  function handleSubmit(
    text: string,
    images?: string[],
    options?: { oneOffModelId?: string }
  ) {
    const request = text.trim();
    if (!request && (!images || images.length === 0)) return;
    const id = generateId();
    if (images && images.length > 0) {
      try {
        sessionStorage.setItem(`pending-images-${id}`, JSON.stringify(images));
      } catch {
        /* ignore */
      }
    }
    const fullPrompt = `${guidePrompt}\n\nUser request:\n${request || "Use the attached image/context."}`;
    const oom = options?.oneOffModelId?.trim();
    const qs = new URLSearchParams({ q: fullPrompt, guided: mode });
    if (editSkillId) qs.set("editSkill", editSkillId);
    if (editAutomationId) qs.set("editAutomation", editAutomationId);
    if (oom) qs.set("oom", oom);
    router.push(`/chat/${id}?${qs.toString()}`);
  }

  return (
    <div className="main-chat-depth flex h-full min-h-0 flex-col bg-[var(--sidebar-depth-canvas)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border/25 px-3 py-2">
        <Link
          href={cfg.backHref}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 text-sidebar-primary" aria-hidden />
          <div>
            <h1 className="text-sm font-medium tracking-tight">
              {isSkillEdit ? "Edit skill" : isAutomationEdit ? "Edit automation" : cfg.title}
            </h1>
            <p className="text-[10px] text-muted-foreground">
              {isSkillEdit ? editSkillId : isAutomationEdit ? editAutomationId : cfg.eyebrow}
            </p>
          </div>
        </div>
      </header>

      <div className="flex max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex-1 flex-col items-center justify-center gap-6 px-6">
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
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {isSkillEdit
              ? "Tell me what to improve, tighten, add, remove, or make clearer. I’ll read the existing skill first and refine it in place."
              : isAutomationEdit
                ? "Tell me what to change: timing, frequency, task, delivery, pause state, or the update you want back. I’ll edit the existing automation."
              : cfg.body}
          </p>
          {mode === "skill" ? (
            <div className="mx-auto mt-4 inline-flex max-w-sm items-center gap-2 rounded-lg border border-sidebar-border/35 bg-[var(--sidebar-depth-input)] px-3 py-2 text-left text-[11px] leading-snug text-muted-foreground">
              <PinIcon className="size-4 shrink-0 text-sidebar-primary" />
              <span>Pinned skills are protected from Hermes Curator edits and archiving.</span>
            </div>
          ) : null}
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
