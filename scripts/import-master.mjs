#!/usr/bin/env node
// Import the full `material_master` table from the Manual for Materials
// Inspection (Electrical) PDF and write lib/material-master-seed.ts.
//
// Usage:  node scripts/import-master.mjs path/to/Manual_for_Materials_Inspection_Electrical.pdf
//
// The manual lays each material out as:
//   MATERIAL GROUP: 300 ELECTRICAL CABLE & CONDUIT  ==>
//   ==> MATERIAL: 30103  CABLE, ELECTRICAL 3/C COPPER  METER (METER )
//       METHOD OF ACCEPTANCE---: VIS ... SPECIFICATIONS: ART 1066 ____...
// We read the text layer with pdf.js and parse those records.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function extractText(path) {
  const doc = await getDocument({ url: path, useSystemFonts: true }).promise;
  let all = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += "\n" + tc.items.map((it) => it.str).join(" ");
  }
  return all;
}

function parse(raw) {
  const groupRe = /MATERIAL GROUP:\s*([0-9]+)\s+([A-Z0-9 ,&.\/\-]+?)\s*==>/g;
  const groups = [];
  let m;
  while ((m = groupRe.exec(raw))) groups.push({ idx: m.index, label: `${m[1]} ${m[2].trim()}` });
  const groupAt = (pos) => {
    let g = "";
    for (const x of groups) {
      if (x.idx <= pos) g = x.label;
      else break;
    }
    return g;
  };

  const rows = [];
  const matRe =
    /==> MATERIAL:\s*([A-Z0-9]+)\s+(.*?)\s+(EA|LINFT|LB|TON|SQYD|CUYD|GAL|CY|SY|LF|FT|LS|LSUM|METER)?\s*\(([^)]*)\)/g;
  while ((m = matRe.exec(raw))) {
    const tail = raw.slice(m.index, m.index + 700);
    rows.push({
      material_code: m[1],
      description: m[2].replace(/\s+/g, " ").trim(),
      group: groupAt(m.index),
      uom: (m[4] || "").trim() || (m[3] || "").trim(),
      method_of_acceptance: (tail.match(/METHOD OF ACCEPTANCE-*:\s*([A-Z]+)/) || [])[1] || "",
      spec_article:
        (tail.match(/SPECIFICATIONS:\s*([^_]+?)\s*_{3,}/) || [])[1]?.replace(/\s+/g, " ").trim() || "",
    });
  }
  return rows;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/import-master.mjs <manual.pdf>");
    process.exit(1);
  }
  const raw = await extractText(path);
  const rows = parse(raw);
  if (!rows.length) {
    console.error("No material rows parsed — is this the right manual?");
    process.exit(1);
  }
  const out =
    "// AUTO-GENERATED from Manual for Materials Inspection (Electrical), Part 2.\n" +
    "// Regenerate with: node scripts/import-master.mjs <manual.pdf>\n" +
    'import type { MaterialMaster } from "./types";\n\n' +
    "export const MATERIAL_MASTER_SEED: MaterialMaster[] = " +
    JSON.stringify(rows, null, 2) +
    ";\n";
  const dest = join(__dirname, "..", "lib", "material-master-seed.ts");
  writeFileSync(dest, out);
  console.log(`Wrote ${rows.length} materials to lib/material-master-seed.ts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
