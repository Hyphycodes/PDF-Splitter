"use client";

import type { OutputGroup, CoverRow } from "@/lib/types";
import { CheckIcon } from "./Icons";

interface PageInfo {
  index: number;
  pageNumber: number;
  thumbnail?: string;
  payItems: string[];
  isCoverSheet: boolean;
}

interface Props {
  pages: PageInfo[];
  coverIndex: number | null;
  groups: OutputGroup[];
  contract: string;
  date: string;
  missingPayItems: string[];
  coverMap: Map<string, CoverRow>;
  onView: (idx: number) => void;
  onAssignGroup: (idx: number, gid: string) => void;
  onAssignPayItem: (idx: number, pi: string) => void;
  onNewFile: (idx: number) => void;
  onUnassign: (idx: number) => void;
  onSelectFile: (gid: string) => void;
}

/** Big overview of every page with one-tap assignment to a file / pay item. */
export default function AllPagesGrid({
  pages,
  coverIndex,
  groups,
  contract,
  date,
  missingPayItems,
  coverMap,
  onView,
  onAssignGroup,
  onAssignPayItem,
  onNewFile,
  onUnassign,
  onSelectFile,
}: Props) {
  const groupOfPage = new Map<number, OutputGroup>();
  for (const g of groups) for (const idx of g.pageIndexes) if (!groupOfPage.has(idx)) groupOfPage.set(idx, g);

  const certPages = pages.filter((p) => !p.isCoverSheet && p.index !== coverIndex);
  const coverPage = pages.find((p) => p.index === coverIndex);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 text-sm text-ink-faint">
          Every page in the packet. The split is done automatically — use this view to eyeball each page big and
          fix where it lands. Click a page to zoom; use its dropdown to send it to a file or pay item.
        </p>

        {coverPage && (
          <div className="mb-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Cover sheet</div>
            <button
              onClick={() => onView(coverPage.index)}
              className="group relative block w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
            >
              {coverPage.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPage.thumbnail} alt="cover" className="h-56 w-full object-cover object-top" />
              )}
              <div className="absolute left-2 top-2 rounded-md bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Cover · in every file
              </div>
            </button>
          </div>
        )}

        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Cert pages ({certPages.length})
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {certPages.map((p) => {
            const g = groupOfPage.get(p.index);
            return (
              <div key={p.index} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
                <button onClick={() => onView(p.index)} className="group relative block w-full" title="Click to view full size">
                  {p.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt={`page ${p.pageNumber}`} className="h-72 w-full object-cover object-top transition group-hover:opacity-90" />
                  )}
                  <div className="absolute left-2 top-2 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    Page {p.pageNumber}
                  </div>
                  {g ? (
                    <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      <CheckIcon width={10} height={10} /> assigned
                    </div>
                  ) : (
                    <div className="absolute right-2 top-2 rounded-md bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      unassigned
                    </div>
                  )}
                </button>

                <div className="p-2.5">
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {p.payItems.length ? (
                      p.payItems.map((pi) => (
                        <span key={pi} className="chip bg-slate-100 font-mono text-[10px] text-ink-soft">
                          {pi}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-ink-faint">No pay item read on this page</span>
                    )}
                  </div>

                  {g && (
                    <button
                      onClick={() => onSelectFile(g.id)}
                      className="mb-1.5 block w-full truncate text-left font-mono text-[11px] text-brand-700 hover:underline"
                      title={g.filename}
                    >
                      → {g.filename}
                    </button>
                  )}

                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__unassign__") onUnassign(p.index);
                      else if (v === "__new__") onNewFile(p.index);
                      else if (v.startsWith("pi:")) onAssignPayItem(p.index, v.slice(3));
                      else if (v) onAssignGroup(p.index, v);
                    }}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] focus:border-brand-400"
                  >
                    <option value="">{g ? "Move to…" : "Assign to…"}</option>
                    {groups.length > 0 && (
                      <optgroup label="Files">
                        {groups.map((gr) => (
                          <option key={gr.id} value={gr.id}>
                            {gr.payItems.join("-") || gr.filename}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {missingPayItems.length > 0 && (
                      <optgroup label="Missing pay item (new file)">
                        {missingPayItems.map((pi) => (
                          <option key={pi} value={`pi:${pi}`}>
                            {pi} — {coverMap.get(pi)?.description || ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <option value="__new__">＋ New file from this page</option>
                    {g && <option value="__unassign__">Unassign</option>}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-right text-[11px] text-ink-faint">
          {contract || "CONTRACT"}_{date || "DATE"}
        </div>
      </div>
    </div>
  );
}
