"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  MailIcon,
  Maximize2Icon,
  MinusIcon,
  MonitorIcon,
  PaperclipIcon,
  PlusIcon,
  PrinterIcon,
  Share2Icon,
  Table2Icon,
  VideoIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type MarkdownVaultFileLinkProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
};

type ArtifactKind =
  | "pdf"
  | "html"
  | "svg"
  | "image"
  | "document"
  | "sheet"
  | "text"
  | "code"
  | "archive"
  | "video"
  | "audio"
  | "email"
  | "file";

type ParsedArtifact = {
  source: "build" | "vault";
  href: string;
  displayName: string;
  downloadName: string;
  previewHref: string;
  viewerHref: string;
  downloadHref: string;
  buildId?: string;
  buildFilePath?: string;
  vaultSlug?: string;
  kind: ArtifactKind;
};

type BuildPackageFile = {
  name: string;
  path: string;
  size: number;
  href: string;
  downloadHref: string;
};

type BuildPackage = {
  id: string;
  name: string;
  description: string | null;
  emailComposeUrl: string | null;
  primaryPath: string | null;
  files: BuildPackageFile[];
};

const mountedBuildCards = new Set<string>();
type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsPromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import("pdfjs-dist/webpack.mjs") as Promise<PdfJsModule>;
  return pdfJsPromise;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function basename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

function extOf(name: string): string {
  return (name.match(/\.([a-z0-9]+)(?:$|[?#])/i)?.[1] ?? "").toLowerCase();
}

function artifactKind(name: string): ArtifactKind {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "html" || ext === "htm") return basename(name).toLowerCase() === "email.html" ? "email" : "html";
  if (ext === "svg") return "svg";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) return "image";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "document";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["txt", "md", "log"].includes(ext)) return "text";
  if (["json", "js", "ts", "tsx", "jsx", "css", "scss", "py", "sh", "yaml", "yml", "xml"].includes(ext)) return "code";
  if (["zip", "tar", "gz", "tgz", "zst", "7z"].includes(ext)) return "archive";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "aac"].includes(ext)) return "audio";
  return "file";
}

function typeLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "html":
      return "Web";
    case "email":
      return "Email";
    case "svg":
      return "SVG";
    case "image":
      return "Image";
    case "document":
      return "Document";
    case "sheet":
      return "Data";
    case "text":
      return "Text";
    case "code":
      return "Code";
    case "archive":
      return "Archive";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return "File";
  }
}

function ArtifactKindIcon({
  kind,
  className,
}: {
  kind: ArtifactKind;
  className?: string;
}) {
  switch (kind) {
    case "pdf":
    case "document":
    case "text":
      return <FileTextIcon className={className} aria-hidden />;
    case "html":
    case "email":
      return <MonitorIcon className={className} aria-hidden />;
    case "svg":
    case "image":
      return <FileImageIcon className={className} aria-hidden />;
    case "sheet":
      return <Table2Icon className={className} aria-hidden />;
    case "code":
      return <Code2Icon className={className} aria-hidden />;
    case "archive":
      return <ArchiveIcon className={className} aria-hidden />;
    case "video":
      return <VideoIcon className={className} aria-hidden />;
    case "audio":
      return <Volume2Icon className={className} aria-hidden />;
    default:
      return <FileIcon className={className} aria-hidden />;
  }
}

