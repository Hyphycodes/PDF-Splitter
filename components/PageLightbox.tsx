"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "@/lib/pdf";
import { CloseIcon, ChevronIcon } from "./Icons";
import RotatablePage from "./RotatablePage";

interface Props {
  doc: PDFDocumentProxy | null;
  index: number | null; // 0-based
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** clockwise rotation (0/90/180/270) applied to the rendered preview */
  rotation?: number;
  /** when set, R / Shift+R rotate the open page right / left */
  onRotate?: (delta: 90 | -90) => void;
  /** clean action panel rendered under the page (assignment controls) */
  actions?: React.ReactNode;
}

export default function PageLightbox({
  doc,
  index,
  title,
  subtitle,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  rotation = 0,
  onRotate,
  actions,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!doc || index === null) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    setSrc(null);
    renderPage(doc, index + 1, 1700)
      .then((s) => !cancelled && setSrc(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  useEffect(() => {
    if (index === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev?.();
      else if (e.key === "ArrowRight" && hasNext) onNext?.();
      else if ((e.key === "r" || e.key === "R") && onRotate && !(e.target instanceof HTMLInputElement)) {
        onRotate(e.shiftKey ? -90 : 90);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onPrev, onNext, onRotate, hasPrev, hasNext]);

  if (index === null) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col animate-fade-in bg-slate-950/85 backdrop-blur-md" onClick={onClose}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title ?? `Page ${index + 1}`}</div>
          {subtitle && <div className="truncate text-xs text-white/60">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10">
          <CloseIcon width={20} height={20} />
        </button>
      </div>

      {/* page + nav */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {hasPrev && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrev?.();
            }}
            className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25"
            title="Previous page (←)"
          >
            <ChevronIcon width={22} height={22} className="rotate-180" />
          </button>
        )}
        <div className="h-full w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
          {src ? (
            <RotatablePage
              key={index}
              src={src}
              alt={`page ${index + 1}`}
              rotation={rotation}
              padding={12}
              className="h-full w-full"
              imgClassName="rounded-lg shadow-float"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          )}
        </div>
        {hasNext && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25"
            title="Next page (→)"
          >
            <ChevronIcon width={22} height={22} />
          </button>
        )}
      </div>

      {/* actions panel */}
      {actions && (
        <div className="px-4 pb-4 pt-2" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto max-w-2xl rounded-2xl bg-white p-4 shadow-float">{actions}</div>
        </div>
      )}
    </div>
  );
}
