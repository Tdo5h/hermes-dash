"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageIcon } from "lucide-react";

type AddingImageOverlayProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
};

export function AddingImageOverlay({
  open,
  title = "Adding image",
  subtitle = "Please hold on.",
}: AddingImageOverlayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="adding-image-overlay"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="adding-image-panel">
        <div className="adding-image-icon">
          <ImageIcon className="size-5" aria-hidden />
        </div>
        <div className="adding-image-copy">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="adding-image-track" aria-hidden>
          <span />
        </div>
      </div>

      <style>{`
        .adding-image-overlay {
          position: fixed;
          inset: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          background:
            radial-gradient(circle at 50% 42%, color-mix(in oklch, var(--sidebar-primary) 18%, transparent), transparent 26%),
            hsl(0 0% 0% / 0.18);
          backdrop-filter: blur(2px);
        }

        .adding-image-panel {
          display: grid;
          width: min(18rem, calc(100vw - 2rem));
          grid-template-columns: 2.6rem minmax(0, 1fr);
          gap: 0.75rem;
          align-items: center;
          border: 1px solid color-mix(in oklch, var(--sidebar-primary) 38%, var(--sidebar-border));
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 38% 0%, hsl(0 0% 100% / 0.04), transparent 42%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-input) 82%, black));
          box-shadow:
            0 1.2rem 3rem hsl(0 0% 0% / 0.46),
            var(--sidebar-neu-raised);
          color: var(--foreground);
          padding: 0.85rem;
          animation: adding-image-in 150ms ease-out;
        }

        .adding-image-icon {
          display: inline-flex;
          width: 2.6rem;
          height: 2.6rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 82%, black);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
        }

        .adding-image-copy {
          min-width: 0;
          display: grid;
          gap: 0.12rem;
        }

        .adding-image-copy strong {
          color: var(--foreground);
          font-size: 0.9rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .adding-image-copy span {
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.25;
        }

        .adding-image-track {
          grid-column: 1 / -1;
          height: 0.42rem;
          overflow: hidden;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 58%, black);
          box-shadow: var(--sidebar-neu-inset);
        }

        .adding-image-track span {
          display: block;
          width: 48%;
          height: 100%;
          border-radius: inherit;
          background:
            linear-gradient(90deg, transparent, var(--sidebar-primary), color-mix(in oklch, var(--sidebar-primary) 65%, white), transparent);
          animation: adding-image-bar 1.05s ease-in-out infinite;
        }

        @keyframes adding-image-bar {
          0% {
            transform: translateX(-110%);
          }
          100% {
            transform: translateX(235%);
          }
        }

        @keyframes adding-image-in {
          from {
            opacity: 0;
            transform: translateY(0.3rem) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
