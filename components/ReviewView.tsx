"use client";

import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OutputGroup, PipelineResult, MaterialMaster, PayItemCrosswalk, GroupRow } from "@/lib/types";
import { buildGroupPdf, buildZip, downloadBytes, triggerDownload, safeName } from "@/lib/build";
import { upsertCrosswalk } from "@/lib/db";
import PdfViewer from "./PdfViewer";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LockIcon,
  AlertIcon,
  ArrowLeftIcon,
  PageIcon,
  SparkIcon,
  GavelIcon,
  PlusIcon,
} from "./Icons";

type SaveState = "idle" | "saving" | "saved";

interface Props {
  result: PipelineResult;
  doc: PDFDocumentProxy | null;
  sourceBytes: ArrayBuffer;
  materials: MaterialMaster[];
  crosswalk: PayItemCrosswalk[];
  projectName: string;
  onRenameProject: (name: string) => void;
  saveState: SaveState;
  onReset: () => void;
  onChallenge: (group: OutputGroup) => void;
  onGroupsChange?: (groups: OutputGroup[]) => void;
}

export default function ReviewView({
  result,
  doc,
  sourceBytes,
  materials,
  crosswalk,
  projectName,
  onRenameProject,
  saveState,
  onReset,
  onChallenge,
  onGroupsChange,
}: Props) {
  const [groups, setGroups] = useState<OutputGroup[]>(result.groups);
  const [selectedId, setSelectedId] = useState<string>(result.groups[0]?.id ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);

  // Reset local state when a different inspection is opened.
  useEffect(() => {
    setGroups(result.groups);
    setSelectedId(result.groups[0]?.id ?? "");
  }, [result]);

  // Lift group changes for persistence (debounced by the parent).
  useEffect(() => {
    onGroupsChange?.(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const materialMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);
  const selected = groups.find((g) => g.id === selectedId) ?? null;

  // Cert pages not currently assigned to any group.
  const assigned = useMemo(() => {
    const s = new Set<number>();
    for (const g of groups) g.pageIndexes.forEach((i) => s.add(i));
    return s;
  }, [groups]);
  const unassigned = result.pages.filter(
    (p) => !p.isCoverSheet && p.index !== result.coverIndex && !assigned.has(p.index)
  );

  function update(groupId: string, patch: (g: OutputGroup) => OutputGroup) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? patch(g) : g)));
  }

  function copy(value: string, key: string) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    });
  }

  function removePage(groupId: string, idx: number) {
    update(groupId, (g) => ({ ...g, pageIndexes: g.pageIndexes.filter((i) => i !== idx), status: "pending" }));
  }

  function addPage(groupId: string, idx: number) {
    update(groupId, (g) => ({
      ...g,
      pageIndexes: [...g.pageIndexes, idx].sort((a, b) => a - b),
      status: "pending",
    }));
    setSelectedId(groupId);
  }

  // Create a brand-new output file from a single (uncategorized) page.
  function createGroupFromPage(idx: number) {
    const page = result.pages.find((p) => p.index === idx);
    const cwMap = new Map(crosswalk.map((c) => [c.pay_item, c]));
    const coverMap = new Map(result.coverRows.map((r) => [r.pay_item, r]));
    const payItems = page?.payItems ?? [];
    const firstCode = payItems.map((pi) => cwMap.get(pi)?.material_code).find(Boolean) ?? null;
    const rows: GroupRow[] = payItems.map((pi) => {
      const cover = coverMap.get(pi);
      const cw = cwMap.get(pi);
      return {
        pay_item: pi,
        description: cover?.description || cw?.pay_item_description || "",
        quantity: cover?.quantity || "",
        uom: cover?.uom || "",
        material_code: cw?.material_code ?? null,
      };
    });
    const label = payItems.length ? payItems.join("-") : `page${idx + 1}`;
    const newGroup: OutputGroup = {
      id: `g_new_${idx}_${groups.length}`,
      materialCode: firstCode,
      materialDescription: firstCode ? materialMap.get(firstCode)?.description ?? "" : "New file",
      payItems,
      pageIndexes: [idx],
      filename: `${result.contract || "CONTRACT"}_${result.date || "DATE"}_${label}.pdf`,
      status: "pending",
      rows,
    };
    setGroups((gs) => [...gs, newGroup]);
    setSelectedId(newGroup.id);
  }

  async function acceptSuggestion(groupId: string, payItem: string) {
    const g = groups.find((x) => x.id === groupId);
    const row = g?.rows.find((r) => r.pay_item === payItem);
    if (!row?.suggestion) return;
    const code = row.suggestion.material_code;
    await upsertCrosswalk({
      pay_item: payItem,
      pay_item_description: row.description,
      material_code: code,
      confidence: 1,
      source: "confirmed",
    });
    update(groupId, (gg) => ({
      ...gg,
      rows: gg.rows.map((r) =>
        r.pay_item === payItem ? { ...r, material_code: code, suggestion: undefined, flag: undefined } : r
      ),
    }));
  }

  async function correctSuggestion(groupId: string, payItem: string, newCode: string) {
    const g = groups.find((x) => x.id === groupId);
    const row = g?.rows.find((r) => r.pay_item === payItem);
    if (!row) return;
    const code = newCode.trim() || null;
    await upsertCrosswalk({
      pay_item: payItem,
      pay_item_description: row.description,
      material_code: code,
      confidence: 1,
      source: "confirmed",
    });
    update(groupId, (gg) => ({
      ...gg,
      materialCode: code ?? gg.materialCode,
      materialDescription: (code && materialMap.get(code)?.description) || gg.materialDescription,
      rows: gg.rows.map((r) =>
        r.pay_item === payItem ? { ...r, material_code: code, suggestion: undefined, flag: undefined } : r
      ),
    }));
    setCorrecting(null);
  }

  async function downloadOne(g: OutputGroup) {
    setBuilding(true);
    try {
      const bytes = await buildGroupPdf(sourceBytes, result.coverIndex, g);
      downloadBytes(bytes, g.filename);
    } finally {
      setBuilding(false);
    }
  }

  const folderName = safeName(projectName || `${result.contract}_${result.date}`);

  async function downloadAllZip() {
    if (!groups.length) return;
    setBuilding(true);
    try {
      const blob = await buildZip(sourceBytes, result.coverIndex, groups, folderName);
      triggerDownload(blob, `${folderName}.zip`);
    } finally {
      setBuilding(false);
    }
  }

  const confirmedCount = groups.filter((g) => g.status === "confirmed").length;
  const viewerIndexes = selected
    ? [...(result.coverIndex !== null ? [result.coverIndex] : []), ...selected.pageIndexes.filter((i) => i !== result.coverIndex)]
    : [];

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-5 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button className="btn-ghost shrink-0 px-3 py-2" onClick={onReset}>
            <ArrowLeftIcon width={16} height={16} />
            <span className="hidden sm:inline">New packet</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="hidden text-xs font-medium text-ink-faint sm:inline">Project</span>
              <input
                value={projectName}
                onChange={(e) => onRenameProject(e.target.value)}
                placeholder="project_date"
                className="w-40 truncate rounded-lg border border-transparent bg-transparent px-1.5 py-1 font-mono text-sm font-semibold text-ink hover:border-slate-200 focus:border-brand-400 focus:bg-white sm:w-56"
              />
              <SaveBadge state={saveState} />
            </div>
            <div className="px-1.5 text-[11px] text-ink-faint">
              {groups.length} files · {confirmedCount} confirmed · saved to history automatically
            </div>
          </div>
        </div>
        <button
          className="btn-primary shrink-0"
          disabled={building || groups.length === 0}
          onClick={downloadAllZip}
          title={`Download all ${groups.length} files as ${folderName}.zip`}
        >
          <DownloadIcon width={16} height={16} />
          {building ? "Zipping…" : `Download all (${groups.length})`}
        </button>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
          <div>{result.warnings.join(" ")}</div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
        {/* File list */}
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50/60 p-3">
          <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Output files
          </div>
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  g.id === selectedId
                    ? "border-brand-300 bg-white shadow-card ring-1 ring-brand-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[12.5px] font-medium text-ink">{g.filename}</span>
                  {g.status === "confirmed" ? (
                    <span className="chip bg-emerald-50 text-emerald-700">
                      <CheckIcon width={12} height={12} />
                    </span>
                  ) : (
                    <span className="chip bg-amber-50 text-amber-700">pending</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                  {g.materialCode ? (
                    <span className="chip bg-brand-50 text-brand-700">code {g.materialCode}</span>
                  ) : (
                    <span className="chip bg-rose-50 text-rose-700">
                      <AlertIcon width={12} height={12} /> unresolved
                    </span>
                  )}
                  <span>{g.pageIndexes.length + (result.coverIndex !== null ? 1 : 0)} pages</span>
                </div>
                <div className="mt-1 truncate text-xs text-ink-faint">{g.materialDescription}</div>
              </button>
            ))}
          </div>

          {unassigned.length > 0 && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-2.5">
              <div className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold text-rose-700">
                <AlertIcon width={13} height={13} />
                {unassigned.length} uncategorized page{unassigned.length > 1 ? "s" : ""}
              </div>
              <p className="px-1 pb-2 text-[11px] text-ink-faint">
                These didn’t match a pay item. Assign each to a file (or start a new one).
              </p>
              <div className="flex flex-col gap-2">
                {unassigned.map((p) => (
                  <div key={p.index} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5">
                    {p.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail} alt={`page ${p.pageNumber}`} className="h-12 w-10 shrink-0 rounded border border-slate-200 object-cover object-top" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-ink">Page {p.pageNumber}</div>
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__new__") createGroupFromPage(p.index);
                          else if (v) addPage(v, p.index);
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] focus:border-brand-400"
                      >
                        <option value="">Assign to…</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.filename}
                          </option>
                        ))}
                        <option value="__new__">＋ New file from this page</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Detail */}
        <main className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-faint">
              No output files were produced — assign pages from the list.
            </div>
          ) : (
            <div className="mx-auto max-w-5xl px-5 py-5">
              {/* Filename + confirm */}
              <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    File name
                  </label>
                  <input
                    value={selected.filename}
                    onChange={(e) => update(selected.id, (g) => ({ ...g, filename: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm focus:border-brand-400"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost border-amber-200 text-amber-700 hover:bg-amber-50"
                    onClick={() => onChallenge(selected)}
                    title="Ask Claude to check this split against the cert pages + your references"
                  >
                    <GavelIcon width={16} height={16} /> Challenge
                  </button>
                  <button className="btn-ghost" disabled={building} onClick={() => downloadOne(selected)}>
                    <DownloadIcon width={16} height={16} /> Download
                  </button>
                  <button
                    className={selected.status === "confirmed" ? "btn-subtle" : "btn-primary"}
                    onClick={() =>
                      update(selected.id, (g) => ({
                        ...g,
                        status: g.status === "confirmed" ? "pending" : "confirmed",
                      }))
                    }
                  >
                    {selected.status === "confirmed" ? (
                      <>
                        <LockIcon width={16} height={16} /> Confirmed
                      </>
                    ) : (
                      <>
                        <CheckIcon width={16} height={16} /> Confirm
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Data table */}
              <div className="card mb-4 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2.5 font-semibold">Quantity</th>
                      <th className="px-4 py-2.5 font-semibold">Material</th>
                      <th className="px-4 py-2.5 font-semibold">Pay item</th>
                      <th className="px-4 py-2.5 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.rows.map((row) => {
                      const key = `${selected.id}:${row.pay_item}`;
                      return (
                        <tr key={row.pay_item} className="align-top">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => copy(row.quantity || "", `${key}:qty`)}
                              title="Click to copy quantity"
                              className="group inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-base font-bold text-brand-700 hover:bg-brand-100"
                            >
                              {row.quantity || "—"}
                              {copied === `${key}:qty` ? (
                                <CheckIcon width={14} height={14} className="text-emerald-600" />
                              ) : (
                                <CopyIcon width={14} height={14} className="opacity-40 group-hover:opacity-100" />
                              )}
                            </button>
                            {row.uom && <div className="mt-1 text-[11px] text-ink-faint">{row.uom}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono font-medium text-ink">{row.material_code ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-ink-soft">{row.pay_item}</td>
                          <td className="px-4 py-3 text-ink-soft">
                            {row.description || <span className="text-slate-400">—</span>}
                            {/* Suggestion / flag affordances */}
                            {row.suggestion && (
                              <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-700">
                                  <SparkIcon width={13} height={13} /> Suggestion
                                </div>
                                <p className="mt-0.5 text-xs text-ink-soft">{row.suggestion.reason}</p>
                                {correcting === key ? (
                                  <CorrectInput
                                    materials={materials}
                                    onCancel={() => setCorrecting(null)}
                                    onSave={(code) => correctSuggestion(selected.id, row.pay_item, code)}
                                  />
                                ) : (
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                                      onClick={() => acceptSuggestion(selected.id, row.pay_item)}
                                    >
                                      Accept {row.suggestion.material_code ?? "(none)"}
                                    </button>
                                    <button
                                      className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-ink-soft ring-1 ring-slate-200 hover:bg-slate-50"
                                      onClick={() => setCorrecting(key)}
                                    >
                                      Correct…
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            {row.flag && (
                              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                                <AlertIcon width={13} height={13} className="mt-0.5 shrink-0" />
                                <span>{row.flag}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Assigned pages (reassignment) */}
              <div className="card mb-4 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <PageIcon width={16} height={16} className="text-brand-600" /> Pages in this file
                  <span className="text-xs font-normal text-ink-faint">(cover sheet is added automatically)</span>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {selected.pageIndexes.map((idx) => {
                    const pg = result.pages.find((p) => p.index === idx);
                    return (
                      <div key={idx} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                        {pg?.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pg.thumbnail} alt={`page ${idx + 1}`} className="h-28 w-full object-cover object-top" />
                        )}
                        <div className="px-1.5 py-1 text-center text-[11px] text-ink-faint">p{idx + 1}</div>
                        <button
                          onClick={() => removePage(selected.id, idx)}
                          className="absolute right-1 top-1 hidden rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white group-hover:block"
                        >
                          remove
                        </button>
                      </div>
                    );
                  })}
                  {selected.pageIndexes.length === 0 && (
                    <div className="col-span-full rounded-lg border border-dashed border-slate-300 py-6 text-center text-xs text-ink-faint">
                      No cert pages assigned. Add pages from the unassigned list on the left.
                    </div>
                  )}
                </div>
              </div>

              {/* Inline viewer */}
              <div className="mb-3 text-sm font-semibold text-ink">Preview</div>
              <div className="rounded-2xl bg-slate-100/70 p-3">
                <PdfViewer doc={doc} indexes={viewerIndexes} coverIndex={result.coverIndex} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="chip bg-slate-100 text-ink-faint">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" /> Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="chip bg-emerald-50 text-emerald-700">
        <CheckIcon width={12} height={12} /> Saved
      </span>
    );
  return null;
}

function CorrectInput({
  materials,
  onSave,
  onCancel,
}: {
  materials: MaterialMaster[];
  onSave: (code: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        list="material-codes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="material code"
        className="w-36 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs focus:border-brand-400"
        autoFocus
      />
      <datalist id="material-codes">
        {materials.map((m) => (
          <option key={m.material_code} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
      <button
        className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
        onClick={() => onSave(value)}
      >
        Save
      </button>
      <button className="rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-slate-100" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
