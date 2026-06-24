import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";
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

/** Sanitize a string into a safe folder / file name. */
export function safeName(s: string): string {
  return (s || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "inspection";
}

/**
 * Build every group's PDF and pack them into a single ZIP whose contents live
 * under one smartly-named folder (project_date). Unzipping yields that folder
 * with all the files inside.
 */
export async function buildZip(
  sourceBytes: ArrayBuffer,
  coverIndex: number | null,
  groups: OutputGroup[],
  folderName: string
): Promise<Blob> {
  const folder = safeName(folderName);
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const g of groups) {
    let name = g.filename || "file.pdf";
    // de-dup identical filenames within the zip
    if (used.has(name)) {
      const base = name.replace(/\.pdf$/i, "");
      let n = 2;
      while (used.has(`${base}_${n}.pdf`)) n++;
      name = `${base}_${n}.pdf`;
    }
    used.add(name);
    files[`${folder}/${name}`] = await buildGroupPdf(sourceBytes, coverIndex, g);
  }
  // PDFs are already compressed; store (level 0) for speed.
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
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
