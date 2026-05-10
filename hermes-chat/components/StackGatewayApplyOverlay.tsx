"use client";

import { Orb } from "@/components/ui/orb";

export { DURATION_MS, waitMinApplyDuration } from "@/lib/wait-min-apply";

type Props = {
  open: boolean;
  /** Bump to remount the orb (e.g. each apply from settings). */
  applyKey?: number;
  /** Root stacking (default matches long-press over composer). */
  zClassName?: string;
};

/**
 * Full-screen "Updating stack and gateway" with the same agent orb scale as the new chat page.
 */
export function StackGatewayApplyOverlay({
  open,
  applyKey = 0,
  zClassName = "z-[55]",
}: Props) {
  if (!open) return null;

  return (
    <div
      className={`pointer-events-auto fixed inset-0 ${zClassName} flex items-center justify-center bg-background/80 backdrop-blur-sm`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-6 px-6">
        <div className="relative size-64">
          <Orb
            key={applyKey}
            agentState="listening"
            colors={["#a3c4f3", "#6b8cce"]}
            className="size-full"
          />
        </div>
        <p className="text-center text-sm text-foreground/90">Updating stack and gateway…</p>
      </div>
    </div>
  );
}
