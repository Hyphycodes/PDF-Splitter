// Client-side PDF reading via pdf.js. Text-layer pages never leave the machine.
import * as pdfjsLib from "pdfjs-dist";

// Configure the worker once, lazily, in the browser. The worker is served as a
// static asset from /public (copied from pdfjs-dist) so webpack never tries to
// bundle it — keeping the version locked to the installed pdfjs-dist.
let workerReady = false;
function ensureWorker() {
  if (workerReady || typeof window === "undefined") return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  workerReady = true;
}

export interface LoadedPdf {
  numPages: number;
  doc: pdfjsLib.PDFDocumentProxy;
}

export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  ensureWorker();
  // Clone the buffer — pdf.js transfers/detaches it, and we reuse the original for pdf-lib.
  const doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
  return { numPages: doc.numPages, doc };
}

export interface PageText {
  index: number; // 0-based
  text: string;
  hasTextLayer: boolean;
}

/** Extract the text layer of a single page. Empty text => likely image-only/scanned. */
export async function extractPageText(doc: pdfjsLib.PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((it) => ("str" in it ? it.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { index: pageNumber - 1, text, hasTextLayer: text.length > 8 };
}

/** Render a page to a PNG dataURL at the given target width (for thumbnails or vision OCR). */
export async function renderPage(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}
