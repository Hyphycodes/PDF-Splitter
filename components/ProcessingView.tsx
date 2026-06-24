"use client";

import type { ProgressEvent } from "@/lib/pipeline";

export default function ProcessingView({ progress }: { progress: ProgressEvent | null }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="mx-auto flex max-w-md animate-fade-in flex-col items-center px-5 py-24 text-center">
      <div className="relative mb-7 h-16 w-16">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-brand-600" />
      </div>
      <h2 className="text-lg font-semibold text-ink">{progress?.phase ?? "Working…"}</h2>
      <p className="mt-1 text-sm text-ink-faint">
        {progress ? `${progress.current} of ${progress.total}` : "Preparing"}
      </p>
      <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-4 text-xs text-ink-faint">Reading the text layer locally — nothing is uploaded.</p>
    </div>
  );
}
