"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ensureSeeded, getAllMaterials } from "@/lib/db";
import { loadPdf } from "@/lib/pdf";
import { runPipeline, type ProgressEvent } from "@/lib/pipeline";
import { getApiKey, setApiKey as persistApiKey } from "@/lib/vision";
import type { MaterialMaster, PipelineResult } from "@/lib/types";
import UploadView from "@/components/UploadView";
import ProcessingView from "@/components/ProcessingView";
import ReviewView from "@/components/ReviewView";
import { ShieldIcon } from "@/components/Icons";

type Stage = "idle" | "processing" | "review" | "error";

export default function AppShell() {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [materials, setMaterials] = useState<MaterialMaster[]>([]);
  const [error, setError] = useState<string>("");

  // Settings
  const [research, setResearch] = useState(false);
  const [useVision, setUseVision] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    ensureSeeded()
      .then(getAllMaterials)
      .then(setMaterials)
      .catch(() => setMaterials([]));
    setApiKey(getApiKey());
  }, []);

  useEffect(() => {
    persistApiKey(apiKey);
  }, [apiKey]);

  async function handleRun(file: File) {
    setStage("processing");
    setProgress(null);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const keep = buf.slice(0); // pristine copy for pdf-lib output building
      const loaded = await loadPdf(buf);
      setDoc(loaded.doc);
      setSourceBytes(keep);

      const res = await runPipeline(loaded.doc, loaded.numPages, {
        research,
        useVision: useVision && !!apiKey,
        filename: file.name,
        onProgress: setProgress,
      });
      setResult(res);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setResult(null);
    setDoc(null);
    setSourceBytes(null);
    setProgress(null);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldIcon width={18} height={18} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-ink">Cert Splitter</div>
              <div className="text-[11px] text-ink-faint">IDOT electrical materials · local-first</div>
            </div>
          </div>
          <a
            className="hidden text-xs text-ink-faint hover:text-ink sm:block"
            href="https://github.com/Hyphycodes/PDF-Splitter"
            target="_blank"
            rel="noreferrer"
          >
            {materials.length} materials seeded
          </a>
        </div>
      </header>

      {stage === "idle" && (
        <UploadView
          research={research}
          setResearch={setResearch}
          useVision={useVision}
          setUseVision={setUseVision}
          apiKey={apiKey}
          setApiKey={setApiKey}
          onRun={handleRun}
        />
      )}

      {stage === "processing" && <ProcessingView progress={progress} />}

      {stage === "error" && (
        <div className="mx-auto max-w-md px-5 py-24 text-center">
          <h2 className="text-lg font-semibold text-rose-600">Couldn’t read that PDF</h2>
          <p className="mt-2 text-sm text-ink-faint">{error || "Unknown error."}</p>
          <button className="btn-primary mt-6" onClick={reset}>
            Try another file
          </button>
        </div>
      )}

      {stage === "review" && result && sourceBytes && (
        <ReviewView
          result={result}
          doc={doc}
          sourceBytes={sourceBytes}
          materials={materials}
          onReset={reset}
        />
      )}
    </div>
  );
}
