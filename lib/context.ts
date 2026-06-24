import type {
  MaterialMaster,
  PayItemCrosswalk,
  ResearchNote,
  OutputGroup,
} from "./types";

function materialLine(m: MaterialMaster): string {
  return `${m.material_code}  ${m.description}  (${m.uom}, ${m.method_of_acceptance})`;
}

function notesBlock(notes: ResearchNote[]): string {
  if (!notes.length) return "";
  return (
    "\nLEARNED NOTES (confirmed by the inspector previously — weigh heavily):\n" +
    notes.map((n) => `- [${n.scope} ${n.ref}] ${n.note}`).join("\n")
  );
}

/** Context for challenging one split: just the file's rows + relevant master/notes. */
export function buildGroupContext(
  group: OutputGroup,
  materials: Map<string, MaterialMaster>,
  crosswalk: Map<string, PayItemCrosswalk>,
  notes: ResearchNote[]
): string {
  const mat = group.materialCode ? materials.get(group.materialCode) : undefined;
  const rows = group.rows
    .map((r) => {
      const cw = crosswalk.get(r.pay_item);
      return `- pay item ${r.pay_item}: "${r.description}", qty ${r.quantity || "?"} ${r.uom || ""}, assigned material ${r.material_code ?? "NULL"} [${cw?.source ?? "?"}]`;
    })
    .join("\n");

  // Pull master rows for nearby cable codes so Claude can reason about conductor counts.
  const nearbyCodes = new Set<string>();
  if (group.materialCode) nearbyCodes.add(group.materialCode);
  const relevantMaster = [...materials.values()]
    .filter((m) => m.material_code.startsWith("301") || nearbyCodes.has(m.material_code))
    .map(materialLine)
    .join("\n");

  return (
    `CONTESTED OUTPUT FILE: ${group.filename}\n` +
    `Assigned material code: ${group.materialCode ?? "UNRESOLVED"}${mat ? ` (${mat.description})` : ""}\n` +
    `Pay items in this file:\n${rows}\n\n` +
    `The page images attached are the actual cert pages in THIS file (cover sheet first). ` +
    `Judge whether the assigned material code is right and whether every page belongs.\n\n` +
    `RELEVANT MATERIAL MASTER:\n${relevantMaster}` +
    notesBlock(notes)
  );
}
