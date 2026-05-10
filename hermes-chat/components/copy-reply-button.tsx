"use client";

import { useCallback, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

export function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const trimmed = text.trim();
  const disabled = !trimmed;

  const onCopy = useCallback(async () => {
    if (!trimmed || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [trimmed]);

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      disabled={disabled}
      aria-label="Copy assistant reply"
      data-hermes-tip="Copy this reply."
      className={`
        inline-flex shrink-0 items-center justify-center rounded p-0.5 transition-colors
        text-muted-foreground hover:text-foreground
        disabled:opacity-40 disabled:pointer-events-none
      `}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-500" aria-hidden />
      ) : (
        <CopyIcon className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
