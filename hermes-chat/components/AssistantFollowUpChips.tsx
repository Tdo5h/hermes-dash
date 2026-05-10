"use client";

import { SendHorizontal } from "lucide-react";
import type { AssistantFollowUpOption } from "@/lib/assistant-follow-up-suggestions";
import { cn } from "@/lib/utils";

type AssistantFollowUpChipsProps = {
  options: AssistantFollowUpOption[];
  disabled?: boolean;
  onSend: (prompt: string) => void;
  className?: string;
};

export function AssistantFollowUpChips({
  options,
  disabled,
  onSend,
  className,
}: AssistantFollowUpChipsProps) {
  if (options.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-2 flex w-full min-w-0 flex-col gap-1.5 border-t border-sidebar-border/20 pt-2",
        className
      )}
      role="group"
      aria-label="Quick replies"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90">
        Tap to send
      </span>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled}
            data-hermes-tip={opt.prompt}
            aria-label={`Send: ${opt.prompt}`}
            onClick={() => onSend(opt.prompt)}
            className={cn(
              "neu-raised flex w-full min-w-0 items-start gap-2 rounded-lg border border-sidebar-border/25 bg-[var(--sidebar-depth-raised)]/80 px-2.5 py-2 text-left text-xs leading-snug text-foreground transition-colors",
              "hover:border-sidebar-primary/35 hover:text-sidebar-primary",
              "disabled:pointer-events-none disabled:opacity-40"
            )}
          >
            <span className="min-w-0 flex-1 break-words">{opt.label}</span>
            <SendHorizontal
              className="mt-0.5 size-3.5 shrink-0 text-sidebar-primary opacity-80"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}
