import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractPageText, renderPage } from "./pdf";
import { findPayItems, parseCoverRows, coverScore, guessContractAndDate } from "./extract";
import { matchAndGroup } from "./match";
import { getCrosswalkMap, getMaterialMap } from "./db";
import { ocrPayItems, ocrCover } from "./vision";
import type { CertPage, CoverRow, PipelineResult } from "./types";

export interface ProgressEvent {
  phase: string;
  current: number;
  total: number;
}

export interface RunOptions {
  research: boolean;
  /** is an Anthropic key available (server or browser); cover + OCR use it automatically */
  keyAvailable: boolean;
  filename: string;
  onProgress?: (e: ProgressEvent) => void;
}

const THUMB_WIDTH = 360;
const OCR_WIDTH = 1800;
const COVER_WIDTH = 2600;

/** Normalize a date string to MMDDYY; fall back to today. */
function normalizeDate(raw: string): string {
  const s = (raw || "").trim();
  let mm = "", dd = "", yy = "";
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    mm = m[1];
    dd = m[2];
    yy = m[3];
  } else if (/^\d{6}$/.test(s)) {
    return s; // already MMDDYY
  } else if (/^\d{8}$/.test(s)) {
    mm = s.slice(0, 2);
    dd = s.slice(2, 4);
    yy = s.slice(6, 8);
  }
  if (mm && dd && yy) {
    return mm.padStart(2, "0") + dd.padStart(2, "0") + yy.slice(-2);
  }
  // default: today
  const t = new Date();
  return (
    String(t.getMonth() + 1).padStart(2, "0") +
    String(t.getDate()).padStart(2, "0") +
    String(t.getFullYear()).slice(-2)
  );
}

/**
 * Local-first pipeline. Text-layer pages read locally; scanned pages (and the
 * cover sheet for accurate quantities/date) read with Claude when a key exists.
 */
export async function runPipeline(
  doc: PDFDocumentProxy,
  numPages: number,
  opts: RunOptions
): Promise<PipelineResult> {
  const { onProgress, research, keyAvailable, filename } = opts;
  // Claude reads the cover sheet + any scanned pages automatically when a key exists.
  const ai = keyAvailable;
  const warnings: string[] = [];
  const [crosswalk, materials] = await Promise.all([getCrosswalkMap(), getMaterialMap()]);

  // Pass 1 — text layer for every page (fully local).
  const texts: { index: number; text: string; hasTextLayer: boolean }[] = [];
  for (let p = 1; p <= numPages; p++) {
    onProgress?.({ phase: "Reading pages locally", current: p, total: numPages });
    texts.push(await extractPageText(doc, p));
  }

  // Cover detection: best text-scored page with a pay item; else default page 0.
  let coverIndex = 0;
  let bestScore = -1;
  for (const t of texts) {
    const s = coverScore(t.text);
    if (s > bestScore && findPayItems(t.text).length > 0) {
      bestScore = s;
      coverIndex = t.index;
    }
  }

  // ---- Read the cover sheet ------------------------------------------------
  // Read it locally first; automatically escalate to Claude only if the local
  // read isn't trustworthy enough (no text layer, missing quantities, etc.).
  const coverText = texts[coverIndex]?.text ?? "";
  const coverHasText = texts[coverIndex]?.hasTextLayer;
  const localRows = parseCoverRows(coverText);
  const localGuess = guessContractAndDate(coverText, filename);
  const payItemsOnCover = findPayItems(coverText).length;

  let coverRows: CoverRow[] = localRows;
  let contract = localGuess.contract;
  let date = localGuess.date;

  const localGoodEnough =
    coverHasText &&
    localRows.length > 0 &&
    localRows.length >= payItemsOnCover &&
    localRows.every((r) => r.quantity && r.uom) &&
    /QUANTITY|\bQTY\b/i.test(coverText); // a real quantity column we can trust

  if (ai && !localGoodEnough) {
    onProgress?.({ phase: "Reading cover sheet with Claude", current: 1, total: 1 });
    const coverImg = await renderPage(doc, coverIndex + 1, COVER_WIDTH);
    const { data, error } = await ocrCover(coverImg, coverText);
    if (error) {
      warnings.push(`Cover read via Claude failed: ${error}. Using local read.`);
    } else if (data.rows.length) {
      coverRows = data.rows;
      contract = data.contract || contract;
      date = data.date || date;
    }
  }
  date = normalizeDate(date);
  if (!contract) {
    contract = guessContractAndDate("", filename).contract;
  }

  // Order index for each pay item per the cover list (drives output order + names).
  const coverOrder = new Map<string, number>();
  coverRows.forEach((r, i) => {
    if (!coverOrder.has(r.pay_item)) coverOrder.set(r.pay_item, i);
  });

  // ---- Read each page: pay items + thumbnail -------------------------------
  const pages: CertPage[] = [];
  let ocrErrors = 0;
  for (const t of texts) {
    onProgress?.({ phase: "Building thumbnails", current: t.index + 1, total: numPages });
    const isCover = t.index === coverIndex;
    const thumbnail = await renderPage(doc, t.index + 1, THUMB_WIDTH);

    let payItems = findPayItems(t.text);
    let readMode: CertPage["readMode"] = t.hasTextLayer ? "text-layer" : "none";

    // Escalate to Claude OCR whenever a cert page yields no pay item locally.
    // This covers scanned pages AND pages whose pay-item box is rotated/sideways
    // (the text layer reads the rest of the cert but misses the turned stamp).
    if (!isCover && payItems.length === 0 && ai) {
      onProgress?.({ phase: "Reading pay-item boxes with Claude", current: t.index + 1, total: numPages });
      const pageImage = await renderPage(doc, t.index + 1, OCR_WIDTH);
      const { data, error } = await ocrPayItems(pageImage);
      if (error) ocrErrors++;
      if (data.length) {
        payItems = data;
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

  if (ocrErrors > 0) warnings.push(`${ocrErrors} scanned page(s) couldn't be read by Claude.`);
  if (!ai) {
    warnings.push("No Anthropic key linked — quantities and scanned pages were read locally and may be incomplete.");
  }
  void coverHasText;

  onProgress?.({ phase: "Matching & grouping", current: numPages, total: numPages });
  const groups = matchAndGroup({
    pages,
    coverRows,
    coverIndex,
    coverOrder,
    crosswalk,
    materials,
    contract,
    date,
    research,
  });

  return { contract, date, coverIndex, coverRows, pages, groups, warnings };
}
