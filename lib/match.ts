import type {
  CertPage,
  CoverRow,
  GroupRow,
  OutputGroup,
  MaterialMaster,
  PayItemCrosswalk,
} from "./types";

export interface MatchInput {
  pages: CertPage[];
  coverRows: CoverRow[];
  coverIndex: number | null;
  /** pay item -> position in the cover list (drives output order + filenames) */
  coverOrder: Map<string, number>;
  crosswalk: Map<string, PayItemCrosswalk>;
  materials: Map<string, MaterialMaster>;
  contract: string;
  date: string;
  research: boolean;
}

/** Expected copper-cable code from a conductor count, used to populate/flag. */
export function expectedCableCode(description: string): string | null {
  const upper = (description || "").toUpperCase();
  if (/\b\d*\s*(PR|PAIR)/.test(upper)) return "30115"; // pairs
  const m = upper.match(/(\d{1,2})\s*C\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 10) return String(30100 + n); // 30101..30110
  if (n === 12) return "30112";
  return null;
}

export function autoName(contract: string, date: string, payItems: string[]): string {
  const c = contract || "CONTRACT";
  const d = date || "DATE";
  const label = payItems.length ? payItems.join("-") : "file";
  return `${c}_${d}_${label}.pdf`;
}

/** Build the per-pay-item review row, always populating a material code. */
export function buildGroupRow(
  payItem: string,
  coverRows: Map<string, CoverRow>,
  crosswalk: Map<string, PayItemCrosswalk>,
  materials: Map<string, MaterialMaster>,
  research: boolean
): GroupRow {
  const cover = coverRows.get(payItem);
  const cw = crosswalk.get(payItem);
  const description = cover?.description || cw?.pay_item_description || "";
  // Always populate a material code: crosswalk first, else infer from the
  // conductor count, so the dropdown is never empty when we can help it.
  const material_code = cw?.material_code ?? expectedCableCode(description) ?? null;

  const row: GroupRow = {
    pay_item: payItem,
    description,
    quantity: cover?.quantity || "",
    uom: cover?.uom || (material_code ? materials.get(material_code)?.uom : "") || "",
    material_code,
  };

  if (cw && cw.source !== "confirmed" && cw.source !== "seed") {
    row.suggestion = {
      material_code: cw.material_code,
      reason:
        cw.source === "research"
          ? "Unresolved on first encounter — confirm a material code."
          : `Suggested (${Math.round(cw.confidence * 100)}% confidence)${cw.note ? ` — ${cw.note}` : ""}.`,
      source: cw.source,
    };
  }

  if (research && cw?.source !== "confirmed") {
    const expected = expectedCableCode(description);
    if (expected && material_code && expected !== material_code) {
      row.flag = `Description reads ${expected === "30115" ? "pairs" : `${expected.slice(-1)}/C`} → expected ${expected}, but assigned ${material_code}.`;
    }
  }
  return row;
}

/**
 * Group cert pages by the PAY-ITEM BOX. Pages that carry the same set of pay
 * items belong to the same cert and go into one output file — including
 * multi-page certs that repeat the box, and certs whose box lists several pay
 * items. Every such pay item is named in the file and listed at the top.
 */
export function matchAndGroup(input: MatchInput): OutputGroup[] {
  const { pages, coverRows, coverIndex, coverOrder, crosswalk, materials, contract, date, research } = input;
  const coverByPayItem = new Map(coverRows.map((r) => [r.pay_item, r]));
  const orderOf = (pi: string) => (coverOrder.has(pi) ? coverOrder.get(pi)! : 10000 + pi.charCodeAt(0));

  const certPages = pages.filter(
    (p) => !p.isCoverSheet && p.index !== coverIndex && p.payItems.length > 0
  );

  // Group key = the sorted set of pay items appearing on the page.
  const groups = new Map<string, { payItems: string[]; pageIndexes: Set<number> }>();
  for (const page of certPages) {
    const set = [...new Set(page.payItems)].sort((a, b) => orderOf(a) - orderOf(b));
    const key = set.join("+");
    let g = groups.get(key);
    if (!g) {
      g = { payItems: set, pageIndexes: new Set() };
      groups.set(key, g);
    }
    g.pageIndexes.add(page.index);
  }

  const result: OutputGroup[] = [];
  let i = 0;
  for (const [, g] of groups) {
    const rows = g.payItems.map((pi) => buildGroupRow(pi, coverByPayItem, crosswalk, materials, research));
    const primaryCode = rows.find((r) => r.material_code)?.material_code ?? null;
    const material = primaryCode ? materials.get(primaryCode) : undefined;

    result.push({
      id: `g${i++}`,
      materialCode: primaryCode,
      materialDescription:
        material?.description || (g.payItems.length > 1 ? `${g.payItems.length} pay items` : "Material"),
      payItems: g.payItems,
      pageIndexes: [...g.pageIndexes].sort((a, b) => a - b),
      filename: autoName(contract, date, g.payItems),
      status: "pending",
      rows,
    });
  }

  // Output order follows the cover list: by each group's earliest pay item.
  result.sort((a, b) => Math.min(...a.payItems.map(orderOf)) - Math.min(...b.payItems.map(orderOf)));
  return result;
}
