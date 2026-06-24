// ---- Database tables -------------------------------------------------------

export interface MaterialMaster {
  material_code: string;
  description: string;
  group: string;
  uom: string;
  method_of_acceptance: string;
  spec_article: string;
}

export type CrosswalkSource = "seed" | "confirmed" | "suggested" | "research";

export interface PayItemCrosswalk {
  pay_item: string;
  pay_item_description: string;
  material_code: string | null;
  confidence: number; // 0..1
  source: CrosswalkSource;
  note?: string;
  updated_at?: number;
}

// ---- Pipeline working types ------------------------------------------------

export type ReadMode = "text-layer" | "vision" | "manual" | "none";

export interface CoverRow {
  pay_item: string;
  description: string;
  quantity: string;
  uom: string;
  manufacturer: string;
}

export interface CertPage {
  /** 0-based index into the source PDF. */
  index: number;
  pageNumber: number; // 1-based for display
  payItems: string[]; // pay-item numbers detected on this page
  readMode: ReadMode;
  rawText: string;
  isCoverSheet: boolean;
  needsReview: boolean; // image-only and unread, or no match
  thumbnail?: string; // dataURL
}

export interface OutputGroup {
  id: string;
  /** material code if grouped by material, else "" */
  materialCode: string | null;
  materialDescription: string;
  payItems: string[]; // pay items covered by this group
  /** source-pdf page indexes assigned to this group (cert pages only, cover added at build) */
  pageIndexes: number[];
  filename: string;
  status: "pending" | "confirmed";
  /** per pay-item review data shown in the table */
  rows: GroupRow[];
}

export interface GroupRow {
  pay_item: string;
  description: string;
  quantity: string;
  uom: string;
  material_code: string | null;
  /** research-mode flag */
  flag?: string;
  /** crosswalk suggestion the inspector can accept/correct */
  suggestion?: { material_code: string | null; reason: string; source: CrosswalkSource };
}

export interface PipelineResult {
  contract: string;
  date: string;
  coverIndex: number | null;
  coverRows: CoverRow[];
  pages: CertPage[];
  groups: OutputGroup[];
}
