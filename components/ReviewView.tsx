"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  OutputGroup,
  PipelineResult,
  MaterialMaster,
  PayItemCrosswalk,
  GroupRow,
  ResearchSource,
  CoverRow,
} from "@/lib/types";
import { buildGroupPdf, buildZip, downloadBytes, triggerDownload, safeName } from "@/lib/build";
import { autoName, buildGroupRow } from "@/lib/match";
import { upsertCrosswalk } from "@/lib/db";
import { renderPageJpeg } from "@/lib/pdf";
import { runResearch, saveReferenceFromSource } from "@/lib/researchClient";
import PdfViewer from "./PdfViewer";
import PageLightbox from "./PageLightbox";
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
  GlobeIcon,
  LinkIcon,
  SearchIcon,
  TrashIcon,
  ChatIcon,
  GridIcon,
  FileIcon,
} from "./Icons";

type SaveState = "idle" | "saving" | "saved";

interface Props {
  result: PipelineResult;
  doc: PDFDocumentProxy | null;
  sourceBytes: ArrayBuffer;
  materials: MaterialMaster[];
  crosswalk: PayItemCrosswalk[];
  research: boolean;
  keyAvailable: boolean;
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
  research,
  keyAvailable,
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
  const [lightbox, setLightbox] = useState<{ index: number; assign: boolean } | null>(null);
  const [editingPages, setEditingPages] = useState(false);
  const [savedRefs, setSavedRefs] = useState<Set<string>>(new Set());
  const [contract, setContract] = useState(result.contract);
  const [date, setDate] = useState(result.date);
  const [reviewTab, setReviewTab] = useState<"files" | "pages">("files");
  const startedResearch = useRef<Set<string>>(new Set());

  // Reset local state when a different inspection is opened.
  useEffect(() => {
    setGroups(result.groups);
    setSelectedId(result.groups[0]?.id ?? "");
    setContract(result.contract);
    setDate(result.date);
    startedResearch.current = new Set();
  }, [result]);

  const crosswalkMap = useMemo(() => new Map(crosswalk.map((c) => [c.pay_item, c])), [crosswalk]);
  const coverMap = useMemo(() => new Map(result.coverRows.map((r) => [r.pay_item, r])), [result.coverRows]);
  const coverOrder = useMemo(() => {
    const m = new Map<string, number>();
    result.coverRows.forEach((r, i) => !m.has(r.pay_item) && m.set(r.pay_item, i));
    return m;
  }, [result.coverRows]);
  const orderOf = (pi: string) => coverOrder.get(pi) ?? 10000;
  const fileName = (payItems: string[]) => autoName(contract, date, payItems);

