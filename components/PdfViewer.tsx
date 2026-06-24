"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface Props {
  doc: PDFDocumentProxy | null;
  /** ordered list of 0-based page indexes to display (cover first) */
  indexes: number[];
  coverIndex: number | null;
}

export default function PdfViewer({ doc, indexes, coverIndex }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!doc || !containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;

    (async () => {
      setRendering(true);
      container.innerHTML = "";
      for (const idx of indexes) {
        if (cancelled) return;
        const wrap = document.createElement("div");
        wrap.className =
          "relative mx-auto w-full max-w-[760px] rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden";

        const tag = document.createElement("div");
        tag.className =
          "absolute left-3 top-3 z-10 rounded-md bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur";
        tag.textContent = idx === coverIndex ? `Cover · p${idx + 1}` : `Cert · p${idx + 1}`;
        wrap.appendChild(tag);

        const canvas = document.createElement("canvas");
        canvas.className = "block w-full h-auto";
        wrap.appendChild(canvas);
        container.appendChild(wrap);

        try {
          const page = await doc.getPage(idx + 1);
          const targetWidth = 720;
          const baseVp = page.getViewport({ scale: 1 });
          const scale = (targetWidth / baseVp.width) * (window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = "100%";
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        } catch {
          /* ignore single-page render errors */
        }
      }
      if (!cancelled) setRendering(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, indexes, coverIndex]);

  return (
    <div className="relative">
      {rendering && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-ink-faint shadow-sm">
          Rendering…
        </div>
      )}
      <div ref={containerRef} className="flex flex-col gap-4" />
    </div>
  );
}
