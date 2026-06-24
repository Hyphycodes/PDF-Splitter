"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "@/lib/pdf";
import { CloseIcon } from "./Icons";

interface Props {
  doc: PDFDocumentProxy | null;
  index: number | null; // 0-based
  title?: string;
  onClose: () => void;
  /** optional action bar rendered under the page (e.g. assign controls) */
  actions?: React.ReactNode;
}

export default function PageLightbox({ doc, index, title, onClose, actions }: Props) {
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (index !== null) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose]);

  if (index === null) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900/70 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="text-sm font-medium">{title ?? `Page ${index + 1}`}</div>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
          <CloseIcon width={20} height={20} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`page ${index + 1}`} className="max-h-full w-auto rounded-lg bg-white shadow-float" />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-white/10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </div>
      {actions && (
        <div className="border-t border-white/10 bg-slate-900/80 px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
