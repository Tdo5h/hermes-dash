"use client"

import { Copy, Download, Maximize2, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
} from "react"
import { createPortal } from "react-dom"
import { defaultTranslations } from "streamdown"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & {
  node?: unknown
}

type SheetBlobState = "idle" | "loading" | "ready" | "error"

const EXT_STRIP = /\.[^/.]+$/

function subscribeMedia(query: string, cb: () => void) {
  if (typeof window === "undefined") return () => {}
  const m = window.matchMedia(query)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}

function useMediaQuery(query: string, ssrFallback: boolean) {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(query, onChange),
    () =>
      typeof window !== "undefined"
        ? window.matchMedia(query).matches
        : ssrFallback,
    () => ssrFallback
  )
}

async function fetchImageBlob(src: string): Promise<Blob> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

/** Bust cache / retry 404: path id is the same; query ignored by route but refetches. */
function imageLoadUrl(base: string, attempt: number): string {
  if (attempt <= 0) return base
  const u = new URL(base, typeof window !== "undefined" ? window.location.origin : "https://local.invalid")
  u.searchParams.set("_hc", String(attempt))
  return u.pathname + u.search
}

function filenameForBlob(
  src: string,
  blob: Blob,
  alt: string | undefined
): string {
  const path =
    new URL(src, window.location.origin).pathname.split("/").pop() || ""
  const extPart = path.split(".").pop()
  const hasShortExt =
    path.includes(".") && extPart !== undefined && extPart.length <= 4
  if (hasShortExt) return path
  const t = blob.type
  let ext = "png"
  if (t.includes("jpeg") || t.includes("jpg")) ext = "jpg"
  else if (t.includes("png")) ext = "png"
  else if (t.includes("svg")) ext = "svg"
  else if (t.includes("gif")) ext = "gif"
  else if (t.includes("webp")) ext = "webp"
  const base = (alt || "image").replace(EXT_STRIP, "")
  return `${base}.${ext}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * ClipboardItem for many browsers only supports image/png reliably (image/jpeg often throws
 * "Type image/jpeg not supported"). Normalize non-PNG rasters to PNG via canvas.
 */
async function blobToClipboardPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob
  if (!blob.type.startsWith("image/")) {
    throw new Error("Clipboard copy supports images only")
  }
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas not available")
    ctx.drawImage(bmp, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
        "image/png"
      )
    })
  } finally {
    bmp.close?.()
  }
}

async function copyBlobToClipboard(blob: Blob) {
  if (!navigator.clipboard?.write) {
    throw new Error("Clipboard API not available")
  }
  const pngBlob = await blobToClipboardPngBlob(blob)
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": pngBlob,
    }),
  ])
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError"
}

function touchDistance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

const FULLSCREEN_SCALE_MIN = 1
const FULLSCREEN_SCALE_MAX = 5

function FullscreenImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)

  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  transformRef.current = { scale, tx, ty }

  const pinchStart = useRef<{ dist: number; scale: number } | null>(null)
  const panStart =
    useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      const cur = transformRef.current
      if (e.touches.length === 2) {
        pinchStart.current = {
          dist: touchDistance(e.touches[0], e.touches[1]),
          scale: cur.scale,
        }
        panStart.current = null
        return
      }
      if (e.touches.length === 1 && cur.scale > 1) {
        const t = e.touches[0]
        panStart.current = {
          x: t.clientX,
          y: t.clientY,
          tx: cur.tx,
          ty: cur.ty,
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStart.current) {
        e.preventDefault()
        const d = touchDistance(e.touches[0], e.touches[1])
        const { dist: d0, scale: s0 } = pinchStart.current
        const next = Math.min(
          FULLSCREEN_SCALE_MAX,
          Math.max(FULLSCREEN_SCALE_MIN, (s0 * d) / d0)
        )
        setScale(next)
        if (next <= 1.02) {
          setTx(0)
          setTy(0)
        }
        return
      }
      if (e.touches.length === 1 && panStart.current && transformRef.current.scale > 1) {
        e.preventDefault()
        const t = e.touches[0]
        const p = panStart.current
        setTx(p.tx + (t.clientX - p.x))
        setTy(p.ty + (t.clientY - p.y))
      }
    }

    const onTouchEndOrCancel = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStart.current = null
      }
      if (e.touches.length === 0) {
        panStart.current = null
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEndOrCancel)
    el.addEventListener("touchcancel", onTouchEndOrCancel)

    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEndOrCancel)
      el.removeEventListener("touchcancel", onTouchEndOrCancel)
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Full screen image"
    >
      <button
        type="button"
        aria-label={defaultTranslations.close}
        className="absolute left-3 top-[max(env(safe-area-inset-top),12px)] z-10 flex h-10 w-10 items-center justify-center rounded-md bg-black/50 text-white"
        onClick={onClose}
      >
        <X className="size-6" />
      </button>
      <div
        ref={viewportRef}
        className="flex flex-1 touch-none items-center justify-center overflow-hidden p-2 pt-14"
      >
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  preferShare: boolean
): Promise<void> {
  if (
    preferShare &&
    typeof File !== "undefined" &&
    navigator.share &&
    navigator.canShare
  ) {
    const file = new File([blob], filename, {
      type: blob.type && blob.type.startsWith("image/") ? blob.type : "image/png",
    })
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] })
        return
      }
    } catch (e) {
      if (isAbortError(e)) return
      triggerDownload(blob, filename)
      return
    }
  }
  triggerDownload(blob, filename)
}

export function MarkdownImageWithActions({
  className,
  src: srcProp,
  alt,
  onLoad,
  onError,
  node: _node,
  width,
  height,
  ...rest
}: MarkdownImageProps) {
  const imageUrl =
    typeof srcProp === "string" && srcProp.length > 0 ? srcProp : null

  const [loadAttempt, setLoadAttempt] = useState(0)
  const displaySrc = useMemo(
    () => (imageUrl ? imageLoadUrl(imageUrl, loadAttempt) : null),
    [imageUrl, loadAttempt]
  )

  const imgRef = useRef<HTMLImageElement>(null)
  const blobCacheRef = useRef<{ url: string; blob: Blob } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sheetBlobState, setSheetBlobState] = useState<SheetBlobState>("idle")

  const isDesktopChrome = useMediaQuery("(hover: hover) and (pointer: fine)", false)
  const isCoarse = useMediaQuery("(pointer: coarse)", false)
  const useTapSheet = !isDesktopChrome || isCoarse

  const hasExplicitDims = width != null || height != null
  const showFallback = hasError && !hasExplicitDims
  const showActions = (loaded || hasExplicitDims) && !hasError

  const [desktopCopyError, setDesktopCopyError] = useState<string | null>(null)
  const desktopErrTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (desktopErrTimer.current) clearTimeout(desktopErrTimer.current)
    },
    []
  )

  useEffect(() => {
    setLoadAttempt(0)
  }, [imageUrl])

  useEffect(() => {
    setFullscreenOpen(false)
  }, [displaySrc])

  useEffect(() => {
    setLoaded(false)
    setHasError(false)
    blobCacheRef.current = null
    const el = imgRef.current
    if (el?.complete && el.naturalWidth > 0) {
      setLoaded(true)
      setHasError(false)
    }
  }, [imageUrl, loadAttempt])

  useEffect(() => {
    if (!sheetOpen || !displaySrc) {
      setSheetBlobState("idle")
      return
    }
    if (blobCacheRef.current?.url === displaySrc) {
      setSheetBlobState("ready")
      return
    }
    let cancelled = false
    setSheetBlobState("loading")
    setActionError(null)
    fetchImageBlob(displaySrc)
      .then((blob) => {
        if (cancelled) return
        blobCacheRef.current = { url: displaySrc, blob }
        setSheetBlobState("ready")
      })
      .catch(() => {
        if (cancelled) return
        setSheetBlobState("error")
        setActionError("Could not load image for this action")
      })
    return () => {
      cancelled = true
    }
  }, [sheetOpen, displaySrc])

  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [sheetOpen])

  const getCachedBlob = useCallback((): Blob | null => {
    if (!displaySrc) return null
    const e = blobCacheRef.current
    return e?.url === displaySrc ? e.blob : null
  }, [displaySrc])

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setLoaded(true)
      setHasError(false)
      onLoad?.(e)
      if (!displaySrc) return
      if (!useTapSheet) return
      if (blobCacheRef.current?.url === displaySrc) return
      void fetchImageBlob(displaySrc)
        .then((blob) => {
          if (blobCacheRef.current?.url === displaySrc) return
          blobCacheRef.current = { url: displaySrc, blob }
          if (sheetOpen) setSheetBlobState("ready")
        })
        .catch(() => {})
    },
    [onLoad, useTapSheet, displaySrc, sheetOpen]
  )

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (
        imageUrl?.startsWith("/api/images/") &&
        loadAttempt < 3
      ) {
        const next = loadAttempt + 1
        window.setTimeout(
          () => {
            setLoadAttempt(next)
          },
          180 * next
        )
        return
      }
      setLoaded(false)
      setHasError(true)
      onError?.(e)
    },
    [imageUrl, loadAttempt, onError]
  )

  const runDownload = useCallback(async () => {
    if (!imageUrl || !displaySrc) return
    setActionError(null)
    const cached = getCachedBlob()
    try {
      if (cached) {
        triggerDownload(cached, filenameForBlob(imageUrl, cached, alt))
        return
      }
      const blob = await fetchImageBlob(displaySrc)
      blobCacheRef.current = { url: displaySrc, blob }
      triggerDownload(blob, filenameForBlob(imageUrl, blob, alt))
    } catch {
      window.open(displaySrc, "_blank", "noopener,noreferrer")
    }
  }, [imageUrl, displaySrc, alt, getCachedBlob])

  const runCopy = useCallback(
    async (opts?: { fromSheet: boolean }) => {
      if (!imageUrl || !displaySrc) return
      setActionError(null)
      setDesktopCopyError(null)
      if (desktopErrTimer.current) {
        clearTimeout(desktopErrTimer.current)
        desktopErrTimer.current = null
      }
      try {
        let blob = getCachedBlob()
        if (!blob) {
          blob = await fetchImageBlob(displaySrc)
          blobCacheRef.current = { url: displaySrc, blob }
        }
        await copyBlobToClipboard(blob)
        if (opts?.fromSheet) setSheetOpen(false)
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not copy image"
        if (opts?.fromSheet) {
          setActionError(msg)
        } else {
          setDesktopCopyError(msg)
          desktopErrTimer.current = setTimeout(() => {
            setDesktopCopyError(null)
          }, 4000)
        }
      }
    },
    [imageUrl, displaySrc, getCachedBlob]
  )

  const runSheetCopy = useCallback(() => {
    if (!imageUrl || !displaySrc || sheetBlobState !== "ready") return
    const blob = getCachedBlob()
    if (!blob) return
    setActionError(null)
    void copyBlobToClipboard(blob)
      .then(() => setSheetOpen(false))
      .catch((e) => {
        setActionError(e instanceof Error ? e.message : "Could not copy image")
      })
  }, [imageUrl, displaySrc, sheetBlobState, getCachedBlob])

  const runSheetSave = useCallback(async () => {
    if (!imageUrl || !displaySrc || sheetBlobState !== "ready") return
    const blob = getCachedBlob()
    if (!blob) return
    setActionError(null)
    const fn = filenameForBlob(imageUrl, blob, alt)
    try {
      await shareOrDownloadBlob(blob, fn, useTapSheet)
      setSheetOpen(false)
    } catch (e) {
      if (isAbortError(e)) return
      setActionError(
        e instanceof Error ? e.message : "Could not save image"
      )
    }
  }, [imageUrl, displaySrc, sheetBlobState, getCachedBlob, alt, useTapSheet])

  const openSheet = useCallback(() => {
    if (!showActions || !useTapSheet) return
    setActionError(null)
    setSheetOpen(true)
  }, [showActions, useTapSheet])

  const openFullscreen = useCallback(() => {
    if (!showActions || !displaySrc) return
    setFullscreenOpen(true)
  }, [showActions, displaySrc])

  if (!imageUrl || !displaySrc) return null

  const t = defaultTranslations

  const actionBtnClass =
    "absolute bottom-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border bg-background/90 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-background opacity-0 group-hover:opacity-100"

  const fullscreenBtnClass = cn(
    "pointer-events-auto absolute top-2 right-2 z-10 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background/90 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-background",
    useTapSheet ? "opacity-100" : "opacity-0 group-hover:opacity-100"
  )

  const sheetActionsDisabled = sheetBlobState !== "ready"

  const sheet = sheetOpen ? (
    <>
      <button
        type="button"
        aria-label={t.close}
        className="fixed inset-0 z-30 bg-black/50"
        onClick={() => setSheetOpen(false)}
      />
      <div
        className="fixed left-1/2 top-1/2 z-40 w-[min(100%-2rem,20rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-image-sheet-title"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <span
            id="markdown-image-sheet-title"
            className="text-sm font-medium text-foreground"
          >
            Image
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t.close}
            onClick={() => setSheetOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        {sheetBlobState === "loading" ? (
          <p className="mb-3 text-center text-sm text-muted-foreground">
            Loading image…
          </p>
        ) : null}
        <div className="flex flex-row flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Button
            type="button"
            variant="outline"
            disabled={sheetActionsDisabled}
            className="inline-flex h-auto w-auto shrink-0 gap-2 px-4 py-2.5 text-base font-medium"
            onClick={() => void runSheetSave()}
          >
            <Download className="size-5 shrink-0" />
            Save image
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={sheetActionsDisabled}
            className="inline-flex h-auto w-auto shrink-0 gap-2 px-4 py-2.5 text-base font-medium"
            onClick={runSheetCopy}
          >
            <Copy className="size-5 shrink-0" />
            Copy image
          </Button>
        </div>
        {actionError ? (
          <p className="mt-3 text-center text-xs text-destructive">
            {actionError}
          </p>
        ) : null}
      </div>
    </>
  ) : null

  const portalRoot =
    typeof document !== "undefined"
      ? createPortal(
          <>
            {sheet}
            {fullscreenOpen && displaySrc ? (
              <FullscreenImageViewer
                src={displaySrc}
                alt={alt ?? ""}
                onClose={() => setFullscreenOpen(false)}
              />
            ) : null}
          </>,
          document.body
        )
      : null

  return (
    <>
      <span
        className={cn("group relative my-4 inline-block max-w-full")}
        data-streamdown="image-wrapper"
      >
        <img
          ref={imgRef}
          alt={alt ?? ""}
          className={cn(
            "max-w-full rounded-lg",
            showFallback && "hidden",
            className
          )}
          data-streamdown="image"
          src={displaySrc}
          width={width}
          height={height}
          onError={handleError}
          onLoad={handleLoad}
          onClick={openSheet}
          onKeyDown={(e) => {
            if (useTapSheet && showActions && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault()
              openSheet()
            }
          }}
          role={useTapSheet && showActions ? "button" : undefined}
          tabIndex={useTapSheet && showActions ? 0 : undefined}
          {...rest}
        />
        {showFallback ? (
          <span
            className="text-muted-foreground text-xs italic"
            data-streamdown="image-fallback"
          >
            {t.imageNotAvailable}
          </span>
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute inset-0 hidden rounded-lg bg-black/10 group-hover:block"
          )}
        />
        {showActions ? (
          <button
	            type="button"
	            className={fullscreenBtnClass}
	            aria-label="View full screen"
	            data-hermes-tip="View this image full screen."
            onClick={(e) => {
              e.stopPropagation()
              openFullscreen()
            }}
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
        {showActions && !useTapSheet ? (
          <>
            <button
	              type="button"
	              className={cn(actionBtnClass, "right-11")}
	              data-hermes-tip={t.downloadImage}
	              aria-label={t.downloadImage}
              onClick={(e) => {
                e.stopPropagation()
                void runDownload()
              }}
            >
              <Download size={14} />
            </button>
            <button
	              type="button"
	              className={cn(actionBtnClass, "right-2")}
	              data-hermes-tip="Copy this image."
	              aria-label="Copy image"
              onClick={(e) => {
                e.stopPropagation()
                void runCopy({ fromSheet: false })
              }}
            >
              <Copy size={14} />
            </button>
          </>
        ) : null}
        {desktopCopyError ? (
          <span
            className="mt-1 block text-center text-xs text-destructive"
            role="status"
          >
            {desktopCopyError}
          </span>
        ) : null}
      </span>
      {portalRoot}
    </>
  )
}
