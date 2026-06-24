"use client";

import type { OutputGroup, ResearchSource } from "@/lib/types";
import { GlobeIcon, ChatIcon, SearchIcon, SparkIcon, LinkIcon, CheckIcon } from "./Icons";

const VERDICT_STYLE: Record<string, { chip: string; label: string }> = {
  match: { chip: "bg-emerald-50 text-emerald-700", label: "Matches" },
  mismatch: { chip: "bg-rose-50 text-rose-700", label: "Possible mismatch" },
  unclear: { chip: "bg-amber-50 text-amber-700", label: "Unclear" },
};

interface Props {
  group: OutputGroup;
  keyAvailable: boolean;
  savedRefs: Set<string>;
  onRun: () => void;
  onApplyCode: (code: string) => void;
  onSaveRef: (src: ResearchSource) => void;
  onDiscuss: () => void;
}

export default function ResearchPanel({ group, keyAvailable, savedRefs, onRun, onApplyCode, onSaveRef, onDiscuss }: Props) {
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
