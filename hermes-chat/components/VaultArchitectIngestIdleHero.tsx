"use client";

import { Orb } from "@/components/ui/orb";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import {
  getOrbHelper,
  VAULT_INGEST_IDLE_HELPERS,
} from "@/lib/helper-suggestions";
import { useRotatingHelper } from "@/lib/use-rotating-helper";

export type VaultArchitectIngestIdleHeroProps = {
  enabled: boolean;
  agentName: string;
};

export function VaultArchitectIngestIdleHero({
  enabled,
  agentName,
}: VaultArchitectIngestIdleHeroProps) {
  const { text, transitioning } = useRotatingHelper(VAULT_INGEST_IDLE_HELPERS, {
    pause: !enabled,
  });

  return (
    <div className="flex min-h-[min(70dvh,28rem)] flex-1 flex-col items-center justify-center gap-6 px-2 py-8 max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]">
      <div className="flex flex-col items-center gap-3">
        <div className="relative size-64 shrink-0">
          <Orb
            agentState="thinking"
            colors={CHAT_AGENT_ORB_COLORS}
            className="size-full"
          />
        </div>
        <p
          className="min-h-[4rem] max-w-md px-1 text-center text-sm leading-relaxed text-muted-foreground transition-[opacity,transform] duration-700"
          style={{
            opacity: transitioning ? 0 : 1,
            transform: transitioning ? "translateY(3px)" : "translateY(0)",
          }}
        >
          {text}
        </p>
      </div>
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          I&apos;m {agentName}
        </h2>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          {getOrbHelper({ surface: "vault-ingest-idle" })}
        </p>
      </div>
    </div>
  );
}
