"use client";

import { useRef, useState } from "react";
import { UploadIcon, FileIcon, ShieldIcon, SparkIcon } from "./Icons";

interface Props {
  research: boolean;
  setResearch: (v: boolean) => void;
  aiRead: boolean;
  setAiRead: (v: boolean) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  serverKey: boolean;
  onRun: (file: File) => void;
}

export default function UploadView({
  research,
  setResearch,
  aiRead,
  setAiRead,
  apiKey,
  setApiKey,
  serverKey,
  onRun,
}: Props) {
  const keyReady = serverKey || !!apiKey;
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (f && f.type === "application/pdf") setFile(f);
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-in px-5 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Split an inspection packet</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-faint">
          Drop in the full packet. The tool reads the cover sheet and the pay-item box on each cert,
          then builds one clean PDF per material — cover sheet on top, matched certs underneath.
        </p>
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
            <div className="text-base font-semibold text-ink">Drop your packet PDF here</div>
            <div className="mt-1 text-sm text-ink-faint">or click to browse</div>
          </>
        )}
      </label>

      {/* Options */}
      <div className="card mt-6 divide-y divide-slate-100">
        <Toggle
          icon={<SparkIcon className="text-brand-600" />}
          title="Research mode"
          desc="Sanity-check assigned material codes against what the cert describes (e.g. conductor count), and flag mismatches. Confirmed rows are never auto-flagged."
          checked={research}
          onChange={setResearch}
        />
        <Toggle
          icon={<ShieldIcon className="text-emerald-600" />}
          title="Let Claude read the cover & scanned pages"
          desc="Reads the cover sheet for accurate quantities + date, and OCRs any scanned/image-only cert page with the most capable model. One page image at a time — text-layer cert pages stay on this machine."
          checked={aiRead}
          onChange={setAiRead}
        />
        {aiRead && !serverKey && (
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
              Stored only in this browser (localStorage). Used to read the cover sheet and scanned pages.
            </p>
          </div>
        )}
        {aiRead && serverKey && (
          <div className="px-5 py-3 text-xs text-emerald-700">
            Anthropic API is linked on this deployment — no key needed.
          </div>
        )}
      </div>

      <button
        className="btn-primary mt-6 w-full py-3 text-base"
        disabled={!file}
        onClick={() => file && onRun(file)}
      >
        Split packet
      </button>
      {aiRead && !keyReady && (
        <p className="mt-2 text-center text-xs text-amber-600">
          No API key linked yet — Claude reading needs one for the cover sheet & scanned pages.
          Add a key above, or it’ll run locally on the text layer only.
        </p>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-ink-faint">
        <ShieldIcon width={14} height={14} className="text-emerald-600" />
        Local-first: PDF reading, splitting, and your master data never leave this machine.
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