function withDisposition(href: string, disposition: "inline" | "attachment"): string {
  try {
    const isRelative = href.startsWith("/");
    const u = new URL(
      href,
      isRelative
        ? "http://local"
        : typeof window !== "undefined"
          ? window.location.origin
          : "http://local"
    );
    u.searchParams.set("disposition", disposition);
    if (disposition === "attachment") u.searchParams.delete("inline");
    return isRelative ? `${u.pathname}${u.search}${u.hash}` : u.toString();
  } catch {
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}disposition=${disposition}`;
  }
}

function buildStaticHref(id: string, filePath: string): string {
  const parts = filePath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  return `/api/builds/static/${encodeURIComponent(id)}/${parts.join("/")}`;
}

function sameOriginParts(href: string | undefined): {
  pathname: string;
  params: URLSearchParams;
} | null {
  if (!href?.trim()) return null;
  try {
    if (href.startsWith("/")) {
      const u = new URL(href, "http://local");
      return { pathname: u.pathname, params: u.searchParams };
    }
    const u = new URL(href);
    const isInternalArtifactPath =
      u.pathname === "/api/builds/file" ||
      u.pathname === "/api/builds/download" ||
      u.pathname.startsWith("/api/builds/static/") ||
      u.pathname.startsWith("/api/images/") ||
      /^\/api\/projects\/[^/]+\/file$/.test(u.pathname);
    if (!isInternalArtifactPath) return null;
    if (typeof window !== "undefined" && u.origin !== window.location.origin) return null;
    return { pathname: u.pathname, params: u.searchParams };
  } catch {
    return null;
  }
}

function parseArtifactHref(href: string | undefined): ParsedArtifact | null {
  const parts = sameOriginParts(href);
  if (!href || !parts) return null;

  if (parts.pathname === "/api/builds/file") {
    const id = (parts.params.get("id") ?? "").trim();
    const rawName = (parts.params.get("name") ?? parts.params.get("file") ?? "").trim();
    if (!id || !rawName) return null;
    const filePath = decodeSafe(rawName).replace(/^\/+/, "");
    const displayName = basename(filePath);
    const kind = artifactKind(displayName);
    const staticHref = buildStaticHref(id, filePath);
    const canStaticPreview = [
      "html",
      "email",
      "svg",
      "image",
      "video",
      "audio",
      "pdf",
      "text",
      "code",
      "sheet",
    ].includes(kind);
    return {
      source: "build",
      href,
      displayName,
      downloadName: displayName,
      previewHref: canStaticPreview ? staticHref : withDisposition(href, "inline"),
      viewerHref: canStaticPreview ? staticHref : withDisposition(href, "inline"),
      downloadHref: withDisposition(href, "attachment"),
      buildId: id,
      buildFilePath: filePath,
      kind,
    };
  }

  const staticBuildMatch = parts.pathname.match(/^\/api\/builds\/static\/([^/]+)\/(.+)$/);
  if (staticBuildMatch) {
    const id = decodeSafe(staticBuildMatch[1] ?? "").trim();
    const filePath = decodeSafe(staticBuildMatch[2] ?? "").replace(/^\/+/, "");
    if (!id || !filePath) return null;
    const displayName = basename(filePath);
    const kind = artifactKind(displayName);
    return {
      source: "build",
      href,
      displayName,
      downloadName: displayName,
      previewHref: href,
      viewerHref: href,
      downloadHref: `/api/builds/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(filePath)}&disposition=attachment`,
      buildId: id,
      buildFilePath: filePath,
      kind,
    };
  }

  if (parts.pathname === "/api/builds/download") {
    const id = (parts.params.get("id") ?? "").trim();
    if (!id) return null;
    return {
      source: "build",
      href,
      displayName: "Creation ZIP",
      downloadName: `${id}.zip`,
      previewHref: href,
      viewerHref: href,
      downloadHref: href,
      buildId: id,
      kind: "archive",
    };
  }

  const imageMatch = parts.pathname.match(/^\/api\/images\/([^/?#]+)$/);
  if (imageMatch) {
    const id = decodeSafe(imageMatch[1] ?? "").trim();
    if (!id) return null;
    const displayName = basename(id);
    return {
      source: "vault",
      href,
      displayName,
      downloadName: displayName,
      previewHref: href,
      viewerHref: href,
      downloadHref: href,
      kind: "image",
    };
  }

  const vaultMatch = parts.pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
  if (vaultMatch) {
    const rawName = (parts.params.get("name") ?? parts.params.get("file") ?? "").trim();
    if (!rawName) return null;
    const fileName = decodeSafe(rawName);
    const displayName = basename(fileName);
    return {
      source: "vault",
      href,
      displayName,
      downloadName: displayName,
      previewHref: withDisposition(href, "inline"),
      viewerHref: withDisposition(href, "inline"),
      downloadHref: withDisposition(href, "attachment"),
      vaultSlug: vaultMatch[1],
      kind: artifactKind(displayName),
    };
  }

  return null;
}

function isCoarseOrPhone(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 760px), (pointer: coarse)").matches
  );
}

function canInlinePreview(kind: ArtifactKind): boolean {
  return ["pdf", "html", "email", "svg", "image", "video", "audio", "text", "code", "sheet"].includes(kind);
}

function canPrint(kind: ArtifactKind): boolean {
  return ["pdf", "html", "email", "svg", "image", "text", "code", "sheet"].includes(kind);
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http")) return href;
  return new URL(href, window.location.origin).toString();
}

function siblingBuildHref(artifact: ParsedArtifact, fileName: string): string | null {
  if (!artifact.buildId || !artifact.buildFilePath) return null;
  const parts = artifact.buildFilePath.split("/").filter(Boolean);
  parts.pop();
  return buildStaticHref(artifact.buildId, [...parts, fileName].join("/"));
}

function buildViewerHref(artifact: ParsedArtifact): string | null {
  if (artifact.source !== "build" || !artifact.buildId) return null;
  if (artifact.kind !== "html" && artifact.kind !== "email") return null;
  return `/chat/builds/open/${encodeURIComponent(artifact.buildId)}`;
}

function artifactFromBuildPackageFile(
  buildId: string,
  file: BuildPackageFile
): ParsedArtifact {
  return {
    source: "build",
    href: file.href,
    displayName: file.name,
    downloadName: file.name,
    previewHref: file.href,
    viewerHref: file.href,
    downloadHref: file.downloadHref,
    buildId,
    buildFilePath: file.path,
    kind: artifactKind(file.name),
  };
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function mimeForArtifact(kind: ArtifactKind, fallback = "application/octet-stream"): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "html":
    case "email":
      return "text/html";
    case "svg":
      return "image/svg+xml";
    case "image":
      return "image/png";
    case "text":
      return "text/plain";
    case "code":
      return "text/plain";
    case "sheet":
      return "text/csv";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mpeg";
    default:
      return fallback;
  }
}

async function fetchArtifactBlob(href: string): Promise<Blob> {
  const res = await fetch(href, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerUrlDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

async function shareArtifactFile(artifact: ParsedArtifact): Promise<boolean> {
  if (
    typeof File === "undefined" ||
    !navigator.share ||
    !navigator.canShare
  ) {
    return false;
  }
  const blob = await fetchArtifactBlob(artifact.downloadHref);
  const file = new File([blob], artifact.downloadName, {
    type: blob.type || mimeForArtifact(artifact.kind),
  });
  if (!navigator.canShare({ files: [file] })) return false;
  await navigator.share({ files: [file] });
  return true;
}

function firstSubjectFromText(text: string): string {
  const subjectHeader = text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim();
  if (subjectHeader) return subjectHeader;
  const option = text.match(/^\s*(?:\d+[\).]\s*|-)\s*(.{6,90})$/m)?.[1]?.trim();
  return option ?? "";
}

function parsePlainTextEmail(raw: string): { subject: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const subject = firstSubjectFromText(text);
  const marker = text.match(/(?:^|\n)Plain-text email:\s*\n/i);
  if (marker?.index != null) {
    return {
      subject,
      body: text.slice(marker.index + marker[0].length).trim(),
    };
  }
  const body = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^Subject:\s*/i.test(t)) return false;
      if (/^Preheader:\s*/i.test(t)) return false;
      if (/^Subject options:?$/i.test(t)) return false;
      if (/^\d+[\).]\s*/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject, body };
}

function mailtoUrl(subject: string, body: string): string | null {
  const cleanBody = body.trim();
  if (!cleanBody) return null;
  return `mailto:?subject=${encodeURIComponent(subject.trim() || "A quick note")}&body=${encodeURIComponent(cleanBody)}`;
}

function parseEmailHtml(raw: string): { subject: string; body: string } {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.querySelectorAll("script,style,noscript,template").forEach((node) => node.remove());
  const subject =
    doc.querySelector("[data-subject]")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    doc.querySelector("h1,h2")?.textContent?.trim() ||
    "";
  const body = (doc.body?.innerText ?? doc.documentElement.textContent ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject, body };
}

async function composeEmailFromArtifact(artifact: ParsedArtifact): Promise<boolean> {
  if (artifact.buildId) {
    try {
      const res = await fetch("/api/builds", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          apps?: Array<{ id?: string; emailComposeUrl?: string | null }>;
        };
        const href = data.apps?.find((app) => app.id === artifact.buildId)?.emailComposeUrl;
        if (href) {
          window.location.href = href;
          return true;
        }
      }
    } catch {
      // Fall through to local file extraction.
    }

    const plainTextHref = siblingBuildHref(artifact, "plain-text.txt");
    if (plainTextHref) {
      const plain = await fetch(plainTextHref, {
        cache: "no-store",
        credentials: "same-origin",
      }).then((res) => (res.ok ? res.text() : ""));
      if (plain.trim()) {
        const parsed = parsePlainTextEmail(plain);
        const href = mailtoUrl(parsed.subject, parsed.body);
        if (href) {
          window.location.href = href;
          return true;
        }
      }
    }
  }

  const html = await fetch(artifact.viewerHref, {
    cache: "no-store",
    credentials: "same-origin",
  }).then((res) => (res.ok ? res.text() : ""));
  if (!html.trim()) return false;
  const parsed = parseEmailHtml(html);
  const href = mailtoUrl(parsed.subject, parsed.body);
  if (!href) return false;
  window.location.href = href;
  return true;
}

async function copyImageToClipboard(artifact: ParsedArtifact): Promise<boolean> {
  if (
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write ||
    (artifact.kind !== "image" && artifact.kind !== "svg")
  ) {
    return false;
  }
  const blob = await fetchArtifactBlob(artifact.viewerHref);
  const type = blob.type || mimeForArtifact(artifact.kind);
  await navigator.clipboard.write([
    new ClipboardItem({
      [type]: blob,
    }),
  ]);
  return true;
}

function ArtifactAction({
  children,
  onClick,
  href,
  download,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  href?: string;
  download?: string;
  title?: string;
  className?: string;
}) {
  const base = cn(
    "neu-raised inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-sidebar-foreground transition-colors hover:text-sidebar-primary",
    className
  );
  if (href) {
    return (
      <a
        href={href}
        download={download}
        onClick={onClick as ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined}
        className={base}
        data-hermes-tip={title}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick as ((event: MouseEvent<HTMLButtonElement>) => void) | undefined}
      className={base}
      data-hermes-tip={title}
    >
      {children}
    </button>
  );
}

function isPdfRenderCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      error.message.toLowerCase().includes("cancelled"))
  );
}

async function loadPdfDocument(href: string): Promise<PDFDocumentProxy> {
  const [pdfjs, res] = await Promise.all([
    loadPdfJs(),
    fetch(href, {
      cache: "no-store",
      credentials: "same-origin",
    }),
  ]);
  if (!res.ok) throw new Error(`Could not load PDF: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
}

