import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Research mode. Claude reads the cert pages, judges whether the assigned material
// code fits, and uses web search to find the manufacturer's datasheet / cert
// (Service Wire, Advanced Digital Cable, etc.). Returns a verdict + sources.

const MODEL = "claude-opus-4-8";
const ENDPOINT = `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`;

function dataUrlToParts(dataUrl: string): { media_type: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

const SYSTEM =
  "You are a materials-research assistant for IDOT electrical inspection. You are given one " +
  "MATERIAL (its code + description, from the pay-item) and the actual certification page(s) " +
  "uploaded for it. Cross-check THREE sources and flag any disagreement:\n" +
  "  (A) what the PAY-ITEM DESCRIPTION says (e.g. '2C' = 2 conductors, '14 3C' = 14 AWG 3 conductor, 'PR' = pairs),\n" +
  "  (B) what the UPLOADED CERT actually states (conductor count, gauge, type, manufacturer, part number),\n" +
  "  (C) what the MANUFACTURER'S real datasheet says — find it with web search using the manufacturer " +
  "name and part number on the cert (e.g. Service Wire, Advanced Digital Cable, Southwire). Prefer official PDFs.\n\n" +
  "Reasoning:\n" +
  "- Apply the conductor-count rule: a cable '...N C' -> material 301-0-N (3C->30103, 5C->30105); pairs -> 30115.\n" +
  "- If (A), (B), and (C) all agree, verdict 'match'.\n" +
  "- If they DISAGREE (e.g. description says 2C but the datasheet/cert shows a single conductor), verdict " +
  "'mismatch' — state exactly which sources disagree and what the correct material code likely is.\n" +
  "- If you can't find a datasheet or the cert is unreadable, verdict 'unclear'.\n\n" +
  "Be concise but specific (name the part number and the disagreement). End your reply with a fenced json block:\n" +
  '```json\n{"verdict":"match|mismatch|unclear","suggested_material_code":"30103","summary":"one or two sentences naming any disagreement"}\n```';

interface SourceOut {
  title: string;
  url: string;
  isPdf: boolean;
}

function collectSources(content: unknown[]): SourceOut[] {
  const out: SourceOut[] = [];
  const seen = new Set<string>();
  const add = (url?: unknown, title?: unknown) => {
    if (typeof url !== "string" || !url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: typeof title === "string" && title ? title : url, isPdf: /\.pdf(\?|$)/i.test(url) });
  };
  for (const block of content as Record<string, unknown>[]) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Record<string, unknown>[]) add(r.url, r.title);
    }
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations as Record<string, unknown>[]) add(c.url, c.title);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: {
    apiKey?: string;
    material_code?: string;
    description?: string;
    payItems?: string[];
    images?: string[];
    hintText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || body.apiKey;
  if (!apiKey) return NextResponse.json({ error: "missing api key" }, { status: 401 });

  const userContent: unknown[] = [
    {
      type: "text",
      text:
        `Material code: ${body.material_code || "(unresolved)"}\n` +
        `Description: ${body.description || ""}\n` +
        `Pay items: ${(body.payItems || []).join(", ")}\n` +
        (body.hintText ? `Cert text (extracted): ${body.hintText.slice(0, 4000)}\n` : "") +
        `Verify the code and find the manufacturer datasheet/cert online.`,
    },
  ];
  for (const img of (body.images || []).slice(0, 2)) {
    const parts = dataUrlToParts(img);
    if (parts) userContent.push({ type: "image", source: { type: "base64", media_type: parts.media_type, data: parts.data } });
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "anthropic error", detail }, { status: res.status });
    }

    const data = await res.json();
    const blocks: unknown[] = Array.isArray(data?.content) ? data.content : [];
    const text = (blocks as Record<string, unknown>[])
      .filter((b) => b?.type === "text")
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .join("\n");
    const sources = collectSources(blocks);

    let verdict = "unclear";
    let suggested: string | null = null;
    let summary = text.replace(/```json[\s\S]*?```/, "").trim();
    const fence = text.match(/```json\s*([\s\S]*?)```/);
    if (fence) {
      try {
        const j = JSON.parse(fence[1]);
        if (typeof j.verdict === "string") verdict = j.verdict;
        if (typeof j.suggested_material_code === "string") suggested = j.suggested_material_code;
        if (typeof j.summary === "string") summary = j.summary;
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json({ verdict, suggestedCode: suggested, summary, sources });
  } catch (e) {
    return NextResponse.json({ error: "request failed", detail: String(e) }, { status: 502 });
  }
}
