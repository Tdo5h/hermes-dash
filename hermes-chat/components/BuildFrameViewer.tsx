"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Mail } from "lucide-react";
import { BuildEmailSendButton } from "@/components/BuildEmailSendButton";

type BuildFrameViewerProps = {
  buildId: string;
  name: string;
  frameUrl: string;
  openUrl: string;
  emailComposeUrl?: string;
  downloadUrl?: string;
};

export function BuildFrameViewer({
  buildId,
  name,
  frameUrl,
  openUrl,
  emailComposeUrl,
  downloadUrl,
}: BuildFrameViewerProps) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [progress, setProgress] = useState(4);
  const [progressTarget, setProgressTarget] = useState(12);
  const [loadingLabel, setLoadingLabel] = useState("Opening creation...");

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    setProgress(4);
    setProgressTarget(12);
    setLoadingLabel("Opening creation...");
    const timer = window.setTimeout(() => setSlow(true), 9000);
    return () => window.clearTimeout(timer);
  }, [frameUrl]);

  useEffect(() => {
    if (loaded) {
      setProgressTarget(100);
      return;
    }
    const id = window.setInterval(() => {
      setProgress((current) => {
        if (current >= progressTarget) return current;
        const distance = progressTarget - current;
        const step = Math.max(0.35, distance * 0.11);
        return Math.min(progressTarget, current + step);
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [loaded, progressTarget]);

  useEffect(() => {
    if (!loaded) return;
    setProgress(100);
  }, [loaded]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (iframeWindow && event.source !== iframeWindow) return;
      const data = event.data as
        | { source?: unknown; stage?: unknown; buildId?: unknown }
        | null;
      if (!data || data.source !== "hermes-build-viewer") return;
      switch (data.stage) {
        case "start":
          setProgressTarget((value) => Math.max(value, 22));
          setLoadingLabel("Starting creation...");
          break;
        case "dom":
          setProgressTarget((value) => Math.max(value, 58));
          setLoadingLabel("Loading layout...");
          break;
        case "load":
          setProgressTarget((value) => Math.max(value, 84));
          setLoadingLabel("Loading assets...");
          break;
        case "fit":
          setProgressTarget((value) => Math.max(value, 94));
          setLoadingLabel("Fitting to screen...");
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("hermes-build-viewer-open");
    return () => {
      document.documentElement.classList.remove("hermes-build-viewer-open");
    };
  }, []);

  function goBack() {
    router.push("/chat/builds");
  }

  function handleFrameLoad() {
    setProgressTarget(100);
    setLoadingLabel("Ready");
    window.setTimeout(() => setLoaded(true), 180);
  }

  return (
    <main
      className="main-chat-depth fixed inset-0 z-[160] flex min-h-0 flex-col overflow-hidden bg-black text-sidebar-foreground"
    >
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.45rem)]">
        <button
          type="button"
          onClick={goBack}
          className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_82%,black)] text-sidebar-foreground backdrop-blur-md"
          aria-label="Back to Hermes"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="pointer-events-none min-w-0 flex-1 text-center">
          <h1 className="mx-auto max-w-[58vw] truncate rounded-full border border-sidebar-border/35 bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_72%,black)] px-3 py-1.5 text-xs font-semibold text-sidebar-foreground shadow-[0_10px_30px_rgba(0,0,0,0.24)] backdrop-blur-md">
            {name}
          </h1>
        </div>
        {emailComposeUrl ? (
          <BuildEmailSendButton
            buildId={buildId}
            name={name}
            title="Copy designed email and open email app"
            className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_82%,black)] text-sidebar-foreground backdrop-blur-md"
          >
            <Mail className="size-4.5" aria-hidden />
          </BuildEmailSendButton>
        ) : null}
        {downloadUrl ? (
          <a
            href={downloadUrl}
            className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_82%,black)] text-sidebar-foreground backdrop-blur-md"
            aria-label={`Download ${name}`}
          >
            <Download className="size-4.5" aria-hidden />
          </a>
        ) : null}
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="neu-raised pointer-events-auto hidden size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_82%,black)] text-sidebar-foreground backdrop-blur-md md:inline-flex"
          aria-label="Open in browser"
        >
          <ExternalLink className="size-4.5" aria-hidden />
        </a>
      </header>
      <section
        className="absolute min-h-0 bg-black"
        style={{
          top: "env(safe-area-inset-top)",
          bottom: "env(safe-area-inset-bottom)",
          left: "env(safe-area-inset-left)",
          right: "env(safe-area-inset-right)",
        }}
      >
        {!loaded ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--sidebar-depth-canvas)] text-sm text-muted-foreground">
            <div
              className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label="Creation loading progress"
            >
              <div
                className="h-full rounded-full bg-sidebar-primary transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              />
            </div>
            <p>{slow ? "Still working on this creation..." : loadingLabel}</p>
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          key={frameUrl}
          src={frameUrl}
          title={name}
          onLoad={handleFrameLoad}
          className="h-full w-full border-0 bg-black"
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="no-referrer-when-downgrade"
          scrolling="yes"
        />
      </section>
    </main>
  );
}
