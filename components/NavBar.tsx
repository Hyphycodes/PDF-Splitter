"use client";

import { ShieldIcon, SplitIcon, DatabaseIcon, HistoryIcon, ChatIcon } from "./Icons";

export type View = "split" | "reference" | "history";

interface Props {
  view: View;
  setView: (v: View) => void;
  onOpenChat: () => void;
  materialCount: number;
  inspectionCount: number;
}

const TABS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "split", label: "Split", icon: <SplitIcon width={16} height={16} /> },
  { key: "reference", label: "Reference", icon: <DatabaseIcon width={16} height={16} /> },
  { key: "history", label: "History", icon: <HistoryIcon width={16} height={16} /> },
];

export default function NavBar({ view, setView, onOpenChat, materialCount, inspectionCount }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
        <div className="flex items-center gap-5">
          <button onClick={() => setView("split")} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldIcon width={18} height={18} />
            </div>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-bold text-ink">Cert Splitter</div>
              <div className="text-[11px] text-ink-faint">IDOT electrical · local-first</div>
            </div>
          </button>

          <nav className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  view === t.key ? "bg-white text-ink shadow-sm" : "text-ink-faint hover:text-ink"
                }`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
                {t.key === "history" && inspectionCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700">
                    {inspectionCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-faint md:inline">{materialCount} materials</span>
          <button onClick={onOpenChat} className="btn-primary px-3 py-2">
            <ChatIcon width={16} height={16} />
            <span className="hidden sm:inline">Ask Claude</span>
          </button>
        </div>
      </div>
    </header>
  );
}