  // Research mode: verify each material against the cert + a manufacturer datasheet.
  useEffect(() => {
    if (!research || !keyAvailable || !doc) return;
    let cancelled = false;
    (async () => {
      for (const g of result.groups) {
        if (cancelled) return;
        if (startedResearch.current.has(g.id)) continue;
        startedResearch.current.add(g.id);
        await runGroupResearch(g);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, research, keyAvailable, doc]);

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

  // Move a page into a file, removing it from any other file it was in.
  function addPageExclusive(groupId: string, idx: number) {
    setGroups((gs) =>
      gs.map((g) => {
        if (g.id === groupId) {
          if (g.pageIndexes.includes(idx)) return g;
          return { ...g, pageIndexes: [...g.pageIndexes, idx].sort((a, b) => a - b), status: "pending" };
        }
        if (g.pageIndexes.includes(idx)) {
          return { ...g, pageIndexes: g.pageIndexes.filter((i) => i !== idx), status: "pending" };
        }
        return g;
      })
    );
  }

  // Remove a page from every file (back to uncategorized).
  function unassignPage(idx: number) {
    setGroups((gs) =>
      gs.map((g) =>
        g.pageIndexes.includes(idx) ? { ...g, pageIndexes: g.pageIndexes.filter((i) => i !== idx) } : g
      )
    );
  }

  // ---- Project / date — applies to every file's name ------------------------
  function applyProjectDate(c: string, d: string) {
    setContract(c);
    setDate(d);
    setGroups((gs) => gs.map((g) => ({ ...g, filename: autoName(c, d, g.payItems) })));
    onRenameProject(`${c || "CONTRACT"}_${d || "DATE"}`);
  }

  // ---- Pay-item rows (top list) ---------------------------------------------
  function newRow(payItem: string): GroupRow {
    return buildGroupRow(payItem, coverMap, crosswalkMap, new Map(materials.map((m) => [m.material_code, m])), research);
  }

  function addPayItemRow(groupId: string, payItem: string) {
    if (!payItem) return;
    // A pay item belongs to exactly one split — add here, remove from any other.
    setGroups((gs) =>
      gs.map((g) => {
        if (g.id === groupId) {
          if (g.payItems.includes(payItem)) return g;
          const payItems = [...g.payItems, payItem].sort((a, b) => orderOf(a) - orderOf(b));
          return {
            ...g,
            payItems,
            rows: [...g.rows, newRow(payItem)].sort((a, b) => orderOf(a.pay_item) - orderOf(b.pay_item)),
            filename: fileName(payItems),
            status: "pending",
          };
        }
        if (g.payItems.includes(payItem)) {
          const payItems = g.payItems.filter((p) => p !== payItem);
          const rows = g.rows.filter((r) => r.pay_item !== payItem);
          return {
            ...g,
            payItems,
            rows,
            filename: fileName(payItems),
            materialCode: rows.find((r) => r.material_code)?.material_code ?? null,
            status: "pending",
          };
        }
        return g;
      })
    );
  }

  function deletePayItemRow(groupId: string, payItem: string) {
    update(groupId, (g) => {
      const payItems = g.payItems.filter((p) => p !== payItem);
      const rows = g.rows.filter((r) => r.pay_item !== payItem);
      return {
        ...g,
        payItems,
        rows,
        filename: fileName(payItems),
        materialCode: rows.find((r) => r.material_code)?.material_code ?? null,
        status: "pending",
      };
    });
  }

  function setRowMaterial(groupId: string, payItem: string, code: string) {
    const c = code || null;
    update(groupId, (g) => {
      const rows = g.rows.map((r) => (r.pay_item === payItem ? { ...r, material_code: c, suggestion: undefined, flag: undefined } : r));
      return { ...g, rows, materialCode: rows.find((r) => r.material_code)?.material_code ?? null };
    });
    const row = groups.find((g) => g.id === groupId)?.rows.find((r) => r.pay_item === payItem);
    if (c) {
      upsertCrosswalk({
        pay_item: payItem,
        pay_item_description: row?.description || "",
        material_code: c,
        confidence: 1,
        source: "confirmed",
      });
    }
  }

  // Pay items on the cover that have no cert pages yet (missing certs).
  const usedPayItems = useMemo(() => new Set(groups.flatMap((g) => g.payItems)), [groups]);
  const coverSet = useMemo(() => new Set(result.coverRows.map((r) => r.pay_item)), [result.coverRows]);
  const missingPayItems = result.coverRows.map((r) => r.pay_item).filter((pi) => !usedPayItems.has(pi));
  // Pay items read off certs that aren't on the cover — likely OCR misreads of a
  // missing cover pay item (this is usually why a pay item shows "missing").
  const unrecognizedPayItems = [...usedPayItems].filter((pi) => !coverSet.has(pi));

  function createGroupForPayItem(payItem: string, idx: number) {
    const newGroup: OutputGroup = {
      id: `g_pi_${payItem}_${groups.length}`,
      materialCode: newRow(payItem).material_code,
      materialDescription: coverMap.get(payItem)?.description || crosswalkMap.get(payItem)?.pay_item_description || "Material",
      payItems: [payItem],
      pageIndexes: [idx],
      filename: fileName([payItem]),
      status: "pending",
      rows: [newRow(payItem)],
    };
    // ensure the page isn't left in another file
    setGroups((gs) => [
      ...gs.map((g) => (g.pageIndexes.includes(idx) ? { ...g, pageIndexes: g.pageIndexes.filter((i) => i !== idx) } : g)),
      newGroup,
    ]);
    setSelectedId(newGroup.id);
  }

  // ---- Research --------------------------------------------------------------
  async function runGroupResearch(group: OutputGroup) {
    if (!doc) return;
    update(group.id, (g) => ({ ...g, research: { status: "pending" } }));
    try {
      const images: string[] = [];
      for (const idx of group.pageIndexes.slice(0, 2)) {
        images.push(await renderPageJpeg(doc, idx + 1, 1500, 0.6));
      }
      const hintText = group.pageIndexes
        .map((i) => result.pages.find((p) => p.index === i)?.rawText || "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 4000);
      const r = await runResearch({
        material_code: group.materialCode,
        description: group.rows.map((x) => x.description).filter(Boolean).join("; "),
        payItems: group.payItems,
        images,
        hintText,
      });
      update(group.id, (g) => ({ ...g, research: r }));
    } catch (e) {
      update(group.id, (g) => ({ ...g, research: { status: "error", error: String(e) } }));
    }
  }

  async function saveRef(source: ResearchSource, refs: string[]) {
    const res = await saveReferenceFromSource(source, refs);
    if (res.ok) setSavedRefs((s) => new Set(s).add(source.url));
  }

  // Apply a research-suggested material code to the whole file + remember it.
  async function applyResearchCode(group: OutputGroup, code: string) {
    const c = code.trim();
    if (!c) return;
    for (const r of group.rows) {
      await upsertCrosswalk({
        pay_item: r.pay_item,
        pay_item_description: r.description,
        material_code: c,
        confidence: 1,
        source: "confirmed",
      });
    }
    update(group.id, (g) => ({
      ...g,
      materialCode: c,
      materialDescription: materialMap.get(c)?.description ?? g.materialDescription,
      rows: g.rows.map((r) => ({ ...r, material_code: c, suggestion: undefined, flag: undefined })),
    }));
  }

  // Create a brand-new output file from a single (uncategorized) page.
  function createGroupFromPage(idx: number) {
    const page = result.pages.find((p) => p.index === idx);
    const payItems = [...new Set(page?.payItems ?? [])].sort((a, b) => orderOf(a) - orderOf(b));
    const rows = payItems.map((pi) => newRow(pi));
    const newGroup: OutputGroup = {
      id: `g_new_${idx}_${groups.length}`,
      materialCode: rows.find((r) => r.material_code)?.material_code ?? null,
      materialDescription: rows.length ? "Material" : "New file",
      payItems,
      pageIndexes: [idx],
      filename: fileName(payItems),
      status: "pending",
      rows,
    };
    setGroups((gs) => [
      ...gs.map((g) => (g.pageIndexes.includes(idx) ? { ...g, pageIndexes: g.pageIndexes.filter((i) => i !== idx) } : g)),
      newGroup,
    ]);
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

  const folderName = safeName(`${contract || "CONTRACT"}_${date || "DATE"}`);

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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Project</span>
                <input
                  value={contract}
                  onChange={(e) => applyProjectDate(e.target.value, date)}
                  placeholder="62P93"
                  className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-sm font-semibold text-ink focus:border-brand-400"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Date</span>
                <input
                  value={date}
                  onChange={(e) => applyProjectDate(contract, e.target.value)}
                  placeholder="062226"
                  className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-sm font-semibold text-ink focus:border-brand-400"
                />
              </label>
              <SaveBadge state={saveState} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              Applies to every file · {groups.length} files · {confirmedCount} confirmed · auto-saved
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

      {/* Review tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-1.5">
        <button
          onClick={() => setReviewTab("files")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            reviewTab === "files" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink"
          }`}
        >
          <FileIcon width={15} height={15} /> Files
        </button>
        <button
          onClick={() => setReviewTab("pages")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            reviewTab === "pages" ? "bg-slate-100 text-ink" : "text-ink-faint hover:text-ink"
          }`}
        >
          <GridIcon width={15} height={15} /> All pages
          <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-ink-soft">
            {result.pages.length}
          </span>
        </button>
      </div>

      {reviewTab === "pages" ? (
        <AllPagesGrid
          pages={result.pages}
          coverIndex={result.coverIndex}
          groups={groups}
          contract={contract}
          date={date}
          missingPayItems={missingPayItems}
          coverMap={coverMap}
          onView={(idx) => setLightbox({ index: idx, assign: false })}
          onAssignGroup={(idx, gid) => addPageExclusive(gid, idx)}
          onAssignPayItem={(idx, pi) => createGroupForPayItem(pi, idx)}
          onNewFile={(idx) => createGroupFromPage(idx)}
          onUnassign={(idx) => unassignPage(idx)}
          onSelectFile={(gid) => {
            setSelectedId(gid);
            setReviewTab("files");
          }}
        />
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
        {/* File list */}
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50/60 p-3">
          {missingPayItems.length > 0 && (
            <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertIcon width={13} height={13} /> {missingPayItems.length} pay item{missingPayItems.length > 1 ? "s have" : " has"} no certs yet
              </div>
              <div className="mt-1 font-mono text-[11px] leading-relaxed">{missingPayItems.join(", ")}</div>
              <div className="mt-1 text-[11px] text-amber-700">
                {unassigned.length > 0
                  ? "Assign an uncategorized page below to one of these instead of making a new file."
                  : unrecognizedPayItems.length > 0
                    ? "No loose pages — these were likely read under a wrong number (see below). Open that split, delete the wrong pay-item row, and add the correct one."
                    : "No cert pages were found for these in the packet. Add the pay item to the right file once you locate its cert."}
              </div>
            </div>
          )}
          {unrecognizedPayItems.length > 0 && (
            <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertIcon width={13} height={13} /> {unrecognizedPayItems.length} pay item{unrecognizedPayItems.length > 1 ? "s aren't" : " isn't"} on the cover
              </div>
              <div className="mt-1 font-mono text-[11px] leading-relaxed">{unrecognizedPayItems.join(", ")}</div>
              <div className="mt-1 text-[11px] text-rose-600">
                Probably a misread of a missing pay item above — open the file, fix the pay-item row.
              </div>
            </div>
          )}
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
                    <span className="chip bg-emerald-100 text-emerald-700" title="Confirmed">
                      <LockIcon width={11} height={11} /> confirmed
                    </span>
                  ) : (
                    <span className="chip bg-emerald-50 text-emerald-600" title="Read & ready — confirm to lock">
                      <CheckIcon width={12} height={12} /> ready
                    </span>
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
                These didn’t match a pay item box. Assign each to a file — or to a pay item from the cover
                that’s still missing its certs.
              </p>
              <div className="flex flex-col gap-2">
                {unassigned.map((p) => (
                  <div key={p.index} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5">
                    <button
                      onClick={() => setLightbox({ index: p.index, assign: true })}
                      title="Click to view full page"
                      className="relative shrink-0"
                    >
                      {p.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt={`page ${p.pageNumber}`} className="h-14 w-11 rounded border border-slate-200 object-cover object-top hover:ring-2 hover:ring-brand-400" />
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 py-0.5 text-center text-[8px] font-medium text-white">view</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-ink">Page {p.pageNumber}</div>
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__new__") createGroupFromPage(p.index);
                          else if (v.startsWith("pi:")) createGroupForPayItem(v.slice(3), p.index);
                          else if (v) addPage(v, p.index);
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] focus:border-brand-400"
                      >
                        <option value="">Assign to…</option>
                        {groups.length > 0 && (
                          <optgroup label="Existing files">
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.filename}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {missingPayItems.length > 0 && (
                          <optgroup label="Missing certs for pay item">
                            {missingPayItems.map((pi) => (
                              <option key={pi} value={`pi:${pi}`}>
                                {pi} — {coverMap.get(pi)?.description || ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
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
                      <th className="px-4 py-2.5 font-semibold">Material code</th>
                      <th className="px-4 py-2.5 font-semibold">Pay item</th>
                      <th className="px-4 py-2.5 font-semibold">Description</th>
                      <th className="px-2 py-2.5"></th>
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
                            <select
                              value={row.material_code ?? ""}
                              onChange={(e) => setRowMaterial(selected.id, row.pay_item, e.target.value)}
                              className={`w-full max-w-[180px] rounded-lg border px-2 py-1.5 font-mono text-xs focus:border-brand-400 ${
                                row.material_code ? "border-slate-200 text-ink" : "border-amber-300 bg-amber-50 text-amber-700"
                              }`}
                            >
                              <option value="">Select…</option>
                              {materials.map((m) => (
                                <option key={m.material_code} value={m.material_code}>
                                  {m.material_code} — {m.description}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 font-mono text-ink-soft">
                            {row.pay_item}
                            {!coverSet.has(row.pay_item) && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                                <AlertIcon width={10} height={10} /> not on cover
                              </div>
                            )}
                          </td>
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
                          <td className="px-2 py-3 text-right align-top">
                            <button
                              onClick={() => deletePayItemRow(selected.id, row.pay_item)}
                              title="Remove this pay item from the file"
                              className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <TrashIcon width={14} height={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Add a pay item to this file */}
                <AddPayItemRow
                  options={result.coverRows
                    .map((r) => r.pay_item)
                    .filter((pi) => !selected.payItems.includes(pi))}
                  coverMap={coverMap}
                  onAdd={(pi) => addPayItemRow(selected.id, pi)}
                />
              </div>

              {/* Research panel */}
              <ResearchPanel
                group={selected}
                keyAvailable={keyAvailable}
                savedRefs={savedRefs}
                onRun={() => runGroupResearch(selected)}
                onApplyCode={(code) => applyResearchCode(selected, code)}
                onSaveRef={(src) => saveRef(src, [selected.materialCode ?? "", ...selected.payItems].filter(Boolean))}
                onDiscuss={() => onChallenge(selected)}
              />

              {/* Assigned pages (reassignment) */}
              <div className="card mb-4 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <PageIcon width={16} height={16} className="text-brand-600" /> Pages in this file
                    <span className="text-xs font-normal text-ink-faint">(cover added automatically)</span>
                  </div>
                  <button className="btn-subtle px-3 py-1.5 text-xs" onClick={() => setEditingPages(true)}>
                    <PlusIcon width={14} height={14} /> Add / edit pages
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {selected.pageIndexes.map((idx) => {
                    const pg = result.pages.find((p) => p.index === idx);
                    return (
                      <div key={idx} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <button onClick={() => setLightbox({ index: idx, assign: false })} title="Click to view full page">
                          {pg?.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={pg.thumbnail} alt={`page ${idx + 1}`} className="h-28 w-full object-cover object-top hover:opacity-90" />
                          )}
                        </button>
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
                      No cert pages assigned. Use “Add / edit pages” to choose pages.
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
      )}

      {/* Full-page lightbox */}
      <PageLightbox
        doc={doc}
        index={lightbox?.index ?? null}
        title={lightbox ? `Page ${lightbox.index + 1}` : undefined}
        onClose={() => setLightbox(null)}
        actions={
          lightbox?.assign ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/80">Assign to file:</span>
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    addPageExclusive(g.id, lightbox.index);
                    setSelectedId(g.id);
                    setLightbox(null);
                  }}
                  className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600"
                >
                  {g.filename}
                </button>
              ))}
              {missingPayItems.length > 0 && (
                <>
                  <span className="ml-1 text-xs text-amber-300">or missing pay item:</span>
                  {missingPayItems.map((pi) => (
                    <button
                      key={pi}
                      onClick={() => {
                        createGroupForPayItem(pi, lightbox.index);
                        setLightbox(null);
                      }}
                      className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-600"
                    >
                      {pi}
                    </button>
                  ))}
                </>
              )}
              <button
                onClick={() => {
                  createGroupFromPage(lightbox.index);
                  setLightbox(null);
                }}
                className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
              >
                ＋ New file
              </button>
            </div>
          ) : (
            selected && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/80">Move this page to:</span>
                {groups
                  .filter((g) => g.id !== selectedId)
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => {
                        addPageExclusive(g.id, lightbox!.index);
                        setLightbox(null);
                      }}
                      className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600"
                    >
                      {g.filename}
                    </button>
                  ))}
              </div>
            )
          )
        }
      />

      {/* Add / edit pages modal */}
      {editingPages && selected && (
        <PageManager
          groupName={selected.filename}
          pages={result.pages.filter((p) => !p.isCoverSheet && p.index !== result.coverIndex)}
          assignedHere={new Set(selected.pageIndexes)}
          assignedElsewhere={(idx) => groups.some((g) => g.id !== selectedId && g.pageIndexes.includes(idx))}
          onToggle={(idx, on) => (on ? addPageExclusive(selectedId, idx) : removePage(selectedId, idx))}
          onView={(idx) => setLightbox({ index: idx, assign: false })}
          onClose={() => setEditingPages(false)}
        />
      )}
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

const VERDICT_STYLE: Record<string, { chip: string; label: string }> = {
  match: { chip: "bg-emerald-50 text-emerald-700", label: "Matches" },
  mismatch: { chip: "bg-rose-50 text-rose-700", label: "Possible mismatch" },
  unclear: { chip: "bg-amber-50 text-amber-700", label: "Unclear" },
};

function ResearchPanel({
  group,
  keyAvailable,
  savedRefs,
  onRun,
  onApplyCode,
  onSaveRef,
  onDiscuss,
}: {
  group: OutputGroup;
  keyAvailable: boolean;
  savedRefs: Set<string>;
  onRun: () => void;
  onApplyCode: (code: string) => void;
  onSaveRef: (src: ResearchSource) => void;
  onDiscuss: () => void;
}) {
  const r = group.research;
  const v = r?.verdict ? VERDICT_STYLE[r.verdict] : null;
  return (
    <div className="card mb-4 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GlobeIcon width={16} height={16} className="text-brand-600" /> Research
          {v && <span className={`chip ${v.chip}`}>{v.label}</span>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-subtle px-3 py-1.5 text-xs"
            disabled={!keyAvailable}
            onClick={onDiscuss}
            title="Chat with Claude about these findings right now"
          >
            <ChatIcon width={14} height={14} /> Discuss
          </button>
          <button
            className="btn-subtle px-3 py-1.5 text-xs"
            disabled={!keyAvailable || r?.status === "pending"}
            onClick={onRun}
            title={keyAvailable ? "Verify against the cert + manufacturer datasheet" : "Link an API key to use research"}
          >
            <SearchIcon width={14} height={14} />
            {r?.status === "pending" ? "Researching…" : r ? "Re-research" : "Research this material"}
          </button>
        </div>
      </div>

      {!r && (
        <p className="text-xs text-ink-faint">
          Checks the pay-item description against the cert and the manufacturer’s datasheet (found online),
          and flags any disagreement — e.g. a “2C” description whose datasheet shows a single conductor.
        </p>
      )}

      {r?.status === "pending" && (
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
          Reading the certs and searching manufacturer datasheets…
        </div>
      )}

      {r?.status === "error" && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{r.error}</div>
      )}

      {r?.status === "done" && (
        <div className="space-y-3">
          {r.summary && <p className="text-sm text-ink-soft">{r.summary}</p>}

          {r.suggestedCode && r.suggestedCode !== group.materialCode && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5">
              <SparkIcon width={14} height={14} className="text-brand-600" />
              <span className="text-xs text-ink-soft">
                Research suggests material code <b>{r.suggestedCode}</b> (currently {group.materialCode ?? "none"}).
              </span>
              <button
                className="ml-auto rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                onClick={() => onApplyCode(r.suggestedCode!)}
              >
                Apply &amp; remember
              </button>
            </div>
          )}

          {r.sources && r.sources.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Manufacturer sources
              </div>
              <div className="space-y-1.5">
                {r.sources.map((s) => (
                  <div key={s.url} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <LinkIcon width={13} height={13} className="shrink-0 text-ink-faint" />
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-xs text-brand-700 hover:underline"
                      title={s.url}
                    >
                      {s.title}
                      {s.isPdf && <span className="ml-1 rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700">PDF</span>}
                    </a>
                    {savedRefs.has(s.url) ? (
                      <span className="chip bg-emerald-50 text-emerald-700">
                        <CheckIcon width={11} height={11} /> saved
                      </span>
                    ) : (
                      <button
                        className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-brand-600 hover:text-white"
                        onClick={() => onSaveRef(s)}
                      >
                        Save to references
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageManager({
  groupName,
  pages,
  assignedHere,
  assignedElsewhere,
  onToggle,
  onView,
  onClose,
}: {
  groupName: string;
  pages: { index: number; pageNumber: number; thumbnail?: string; payItems: string[] }[];
  assignedHere: Set<number>;
  assignedElsewhere: (idx: number) => boolean;
  onToggle: (idx: number, on: boolean) => void;
  onView: (idx: number) => void;
  onClose: () => void;
}) {
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

function AddPayItemRow({
  options,
  coverMap,
  onAdd,
}: {
  options: string[];
  coverMap: Map<string, CoverRow>;
  onAdd: (pi: string) => void;
}) {
  const [val, setVal] = useState("");
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2.5">
      <PlusIcon width={14} height={14} className="shrink-0 text-ink-faint" />
      <select
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-brand-400"
      >
        <option value="">Add a pay item from the cover…</option>
        {options.map((pi) => (
          <option key={pi} value={pi}>
            {pi} — {coverMap.get(pi)?.description || ""}
          </option>
        ))}
      </select>
      <button
        disabled={!val}
        onClick={() => {
          onAdd(val);
          setVal("");
        }}
        className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
      >
        Add
      </button>
    </div>
  );
}

/** Big overview of every page with one-tap assignment to a file / pay item. */
function AllPagesGrid({
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
}: {
  pages: { index: number; pageNumber: number; thumbnail?: string; payItems: string[]; isCoverSheet: boolean }[];
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
}) {
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
