"use client";

import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { La15Result, TicketGroup } from "@/lib/types";
import { buildGroupPdf, buildZip, downloadBytes, triggerDownload, safeName } from "@/lib/build";
import { la15FileName } from "@/lib/la15";
import PageLightbox from "./PageLightbox";
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

  function rotateGroup(groupId: string, delta: -90 | 90) {
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, rotation: (((g.rotation ?? 0) + delta) % 360 + 360) % 360 } : g))
    );
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
                  value={projectName}
                  onChange={(e) => onRenameProject(e.target.value)}
                  placeholder="LA15_batch"
                  className="w-40 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-sm font-semibold text-ink focus:border-brand-400"
                />
              </label>
              <SaveBadge state={saveState} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {groups.length} page{groups.length === 1 ? "" : "s"} → {groups.length} file
              {groups.length === 1 ? "" : "s"}
              {needsReviewCount > 0 && ` · ${needsReviewCount} need a ticket number`}
              {" · auto-saved"}
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

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {groups.map((g) => {
              const page = pageOf.get(g.pageIndexes[0]);
              const needsReview = !g.ticketNumber;
              return (
                <div key={g.id} className={`card overflow-hidden ${needsReview ? "ring-1 ring-amber-300" : ""}`}>
                  <div className="relative h-40 w-full overflow-hidden border-b border-slate-100 bg-slate-50">
                    <button
                      onClick={() => setLightbox({ index: g.pageIndexes[0] })}
                      className="flex h-full w-full items-center justify-center"
                      title="Click to view full page"
                    >
                      {page?.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={page.thumbnail}
                          alt={`page ${page.pageNumber}`}
                          style={{ transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined }}
                          className="max-h-full max-w-full object-contain hover:opacity-90"
                        />
                      )}
                    </button>
                    <div className="absolute right-1.5 top-1.5 flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          rotateGroup(g.id, -90);
                        }}
                        title="Rotate left"
                        className="rounded-md bg-white/90 p-1 text-ink-faint shadow-sm hover:bg-white hover:text-ink"
                      >
                        <RotateCcwIcon width={13} height={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          rotateGroup(g.id, 90);
                        }}
                        title="Rotate right"
                        className="rounded-md bg-white/90 p-1 text-ink-faint shadow-sm hover:bg-white hover:text-ink"
                      >
                        <RotateCwIcon width={13} height={13} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      <PageIcon width={12} height={12} /> Page {page?.pageNumber ?? g.pageIndexes[0] + 1}
                    </span>
                    {needsReview ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertIcon width={11} height={11} /> needs review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckIcon width={11} height={11} /> read
                      </span>
                    )}
                  </div>
                  <div className="px-3 pb-2 pt-1.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                      Ticket number
                    </label>
                    <input
                      value={g.ticketNumber ?? ""}
                      onChange={(e) => setTicket(g.id, e.target.value)}
                      placeholder="—"
                      className={`w-full rounded-lg border px-2 py-1.5 font-mono text-sm focus:border-brand-400 ${
                        needsReview ? "border-amber-300 bg-amber-50" : "border-slate-200"
                      }`}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
                    <input
                      value={g.filename}
                      onChange={(e) => setFilename(g.id, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] focus:border-brand-400"
                    />
                    <button
                      onClick={() => downloadOne(g)}
                      disabled={building}
                      title="Download this file"
                      className="shrink-0 rounded-md p-1.5 text-ink-faint hover:bg-slate-100 hover:text-ink"
                    >
                      <DownloadIcon width={14} height={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {groups.length === 0 && (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-16 text-sm text-ink-faint">
                <FileIcon width={16} height={16} /> No pages found in this PDF.
              </div>
            )}
          </div>
        </div>
      </main>

      <PageLightbox
        doc={doc}
        index={lightbox?.index ?? null}
        title={lightbox ? `Page ${lightbox.index + 1}` : undefined}
        subtitle={lightboxGroup?.ticketNumber ?? "No ticket number read"}
        onClose={() => setLightbox(null)}
        onPrev={() => navLightbox(-1)}
        onNext={() => navLightbox(1)}
        hasPrev={lightbox ? allPageIndexes.indexOf(lightbox.index) > 0 : false}
        hasNext={lightbox ? allPageIndexes.indexOf(lightbox.index) < allPageIndexes.length - 1 : false}
        rotation={lightboxGroup?.rotation ?? 0}
        actions={
          lightboxGroup && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">Rotation: {lightboxGroup.rotation}°</span>
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateGroup(lightboxGroup.id, -90)}>
                  <RotateCcwIcon width={14} height={14} /> Rotate left
                </button>
                <button className="btn-ghost px-3 py-1.5" onClick={() => rotateGroup(lightboxGroup.id, 90)}>
                  <RotateCwIcon width={14} height={14} /> Rotate right
                </button>
              </div>
            </div>
          )
        }
      />
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
