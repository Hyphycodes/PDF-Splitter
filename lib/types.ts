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
  /** research-mode findings (populated asynchronously when research is on) */
  research?: ResearchResult;
}

export interface ResearchSource {
  title: string;
  url: string;
  isPdf: boolean;
}

export interface ResearchResult {
  status: "pending" | "done" | "error";
  verdict?: "match" | "mismatch" | "unclear";
  suggestedCode?: string | null;
  summary?: string;
  sources?: ResearchSource[];
  error?: string;
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
  warnings?: string[];
}

// ---- Saved inspections (history) ------------------------------------------

export interface Inspection {
  id: string;
  name: string;
  contract: string;
  date: string; // packet date (MMDDYY-ish, as read)
  created_at: number;
  updated_at: number;
  pageCount: number;
  fileCount: number;
  confirmedCount: number;
  /** original packet bytes, stored locally so the run can be fully reopened */
  pdf: Blob;
  /** reviewed state — pages carry no thumbnails (regenerated on open) */
  result: PipelineResult;
}

// ---- Research memory (learning over time) ----------------------------------

export type ResearchScope = "payitem" | "material" | "cert";

export interface ResearchNote {
  /** composite key, e.g. "payitem:87301805" or "material:30115" */
  key: string;
  scope: ResearchScope;
  ref: string; // the pay item / material code / cert id
  note: string;
  confirmed: boolean;
  updated_at: number;
}

// ---- Saved reference documents (manufacturer datasheets / certs) -----------

export interface ResearchDoc {
  id: string;
  name: string;
  url: string;
  /** material codes / pay items this reference relates to */
  refs: string[];
  blob?: Blob; // downloaded copy, when saved into the app
  added_at: number;
}

// ---- Chat / challenge ------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Proposal {
  type: "crosswalk" | "note";
  pay_item?: string;
  material_code?: string | null;
  pay_item_description?: string;
  scope?: ResearchScope;
  ref?: string;
  note?: string;
  rationale?: string;
}

