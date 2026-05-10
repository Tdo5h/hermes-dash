"use client";

import { useCallback, useRef, useState } from "react";
import { CheckIcon, PrinterIcon } from "lucide-react";

function makePrintText(text: string): string {
  return text
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function removeExistingPrintRoot() {
  document.getElementById("hermes-reply-print-root")?.remove();
  document.documentElement.classList.remove("hermes-printing-reply");
}

function cloneRenderedReply(button: HTMLButtonElement | null): HTMLElement | null {
  const source = button?.closest(".hermes-message-content");
  if (!(source instanceof HTMLElement)) return null;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-hermes-print-skip]").forEach((node) => node.remove());
  clone.querySelectorAll("button").forEach((node) => node.remove());
  clone.querySelectorAll("[data-hermes-artifact-actions]").forEach((node) => node.remove());
  clone.className = "hermes-reply-print-body";
  return clone;
}

export function PrintReplyButton({ text }: { text: string }) {
  const [opened, setOpened] = useState(false);
  const cleanupTimer = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const trimmed = makePrintText(text);
  const disabled = !trimmed;

  const onPrint = useCallback(() => {
    if (!trimmed) return;
    if (cleanupTimer.current) {
      window.clearTimeout(cleanupTimer.current);
      cleanupTimer.current = null;
    }

    removeExistingPrintRoot();

    const root = document.createElement("section");
    root.id = "hermes-reply-print-root";
    root.className = "hermes-reply-print-root";

    const eyebrow = document.createElement("div");
    eyebrow.className = "hermes-reply-print-eyebrow";
    eyebrow.textContent = "Hermes reply";

    const body = cloneRenderedReply(buttonRef.current) ?? document.createElement("pre");
    if (!body.textContent?.trim()) {
      body.textContent = trimmed;
    }
    body.classList.add("hermes-reply-print-body");

    root.append(eyebrow, body);
    document.body.appendChild(root);
    document.documentElement.classList.add("hermes-printing-reply");

    const cleanup = () => {
      setOpened(false);
      removeExistingPrintRoot();
      window.removeEventListener("afterprint", cleanup);
      if (cleanupTimer.current) {
        window.clearTimeout(cleanupTimer.current);
        cleanupTimer.current = null;
      }
    };

    window.addEventListener("afterprint", cleanup);
    setOpened(true);
    window.requestAnimationFrame(() => {
      window.print();
      cleanupTimer.current = window.setTimeout(cleanup, 60_000);
    });
  }, [trimmed]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onPrint}
      disabled={disabled}
      aria-label="Print assistant reply"
      data-hermes-tip="Print this reply."
      className={`
        inline-flex shrink-0 items-center justify-center rounded p-0.5 transition-colors
        text-muted-foreground hover:text-foreground
        disabled:pointer-events-none disabled:opacity-40
      `}
    >
      {opened ? (
        <CheckIcon className="size-3.5 text-sidebar-primary" aria-hidden />
      ) : (
        <PrinterIcon className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
