"use client";

interface Props {
  groupName: string;
  pages: { index: number; pageNumber: number; thumbnail?: string; payItems: string[] }[];
  assignedHere: Set<number>;
  assignedElsewhere: (idx: number) => boolean;
  onToggle: (idx: number, on: boolean) => void;
  onView: (idx: number) => void;
  onClose: () => void;
}

export default function PageManager({ groupName, pages, assignedHere, assignedElsewhere, onToggle, onView, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-ink">Add / edit pages</div>
            <div className="truncate font-mono text-xs text-ink-faint">{groupName}</div>
          </div>
          <button onClick={onClose} className="btn-primary px-3 py-1.5 text-xs">
            Done
          </button>
        </div>
        <p className="border-b border-slate-100 px-5 py-2 text-xs text-ink-faint">
          Check a page to add it to this file. Adding a page moves it here and removes it from any other file.
          Click a page to view it full-size.
        </p>
        <div className="grid grid-cols-3 gap-3 overflow-y-auto p-4 sm:grid-cols-4 md:grid-cols-5">
          {pages.map((p) => {
            const here = assignedHere.has(p.index);
            const elsewhere = !here && assignedElsewhere(p.index);
            return (
              <div
                key={p.index}
                className={`overflow-hidden rounded-lg border-2 transition ${
                  here ? "border-brand-500 ring-2 ring-brand-200" : elsewhere ? "border-amber-300" : "border-slate-200"
                }`}
              >
                <button onClick={() => onView(p.index)} className="block w-full" title="View full page">
                  {p.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt={`page ${p.pageNumber}`} className="h-32 w-full object-cover object-top" />
                  )}
                </button>
                <label className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={here}
                    onChange={(e) => onToggle(p.index, e.target.checked)}
                    className="h-3.5 w-3.5 accent-brand-600"
                  />
                  <span className="font-medium text-ink">p{p.pageNumber}</span>
                  {elsewhere && <span className="ml-auto text-amber-600">in another file</span>}
                  {p.payItems.length > 0 && !elsewhere && (
                    <span className="ml-auto truncate font-mono text-ink-faint">{p.payItems[0]}</span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
