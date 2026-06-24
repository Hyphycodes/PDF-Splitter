import type { PayItemCrosswalk } from "./types";

// Seed from contract 62P93, job 262871 (inspector's cover-sheet annotations).
// Pay-item numbers and descriptions are stable across contracts, so this carries forward.
export const CROSSWALK_SEED: PayItemCrosswalk[] = [
  { pay_item: "81028200", pay_item_description: "UNDRGD C GALVS 2", material_code: "30801", confidence: 1, source: "confirmed" },
  { pay_item: "81028220", pay_item_description: "UNDRGD C GALVS 3", material_code: "30801", confidence: 1, source: "confirmed" },
  { pay_item: "81028240", pay_item_description: "UNDRGD C GALVS 4", material_code: "30801", confidence: 1, source: "confirmed" },
  { pay_item: "81400100", pay_item_description: "HANDHOLE", material_code: "21010", confidence: 1, source: "confirmed", note: "regular duty" },
  { pay_item: "81400200", pay_item_description: "HD HANDHOLE", material_code: "21011", confidence: 1, source: "confirmed", note: "heavy duty" },
  { pay_item: "81400300", pay_item_description: "DBL HANDHOLE", material_code: "21011", confidence: 1, source: "confirmed", note: "no double-specific code; heavy code used for double" },
  { pay_item: "87300925", pay_item_description: "ELCBL C TRACER 14 1C", material_code: "30101", confidence: 1, source: "confirmed" },
  { pay_item: "87301215", pay_item_description: "ELCBL C SIGNAL 14 2C", material_code: "30102", confidence: 1, source: "confirmed" },
  { pay_item: "87301225", pay_item_description: "ELCBL C SIGNAL 14 3C", material_code: "30103", confidence: 1, source: "confirmed" },
  { pay_item: "87301245", pay_item_description: "ELCBL C SIGNAL 14 5C", material_code: "30105", confidence: 1, source: "confirmed" },
  { pay_item: "87301255", pay_item_description: "ELCBL C SIGNAL 14 7C", material_code: "30107", confidence: 1, source: "confirmed" },
  { pay_item: "87301305", pay_item_description: "ELCBL C LEAD 14 1PR", material_code: "30155", confidence: 0.6, source: "suggested", note: "best guess; research may revise to 30115 (pairs)" },
  { pay_item: "87301805", pay_item_description: "ELCBL C SERV 6 2C", material_code: null, confidence: 0, source: "research", note: "resolve via research on first encounter" },
  { pay_item: "87301900", pay_item_description: "ELCBL C EGRDC 6 1C", material_code: null, confidence: 0, source: "research", note: "resolve via research on first encounter" },
  { pay_item: "87800100", pay_item_description: "CONC FDN TY A", material_code: "31601", confidence: 1, source: "confirmed", note: "ground rod is the certifiable material within this pay item" },
  { pay_item: "87800150", pay_item_description: "CONC FDN TY C", material_code: "31601", confidence: 1, source: "confirmed", note: "ground rod" },
  { pay_item: "87800400", pay_item_description: "CONC FDN TY E 30D", material_code: "31601", confidence: 1, source: "confirmed", note: "ground rod" },
  { pay_item: "87800415", pay_item_description: "CONC FDN TY E 36D", material_code: "31601", confidence: 1, source: "confirmed", note: "ground rod" },
  { pay_item: "X8780012", pay_item_description: 'CONC FND TYPE A 12" DIA', material_code: "31601", confidence: 1, source: "confirmed", note: "ground rod" },
  { pay_item: "X8860105", pay_item_description: "DET LOOP REPLACEMENT", material_code: "31603", confidence: 1, source: "confirmed" },
  { pay_item: "88600100", pay_item_description: "DET LOOP T1", material_code: "31603", confidence: 1, source: "confirmed" },
  { pay_item: "X0324085", pay_item_description: "EM VEH P S LSC 20 3C", material_code: "30103", confidence: 1, source: "confirmed" },
  { pay_item: "X8710029", pay_item_description: "FIB OPT CBL 24F SM", material_code: "31504", confidence: 1, source: "confirmed" },
];
