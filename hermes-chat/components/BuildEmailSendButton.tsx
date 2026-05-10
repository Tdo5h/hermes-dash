"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Mail } from "lucide-react";

type EmailPrepareResponse = {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  html?: string;
  clipboardHtml?: string;
  richClipboardHtml?: string;
  text?: string;
  textPreview: string;
  htmlBytes: number;
  clipboardHtmlBytes?: number;
  richClipboardHtmlBytes?: number;
  textBytes: number;
  imageCount: number;
  warnings: string[];
  error?: string;
};

type BuildEmailSendButtonProps = {
  buildId: string;
  name: string;
  className: string;
  children?: ReactNode;
  title?: string;
  mode?: "send-rich" | "copy-rich";
};

export function BuildEmailSendButton({
  buildId,
  name,
  className,
  children,
  title = "Open email app",
  mode = "send-rich",
}: BuildEmailSendButtonProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const emailPromiseRef = useRef<Promise<EmailPrepareResponse> | null>(null);

  function prepareEmail(): Promise<EmailPrepareResponse> {
    emailPromiseRef.current ??= fetch(
      `/api/builds/email/send?id=${encodeURIComponent(buildId)}`,
      {
        cache: "no-store",
        credentials: "same-origin",
      }
    ).then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as EmailPrepareResponse;
      if (!res.ok) throw new Error(json.error || "Could not prepare email.");
      return json;
    });
    return emailPromiseRef.current;
  }

  function mailtoParam(key: string, value: string): string {
    return `${key}=${encodeURIComponent(value)}`;
  }

  function mailtoSubject(email: EmailPrepareResponse): string {
    return (email.subject?.trim() || name)
      .replace(/\s*[–—]\s*/g, ": ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function mailtoUrl(email: EmailPrepareResponse, fallbackBody = ""): string {
    const params = [mailtoParam("subject", mailtoSubject(email))];
    if (fallbackBody.trim()) params.push(mailtoParam("body", fallbackBody.trim()));
    return `mailto:?${params.join("&")}`;
  }

  async function copyPreparedEmail(email: EmailPrepareResponse): Promise<"html" | "text" | "none"> {
    const html =
      mode === "copy-rich"
        ? email.richClipboardHtml?.trim() || email.html?.trim() || ""
        : email.richClipboardHtml?.trim() ||
          email.html?.trim() ||
          email.clipboardHtml?.trim() ||
          "";
    const text = email.text?.trim() || email.textPreview.trim();
    if (
      html &&
      typeof ClipboardItem !== "undefined" &&
      typeof Blob !== "undefined" &&
      navigator.clipboard?.write
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return "html";
    }
    if (text && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "text";
    }
    return "none";
  }

  async function copyEmailForNativeApp(): Promise<{
    email: EmailPrepareResponse;
    copied: "html" | "text" | "none";
  }> {
    const emailPromise = prepareEmail();
    if (
      typeof ClipboardItem !== "undefined" &&
      typeof Blob !== "undefined" &&
      navigator.clipboard?.write
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": emailPromise.then((email) => {
              const html =
                mode === "copy-rich"
                  ? email.richClipboardHtml?.trim() ||
                    email.html?.trim() ||
                    email.text?.trim() ||
                    email.textPreview
                  : email.richClipboardHtml?.trim() ||
                    email.html?.trim() ||
                    email.clipboardHtml?.trim() ||
                    email.text?.trim() ||
                    email.textPreview;
              return new Blob([html], { type: "text/html" });
            }),
            "text/plain": emailPromise.then((email) => {
              const text = email.text?.trim() || email.textPreview;
              return new Blob([text], { type: "text/plain" });
            }),
          }),
        ]);
        return { email: await emailPromise, copied: "html" };
      } catch {
        const email = await emailPromise;
        return { email, copied: await copyPreparedEmail(email) };
      }
    }

    const email = await emailPromise;
    return { email, copied: await copyPreparedEmail(email) };
  }

  async function openEmailApp() {
    if (busy) return;
    setBusy(true);
    try {
      const { email, copied } = await copyEmailForNativeApp();
      if (mode === "copy-rich") {
        if (copied === "none") throw new Error("Could not copy the designed email.");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
        return;
      }
      const fallbackBody = copied === "none" ? email.text?.trim() || email.textPreview : "";
      if (copied !== "none") {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      }
      window.location.href = mailtoUrl(email, fallbackBody);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not open email app.";
      window.alert(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={
        mode === "copy-rich"
          ? `Copy designed email for ${name}`
          : `Open email app for ${name}`
      }
      title={
        busy
          ? "Preparing email..."
          : copied
            ? "Copied designed email"
            : title
      }
      disabled={busy}
      onPointerEnter={() => {
        void prepareEmail().catch(() => {
          emailPromiseRef.current = null;
        });
      }}
      onFocus={() => {
        void prepareEmail().catch(() => {
          emailPromiseRef.current = null;
        });
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openEmailApp();
      }}
    >
      {copied ? <Check className="size-4.5" aria-hidden /> : children ?? <Mail className="size-4.5" aria-hidden />}
    </button>
  );
}
