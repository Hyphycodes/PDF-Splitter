import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";
const ENDPOINT = `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`;

interface InMsg {
  role: "user" | "assistant";
  content: string;
}

function dataUrlToParts(dataUrl: string): { media_type: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

const SYSTEM = `You are the research assistant inside "Cert Splitter", a tool IDOT electrical materials inspectors use to split certification packets and map pay items to material codes.

You help the inspector understand and verify pay items, material codes, and certifications. You can:
- Answer questions about pay items, material codes, descriptions, units, and methods of acceptance.
- "Challenge" a split: given the actual cert pages of one output file plus any reference documents the inspector attached, judge whether the assigned material code and the included pages are correct, and explain why.

Rules:
- Reference documents are provided ONLY as context for your reasoning. They are NOT part of the file being contested and must never be "added" to it.
- The conductor-count rule: a cable described "... N C" maps to material code 301-0-N (e.g. 3C -> 30103, 5C -> 30105); "... PR / pairs" -> 30115. Flag mismatches.
- "confirmed" crosswalk rows are authoritative — do not contradict them unless the cert clearly proves otherwise; if you do, explain the evidence.
- Be concise and concrete. Cite the page or the cert text you relied on.
- You can use web search to look up manufacturer datasheets/certs (e.g. Service Wire, Advanced Digital Cable, Southwire) when it helps verify a material; share the links you find.

When — and only when — you recommend a concrete change the inspector should save and remember, end your reply with a fenced code block labelled json containing:
\`\`\`json
{"proposals":[{"type":"crosswalk","pay_item":"87301805","material_code":"30102","pay_item_description":"ELCBL C SERV 6 2C","rationale":"cert shows 2 conductors"},{"type":"note","scope":"material","ref":"30115","note":"Brand X 'CIC' certs are pairs -> 30115"}]}
\`\`\`
Only include proposals you are confident about. If no change is warranted, do not include a json block.`;

export async function POST(req: NextRequest) {
  let body: {
    apiKey?: string;
    messages?: InMsg[];
    contextText?: string;
    images?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || body.apiKey;
  if (!apiKey) return NextResponse.json({ error: "missing api key" }, { status: 401 });
  const messages = body.messages ?? [];
  if (!messages.length) return NextResponse.json({ error: "no messages" }, { status: 400 });

  // Build Anthropic messages. Attach context + images to the final user turn.
  const anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }] as unknown[],
  }));

  const last = anthropicMessages[anthropicMessages.length - 1];
  if (last && last.role === "user") {
    if (body.contextText) {
      (last.content as unknown[]).unshift({
        type: "text",
        text: `Context for this question:\n${body.contextText}`,
      });
    }
    for (const img of body.images ?? []) {
      const parts = dataUrlToParts(img);
      if (parts) {
        (last.content as unknown[]).push({
          type: "image",
          source: { type: "base64", media_type: parts.media_type, data: parts.data },
        });
      }
    }
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
        max_tokens: 1800,
        system: SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: anthropicMessages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "anthropic error", detail }, { status: res.status });
    }

    const data = await res.json();
    const text: string =
      data?.content?.map((c: { text?: string }) => c.text || "").join("") ?? "";

    // Pull out a proposals block if present.
    let proposals: unknown[] = [];
    const fence = text.match(/```json\s*([\s\S]*?)```/);
    if (fence) {
      try {
        const parsed = JSON.parse(fence[1]);
        if (Array.isArray(parsed.proposals)) proposals = parsed.proposals;
      } catch {
        /* ignore */
      }
    }
    const display = text.replace(/```json\s*[\s\S]*?```/, "").trim();
    return NextResponse.json({ text: display, proposals });
  } catch (e) {
    return NextResponse.json({ error: "request failed", detail: String(e) }, { status: 502 });
  }
}
