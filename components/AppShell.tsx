"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ensureSeeded,
  getAllMaterials,
  getAllCrosswalk,
  getAllResearchNotes,
  getAllInspections,
  getMaterialMap,
  getCrosswalkMap,
  getRelevantNotes,
  saveInspection,
  getInspection,
  deleteInspection,
  upsertCrosswalk,
  upsertResearchNote,
} from "@/lib/db";
import { loadPdf, renderPage, renderPageJpeg } from "@/lib/pdf";
import { runPipeline, type ProgressEvent } from "@/lib/pipeline";
import { getApiKey, setApiKey as persistApiKey } from "@/lib/vision";
import { hasServerKey } from "@/lib/chatClient";
import { buildGeneralContext, buildGroupContext } from "@/lib/context";
import type {
  MaterialMaster,
  PayItemCrosswalk,
  ResearchNote,
  Inspection,
  PipelineResult,
  OutputGroup,
  Proposal,
} from "@/lib/types";
import NavBar, { type View } from "@/components/NavBar";
import UploadView from "@/components/UploadView";
import ProcessingView from "@/components/ProcessingView";
import ReviewView from "@/components/ReviewView";
import ReferenceView from "@/components/ReferenceView";
import HistoryView from "@/components/HistoryView";
import ChatPanel, { type ChatScope } from "@/components/ChatPanel";

type Stage = "idle" | "processing" | "review" | "error";
const THUMB_WIDTH = 360;
const MAX_CHALLENGE_IMAGES = 6;

