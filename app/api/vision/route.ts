import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Thin proxy to the Anthropic Messages API (vision). The browser holds the key
// in localStorage and sends it per-request, so no secret is stored server-side.
// Only a single page image is ever forwarded.

const MODEL = "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

function dataUrlToParts(dataUrl: string): { media_type: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

export async function POST(req: NextRequest) {
  let body: { mode?: string; apiKey?: string; image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { apiKey, image } = body;
  if (!apiKey) return NextResponse.json({ error: "missing api key" }, { status: 401 });
  if (!image) return NextResponse.json({ error: "missing image" }, { status: 400 });

  const img = dataUrlToParts(image);
  if (!img) return NextResponse.json({ error: "bad image" }, { status: 400 });

  const prompt =
    "You are reading a single scanned page from an electrical materials inspection " +
    "certification packet. Find the stamped or hand-boxed PAY ITEM number(s) on this page. " +
    "Pay-item numbers are 8 characters: either 8 digits (e.g. 87301225) or an 'X' followed " +
    "by 7 digits (e.g. X8780012). There may be more than one. " +
    'Respond with ONLY a JSON object: {"payItems": ["87301225", ...]}. ' +
    "If you cannot find any, respond {\"payItems\": []}. No other text.";

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
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "anthropic error", detail }, { status: res.status });
    }

    const data = await res.json();
    const text: string = data?.content?.map((c: { text?: string }) => c.text || "").join("") ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    let payItems: string[] = [];
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.payItems)) {
          payItems = parsed.payItems.filter((s: unknown) => typeof s === "string");
        }
      } catch {
        /* fall through */
      }
    }
    return NextResponse.json({ payItems });
  } catch (e) {
    return NextResponse.json({ error: "request failed", detail: String(e) }, { status: 502 });
  }
}
