import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractPageText, renderPage } from "./pdf";
import { findPayItems, parseCoverRows, coverScore, guessContractAndDate } from "./extract";
import { matchAndGroup } from "./match";
import { getCrosswalkMap, getMaterialMap } from "./db";
import { ocrPayItems } from "./vision";
import type { CertPage, PipelineResult } from "./types";

export interface ProgressEvent {
  phase: string;
  current: number;
  total: number;
}

export interface RunOptions {
  research: boolean;
  useVision: boolean; // OCR image-only pages via API
  filename: string;
  onProgress?: (e: ProgressEvent) => void;
}

const THUMB_WIDTH = 360;
const OCR_WIDTH = 1500;

/**
 * Full local-first pipeline:
 *  1. read every page's text layer (local),
 *  2. detect the cover sheet,
 *  3. find pay items per cert page (vision OCR only for image-only pages),
 *  4. match + group against the local crosswalk/master,
 *  5. return groups for the review UI. PDF bytes never leave the machine.
 */
export async function runPipeline(
  doc: PDFDocumentProxy,
  numPages: number,
  opts: RunOptions
): Promise<PipelineResult> {
  const { onProgress, research, useVision, filename } = opts;
  const [crosswalk, materials] = await Promise.all([getCrosswalkMap(), getMaterialMap()]);

  // Pass 1 — text layer for every page (fully local).
  const texts: { index: number; text: string; hasTextLayer: boolean }[] = [];
  for (let p = 1; p <= numPages; p++) {
    onProgress?.({ phase: "Reading pages locally", current: p, total: numPages });
    texts.push(await extractPageText(doc, p));
  }

  // Detect cover sheet — highest cover score, must contain at least one pay item.
  let coverIndex: number | null = null;
  let bestScore = -1;
  for (const t of texts) {
    const s = coverScore(t.text);
    if (s > bestScore && findPayItems(t.text).length > 0) {
      bestScore = s;
      coverIndex = t.index;
    }
  }

  const coverText = coverIndex !== null ? texts[coverIndex].text : "";
  const coverRows = parseCoverRows(coverText);
  const { contract, date } = guessContractAndDate(coverText, filename);

  // Pass 2 — per page: pay items + thumbnail. Vision OCR for image-only pages.
  const pages: CertPage[] = [];
  for (const t of texts) {
    onProgress?.({ phase: "Building thumbnails", current: t.index + 1, total: numPages });
    const isCover = t.index === coverIndex;
    const thumbnail = await renderPage(doc, t.index + 1, THUMB_WIDTH);

    let payItems = findPayItems(t.text);
    let readMode: CertPage["readMode"] = t.hasTextLayer ? "text-layer" : "none";

    if (!isCover && !t.hasTextLayer && useVision) {
      onProgress?.({ phase: "OCR (image-only pages)", current: t.index + 1, total: numPages });
      const pageImage = await renderPage(doc, t.index + 1, OCR_WIDTH);
      const ocr = await ocrPayItems(pageImage);
      if (ocr.length) {
        payItems = ocr;
        readMode = "vision";
      }
    }

    const needsReview = !isCover && payItems.length === 0;
    pages.push({
      index: t.index,
      pageNumber: t.index + 1,
      payItems,
      readMode,
      rawText: t.text,
      isCoverSheet: isCover,
      needsReview,
      thumbnail,
    });
  }

  onProgress?.({ phase: "Matching & grouping", current: numPages, total: numPages });
  const groups = matchAndGroup({
    pages,
    coverRows,
    coverIndex,
    crosswalk,
    materials,
    contract,
    date,
    research,
  });

  return { contract, date, coverIndex, coverRows, pages, groups };
}
