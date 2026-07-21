import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractPageText, renderPage } from "./pdf";
import { findTicketNumber } from "./extract";
import { ocrTicketNumber } from "./vision";
import type { ProgressEvent } from "./pipeline";
import type { La15Result, TicketGroup, TicketPage } from "./types";

const THUMB_WIDTH = 360;
const OCR_WIDTH = 1800;

export interface La15RunOptions {
  /** is an Anthropic key available (server or browser); OCR fallback uses it automatically */
  keyAvailable: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

/** Safe per-ticket filename; falls back to the page number when no ticket was read. */
export function la15FileName(ticketNumber: string | null, pageNumber: number): string {
  return ticketNumber ? `${ticketNumber}.pdf` : `unmatched_p${pageNumber}.pdf`;
}

function groupsFromPages(pages: TicketPage[]): TicketGroup[] {
  const used = new Set<string>();
  return pages.map((pg) => {
    let filename = la15FileName(pg.ticketNumber, pg.pageNumber);
    if (used.has(filename)) {
      const base = filename.replace(/\.pdf$/i, "");
      let n = 2;
      while (used.has(`${base}_${n}.pdf`)) n++;
      filename = `${base}_${n}.pdf`;
    }
    used.add(filename);
    return {
      id: `t${pg.index}`,
      ticketNumber: pg.ticketNumber,
      pageIndexes: [pg.index],
      filename,
      status: "pending",
    };
  });
}

/**
 * LA-15 pipeline: every page stands alone (no cover sheet, no grouping). Reads
 * the ticket number off each page — locally from the text layer first, and via
 * Claude vision only when a page has no text layer / no ticket number was found.
 */
export async function runLa15Pipeline(
  doc: PDFDocumentProxy,
  numPages: number,
  opts: La15RunOptions
): Promise<La15Result> {
  const { onProgress, keyAvailable } = opts;
  const warnings: string[] = [];
  const pages: TicketPage[] = [];
  let ocrErrors = 0;

  for (let p = 1; p <= numPages; p++) {
    onProgress?.({ phase: "Reading pages", current: p, total: numPages });
    const { text, hasTextLayer } = await extractPageText(doc, p);
    const thumbnail = await renderPage(doc, p, THUMB_WIDTH);

    let ticketNumber = findTicketNumber(text);
    let readMode: TicketPage["readMode"] = hasTextLayer ? "text-layer" : "none";

    if (!ticketNumber && keyAvailable) {
      onProgress?.({ phase: "Reading ticket numbers with Claude", current: p, total: numPages });
      const image = await renderPage(doc, p, OCR_WIDTH);
      const { data, error } = await ocrTicketNumber(image);
      if (error) ocrErrors++;
      if (data) {
        ticketNumber = data;
        readMode = "vision";
      }
    }

    pages.push({
      index: p - 1,
      pageNumber: p,
      ticketNumber,
      readMode,
      rawText: text,
      needsReview: !ticketNumber,
      thumbnail,
    });
  }

  if (ocrErrors > 0) warnings.push(`${ocrErrors} scanned page(s) couldn't be read by Claude.`);
  if (!keyAvailable && pages.some((p) => p.needsReview)) {
    warnings.push("No Anthropic key linked — pages without a text layer couldn't be read for a ticket number.");
  }

  return { pages, groups: groupsFromPages(pages), warnings };
}
