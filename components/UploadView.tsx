"use client";

import { useRef, useState } from "react";
import type { SplitterKind } from "@/lib/types";
import { UploadIcon, FileIcon, ShieldIcon, SparkIcon, SplitIcon, PageIcon } from "./Icons";

interface Props {
  kind: SplitterKind;
  setKind: (k: SplitterKind) => void;
  research: boolean;
  setResearch: (v: boolean) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  serverKey: boolean;
  onRun: (file: File) => void;
}

const KIND_COPY: Record<SplitterKind, { title: string; desc: string }> = {
  cert: {
    title: "Split an inspection packet",
    desc:
      "Drop in the full packet. The tool reads the cover sheet and the pay-item box on each cert, " +
      "then builds one clean PDF per material — cover sheet on top, matched certs underneath.",
  },
  la15: {
    title: "Split an LA-15 packet",
    desc:
      "Drop in the full LA-15 document. The tool reads the ticket number off every page and builds " +
      "one PDF per page, named by that page's ticket number.",
  },
};

export default function UploadView({
  kind,
  setKind,
  research,
  setResearch,
  apiKey,
  setApiKey,
  serverKey,
  onRun,
}: Props) {
  const keyReady = serverKey || !!apiKey;
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = KIND_COPY[kind];

  function pick(f: File | null) {
    if (f && f.type === "application/pdf") setFile(f);
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-in px-5 py-10">
      <div className="mb-6 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setKind("cert")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              kind === "cert" ? "bg-white text-ink shadow-sm" : "text-ink-faint hover:text-ink"
            }`}
          >
            <SplitIcon width={15} height={15} /> Cert Splitter
          </button>
          <button
            onClick={() => setKind("la15")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              kind === "la15" ? "bg-white text-ink shadow-sm" : "text-ink-faint hover:text-ink"
            }`}
          >
            <PageIcon width={15} height={15} /> LA-15 Splitter
          </button>
        </div>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{copy.title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-faint">{copy.desc}</p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition
          ${dragging ? "border-brand-400 bg-brand-50" : "border-slate-300 bg-white hover:border-brand-300 hover:bg-slate-50"}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <div
          className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl transition
            ${dragging ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600 group-hover:scale-105"}`}
        >
          <UploadIcon width={26} height={26} />
        </div>
        {file ? (
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <FileIcon className="text-brand-600" /> {file.name}
            <span className="text-ink-faint">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
          </div>
        ) : (
          <>
            <div className="text-base font-semibold text-ink">
              {kind === "la15" ? "Drop your LA-15 PDF here" : "Drop your packet PDF here"}
            </div>
            <div className="mt-1 text-sm text-ink-faint">or click to browse</div>
          </>
        )}
      </label>

      {/* Options */}
      <div className="card mt-6 divide-y divide-slate-100">
        {kind === "cert" && (
          <Toggle
            icon={<SparkIcon className="text-brand-600" />}
            title="Research mode"
            desc="After splitting, Claude verifies each material against the cert and the pay-item description, web-searches the manufacturer's datasheet (Service Wire, Advanced Digital Cable, …), and flags any disagreement. Found datasheets can be saved to your reference library."
            checked={research}
            onChange={setResearch}
          />
        )}
        {!serverKey && (
          <div className="px-5 py-4">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Anthropic API key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-mono placeholder:text-slate-400 focus:border-brand-400"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Stored only in this browser (localStorage). Powers cover reading, scanned-page OCR, research, and challenges.
            </p>
          </div>
        )}
        {serverKey && (
          <div className="px-5 py-3 text-xs text-emerald-700">
            Anthropic API is linked — Claude steps in automatically when a page needs more than the text layer.
          </div>
        )}
      </div>

      <button
        className="btn-primary mt-6 w-full py-3 text-base"
        disabled={!file}
        onClick={() => file && onRun(file)}
      >
        {kind === "la15" ? "Split LA-15 packet" : "Split packet"}
      </button>
      {!keyReady && (
        <p className="mt-2 text-center text-xs text-amber-600">
          {kind === "la15"
            ? "No API key linked — the tool reads the text layer locally. Add a key so pages without a text layer (scans) can still have their ticket number read."
            : "No API key linked — the tool reads the text layer locally. Add a key for accurate quantities on messy/scanned packets, research, and challenges."}
        </p>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint">
        <ShieldIcon width={14} height={14} className="text-emerald-600" />
        Reads what it can locally first; Claude steps in automatically only when a page needs more power.
      </p>
    </div>
  );
}

function Toggle({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-ink-faint">{desc}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand-600" : "bg-slate-300"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}
