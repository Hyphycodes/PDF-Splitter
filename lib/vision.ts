// Client helpers for reading scanned pages with Claude. Only single page images
// are ever sent. Text-layer pages are read locally and never transmitted.

import type { CoverRow } from "./types";

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("anthropic_api_key") || "";
}

export function setApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (key) window.localStorage.setItem("anthropic_api_key", key);
  else window.localStorage.removeItem("anthropic_api_key");
}

export interface OcrResult<T> {
  data: T;
  error?: string;
}

/** Read pay-item number(s) off a scanned cert page. `candidates` are the cover's
 * pay items, which sharpens reading of smudged/rotated boxes. */
export async function ocrPayItems(pngDataUrl: string, candidates?: string[]): Promise<OcrResult<string[]>> {
  try {
    const res = await fetch("/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ocr", apiKey: getApiKey(), image: pngDataUrl, candidates }),
    });
    const data = await res.json();
    if (!res.ok) return { data: [], error: data?.error || `OCR failed (${res.status})` };
    return { data: Array.isArray(data.payItems) ? data.payItems : [] };
  } catch (e) {
    return { data: [], error: String(e) };
  }
}

/** Read the ticket number off a scanned LA-15 page. */
export async function ocrTicketNumber(pngDataUrl: string): Promise<OcrResult<string | null>> {
  try {
    const res = await fetch("/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ticket", apiKey: getApiKey(), image: pngDataUrl }),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data?.error || `OCR failed (${res.status})` };
    const ticket = typeof data.ticketNumber === "string" && data.ticketNumber.trim() ? data.ticketNumber.trim() : null;
    return { data: ticket };
  } catch (e) {
    return { data: null, error: String(e) };
  }
}

export interface CoverExtract {
  contract: string;
  date: string;
  rows: CoverRow[];
}

/** Read the full cover-sheet table (rows + date + contract) from its image. */
export async function ocrCover(imageDataUrl: string, hintText?: string): Promise<OcrResult<CoverExtract>> {
  const empty: CoverExtract = { contract: "", date: "", rows: [] };
  try {
    const res = await fetch("/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "cover", apiKey: getApiKey(), image: imageDataUrl, hintText }),
    });
    const data = await res.json();
    if (!res.ok) return { data: empty, error: data?.error || `Cover read failed (${res.status})` };
    const rows: CoverRow[] = Array.isArray(data.rows)
      ? data.rows.map((r: Record<string, unknown>) => ({
          pay_item: String(r.pay_item ?? "").trim(),
          description: String(r.description ?? "").trim(),
          quantity: String(r.quantity ?? "").trim(),
          uom: String(r.uom ?? "").trim(),
          manufacturer: "",
        }))
      : [];
    return { data: { contract: String(data.contract ?? ""), date: String(data.date ?? ""), rows: rows.filter((r) => r.pay_item) } };
  } catch (e) {
    return { data: empty, error: String(e) };
  }
}
