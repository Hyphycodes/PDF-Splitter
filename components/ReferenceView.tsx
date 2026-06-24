"use client";

import { useMemo, useState } from "react";
import type { MaterialMaster, PayItemCrosswalk, ResearchNote } from "@/lib/types";
import { SearchIcon, CopyIcon, CheckIcon, ChatIcon, SparkIcon } from "./Icons";

interface Props {
  materials: MaterialMaster[];
  crosswalk: PayItemCrosswalk[];
  notes: ResearchNote[];
  onAsk: (seed: string, refs: string[]) => void;
}

const SOURCE_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  seed: "bg-slate-100 text-slate-600",
  suggested: "bg-amber-50 text-amber-700",
  research: "bg-rose-50 text-rose-700",
};

export default function ReferenceView({ materials, crosswalk, notes, onAsk }: Props) {
  const [tab, setTab] = useState<"payitems" | "materials">("payitems");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const materialMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);
  const noteByRef = useMemo(() => {
    const m = new Map<string, ResearchNote[]>();
    for (const n of notes) {
      const arr = m.get(n.ref) ?? [];
      arr.push(n);
      m.set(n.ref, arr);
    }
    return m;
  }, [notes]);

  const needle = q.trim().toLowerCase();
  const payRows = crosswalk.filter(
    (r) =>
      !needle ||
      r.pay_item.toLowerCase().includes(needle) ||
      r.pay_item_description.toLowerCase().includes(needle) ||
      (r.material_code ?? "").includes(needle) ||
      (materialMap.get(r.material_code ?? "")?.description ?? "").toLowerCase().includes(needle)
  );
  const matRows = materials.filter(
    (m) =>
      !needle ||
      m.material_code.includes(needle) ||
      m.description.toLowerCase().includes(needle) ||
      m.group.toLowerCase().includes(needle)
  );

  function copy(value: string, key: string) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1100);
    });
  }

  function Copyable({ value, k }: { value: string; k: string }) {
    return (
      <button
        onClick={() => copy(value, k)}
        className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono hover:bg-slate-100"
        title="Click to copy"
      >
        {value}
        {copied === k ? (
          <CheckIcon width={12} height={12} className="text-emerald-600" />
        ) : (
          <CopyIcon width={12} height={12} className="opacity-0 group-hover:opacity-50" />
        )}
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-in px-5 py-7">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Master reference</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Pay items, material codes, and what the tool has learned. Click any code to copy.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setTab("payitems")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "payitems" ? "bg-white text-ink shadow-sm" : "text-ink-faint"}`}
          >
            Pay items <span className="text-ink-faint">({crosswalk.length})</span>
          </button>
          <button
            onClick={() => setTab("materials")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "materials" ? "bg-white text-ink shadow-sm" : "text-ink-faint"}`}
          >
            Materials <span className="text-ink-faint">({materials.length})</span>
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "payitems" ? "Search pay item, code, or description…" : "Search material code, description, or group…"}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm focus:border-brand-400"
        />
      </div>

      <div className="card overflow-hidden">
        {tab === "payitems" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Pay item</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Material</th>
                <th className="px-4 py-2.5 font-semibold">Source</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payRows.map((r) => {
                const mat = materialMap.get(r.material_code ?? "");
                const rowNotes = [...(noteByRef.get(r.pay_item) ?? []), ...(noteByRef.get(r.material_code ?? "") ?? [])];
                return (
                  <tr key={r.pay_item} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <Copyable value={r.pay_item} k={`pi:${r.pay_item}`} />
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {r.pay_item_description}
                      {rowNotes.length > 0 && (
                        <div className="mt-1 flex items-start gap-1 text-xs text-brand-700">
                          <SparkIcon width={12} height={12} className="mt-0.5 shrink-0" />
                          <span>{rowNotes[0].note}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.material_code ? (
                        <div>
                          <Copyable value={r.material_code} k={`mc:${r.pay_item}`} />
                          {mat && <div className="mt-0.5 text-xs text-ink-faint">{mat.description}</div>}
                        </div>
                      ) : (
                        <span className="text-rose-500">unresolved</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`chip ${SOURCE_STYLE[r.source] ?? "bg-slate-100 text-slate-600"}`}>{r.source}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() =>
                          onAsk(
                            `Tell me about pay item ${r.pay_item} (${r.pay_item_description}) and confirm its material code.`,
                            [r.pay_item, r.material_code ?? ""].filter(Boolean)
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-ink-soft hover:bg-brand-600 hover:text-white"
                      >
                        <ChatIcon width={12} height={12} /> Ask
                      </button>
                    </td>
                  </tr>
                );
              })}
              {payRows.length === 0 && <EmptyRow span={5} />}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Code</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Group</th>
                <th className="px-4 py-2.5 font-semibold">UOM</th>
                <th className="px-4 py-2.5 font-semibold">Accept.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matRows.map((m) => (
                <tr key={m.material_code} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <Copyable value={m.material_code} k={`m:${m.material_code}`} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{m.description}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-faint">{m.group}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-faint">{m.uom}</td>
                  <td className="px-4 py-2.5">
                    <span className="chip bg-slate-100 text-slate-600">{m.method_of_acceptance || "—"}</span>
                  </td>
                </tr>
              ))}
              {matRows.length === 0 && <EmptyRow span={5} />}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ span }: { span: number }) {
  return (
    <tr>
      <td colSpan={span} className="px-4 py-10 text-center text-sm text-ink-faint">
        Nothing matches that search.
      </td>
    </tr>
  );
}
