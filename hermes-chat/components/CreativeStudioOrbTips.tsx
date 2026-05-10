"use client";

import type { AgentState } from "@/components/ui/orb";
import { Orb } from "@/components/ui/orb";
import type { CreativeStudioIntent } from "@/lib/creative-studio-session";
import { getCreateOrbHelpers } from "@/lib/helper-suggestions";
import { useRotatingHelper } from "@/lib/use-rotating-helper";

export type CreativeStudioOrbTipsLayout = "dialog" | "hero";

export type CreativeStudioOrbTipsProps = {
  intent: CreativeStudioIntent;
  /** When false, tip index stays fixed (e.g. dialog closed). */
  enabled: boolean;
  agentState: AgentState;
  layout: CreativeStudioOrbTipsLayout;
  className?: string;
};

export function CreativeStudioOrbTips({
  intent,
  enabled,
  agentState,
  layout,
  className,
}: CreativeStudioOrbTipsProps) {
  const tips = getCreateOrbHelpers(intent);
  const { text, transitioning } = useRotatingHelper(tips, {
    pause: !enabled,
  });

  const orbWrap =
    layout === "hero"
      ? "relative size-64 shrink-0"
      : "relative size-44 shrink-0 sm:size-48";

  const tipText =
    layout === "hero"
      ? "min-h-[4rem] max-w-md text-center text-sm leading-relaxed text-muted-foreground"
      : "min-h-[3.25rem] max-w-[18rem] text-center text-xs leading-relaxed text-muted-foreground";

  return (
    <div
      className={`flex flex-col items-center gap-3 ${className ?? ""}`.trim()}
    >
      <div className={orbWrap}>
        <Orb
          agentState={agentState}
          colors={["#a3c4f3", "#6b8cce"]}
          className="size-full"
        />
      </div>
      <p
        className={`${tipText} transition-[opacity,transform] duration-700`}
        style={{
          opacity: transitioning ? 0 : 1,
          transform: transitioning ? "translateY(3px)" : "translateY(0)",
        }}
      >
        {text}
      </p>
    </div>
  );
}
