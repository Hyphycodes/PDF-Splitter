import { PDFDocument } from "pdf-lib";
import type { OutputGroup } from "./types";

/**
 * Build one output PDF for a group: page 1 = cover sheet, then the matched cert
 * pages in order. Fully local (pdf-lib) — bytes never leave the machine.
 */
export async function buildGroupPdf(
  sourceBytes: ArrayBuffer,
  coverIndex: number | null,
  group: OutputGroup
): Promise<Uint8Array> {
  const src = await PDFDocument.load(sourceBytes);
  const out = await PDFDocument.create();

  const indexes: number[] = [];
  if (coverIndex !== null) indexes.push(coverIndex);
  for (const idx of group.pageIndexes) {
    if (idx !== coverIndex) indexes.push(idx);
  }

  const copied = await out.copyPages(src, indexes);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  triggerDownload(blob, filename);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
