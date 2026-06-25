"use client";

import { useMemo } from "react";
import type { OutputGroup, CoverRow, MaterialMaster } from "@/lib/types";
import { CheckIcon, AlertIcon, FileIcon, PageIcon, DatabaseIcon, ChevronIcon } from "./Icons";

interface Props {
  coverRows: CoverRow[];
  groups: OutputGroup[];
  materials: Map<string, MaterialMaster>;
  coverIndex: number | null;
  missingPayItems: string[];
  unrecognizedPayItems: string[];
  onOpenFile: (gid: string) => void;
  onGoToPages: () => void;
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone ?? "bg-brand-50 text-brand-600"}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold leading-none text-ink">{value}</div>
        <div className="mt-1 text-xs text-ink-faint">{label}</div>
      </div>
    </div>
  );
}

export default function DashboardView({
  coverRows,
  groups,
  materials,
  coverIndex,
  missingPayItems,
  unrecognizedPayItems,
  onOpenFile,
  onGoToPages,
}: Props) {
  const groupOfPayItem = useMemo(() => {
    const m = new Map<string, OutputGroup>();
    for (const g of groups) for (const pi of g.payItems) if (!m.has(pi)) m.set(pi, g);
    return m;
  }, [groups]);

  const coverPlus = coverIndex !== null ? 1 : 0;
  const pagesAssigned = groups.reduce((n, g) => n + g.pageIndexes.length, 0);
  const covered = coverRows.length - missingPayItems.length;

  // Rows: every cover pay item + any extra (unrecognized) pay items found on certs.
  const extraRows = unrecognizedPayItems.map((pi) => ({ pay_item: pi, description: "", quantity: "", uom: "", manufacturer: "" }));
  const rows = [...coverRows, ...extraRows];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<FileIcon width={20} height={20} />} label="Output files" value={groups.length} />
          <Stat icon={<PageIcon width={20} height={20} />} label="Pages assigned" value={pagesAssigned} />
          <Stat
            icon={<DatabaseIcon width={20} height={20} />}
            label="Pay items covered"
            value={`${covered}/${coverRows.length}`}
            tone="bg-emerald-50 text-emerald-600"
          />
          <Stat
            icon={<AlertIcon width={20} height={20} />}
            label="Missing certs"
            value={missingPayItems.length}
            tone={missingPayItems.length ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-400"}
          />
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-ink">Pay items</div>
            <button onClick={onGoToPages} className="text-xs font-medium text-brand-700 hover:underline">
              View all pages →
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Pay item</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Qty</th>
                <th className="px-4 py-2.5 font-semibold">Material</th>
                <th className="px-4 py-2.5 font-semibold">File</th>
                <th className="px-4 py-2.5 font-semibold">Pages</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const g = groupOfPayItem.get(r.pay_item);
                const row = g?.rows.find((x) => x.pay_item === r.pay_item);
                const code = row?.material_code ?? null;
                const onCover = coverRows.some((c) => c.pay_item === r.pay_item);
                return (
                  <tr
                    key={r.pay_item}
                    className={`align-top ${g ? "cursor-pointer hover:bg-slate-50/70" : ""}`}
                    onClick={() => g && onOpenFile(g.id)}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-ink">{r.pay_item}</span>
                      {!onCover && (
                        <span className="ml-1.5 rounded bg-rose-50 px-1 text-[10px] font-medium text-rose-600">not on cover</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{r.description || row?.description || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-ink-soft">{r.quantity || row?.quantity || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-ink-soft">{code ?? "—"}</span>
                      {code && materials.get(code) && (
                        <div className="text-[11px] text-ink-faint">{materials.get(code)!.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {g ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckIcon width={13} height={13} /> assigned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertIcon width={13} height={13} /> missing
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{g ? g.pageIndexes.length + coverPlus : "—"}</td>
                    <td className="px-2 py-2.5 text-right">
                      {g && <ChevronIcon width={15} height={15} className="text-slate-300" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
