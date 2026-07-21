import type { CoverRow } from "./types";

// Pay items are 8 chars: either 8 digits (87301225) or X + 7 digits (X8780012).
export const PAY_ITEM_RE = /\b(?:X\d{7}|\d{8})\b/g;

/** All distinct pay-item-shaped tokens in a blob of text, in order of first appearance. */
export function findPayItems(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(PAY_ITEM_RE)) {
    const v = m[0];
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Heuristic: a cover sheet ("IL OKAY LOG") lists many pay items and usually
 * carries the words OKAY / LOG / SUMMARY / PAY ITEM. We score every page and
 * pick the strongest as the cover, but the caller can override.
 */
export function coverScore(text: string): number {
  const upper = text.toUpperCase();
  let score = findPayItems(text).length;
  if (/OKAY\s*LOG/.test(upper)) score += 8;
  if (/\bSUMMARY\b/.test(upper)) score += 3;
  if (/\bPAY\s*ITEM\b/.test(upper)) score += 3;
  if (/\bQUANTITY\b|\bQTY\b/.test(upper)) score += 2;
  if (/\bUOM\b|\bU\/M\b/.test(upper)) score += 2;
  return score;
}

const KNOWN_UOMS = ["LINFT", "LIN FT", "METER", "EA", "EACH", "LB", "LBS", "TON", "FT", "CY", "SY", "LS", "LSUM", "GAL"];

/**
 * Best-effort parse of cover-sheet rows. The layout varies, so for each pay item
 * found we capture a text window and pull out a plausible quantity + UOM + a
 * description fragment. Everything is editable in the review UI.
 */
export function parseCoverRows(text: string): CoverRow[] {
  const rows: CoverRow[] = [];
  const matches = [...text.matchAll(PAY_ITEM_RE)];
  const seen = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const payItem = m[0];
    if (seen.has(payItem)) continue;
    seen.add(payItem);

    const start = (m.index ?? 0) + payItem.length;
    const end = matches[i + 1]?.index ?? Math.min(text.length, start + 160);
    const window = text.slice(start, end).trim();
    const upper = window.toUpperCase();

    // UOM: first known unit token in the window (whole-word, so "EA" doesn't
    // match inside "LEAD").
    let uom = "";
    let uomIdx = -1;
    for (const u of KNOWN_UOMS) {
      const re = new RegExp(`\\b${u.replace(/\s/g, "\\s*")}\\b`);
      const mm = re.exec(upper);
      if (mm && (uomIdx === -1 || mm.index < uomIdx)) {
        uom = u;
        uomIdx = mm.index;
      }
    }

    // Quantity: in these logs the quantity sits just before the UOM column, so
    // prefer the number nearest-left of the UOM. Fall back to the first number.
    let quantity = "";
    if (uomIdx > 0) {
      const before = window.slice(0, uomIdx);
      const nums = [...before.matchAll(/(\d[\d,]*\.?\d*)/g)];
      if (nums.length) quantity = nums[nums.length - 1][1].replace(/,/g, "");
    }
    if (!quantity) {
      const qtyMatch = window.match(/(\d[\d,]*\.?\d*)/);
      quantity = qtyMatch ? qtyMatch[1].replace(/,/g, "") : "";
    }

    // Description: alpha-heavy fragment from the window.
    const descMatch = window.match(/[A-Za-z][A-Za-z0-9 ,.&\/"'-]{3,60}/);
    const description = descMatch ? descMatch[0].trim() : "";

    rows.push({ pay_item: payItem, description, quantity, uom, manufacturer: "" });
  }
  return rows;
}

// LA-15 ticket numbers follow an explicit label ("Ticket No: 12345", "Ticket #12345",
// "Ticket Number TX-4521"); the NO/NUMBER/#/: separator is required so plain prose
// mentioning "ticket" (e.g. "no ticket field on this page") doesn't false-match.
const TICKET_LABEL_RE = /\bTICKET\s*(?:NO\.?|NUMBER|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,19})/i;

/** Best-effort ticket number for an LA-15 page: the value right after a "Ticket #/No/Number" label. */
export function findTicketNumber(text: string): string | null {
  const m = text.match(TICKET_LABEL_RE);
  return m ? m[1].toUpperCase() : null;
}

/** Pull a contract id + date from header text or filename, best-effort. */
export function guessContractAndDate(coverText: string, filename: string): { contract: string; date: string } {
  let contract = "";
  let date = "";

  // Contract often looks like 62P93 (digit+letter mix, 4–7 chars) — try header then filename.
  const contractRe = /\b\d{2}[A-Z]\d{2,3}\b/;
  contract = coverText.match(contractRe)?.[0] || filename.match(contractRe)?.[0] || "";

  // Date: MMDDYY or MM/DD/YY[YY] or MM-DD-YYYY
  const dateRe = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/;
  const dm = coverText.match(dateRe) || filename.match(dateRe);
  if (dm) {
    const mm = dm[1].padStart(2, "0");
    const dd = dm[2].padStart(2, "0");
    const yy = dm[3].slice(-2);
    date = `${mm}${dd}${yy}`;
  } else {
    const compact = filename.match(/\b(\d{6})\b/);
    if (compact) date = compact[1];
  }
  return { contract, date };
}
