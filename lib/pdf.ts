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
  /** clockwise rotation (0/90/180/270) that would need to be added to the page's
   *  current /Rotate to make its text layer read upright; null when the page has
   *  too little text, or the text runs don't agree on one orientation. */
  rotationHint: number | null;
}

/** Shape of a pdf.js text-content run we need — narrower than the library's own
 *  TextItem (not re-exported from the package's top-level types in this version). */
interface TextRun {
  str: string;
  transform: number[];
}

const ROTATION_ANGLES = [0, 90, 180, 270] as const;
// Text runs within this many degrees of a right angle are treated as belonging
// to that orientation (small skew from italics/handwritten fonts is common).
const ANGLE_TOLERANCE_DEG = 8;
// Need at least this many significant characters of agreeing text before trusting
// the signal — a couple of stray glyphs (a rotated stamp, a sideways watermark)
// shouldn't flip a whole page that otherwise reads fine. A wrong auto-flip is
// worse than leaving a genuinely-sideways page for the inspector to fix by hand,
// so this errs conservative.
const MIN_ROTATION_WEIGHT = 40;
// ...spread across more than one text run, so a single rotated element can't
// dominate just by being a long string (e.g. one long stamped disclaimer).
const MIN_ROTATION_RUNS = 3;
// ...and they need to be a clear, dominant majority, not just a plurality, of
// everything found on the page.
const MAJORITY_FRACTION = 0.85;

/**
 * Best-effort page rotation from the text layer's own glyph orientation: each
 * text run's transform matrix encodes the angle it was drawn at (independent of
 * the page's /Rotate flag), so a page whose text consistently reads sideways or
 * upside-down gives that away even when the raw string content still extracts
 * fine. Returns the fix to add to the page's current rotation, or null when the
 * signal isn't strong enough to trust.
 */
function detectRotationHint(items: TextRun[], pageRotate: number): number | null {
  const weightByAngle: Record<number, number> = { 0: 0, 90: 0, 180: 0, 270: 0 };
  const runsByAngle: Record<number, number> = { 0: 0, 90: 0, 180: 0, 270: 0 };
  let totalWeight = 0;

  for (const it of items) {
    const str = it.str?.trim();
    if (!str || str.length < 2) continue;
    const [a, b] = it.transform;
    if (Math.hypot(a, b) < 1e-6) continue; // degenerate matrix, no orientation info

    const angleDeg = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const nearest = (Math.round(angleDeg / 90) * 90) % 360;
    const deviation = Math.min(Math.abs(angleDeg - nearest), 360 - Math.abs(angleDeg - nearest));
    if (deviation > ANGLE_TOLERANCE_DEG) continue;

    const weight = str.length;
    weightByAngle[nearest] += weight;
    runsByAngle[nearest] += 1;
    totalWeight += weight;
  }

  if (totalWeight < MIN_ROTATION_WEIGHT) return null;

  let contentAngle = 0;
  let bestWeight = -1;
  for (const angle of ROTATION_ANGLES) {
    if (weightByAngle[angle] > bestWeight) {
      bestWeight = weightByAngle[angle];
      contentAngle = angle;
    }
  }
  if (bestWeight / totalWeight < MAJORITY_FRACTION) return null;
  if (runsByAngle[contentAngle] < MIN_ROTATION_RUNS) return null;

  const pageRotateNorm = ((pageRotate % 360) + 360) % 360;
  return ((contentAngle - pageRotateNorm) % 360 + 360) % 360;
}

/** Extract the text layer of a single page. Empty text => likely image-only/scanned. */
export async function extractPageText(doc: pdfjsLib.PDFDocumentProxy, pageNumber: number): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const textRuns: TextRun[] = [];
  for (const it of content.items) {
    if ("str" in it && "transform" in it) textRuns.push({ str: it.str, transform: it.transform });
  }
  const text = textRuns
    .map((r) => r.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const rotationHint = detectRotationHint(textRuns, page.rotate);
  return { index: pageNumber - 1, text, hasTextLayer: text.length > 8, rotationHint };
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

/** Render a page as JPEG (smaller payload for vision calls). */
export async function renderPageJpeg(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
  quality = 0.7
): Promise<string> {
  const png = await renderPage(doc, pageNumber, targetWidth);
  // Re-encode through a canvas to JPEG.
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image decode failed"));
    img.src = png;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return png;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Extract the whole text layer of a document, up to a character budget. */
export async function extractDocText(
  doc: pdfjsLib.PDFDocumentProxy,
  maxChars = 24000
): Promise<string> {
  let out = "";
  for (let p = 1; p <= doc.numPages && out.length < maxChars; p++) {
    const { text } = await extractPageText(doc, p);
    if (text) out += `\n[p${p}] ${text}`;
  }
  return out.slice(0, maxChars).trim();
}