function PdfCanvasRenderer({
  artifact,
  pageNumber = 1,
  zoom = 1,
  preview = false,
  onDocumentLoad,
  onReady,
  className,
  canvasClassName,
}: {
  artifact: ParsedArtifact;
  pageNumber?: number;
  zoom?: number;
  preview?: boolean;
  onDocumentLoad?: (pageCount: number) => void;
  onReady?: () => void;
  className?: string;
  canvasClassName?: string;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDocumentLoadRef = useRef(onDocumentLoad);
  const onReadyRef = useRef(onReady);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    onDocumentLoadRef.current = onDocumentLoad;
  }, [onDocumentLoad]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    let activeDocument: PDFDocumentProxy | null = null;
    setStatus("loading");
    setPdfDocument(null);

    void loadPdfDocument(artifact.viewerHref)
      .then((document) => {
        activeDocument = document;
        if (cancelled) {
          void document.destroy();
          return;
        }
        setPdfDocument(document);
        onDocumentLoadRef.current?.(document.numPages);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (activeDocument) void activeDocument.destroy();
    };
  }, [artifact.viewerHref]);

  useEffect(() => {
    if (!pdfDocument) return;

    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    let observer: ResizeObserver | null = null;
    let animationFrame = 0;
    let readyNotified = false;
    let renderRun = 0;

    async function paint() {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas || !page) return;

      const rect = container.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) return;

      const run = ++renderRun;
      renderTask?.cancel();
      renderTask = null;

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(80, rect.width - (preview ? 20 : 28));
      const availableHeight = Math.max(80, rect.height - (preview ? 20 : 28));
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height
      );
      const cssScale = Math.max(0.04, fitScale * zoom);
      const deviceScale = Math.min(window.devicePixelRatio || 1, preview ? 2 : 2.5);
      const cssViewport = page.getViewport({ scale: cssScale });
      const renderViewport = page.getViewport({ scale: cssScale * deviceScale });

      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.floor(cssViewport.width)}px`;
      canvas.style.height = `${Math.floor(cssViewport.height)}px`;

      const task = page.render({
        canvas,
        viewport: renderViewport,
        background: "#ffffff",
      });
      renderTask = task;

      try {
        await task.promise;
        if (cancelled || task !== renderTask || run !== renderRun) return;
        setStatus("ready");
        if (!readyNotified) {
          readyNotified = true;
          onReadyRef.current?.();
        }
      } catch (error) {
        if (cancelled || task !== renderTask || isPdfRenderCancellation(error)) return;
        setStatus("error");
      }
    }

    function schedulePaint() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        void paint();
      });
    }

    void pdfDocument
      .getPage(Math.min(Math.max(1, pageNumber), pdfDocument.numPages || 1))
      .then((loadedPage) => {
        if (cancelled) return;
        page = loadedPage;
        const container = containerRef.current;
        if (container && typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(schedulePaint);
          observer.observe(container);
        } else {
          window.addEventListener("resize", schedulePaint);
        }
        schedulePaint();
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", schedulePaint);
      observer?.disconnect();
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, preview, zoom]);

  return (
    <span
      ref={containerRef}
      className={cn(
        "relative flex min-h-0 min-w-0 items-center justify-center overflow-auto",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "block max-w-none rounded-sm bg-white shadow-[0_18px_55px_rgba(0,0,0,0.34)]",
          status === "ready" ? "opacity-100" : "opacity-0",
          canvasClassName
        )}
        aria-label={`PDF preview of ${artifact.displayName}`}
      />
      {status === "loading" ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
          Loading PDF...
        </span>
      ) : null}
      {status === "error" ? (
        <span className="absolute inset-0 flex items-center justify-center px-5 text-center">
          <span className="rounded-lg border border-sidebar-border/35 bg-[var(--sidebar-depth-raised)] px-4 py-3 text-xs font-medium text-muted-foreground shadow-[var(--sidebar-neu-raised)]">
            PDF preview could not load. Open or download the file.
          </span>
        </span>
      ) : null}
    </span>
  );
}

function PdfCanvasPreview({ artifact }: { artifact: ParsedArtifact }) {
  return (
    <span className="relative block aspect-square overflow-hidden bg-[radial-gradient(circle_at_top,color-mix(in_oklch,var(--sidebar-primary)_18%,transparent),transparent_42%),var(--sidebar-depth-input)] p-3">
      <PdfCanvasRenderer
        artifact={artifact}
        preview
        className="h-full w-full rounded-lg border border-sidebar-border/35 bg-black/20 p-2"
        canvasClassName="rounded-[0.2rem]"
      />
    </span>
  );
}

function PdfCanvasViewer({
  artifact,
  onReady,
}: {
  artifact: ParsedArtifact;
  onReady: () => void;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(1);

  function setFit() {
    setZoom(1);
  }

  return (
    <span className="relative flex h-full w-full flex-col bg-black px-3 pb-20 pt-16 sm:px-5 sm:pb-24 sm:pt-20">
      <PdfCanvasRenderer
        artifact={artifact}
        pageNumber={pageNumber}
        zoom={zoom}
        onReady={onReady}
        onDocumentLoad={(count) => {
          setPageCount(count);
          setPageNumber((current) => Math.min(Math.max(1, current), count || 1));
        }}
        className={cn(
          "h-full w-full rounded-xl bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_76%,black)] p-4",
          zoom > 1.05 ? "items-start justify-center" : "items-center justify-center"
        )}
        canvasClassName="rounded-[0.15rem]"
      />

      <span className="pointer-events-none absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.8rem)] z-10 flex justify-center">
        <span className="neu-raised pointer-events-auto inline-flex max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-full border border-sidebar-border/35 bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_86%,black)] p-1 shadow-[0_16px_45px_rgba(0,0,0,0.32)] backdrop-blur-md">
          {pageCount > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                className="inline-flex size-9 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/8"
                aria-label="Previous PDF page"
              >
                <ChevronLeftIcon className="size-4" aria-hidden />
              </button>
              <span className="min-w-14 text-center text-xs font-semibold text-muted-foreground">
                {pageNumber}/{pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                className="inline-flex size-9 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/8"
                aria-label="Next PDF page"
              >
                <ChevronRightIcon className="size-4" aria-hidden />
              </button>
              <span className="mx-1 h-5 w-px bg-sidebar-border/45" />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(0.45, Number((current - 0.15).toFixed(2))))}
            className="inline-flex size-9 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/8"
            aria-label="Zoom PDF out"
          >
            <MinusIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={setFit}
            className="inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-foreground/8"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(3.5, Number((current + 0.15).toFixed(2))))}
            className="inline-flex size-9 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/8"
            aria-label="Zoom PDF in"
          >
            <PlusIcon className="size-4" aria-hidden />
          </button>
        </span>
      </span>
    </span>
  );
}

function ArtifactPreview({ artifact }: { artifact: ParsedArtifact }) {
  const label = typeLabel(artifact.kind);

  if (artifact.kind === "image" || artifact.kind === "svg") {
    return (
      <span className="relative block aspect-square overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--sidebar-primary)_18%,transparent),transparent_42%),var(--sidebar-depth-input)] p-3">
        <img
          src={artifact.viewerHref}
          alt=""
          className="h-full w-full rounded-lg border border-sidebar-border/35 bg-black/20 object-contain shadow-[0_16px_45px_rgba(0,0,0,0.28)]"
          loading="lazy"
        />
      </span>
    );
  }

  if (artifact.kind === "video") {
    return (
      <span className="relative block aspect-square overflow-hidden bg-black p-3">
        <video
          src={artifact.viewerHref}
          className="h-full w-full rounded-lg border border-sidebar-border/35 object-contain shadow-[0_16px_45px_rgba(0,0,0,0.28)]"
          muted
          playsInline
          preload="metadata"
        />
      </span>
    );
  }

  if (artifact.kind === "html" || artifact.kind === "email") {
    return (
      <span className="relative block aspect-square overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--sidebar-primary)_18%,transparent),transparent_44%),var(--sidebar-depth-input)] p-3">
        <iframe
          src={artifact.previewHref}
          title={`Preview ${artifact.displayName}`}
          className="pointer-events-none block h-full w-full rounded-lg border border-sidebar-border/35 bg-white shadow-[0_16px_45px_rgba(0,0,0,0.28)]"
          loading="lazy"
          scrolling="no"
        />
        <span className="pointer-events-none absolute inset-x-3 bottom-3 rounded-b-lg bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-10 text-[11px] font-medium text-white/85">
          Open for the live preview
        </span>
      </span>
    );
  }

  if (artifact.kind === "pdf") {
    return <PdfCanvasPreview artifact={artifact} />;
  }

  return (
    <span className="relative flex aspect-square items-center justify-center bg-[var(--sidebar-depth-input)] px-4 text-center">
      <span className="flex max-w-xs flex-col items-center gap-2">
        <span className="flex size-12 items-center justify-center rounded-xl border border-sidebar-border/35 bg-[var(--sidebar-depth-raised)] shadow-[var(--sidebar-neu-raised)]">
          <ArtifactKindIcon kind={artifact.kind} className="size-5 text-sidebar-primary" />
        </span>
        <span className="text-sm font-semibold text-sidebar-foreground">
          {label} file
        </span>
        <span className="text-xs leading-snug text-muted-foreground">
          Open, download, or share this file from the action bar.
        </span>
      </span>
    </span>
  );
}

function ArtifactViewerModal({
  artifact,
  onClose,
}: {
  artifact: ParsedArtifact;
  onClose: () => void;
}) {
  const titleId = useId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [progress, setProgress] = useState(6);
  const [progressTarget, setProgressTarget] = useState(16);
  const [loadingLabel, setLoadingLabel] = useState("Opening file...");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 9000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded) {
      setProgressTarget(100);
      return;
    }
    const id = window.setInterval(() => {
      setProgress((current) => {
        if (current >= progressTarget) return current;
        const distance = progressTarget - current;
        const step = Math.max(0.35, distance * 0.12);
        return Math.min(progressTarget, current + step);
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [loaded, progressTarget]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (iframeWindow && event.source !== iframeWindow) return;
      const data = event.data as
        | { source?: unknown; stage?: unknown; buildId?: unknown }
        | null;
      if (!data || data.source !== "hermes-build-viewer") return;
      if (artifact.buildId && data.buildId && data.buildId !== artifact.buildId) return;
      switch (data.stage) {
        case "start":
          setProgressTarget((value) => Math.max(value, 22));
          setLoadingLabel("Starting preview...");
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
  }, [artifact.buildId]);

  function handleViewerLoaded() {
    setProgressTarget(100);
    setLoadingLabel("Ready");
    setProgress(100);
    window.setTimeout(() => setLoaded(true), 160);
  }

  async function handleShare() {
    setNotice(null);
    try {
      if (await shareArtifactFile(artifact)) {
        setNotice(artifact.kind === "pdf" ? "Choose Print in the sheet if you want a paper copy." : "Shared.");
        return;
      }
      const blob = await fetchArtifactBlob(artifact.downloadHref);
      triggerBlobDownload(blob, artifact.downloadName);
      setNotice("Sharing is not available here, so Hermes downloaded the file.");
    } catch (e) {
      if (isAbortError(e)) return;
      setNotice("Could not open sharing here. Try Download instead.");
    }
  }

  async function handlePrint() {
    setNotice(null);
    if (artifact.kind === "pdf" && isCoarseOrPhone()) {
      try {
        if (await shareArtifactFile(artifact)) {
          setNotice("Choose Print in the sheet.");
          return;
        }
      } catch (e) {
        if (isAbortError(e)) return;
      }
    }

    try {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) throw new Error("Print view not ready");
      frameWindow.focus();
      frameWindow.print();
      setNotice("Print sheet opened.");
    } catch {
      window.open(absoluteUrl(artifact.viewerHref), "_blank", "noopener,noreferrer");
      setNotice("Opened the file. Use the browser menu to print.");
    }
  }

  return createPortal(
    <span
      className="main-chat-depth fixed inset-0 z-[1000] flex min-h-0 flex-col overflow-hidden bg-black text-sidebar-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          onClick={onClose}
          className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_84%,black)] text-sidebar-foreground backdrop-blur-md"
          aria-label="Back to Hermes"
        >
          <XIcon className="size-5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 text-center">
          <span
            id={titleId}
            className="mx-auto block max-w-[56vw] truncate rounded-full border border-sidebar-border/35 bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_74%,black)] px-3 py-1.5 text-xs font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.24)] backdrop-blur-md"
          >
            {artifact.displayName}
          </span>
        </span>
        {canPrint(artifact.kind) ? (
          <button
            type="button"
            onClick={() => void handlePrint()}
            className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_84%,black)] text-sidebar-foreground backdrop-blur-md"
            aria-label={`Print ${artifact.displayName}`}
            data-hermes-tip={
              artifact.kind === "pdf"
                ? "Open the print/share sheet for this PDF."
                : "Open the print sheet for this file."
            }
          >
            <PrinterIcon className="size-4.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleShare()}
          className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_84%,black)] text-sidebar-foreground backdrop-blur-md"
          aria-label={`Share ${artifact.displayName}`}
          data-hermes-tip="Share this file or save it."
        >
          <Share2Icon className="size-4.5" aria-hidden />
        </button>
        <a
          href={artifact.downloadHref}
          download={artifact.downloadName}
          className="neu-raised pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_84%,black)] text-sidebar-foreground backdrop-blur-md"
          aria-label={`Download ${artifact.displayName}`}
          data-hermes-tip="Download this file."
        >
          <DownloadIcon className="size-4.5" aria-hidden />
        </a>
      </span>

      {!loaded ? (
        <span className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--sidebar-depth-canvas)] text-sm text-muted-foreground">
          <span
            className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="File loading progress"
          >
            <span
              className="block h-full rounded-full bg-sidebar-primary transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
            />
          </span>
          <span>{slow ? "Still opening this file..." : loadingLabel}</span>
        </span>
      ) : null}

      {notice ? (
        <span className="pointer-events-none absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-20 mx-auto max-w-md rounded-full border border-sidebar-border/35 bg-[color-mix(in_oklch,var(--sidebar-depth-canvas)_82%,black)] px-4 py-2 text-center text-xs font-medium shadow-[0_14px_40px_rgba(0,0,0,0.28)] backdrop-blur-md">
          {notice}
        </span>
      ) : null}

      <span
        className="absolute min-h-0 bg-black"
        style={{
          top: "env(safe-area-inset-top)",
          bottom: "env(safe-area-inset-bottom)",
          left: "env(safe-area-inset-left)",
          right: "env(safe-area-inset-right)",
        }}
      >
        {artifact.kind === "pdf" ? (
          <PdfCanvasViewer artifact={artifact} onReady={handleViewerLoaded} />
        ) : artifact.kind === "image" || artifact.kind === "svg" ? (
          <span className="flex h-full w-full items-center justify-center overflow-auto p-4 pt-20">
            <img
              src={artifact.viewerHref}
              alt=""
              className="max-h-full max-w-full object-contain"
              onLoad={handleViewerLoaded}
            />
          </span>
        ) : artifact.kind === "video" ? (
          <span className="flex h-full w-full items-center justify-center p-4 pt-20">
            <video
              src={artifact.viewerHref}
              className="max-h-full max-w-full"
              controls
              playsInline
              onLoadedData={handleViewerLoaded}
            />
          </span>
        ) : artifact.kind === "audio" ? (
          <span className="flex h-full w-full items-center justify-center p-6">
            <audio
              src={artifact.viewerHref}
              className="w-full max-w-lg"
              controls
              onCanPlay={handleViewerLoaded}
            />
          </span>
        ) : canInlinePreview(artifact.kind) ? (
          <iframe
            ref={iframeRef}
            src={artifact.viewerHref}
            title={artifact.displayName}
            onLoad={handleViewerLoaded}
            className="h-full w-full border-0 bg-white"
            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-6 text-center">
            <span className="max-w-sm rounded-xl border border-sidebar-border/35 bg-[var(--sidebar-depth-canvas)] p-5 shadow-[var(--sidebar-neu-raised)]">
              <FileIcon className="mx-auto size-8 text-sidebar-primary" aria-hidden />
              <span className="mt-3 block text-sm font-semibold">
                Preview unavailable
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                Download this file and open it with an app that supports {typeLabel(artifact.kind).toLowerCase()} files.
              </span>
            </span>
          </span>
        )}
      </span>
    </span>,
    document.body
  );
}

function ArtifactCard({
  artifact,
  className,
}: {
  artifact: ParsedArtifact;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [buildCardVisible, setBuildCardVisible] = useState(true);
  const [buildPackage, setBuildPackage] = useState<BuildPackage | null>(null);
  const [selectedBuildPath, setSelectedBuildPath] = useState<string | null>(
    artifact.buildFilePath ?? null
  );

  useEffect(() => {
    if (!artifact.buildId) return;
    const key = artifact.buildId;
    if (mountedBuildCards.has(key)) {
      setBuildCardVisible(false);
      return;
    }
    mountedBuildCards.add(key);
    setBuildCardVisible(true);
    return () => {
      mountedBuildCards.delete(key);
    };
  }, [artifact.buildId]);

  useEffect(() => {
    if (!artifact.buildId) {
      setBuildPackage(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/builds/${encodeURIComponent(artifact.buildId)}/files`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BuildPackage | null) => {
        if (cancelled) return;
        if (!data?.files?.length) {
          setBuildPackage(null);
          return;
        }
        setBuildPackage(data);
        setSelectedBuildPath(data.primaryPath ?? artifact.buildFilePath ?? data.files[0]?.path ?? null);
      })
      .catch(() => {
        if (!cancelled) setBuildPackage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.buildFilePath, artifact.buildId]);

  const selectedBuildFile = buildPackage?.files.find(
    (file) => file.path === selectedBuildPath
  );
  const activeArtifact =
    artifact.buildId && selectedBuildFile
      ? artifactFromBuildPackageFile(artifact.buildId, selectedBuildFile)
      : artifact;
  const label = typeLabel(activeArtifact.kind);
  const packageFiles = buildPackage?.files ?? [];
  const packageTitle = buildPackage?.name ?? activeArtifact.displayName;
  const packageDescription = buildPackage?.description;

  function stop(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  async function shareOrDownload(event: MouseEvent<HTMLElement>) {
    stop(event);
    setStatus(null);
    try {
      if (await shareArtifactFile(activeArtifact)) {
        setStatus(activeArtifact.kind === "pdf" ? "Choose Print in the sheet if needed." : "Shared.");
        return;
      }
      const blob = await fetchArtifactBlob(activeArtifact.downloadHref);
      triggerBlobDownload(blob, activeArtifact.downloadName);
    } catch (e) {
      if (isAbortError(e)) return;
      triggerUrlDownload(activeArtifact.downloadHref, activeArtifact.downloadName);
    }
  }

  async function sendEmail(event: MouseEvent<HTMLElement>) {
    stop(event);
    setStatus("Opening your email app...");
    try {
      if (await composeEmailFromArtifact(activeArtifact)) return;
      setStatus("Could not prepare the email. Open the preview and copy the text.");
    } catch {
      setStatus("Could not prepare the email. Open the preview and copy the text.");
    }
  }

  async function copyImage(event: MouseEvent<HTMLElement>) {
    stop(event);
    setStatus(null);
    try {
      if (await copyImageToClipboard(activeArtifact)) {
        setStatus("Image copied.");
        return;
      }
      if (await shareArtifactFile(activeArtifact)) {
        setStatus("Shared.");
        return;
      }
      const blob = await fetchArtifactBlob(activeArtifact.downloadHref);
      triggerBlobDownload(blob, activeArtifact.downloadName);
      setStatus("Downloaded.");
    } catch (e) {
      if (isAbortError(e)) return;
      triggerUrlDownload(activeArtifact.downloadHref, activeArtifact.downloadName);
      setStatus("Downloaded.");
    }
  }

  async function print(event: MouseEvent<HTMLElement>) {
    stop(event);
    setStatus(null);
    if (activeArtifact.kind === "pdf" && isCoarseOrPhone()) {
      try {
        if (await shareArtifactFile(activeArtifact)) {
          setStatus("Choose Print in the sheet.");
          return;
        }
      } catch (e) {
        if (isAbortError(e)) return;
      }
    }
    setOpen(true);
    setStatus("Use the print button in the viewer.");
  }

  const previewable = canInlinePreview(activeArtifact.kind);
  const printReady = canPrint(activeArtifact.kind);
  const imageLike = activeArtifact.kind === "image" || activeArtifact.kind === "svg";
  const liveViewerHref = buildViewerHref(activeArtifact);

  function openActiveArtifact() {
    if (!previewable) return;
    if (liveViewerHref) {
      window.location.href = liveViewerHref;
      return;
    }
    setOpen(true);
  }

  if (!buildCardVisible) return null;

  return (
    <>
      <span className={cn("not-prose my-3 block w-full max-w-lg", className)}>
        <span
          role={previewable ? "button" : undefined}
          tabIndex={previewable ? 0 : undefined}
          onClick={openActiveArtifact}
          onKeyDown={(event) => {
            if (!previewable) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openActiveArtifact();
          }}
          className={cn(
            "group block overflow-hidden rounded-lg border border-sidebar-border/45 bg-[var(--sidebar-depth-canvas)] text-left text-sidebar-foreground shadow-[var(--sidebar-neu-raised)] outline-none transition-all duration-200",
            previewable
              ? "hover:border-sidebar-primary/45 hover:shadow-[var(--sidebar-neu-raised-hover)] focus-visible:ring-2 focus-visible:ring-sidebar-primary/45"
              : ""
          )}
          aria-label={
            previewable
              ? liveViewerHref
                ? `Open ${packageTitle} in Hermes`
                : `Open ${activeArtifact.displayName}`
              : undefined
          }
        >
          <span className="flex min-w-0 items-start justify-between gap-3 border-b border-sidebar-border/35 bg-[var(--sidebar-depth-raised)] px-3 py-2.5">
            <span className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border/35 bg-[var(--sidebar-depth-input)]">
                <ArtifactKindIcon
                  kind={activeArtifact.kind}
                  className="size-4 text-sidebar-primary"
                />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-primary">
                    {label}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold" data-hermes-tip={packageTitle}>
                    {packageTitle}
                  </span>
                </span>
                {packageDescription ? (
                  <span className="mt-0.5 block line-clamp-1 text-xs leading-snug text-muted-foreground">
                    {packageDescription}
                  </span>
                ) : activeArtifact.displayName !== packageTitle ? (
                  <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
                    Showing {activeArtifact.displayName}
                  </span>
                ) : null}
              </span>
            </span>
            {packageFiles.length > 1 ? (
              <button
                type="button"
                onClick={(event) => {
                  stop(event);
                  setFilesOpen((current) => !current);
                }}
                className="neu-raised inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-sidebar-foreground"
                data-hermes-tip="Show the files that came with this creation."
              >
                <PaperclipIcon className="size-3.5 text-sidebar-primary" aria-hidden />
                <span>{packageFiles.length}</span>
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", filesOpen ? "rotate-180" : "")}
                  aria-hidden
                />
              </button>
            ) : activeArtifact.kind === "email" ? (
              <span className="hidden shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
                <MailIcon className="size-3.5" aria-hidden />
                Preview
              </span>
            ) : null}
          </span>

          {filesOpen && packageFiles.length > 1 ? (
            <span className="grid gap-1 border-b border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] p-2">
              {packageFiles.map((file) => {
                const kind = artifactKind(file.name);
                const selected = file.path === activeArtifact.buildFilePath;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={(event) => {
                      stop(event);
                      setSelectedBuildPath(file.path);
                      setFilesOpen(false);
                      setStatus(null);
                    }}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs transition-colors",
                      selected
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "hover:border-sidebar-border/45 hover:bg-[var(--sidebar-depth-input)]"
                    )}
                  >
                    <ArtifactKindIcon
                      kind={kind}
                      className={cn(
                        "size-3.5 shrink-0",
                        selected ? "text-sidebar-primary-foreground" : "text-sidebar-primary"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-[10px] opacity-75">
                      {formatFileSize(file.size)}
                    </span>
                  </button>
                );
              })}
            </span>
          ) : null}

          <ArtifactPreview artifact={activeArtifact} />

          <span
            data-hermes-artifact-actions
            className="grid min-w-0 grid-cols-4 gap-2 border-t border-sidebar-border/35 bg-[var(--sidebar-depth-raised)] p-2"
          >
            {previewable ? (
              <ArtifactAction
                href={liveViewerHref ?? undefined}
                onClick={
                  liveViewerHref
                    ? stop
                    : (event) => {
                        stop(event);
                        setOpen(true);
                      }
                }
                className="col-span-2"
                title={
                  liveViewerHref
                    ? "Open this creation in the Hermes app viewer."
                    : "Open this in the Hermes viewer."
                }
              >
                <Maximize2Icon className="size-3.5" aria-hidden />
                <span>{liveViewerHref ? "Open app" : "Open"}</span>
              </ArtifactAction>
            ) : (
              <ArtifactAction
                href={activeArtifact.downloadHref}
                download={activeArtifact.downloadName}
                onClick={stop}
                className="col-span-2"
                title="Download this file."
              >
                <DownloadIcon className="size-3.5" aria-hidden />
                <span>Download</span>
              </ArtifactAction>
            )}
            {!previewable ? (
              <ArtifactAction
                onClick={(event) => void shareOrDownload(event)}
                className="col-span-2"
                title="Share or download this file."
              >
                <Share2Icon className="size-3.5" aria-hidden />
                <span>Share</span>
              </ArtifactAction>
            ) : activeArtifact.kind === "email" ? (
              <ArtifactAction onClick={(event) => void sendEmail(event)} title="Open your email app with a plain-text version ready to send.">
                <MailIcon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Send</span>
              </ArtifactAction>
            ) : imageLike ? (
              <ArtifactAction onClick={(event) => void copyImage(event)} title="Copy the image, or save/share if copying is not available here.">
                <CopyIcon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Copy</span>
              </ArtifactAction>
            ) : printReady ? (
              <ArtifactAction onClick={(event) => void print(event)} title="Print or open the print sheet.">
                <PrinterIcon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Print</span>
              </ArtifactAction>
            ) : (
              <ArtifactAction
                href={activeArtifact.downloadHref}
                download={activeArtifact.downloadName}
                onClick={stop}
                title="Download this file."
              >
                <DownloadIcon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Save</span>
              </ArtifactAction>
            )}
            {!previewable ? null : activeArtifact.kind === "email" ? (
              <ArtifactAction
                href={activeArtifact.downloadHref}
                download={activeArtifact.downloadName}
                onClick={stop}
                title="Download the email HTML."
              >
                <DownloadIcon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Save</span>
              </ArtifactAction>
            ) : (
              <ArtifactAction onClick={(event) => void shareOrDownload(event)} title="Share or download this file.">
                <Share2Icon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">Share</span>
              </ArtifactAction>
            )}
          </span>
          {status ? (
            <span className="block border-t border-sidebar-border/25 px-3 py-2 text-center text-[11px] font-medium text-muted-foreground">
              {status}
            </span>
          ) : null}
        </span>
      </span>
      {open ? (
        <ArtifactViewerModal artifact={activeArtifact} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * Renders same-origin Hermes file links as artifact cards.
 * Other links pass through as normal links.
 */
export function MarkdownVaultFileLink({
  href,
  className,
  children,
  node,
  ...rest
}: MarkdownVaultFileLinkProps) {
  void node;
  const artifact = useMemo(
    () => (typeof href === "string" ? parseArtifactHref(href) : null),
    [href]
  );

  if (artifact) {
    return <ArtifactCard artifact={artifact} className={className} />;
  }

  const isExternal = typeof href === "string" && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      className={className}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      {...rest}
    >
      {children}
      {isExternal ? (
        <ExternalLinkIcon className="ml-1 inline size-3 align-[-0.12em]" aria-hidden />
      ) : null}
    </a>
  );
}