export default function AppShell() {
  const [view, setView] = useState<View>("split");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  const [result, setResult] = useState<PipelineResult | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Reference data
  const [materials, setMaterials] = useState<MaterialMaster[]>([]);
  const [crosswalk, setCrosswalk] = useState<PayItemCrosswalk[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);

  // Settings
  const [research, setResearch] = useState(false);
  const [useVision, setUseVision] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState(false);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<ChatScope | null>(null);
  const [chatSeed, setChatSeed] = useState<string | undefined>(undefined);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshData = useCallback(async () => {
    const [m, c, n, i] = await Promise.all([
      getAllMaterials(),
      getAllCrosswalk(),
      getAllResearchNotes(),
      getAllInspections(),
    ]);
    setMaterials(m);
    setCrosswalk(c);
    setNotes(n);
    setInspections(i);
  }, []);

  useEffect(() => {
    ensureSeeded().then(refreshData).catch(() => undefined);
    setApiKey(getApiKey());
    hasServerKey().then(setServerKey);
  }, [refreshData]);

  useEffect(() => {
    persistApiKey(apiKey);
  }, [apiKey]);

  // ---- Run a split -------------------------------------------------------
  async function handleRun(file: File) {
    setStage("processing");
    setProgress(null);
    setError("");
    setView("split");
    try {
      const buf = await file.arrayBuffer();
      const keep = buf.slice(0);
      const loaded = await loadPdf(buf);
      setDoc(loaded.doc);
      setSourceBytes(keep);

      const res = await runPipeline(loaded.doc, loaded.numPages, {
        research,
        useVision: useVision && (serverKey || !!apiKey),
        filename: file.name,
        onProgress: setProgress,
      });
      setResult(res);
      setStage("review");

      const insp = await persistInspection(res, res.groups, keep, file.name, null);
      setCurrentId(insp.id);
      await refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  // ---- Persist / open inspections ---------------------------------------
  async function persistInspection(
    res: PipelineResult,
    groups: OutputGroup[],
    bytes: ArrayBuffer,
    filename: string,
    id: string | null
  ): Promise<Inspection> {
    // Strip heavy fields (thumbnails, raw text) before storing.
    const slimResult: PipelineResult = {
      ...res,
      groups,
      pages: res.pages.map((p) => ({ ...p, thumbnail: undefined, rawText: "" })),
    };
    const existing = id ? await getInspection(id) : undefined;
    const now = Date.now();
    const insp: Inspection = {
      id: id ?? (crypto.randomUUID ? crypto.randomUUID() : `insp_${now}`),
      name: existing?.name ?? `${res.contract || "Packet"}${res.date ? ` · ${res.date}` : ""} — ${filename}`,
      contract: res.contract,
      date: res.date,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      pageCount: res.pages.length,
      fileCount: groups.length,
      confirmedCount: groups.filter((g) => g.status === "confirmed").length,
      pdf: new Blob([bytes], { type: "application/pdf" }),
      result: slimResult,
    };
    await saveInspection(insp);
    return insp;
  }

  // Debounced re-save of the open inspection as the inspector edits.
  function handleGroupsChange(groups: OutputGroup[]) {
    if (!currentId || !result || !sourceBytes) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      await persistInspection(result, groups, sourceBytes, "", currentId);
      await refreshData();
    }, 800);
  }

  async function openInspection(id: string) {
    const insp = await getInspection(id);
    if (!insp) return;
    setError("");
    setStage("processing");
    setView("split");
    setProgress({ phase: "Reopening inspection", current: 0, total: insp.pageCount });
    try {
      const bytes = await insp.pdf.arrayBuffer();
      const keep = bytes.slice(0);
      const loaded = await loadPdf(bytes);
      // Regenerate thumbnails for the saved pages.
      const pages = [];
      for (const p of insp.result.pages) {
        setProgress({ phase: "Reopening inspection", current: p.index + 1, total: insp.pageCount });
        pages.push({ ...p, thumbnail: await renderPage(loaded.doc, p.index + 1, THUMB_WIDTH) });
      }
      const res: PipelineResult = { ...insp.result, pages };
      setDoc(loaded.doc);
      setSourceBytes(keep);
      setResult(res);
      setCurrentId(insp.id);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  async function removeInspection(id: string) {
    await deleteInspection(id);
    if (id === currentId) setCurrentId(null);
    await refreshData();
  }

  // ---- Chat / challenge --------------------------------------------------
  function openGeneralChat(seed?: string, refs: string[] = []) {
    const ctx = buildGeneralContext(crosswalk, materials, notes, refs);
    setChatScope({ title: "Master reference", contextText: ctx, refs: refs.length ? refs : crosswalk.map((c) => c.pay_item) });
    setChatSeed(seed);
    setChatOpen(true);
  }

  async function challengeGroup(group: OutputGroup) {
    if (!doc) return;
    setChatSeed(undefined);
    // Open immediately with a "preparing" note while we render the page images.
    setChatScope({ title: group.filename, contextText: "Preparing…", refs: [], challenge: true });
    setChatOpen(true);

    const [matMap, cwMap] = await Promise.all([getMaterialMap(), getCrosswalkMap()]);
    const refs = [group.materialCode ?? "", ...group.payItems].filter(Boolean);
    const relevantNotes = await getRelevantNotes(refs);
    const contextText = buildGroupContext(group, matMap, cwMap, relevantNotes);

    const ordered = [
      ...(result?.coverIndex != null ? [result.coverIndex] : []),
      ...group.pageIndexes.filter((i) => i !== result?.coverIndex),
    ].slice(0, MAX_CHALLENGE_IMAGES);

    const images: string[] = [];
    for (const idx of ordered) images.push(await renderPageJpeg(doc, idx + 1, 1100, 0.65));

    setChatScope({ title: group.filename, contextText, scopeImages: images, refs, challenge: true });
  }

  async function applyProposal(p: Proposal) {
    if (p.type === "crosswalk" && p.pay_item) {
      await upsertCrosswalk({
        pay_item: p.pay_item,
        pay_item_description: p.pay_item_description ?? "",
        material_code: p.material_code ?? null,
        confidence: 1,
        source: "confirmed",
      });
      if (p.rationale) {
        await upsertResearchNote({
          key: `payitem:${p.pay_item}`,
          scope: "payitem",
          ref: p.pay_item,
          note: p.rationale,
          confirmed: true,
          updated_at: Date.now(),
        });
      }
    } else if (p.type === "note" && p.ref) {
      await upsertResearchNote({
        key: `${p.scope ?? "material"}:${p.ref}`,
        scope: p.scope ?? "material",
        ref: p.ref,
        note: p.note ?? "",
        confirmed: true,
        updated_at: Date.now(),
      });
    }
    await refreshData();
  }

  function reset() {
    setStage("idle");
    setResult(null);
    setDoc(null);
    setSourceBytes(null);
    setProgress(null);
    setCurrentId(null);
    setView("split");
  }

  return (
    <div className="min-h-screen">
      <NavBar
        view={view}
        setView={setView}
        onOpenChat={() => openGeneralChat()}
        materialCount={materials.length}
        inspectionCount={inspections.length}
      />

      {view === "split" && stage === "idle" && (
        <UploadView
          research={research}
          setResearch={setResearch}
          useVision={useVision}
          setUseVision={setUseVision}
          apiKey={apiKey}
          setApiKey={setApiKey}
          serverKey={serverKey}
          onRun={handleRun}
        />
      )}

      {view === "split" && stage === "processing" && <ProcessingView progress={progress} />}

      {view === "split" && stage === "error" && (
        <div className="mx-auto max-w-md px-5 py-24 text-center">
          <h2 className="text-lg font-semibold text-rose-600">Couldn’t read that PDF</h2>
          <p className="mt-2 text-sm text-ink-faint">{error || "Unknown error."}</p>
          <button className="btn-primary mt-6" onClick={reset}>
            Try another file
          </button>
        </div>
      )}

      {view === "split" && stage === "review" && result && sourceBytes && (
        <ReviewView
          result={result}
          doc={doc}
          sourceBytes={sourceBytes}
          materials={materials}
          onReset={reset}
          onChallenge={challengeGroup}
          onGroupsChange={handleGroupsChange}
        />
      )}

      {view === "reference" && (
        <ReferenceView materials={materials} crosswalk={crosswalk} notes={notes} onAsk={openGeneralChat} />
      )}

      {view === "history" && (
        <HistoryView inspections={inspections} onOpen={openInspection} onDelete={removeInspection} />
      )}

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        scope={chatScope}
        seed={chatSeed}
        onApplyProposal={applyProposal}
      />
    </div>
  );
}
