import { getApiKey } from "./vision";
import { saveResearchDoc } from "./db";
import type { ResearchResult, ResearchSource, ResearchDoc } from "./types";

export async function runResearch(args: {
  material_code: string | null;
  description: string;
  payItems: string[];
  images?: string[];
  hintText?: string;
}): Promise<ResearchResult> {
  try {
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, apiKey: getApiKey() }),
    });
    const data = await res.json();
    if (!res.ok) return { status: "error", error: data?.error || `Research failed (${res.status})` };
    return {
      status: "done",
      verdict: data.verdict,
      suggestedCode: data.suggestedCode ?? null,
      summary: data.summary || "",
      sources: Array.isArray(data.sources) ? data.sources : [],
    };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

/** Download a found datasheet/cert into the local reference library. */
export async function saveReferenceFromSource(source: ResearchSource, refs: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    let blob: Blob | undefined;
    try {
      const res = await fetch(`/api/fetch-doc?url=${encodeURIComponent(source.url)}`);
      if (res.ok) blob = await res.blob();
    } catch {
      /* keep the link even if the download fails */
    }
    const doc: ResearchDoc = {
      id: crypto.randomUUID ? crypto.randomUUID() : `doc_${Date.now()}_${Math.round(performance.now())}`,
      name: source.title || source.url,
      url: source.url,
      refs,
      blob,
      added_at: Date.now(),
    };
    await saveResearchDoc(doc);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
