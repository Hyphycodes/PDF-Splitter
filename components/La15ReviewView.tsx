"use client";

import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { La15Result, TicketGroup } from "@/lib/types";
import { buildGroupPdf, buildZip, downloadBytes, triggerDownload, safeName } from "@/lib/build";
import { la15FileName } from "@/lib/la15";
import PageLightbox from "./PageLightbox";
import RotatablePage from "./RotatablePage";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  FileIcon,
  PageIcon,
  RotateCcwIcon,
  RotateCwIcon,
} from "./Icons";

type Filter = "all" | "review";
const norm = (deg: number) => (((deg % 360) + 360) % 360);

type SaveState = "idle" | "saving" | "saved";

interface Props {
  result: La15Result;
  doc: PDFDocumentProxy | null;
  sourceBytes: ArrayBuffer;
  projectName: string;
  onRenameProject: (name: string) => void;
  saveState: SaveState;
  onReset: () => void;
  onGroupsChange?: (groups: TicketGroup[]) => void;
}

export default function La15ReviewView({
  result,
  doc,
  sourceBytes,
  projectName,
  onRenameProject,
  saveState,
  onReset,
  onGroupsChange,
}: Props) {
  const [groups, setGroups] = useState<TicketGroup[]>(result.groups);
  const [building, setBuilding] = useState(false);
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [cardSize, setCardSize] = useState(230);

  // Reset local state when a different LA-15 run is opened.
  useEffect(() => {
    setGroups(result.groups);
  }, [result]);

  useEffect(() => {
    onGroupsChange?.(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const pageOf = useMemo(() => new Map(result.pages.map((p) => [p.index, p])), [result.pages]);
  const allPageIndexes = useMemo(() => result.pages.map((p) => p.index), [result.pages]);
  const needsReviewCount = groups.filter((g) => !g.ticketNumber).length;
  const adjustedCount = groups.filter((g) => norm(g.rotation ?? 0) !== norm(pageOf.get(g.pageIndexes[0])?.rotation ?? 0)).length;
  const visibleGroups = filter === "review" ? groups.filter((g) => !g.ticketNumber) : groups;
  const lightboxGroup = useMemo(
    () => (lightbox ? groups.find((g) => g.pageIndexes.includes(lightbox.index)) : undefined),
    [groups, lightbox]
  );

  function setTicket(groupId: string, value: string) {
    setGroups((gs) =>
      gs.map((g) => {
        if (g.id !== groupId) return g;
        const ticketNumber = value.trim() ? value.trim().toUpperCase() : null;
        const page = pageOf.get(g.pageIndexes[0]);
        const filename = la15FileName(ticketNumber, page?.pageNumber ?? g.pageIndexes[0] + 1);
        return { ...g, ticketNumber, filename };
      })
    );
  }

  function setFilename(groupId: string, filename: string) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, filename } : g)));
  }

  function rotateGroup(groupId: string, delta: -90 | 90 | 180) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, rotation: norm((g.rotation ?? 0) + delta) } : g)));
  }

  function rotateAll(delta: -90 | 90 | 180) {
    setGroups((gs) => gs.map((g) => ({ ...g, rotation: norm((g.rotation ?? 0) + delta) })));
  }

  /** Back to the orientation detected when the packet was read. */
  function resetGroup(groupId: string) {
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, rotation: pageOf.get(g.pageIndexes[0])?.rotation ?? 0 } : g))
    );
  }

  function resetAll() {
    setGroups((gs) => gs.map((g) => ({ ...g, rotation: pageOf.get(g.pageIndexes[0])?.rotation ?? 0 })));
  }

  async function downloadOne(g: TicketGroup) {
    setBuilding(true);
    try {
      const bytes = await buildGroupPdf(sourceBytes, null, g);
      downloadBytes(bytes, g.filename);
    } finally {
      setBuilding(false);
    }
  }

  const folderName = safeName(projectName || "LA15");

  async function downloadAllZip() {
    if (!groups.length) return;
    setBuilding(true);
    try {
      const blob = await buildZip(sourceBytes, null, groups, folderName);
      triggerDownload(blob, `${folderName}.zip`);
    } finally {
      setBuilding(false);
    }
  }

  function navLightbox(dir: -1 | 1) {
    setLightbox((lb) => {
      if (!lb) return lb;
      const pos = allPageIndexes.indexOf(lb.index);
      const next = allPageIndexes[pos + dir];
      return next === undefined ? lb : { index: next };
    });
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      {/* Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/80 px-5 py-3 backdrop-blur-xl">
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
                  value={projectName}
                  onChange={(e) => onRenameProject(e.target.value)}
                  placeholder="LA15_batch"
                  className="w-36 rounded-lg border sm:w-44 border-slate-200 bg-white px-2.5 py-1 font-mono text-sm font-semibold text-ink focus:border-brand-400"
                />
              </label>
              <SaveBadge state={saveState} />
            </div>
            <div className="mt-1 text-[11px] text-ink-faint">
              {groups.length} page{groups.length === 1 ? "" : "s"} → {groups.length} file
              {groups.length === 1 ? "" : "s"} · auto-saved
            </div>
          </div>
        </div>
        <button
          className="btn-primary shrink-0 shadow-md shadow-brand-600/20"
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

      {/* Toolbar: filter, size, rotate-all */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200/60 bg-slate-50/70 px-5 py-2.5">
        <div className="flex items-center gap-1 rounded-xl bg-slate-200/60 p-1">
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="tabular-nums opacity-60">{groups.length}</span>
          </FilterTab>
          <FilterTab active={filter === "review"} onClick={() => setFilter("review")} warn={needsReviewCount > 0}>
            Needs ticket <span className="tabular-nums opacity-60">{needsReviewCount}</span>
          </FilterTab>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-2 text-ink-faint md:flex" title="Preview size">
            <PageIcon width={12} height={12} />
            <input
              type="range"
              min={170}
              max={380}
              step={10}
              value={cardSize}
              onChange={(e) => setCardSize(Number(e.target.value))}
              aria-label="Preview size"
              className="h-1 w-24 cursor-pointer accent-brand-600"
            />
            <PageIcon width={18} height={18} />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Rotate all</span>
            <ToolButton title="Rotate every page left" onClick={() => rotateAll(-90)} disabled={!groups.length}>
              <RotateCcwIcon width={15} height={15} />
            </ToolButton>
            <ToolButton title="Rotate every page right" onClick={() => rotateAll(90)} disabled={!groups.length}>
              <RotateCwIcon width={15} height={15} />
            </ToolButton>
            <ToolButton title="Flip every page upside-down" onClick={() => rotateAll(180)} disabled={!groups.length}>
              <span className="px-0.5 text-[11px] font-bold">180°</span>
            </ToolButton>
            <span className="mx-0.5 h-5 w-px bg-slate-200" />
            <button
              onClick={resetAll}
              disabled={adjustedCount === 0}
              title="Put every page back to the orientation detected automatically"
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-default disabled:text-ink-faint disabled:opacity-50 disabled:hover:bg-transparent"
            >
              Reset to auto{adjustedCount > 0 && ` (${adjustedCount})`}
            </button>
          </div>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-5 py-6">
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}
          >
            {visibleGroups.map((g, i) => {
              const page = pageOf.get(g.pageIndexes[0]);
              const needsReview = !g.ticketNumber;
              const rotation = norm(g.rotation ?? 0);
              const adjusted = rotation !== norm(page?.rotation ?? 0);
              return (
                <div
                  key={g.id}
                  style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                  className={`group animate-fade-in overflow-hidden rounded-2xl border bg-white shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float ${
                    needsReview ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"
                  }`}
                >
                  <div className="relative aspect-[4/5] w-full bg-gradient-to-b from-slate-100 to-slate-200/70">
                    <button
                      onClick={() => setLightbox({ index: g.pageIndexes[0] })}
                      className="absolute inset-0 block h-full w-full cursor-zoom-in"
                      title="Click to view full page"
                    >
                      {page?.thumbnail && (
                        <RotatablePage
                          src={page.thumbnail}
                          alt={`page ${page.pageNumber}`}
                          rotation={rotation}
                          padding={12}
                          className="h-full w-full"
                          imgClassName="rounded-[3px] shadow-[0_2px_10px_rgba(15,23,42,0.18)]"
                        />
                      )}
                    </button>

                    <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                      <PageIcon width={11} height={11} /> {page?.pageNumber ?? g.pageIndexes[0] + 1}
                    </span>
                    {adjusted && (
                      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                        edited
                      </span>
                    )}

                    {/* hover toolbar */}
                    <div className="absolute inset-x-0 bottom-2.5 flex justify-center opacity-0 transition-all duration-200 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <div className="flex translate-y-1 items-center gap-0.5 rounded-full bg-slate-900/85 p-1 text-white shadow-lg backdrop-blur transition-transform duration-200 group-focus-within:translate-y-0 group-hover:translate-y-0 [@media(hover:none)]:translate-y-0">
                        <OverlayButton title="Rotate left" onClick={() => rotateGroup(g.id, -90)}>
                          <RotateCcwIcon width={15} height={15} />
                        </OverlayButton>
                        <OverlayButton title="Rotate right" onClick={() => rotateGroup(g.id, 90)}>
                          <RotateCwIcon width={15} height={15} />
                        </OverlayButton>
                        {adjusted && (
                          <OverlayButton title="Back to auto orientation" onClick={() => resetGroup(g.id)}>
                            <span className="px-0.5 text-[10px] font-bold">AUTO</span>
                          </OverlayButton>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 p-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                          Ticket number
                        </label>
                        {needsReview ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                            <AlertIcon width={11} height={11} /> needs review
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <CheckIcon width={11} height={11} /> read
                          </span>
                        )}
                      </div>
                      <input
                        value={g.ticketNumber ?? ""}
                        onChange={(e) => setTicket(g.id, e.target.value)}
                        placeholder="Type ticket number"
                        className={`w-full rounded-xl border px-2.5 py-1.5 font-mono text-sm font-semibold placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-brand-400 ${
                          needsReview ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50 focus:bg-white"
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={g.filename}
                        onChange={(e) => setFilename(g.id, e.target.value)}
                        aria-label="File name"
                        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 font-mono text-[11px] text-ink-faint hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:text-ink"
                      />
                      <button
                        onClick={() => downloadOne(g)}
                        disabled={building}
                        title="Download this file"
                        className="shrink-0 rounded-lg p-1.5 text-ink-faint hover:bg-brand-50 hover:text-brand-700"
                      >
                        <DownloadIcon width={15} height={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {groups.length === 0 && (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-16 text-sm text-ink-faint">
                <FileIcon width={16} height={16} /> No pages found in this PDF.
              </div>
            )}
            {groups.length > 0 && visibleGroups.length === 0 && (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 py-16 text-sm text-emerald-700">
                <CheckIcon width={16} height={16} /> Every page has a ticket number.
              </div>
            )}
          </div>
        </div>
      </main>

      <PageLightbox
        doc={doc}
        index={lightbox?.index ?? null}
        title={lightbox ? `Page ${lightbox.index + 1}` : undefined}
        subtitle={lightboxGroup?.ticketNumber ? `Ticket ${lightboxGroup.ticketNumber}` : "No ticket number read"}
        onClose={() => setLightbox(null)}
        onPrev={() => navLightbox(-1)}
        onNext={() => navLightbox(1)}
        hasPrev={lightbox ? allPageIndexes.indexOf(lightbox.index) > 0 : false}
        hasNext={lightbox ? allPageIndexes.indexOf(lightbox.index) < allPageIndexes.length - 1 : false}
        rotation={lightboxGroup?.rotation ?? 0}
        onRotate={lightboxGroup ? (d) => rotateGroup(lightboxGroup.id, d) : undefined}
        actions={
          lightboxGroup && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-ink-faint">
                Rotation <span className="font-mono font-semibold text-ink">{norm(lightboxGroup.rotation)}°</span>
                <span className="ml-2 hidden sm:inline">
                  · press <kbd className="rounded bg-slate-100 px-1 font-mono">R</kbd> to turn right,{" "}
                  <kbd className="rounded bg-slate-100 px-1 font-mono">Shift+R</kbd> left
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateGroup(lightboxGroup.id, -90)}>
                  <RotateCcwIcon width={14} height={14} /> Left
                </button>
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateGroup(lightboxGroup.id, 90)}>
                  <RotateCwIcon width={14} height={14} /> Right
                </button>
                <button className="btn-subtle px-3 py-1.5" onClick={() => resetGroup(lightboxGroup.id)}>
                  Auto
                </button>
                <span className="mx-1 hidden h-8 w-px bg-slate-200 sm:block" />
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateAll(-90)} title="Rotate every page left">
                  <RotateCcwIcon width={14} height={14} /> All
                </button>
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateAll(90)} title="Rotate every page right">
                  <RotateCwIcon width={14} height={14} /> All
                </button>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

function FilterTab({
  active,
  warn,
  onClick,
  children,
}: {
  active: boolean;
  warn?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium ${
        active ? "bg-white text-ink shadow-sm" : warn ? "text-amber-700 hover:text-amber-800" : "text-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-1.5 text-ink-soft hover:bg-brand-50 hover:text-brand-700 active:scale-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function OverlayButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-1.5 hover:bg-white/20 active:scale-90"
    >
      {children}
    </button>
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
