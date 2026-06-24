"use client";

import type { Inspection } from "@/lib/types";
import { FileIcon, TrashIcon, HistoryIcon, CheckIcon } from "./Icons";

interface Props {
  inspections: Inspection[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function fmt(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function HistoryView({ inspections, onOpen, onDelete }: Props) {
  return (
    <div className="mx-auto max-w-4xl animate-fade-in px-5 py-7">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Inspection history</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Every split is saved locally as one inspection — reopen any of them to reference the files,
          quantities, and matches. Edits you confirm carry forward.
        </p>
      </div>

      {inspections.length === 0 ? (
        <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <HistoryIcon width={24} height={24} />
          </div>
          <div className="text-sm font-semibold text-ink">No inspections yet</div>
          <div className="mt-1 text-sm text-ink-faint">Split a packet and it’ll be saved here automatically.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {inspections.map((insp) => (
            <div
              key={insp.id}
              className="card flex items-center gap-4 p-4 transition hover:shadow-float"
            >
              <button onClick={() => onOpen(insp.id)} className="flex flex-1 items-center gap-4 text-left">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <FileIcon width={22} height={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{insp.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
                    <span className="font-mono">{insp.contract || "contract ?"}</span>
                    <span>·</span>
                    <span>{insp.date || "date ?"}</span>
                    <span>·</span>
                    <span>{insp.fileCount} files</span>
                    <span>·</span>
                    <span>{insp.pageCount} pages</span>
                    {insp.confirmedCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-600">
                        <CheckIcon width={12} height={12} /> {insp.confirmedCount} confirmed
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden shrink-0 text-xs text-ink-faint sm:block">{fmt(insp.updated_at)}</div>
              </button>
              <button
                onClick={() => onDelete(insp.id)}
                title="Delete inspection"
                className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <TrashIcon width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
