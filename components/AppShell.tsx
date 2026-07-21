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
  getAllResearchDocs,
  deleteResearchDoc,
} from "@/lib/db";
import { loadPdf, renderPage, renderPageJpeg } from "@/lib/pdf";
import { runPipeline, type ProgressEvent } from "@/lib/pipeline";
import { runLa15Pipeline } from "@/lib/la15";
import { getApiKey, setApiKey as persistApiKey } from "@/lib/vision";
import { hasServerKey } from "@/lib/chatClient";
import { buildGroupContext } from "@/lib/context";
import type {
  MaterialMaster,
  PayItemCrosswalk,
  ResearchNote,
  ResearchDoc,
  Inspection,
  PipelineResult,
  OutputGroup,
  SplitterKind,
  La15Result,
  TicketGroup,
  Proposal,
} from "@/lib/types";
import NavBar, { type View } from "@/components/NavBar";
import UploadView from "@/components/UploadView";
import ProcessingView from "@/components/ProcessingView";
import ReviewView from "@/components/ReviewView";
import La15ReviewView from "@/components/La15ReviewView";
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
  const [splitterKind, setSplitterKind] = useState<SplitterKind>("cert");

  const [result, setResult] = useState<PipelineResult | null>(null);
  const [la15Result, setLa15Result] = useState<La15Result | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Reference data
  const [materials, setMaterials] = useState<MaterialMaster[]>([]);
  const [crosswalk, setCrosswalk] = useState<PayItemCrosswalk[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [researchDocs, setResearchDocs] = useState<ResearchDoc[]>([]);

  // Settings
  const [research, setResearch] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState(false);

  // Project save state
  const [projectName, setProjectName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Challenge chat (scoped to one split only)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<ChatScope | null>(null);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestGroups = useRef<OutputGroup[] | null>(null);
  const latestLa15Groups = useRef<TicketGroup[] | null>(null);

  const refreshData = useCallback(async () => {
    const [m, c, n, i, d] = await Promise.all([
      getAllMaterials(),
      getAllCrosswalk(),
      getAllResearchNotes(),
      getAllInspections(),
      getAllResearchDocs(),
    ]);
    setMaterials(m);
    setCrosswalk(c);
    setNotes(n);
    setInspections(i);
    setResearchDocs(d);
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

      if (splitterKind === "la15") {
        const res = await runLa15Pipeline(loaded.doc, loaded.numPages, {
          keyAvailable: serverKey || !!apiKey,
          onProgress: setProgress,
        });
        setLa15Result(res);
        setStage("review");

        const defaultName = file.name.replace(/\.pdf$/i, "");
        setProjectName(defaultName);
        const insp = await persistLa15Inspection(res, res.groups, keep, defaultName, null);
        setCurrentId(insp.id);
        setSaveState("saved");
        await refreshData();
        return;
      }

      const res = await runPipeline(loaded.doc, loaded.numPages, {
        research,
        keyAvailable: serverKey || !!apiKey,
        filename: file.name,
        onProgress: setProgress,
      });
      setResult(res);
      setStage("review");

      const defaultName = `${res.contract || "Packet"}_${res.date || ""}`.replace(/_$/, "");
      setProjectName(defaultName);
      const insp = await persistInspection(res, res.groups, keep, defaultName, null);
      setCurrentId(insp.id);
      setSaveState("saved");
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
    name: string,
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
      kind: "cert",
      name: name || existing?.name || `${res.contract || "Packet"}_${res.date || ""}`,
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

  async function persistLa15Inspection(
    res: La15Result,
    groups: TicketGroup[],
    bytes: ArrayBuffer,
    name: string,
    id: string | null
  ): Promise<Inspection> {
    // Strip heavy fields (thumbnails, raw text) before storing.
    const slimResult: La15Result = {
      ...res,
      groups,
      pages: res.pages.map((p) => ({ ...p, thumbnail: undefined, rawText: "" })),
    };
    const existing = id ? await getInspection(id) : undefined;
    const now = Date.now();
    const insp: Inspection = {
      id: id ?? (crypto.randomUUID ? crypto.randomUUID() : `insp_${now}`),
      kind: "la15",
      name: name || existing?.name || "LA-15 packet",
      created_at: existing?.created_at ?? now,
      updated_at: now,
      pageCount: res.pages.length,
      fileCount: groups.length,
      pdf: new Blob([bytes], { type: "application/pdf" }),
      result: slimResult,
    };
    await saveInspection(insp);
    return insp;
  }

  // Debounced re-save of the open inspection as the inspector edits.
  function scheduleSave(name: string) {
    if (!currentId || !sourceBytes) return;
    if (splitterKind === "la15") {
      if (!la15Result) return;
      setSaveState("saving");
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(async () => {
        const groups = (latestLa15Groups.current ?? la15Result.groups) as TicketGroup[];
        await persistLa15Inspection(la15Result, groups, sourceBytes, name, currentId);
        setSaveState("saved");
        await refreshData();
      }, 600);
      return;
    }
    if (!result) return;
    setSaveState("saving");
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      const groups = latestGroups.current ?? result.groups;
      await persistInspection(result, groups, sourceBytes, name, currentId);
      setSaveState("saved");
      await refreshData();
    }, 600);
  }

  function handleGroupsChange(groups: OutputGroup[]) {
    latestGroups.current = groups;
    scheduleSave(projectName);
  }

  function handleLa15GroupsChange(groups: TicketGroup[]) {
    latestLa15Groups.current = groups;
    scheduleSave(projectName);
  }

  function renameProject(name: string) {
    setProjectName(name);
    scheduleSave(name);
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

      if (insp.kind === "la15") {
        const pages = [];
        for (const p of insp.result.pages) {
          setProgress({ phase: "Reopening inspection", current: p.index + 1, total: insp.pageCount });
          pages.push({ ...p, thumbnail: await renderPage(loaded.doc, p.index + 1, THUMB_WIDTH) });
        }
        const res: La15Result = { ...insp.result, pages };
        latestLa15Groups.current = res.groups;
        setDoc(loaded.doc);
        setSourceBytes(keep);
        setLa15Result(res);
        setResult(null);
        setSplitterKind("la15");
        setCurrentId(insp.id);
        setProjectName(insp.name);
        setSaveState("saved");
        setStage("review");
        return;
      }

      // Regenerate thumbnails for the saved pages.
      const pages = [];
      for (const p of insp.result.pages) {
        setProgress({ phase: "Reopening inspection", current: p.index + 1, total: insp.pageCount });
        pages.push({ ...p, thumbnail: await renderPage(loaded.doc, p.index + 1, THUMB_WIDTH) });
      }
      const res: PipelineResult = { ...insp.result, pages };
      latestGroups.current = res.groups;
      setDoc(loaded.doc);
      setSourceBytes(keep);
      setResult(res);
      setLa15Result(null);
      setSplitterKind("cert");
      setCurrentId(insp.id);
      setProjectName(insp.name);
      setSaveState("saved");
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

  // ---- Per-split challenge (the only chat entry point) -------------------
  async function challengeGroup(group: OutputGroup) {
    if (!doc) return;
    // Open immediately with a "preparing" note while we render the page images.
    setChatScope({ title: group.filename, contextText: "Preparing…", refs: [], challenge: true });
    setChatOpen(true);

    const [matMap, cwMap] = await Promise.all([getMaterialMap(), getCrosswalkMap()]);
    const refs = [group.materialCode ?? "", ...group.payItems].filter(Boolean);
    const relevantNotes = await getRelevantNotes(refs);
    let contextText = buildGroupContext(group, matMap, cwMap, relevantNotes);
    if (group.research?.status === "done" && group.research.summary) {
      contextText +=
        `\n\nPRIOR RESEARCH FINDINGS (verdict: ${group.research.verdict ?? "?"}): ${group.research.summary}` +
        (group.research.sources?.length
          ? `\nSources found: ${group.research.sources.map((s) => s.url).join(", ")}`
          : "");
    }

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
    setLa15Result(null);
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
        materialCount={materials.length}
        inspectionCount={inspections.length}
      />

      {view === "split" && stage === "idle" && (
        <UploadView
          kind={splitterKind}
          setKind={setSplitterKind}
          research={research}
          setResearch={setResearch}
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

      {view === "split" && stage === "review" && splitterKind === "la15" && la15Result && sourceBytes && (
        <La15ReviewView
          result={la15Result}
          doc={doc}
          sourceBytes={sourceBytes}
          projectName={projectName}
          onRenameProject={renameProject}
          saveState={saveState}
          onReset={reset}
          onGroupsChange={handleLa15GroupsChange}
        />
      )}

      {view === "split" && stage === "review" && splitterKind === "cert" && result && sourceBytes && (
        <ReviewView
          result={result}
          doc={doc}
          sourceBytes={sourceBytes}
          materials={materials}
          crosswalk={crosswalk}
          research={research}
          keyAvailable={serverKey || !!apiKey}
          onRenameProject={renameProject}
          saveState={saveState}
          onReset={reset}
          onChallenge={challengeGroup}
          onGroupsChange={handleGroupsChange}
        />
      )}

      {view === "reference" && (
        <ReferenceView
          materials={materials}
          crosswalk={crosswalk}
          notes={notes}
          docs={researchDocs}
          onDeleteDoc={async (id) => {
            await deleteResearchDoc(id);
            await refreshData();
          }}
        />
      )}

      {view === "history" && (
        <HistoryView inspections={inspections} onOpen={openInspection} onDelete={removeInspection} />
      )}

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        scope={chatScope}
        onApplyProposal={applyProposal}
      />
    </div>
  );
}
