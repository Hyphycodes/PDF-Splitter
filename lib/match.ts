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

/** The conductor-count sanity rule, used in research mode. */
function expectedCableCode(description: string): string | null {
  const upper = description.toUpperCase();
  if (/\b\d*\s*(PR|PAIR)/.test(upper)) return "30115"; // pairs
  const m = upper.match(/(\d{1,2})\s*C\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 10) return String(30100 + n); // 30101..30110
  if (n === 12) return "30112";
  return null;
}

function key(materialCode: string | null, payItem: string): string {
  return materialCode ? `MC:${materialCode}` : `PI:${payItem}`;
}

function autoName(contract: string, date: string, payItems: string[]): string {
  const c = contract || "CONTRACT";
  const d = date || "DATE";
  return `${c}_${d}_${payItems.join("-")}.pdf`;
}

export function matchAndGroup(input: MatchInput): OutputGroup[] {
  const { pages, coverRows, coverIndex, coverOrder, crosswalk, materials, contract, date, research } = input;
  const coverByPayItem = new Map(coverRows.map((r) => [r.pay_item, r]));
  // Pay items not on the cover sort after those that are, by appearance order.
  const orderOf = (pi: string) => (coverOrder.has(pi) ? coverOrder.get(pi)! : 10000 + (coverByPayItem.size || 0));

  // group key -> working group
  const groups = new Map<
    string,
    {
      materialCode: string | null;
      payItems: Set<string>;
      pageIndexes: Set<number>;
    }
  >();

  const certPages = pages.filter((p) => !p.isCoverSheet && p.index !== coverIndex);

  for (const page of certPages) {
    for (const payItem of page.payItems) {
      const cw = crosswalk.get(payItem);
      const materialCode = cw?.material_code ?? null;
      const k = key(materialCode, payItem);
      let g = groups.get(k);
      if (!g) {
        g = { materialCode, payItems: new Set(), pageIndexes: new Set() };
        groups.set(k, g);
      }
      g.payItems.add(payItem);
      g.pageIndexes.add(page.index);
    }
  }

  const result: OutputGroup[] = [];
  let i = 0;
  for (const [, g] of groups) {
    const material = g.materialCode ? materials.get(g.materialCode) : undefined;
    // Pay items ordered by their position on the cover list.
    const payItems = [...g.payItems].sort((a, b) => orderOf(a) - orderOf(b));

    const rows: GroupRow[] = payItems.map((pi) => {
      const cover = coverByPayItem.get(pi);
      const cw = crosswalk.get(pi);
      const description = cover?.description || cw?.pay_item_description || "";
      const row: GroupRow = {
        pay_item: pi,
        description,
        quantity: cover?.quantity || "",
        uom: cover?.uom || material?.uom || "",
        material_code: g.materialCode,
      };

      // Crosswalk suggestion for non-confirmed rows.
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

      // Research-mode conductor-count check — never auto-flag confirmed rows.
      if (research && cw?.source !== "confirmed") {
        const expected = expectedCableCode(description);
        if (expected && g.materialCode && expected !== g.materialCode) {
          row.flag = `Description reads ${describeConductors(description)} → expected ${expected}, but assigned ${g.materialCode}.`;
        }
      }
      return row;
    });

    const filename = autoName(contract, date, payItems);

    result.push({
      id: `g${i++}`,
      materialCode: g.materialCode,
      materialDescription: material?.description || (g.materialCode ? "" : "Unresolved pay item"),
      payItems,
      pageIndexes: [...g.pageIndexes].sort((a, b) => a - b),
      filename,
      status: "pending",
      rows,
    });
  }

  // Output order follows the cover list: by each group's earliest pay item.
  result.sort((a, b) => {
    const ao = Math.min(...a.payItems.map(orderOf));
    const bo = Math.min(...b.payItems.map(orderOf));
    return ao - bo;
  });

  return result;
}

function describeConductors(description: string): string {
  const m = description.toUpperCase().match(/(\d{1,2})\s*C\b/);
  if (m) return `${m[1]}/C`;
  if (/\b\d*\s*(PR|PAIR)/.test(description.toUpperCase())) return "pairs";
  return "cable";
}
