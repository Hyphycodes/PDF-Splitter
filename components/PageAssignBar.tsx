"use client";

import { useState } from "react";
import type { OutputGroup, CoverRow } from "@/lib/types";
import { CheckIcon, AlertIcon, PlusIcon } from "./Icons";

interface Props {
  pageIndex: number;
  isCover: boolean;
  groups: OutputGroup[];
  currentGroup: OutputGroup | null;
  missingPayItems: string[];
  coverPayItems: string[];
  coverMap: Map<string, CoverRow>;
  onAssign: (gid: string) => void;
  onAssignPayItem: (pi: string) => void;
  onNewFile: () => void;
  onUnassign: () => void;
  onAddPayItem: (gid: string, pi: string) => void;
  onRemovePayItem: (gid: string, pi: string) => void;
}

export default function PageAssignBar({
  isCover,
  groups,
  currentGroup,
  missingPayItems,
  coverPayItems,
  coverMap,
  onAssign,
  onAssignPayItem,
  onNewFile,
  onUnassign,
  onAddPayItem,
  onRemovePayItem,
}: Props) {
  const [addPi, setAddPi] = useState("");

  if (isCover) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="chip bg-brand-50 text-brand-700">Cover sheet</span>
        Included automatically at the top of every output file.
      </div>
    );
  }

  const addable = coverPayItems.filter((pi) => !currentGroup?.payItems.includes(pi));

  return (
    <div className="space-y-3">
      {/* Current assignment */}
      <div className="flex items-center gap-2 text-sm">
        {currentGroup ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
            <CheckIcon width={14} height={14} /> In file
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
            <AlertIcon width={14} height={14} /> Not assigned
          </span>
        )}
        {currentGroup && <span className="truncate font-mono text-xs text-ink-faint">{currentGroup.filename}</span>}
      </div>

      {/* Single big dropdown to assign / move */}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Assign this page to
        </label>
        <select
          value={currentGroup?.id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onUnassign();
            else if (v === "__new__") onNewFile();
            else if (v.startsWith("pi:")) onAssignPayItem(v.slice(3));
            else onAssign(v);
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-brand-400"
        >
          <option value="">— Unassigned —</option>
          {groups.length > 0 && (
            <optgroup label="Files">
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.payItems.join(" · ") || g.filename}
                </option>
              ))}
            </optgroup>
          )}
          {missingPayItems.length > 0 && (
            <optgroup label="Pay items still missing certs (creates a file)">
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

      {/* Pay items on this file — add the ones the box also lists */}
      {currentGroup && (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Pay items in this file
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {currentGroup.payItems.map((pi) => (
              <span key={pi} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 font-mono text-xs text-ink">
                {pi}
                <button
                  onClick={() => onRemovePayItem(currentGroup.id, pi)}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                  title="Remove from this file"
                >
                  ×
                </button>
              </span>
            ))}
            {addable.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <select
                  value={addPi}
                  onChange={(e) => setAddPi(e.target.value)}
                  className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1 text-xs focus:border-brand-400"
                >
                  <option value="">+ add pay item…</option>
                  {addable.map((pi) => (
                    <option key={pi} value={pi}>
                      {pi} — {coverMap.get(pi)?.description || ""}
                    </option>
                  ))}
                </select>
                {addPi && (
                  <button
                    onClick={() => {
                      onAddPayItem(currentGroup.id, addPi);
                      setAddPi("");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    <PlusIcon width={12} height={12} /> add
                  </button>
                )}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">Adding a pay item links this file to it and updates the file name.</p>
        </div>
      )}
    </div>
  );
}
