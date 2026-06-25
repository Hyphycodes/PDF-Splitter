import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reads scanned pages with Claude vision. Two modes:
//   mode "ocr"   -> find the stamped pay-item number(s) on a cert page
//   mode "cover" -> read the whole IL OKAY LOG cover table (rows + date + contract)
// Uses the most capable model so a messy scan still reads. Only the single page
// image is forwarded; the rest of the packet stays local.

const MODEL = "claude-opus-4-8";
const ENDPOINT = `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`;

function dataUrlToParts(dataUrl: string): { media_type: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

const OCR_PROMPT =
  "You are reading a single page from an electrical materials inspection certification packet " +
  "(mill cert, BOL, coating cert, or catalog cut). Find ALL PAY ITEM number(s) on this page — " +
  "they are usually stamped or hand-written in a box. IMPORTANT: the pay-item box is OFTEN ROTATED " +
  "(sideways / vertical, 90° or 270°) even when the rest of the page is upright — read text in every " +
  "orientation and check the page margins and corners. A pay-item number is 8 characters: either " +
  "8 digits (e.g. 87301225) or an 'X'/'Z' followed by 7 alphanumerics (e.g. X8780012). A page may " +
  "carry MORE THAN ONE (a box can list several). Return every one you see. " +
  'Respond with ONLY JSON: {"payItems":["87301225","87301245"]}. If none, {"payItems":[]}.';

const COVER_PROMPT =
  "This is the COVER SHEET (an IDOT 'IL OKAY LOG' / materials summary) of an electrical inspection " +
  "packet. Read the whole sheet carefully — it is a table with columns that typically include a line " +
  "number, PAY ITEM number, DESCRIPTION, QUANTITY, and UNIT. Extract:\n" +
  "1. The contract number (often like 62P93).\n" +
  "2. The date it was initialed / stamped by the inspector (hand-written or stamped). Return MMDDYY.\n" +
  "3. EVERY pay-item row, top-to-bottom, in order. Do not skip rows and do not invent rows.\n\n" +
  "CRITICAL for QUANTITY: read the value from the QUANTITY column only. Do NOT use the line number, " +
  "the pay-item number, a unit price, or a dollar amount. Quantities can have decimals and thousands " +
  "separators (e.g. 1,500 or 250.5) — return digits only, no commas (1500, 250.5). Align each quantity " +
  "to the SAME ROW as its pay item; double-check you didn't shift a row up or down.\n" +
  "Pay-item numbers are 8 characters (8 digits, or a letter + 7).\n" +
  'Respond with ONLY JSON: {"contract":"62P93","date":"062226","rows":[{"pay_item":"87301225",' +
  '"description":"ELCBL C SIGNAL 14 3C","quantity":"1500","uom":"LINFT"}]}. ' +
  "Use empty strings only for cells you genuinely cannot read. No commentary.";

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { mode?: string; apiKey?: string; image?: string; hintText?: string; candidates?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const mode = body.mode === "cover" ? "cover" : "ocr";
  const { image } = body;
  const apiKey = process.env.ANTHROPIC_API_KEY || body.apiKey;
  if (!apiKey) return NextResponse.json({ error: "missing api key" }, { status: 401 });
  if (!image) return NextResponse.json({ error: "missing image" }, { status: 400 });

  const img = dataUrlToParts(image);
  if (!img) return NextResponse.json({ error: "bad image" }, { status: 400 });

  let prompt = mode === "cover" ? COVER_PROMPT : OCR_PROMPT;
  if (mode === "ocr" && body.candidates?.length) {
    prompt +=
      "\n\nThese pay-item numbers are listed on the cover sheet for this packet, so the box on this " +
      "page is almost certainly ONE (or a few) of them — match what you see to this list, and prefer " +
      "an exact match from it when a digit is smudged or rotated:\n" +
      body.candidates.slice(0, 60).join(", ") +
      "\nStill report any 8-character pay-item number you see even if it isn't on this list.";
  }

  const content: unknown[] = [
    { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
    { type: "text", text: prompt },
  ];
  if (body.hintText) {
    content.push({ type: "text", text: `Text layer already extracted from this page (may help):\n${body.hintText.slice(0, 6000)}` });
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
        max_tokens: mode === "cover" ? 2500 : 256,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "anthropic error", detail }, { status: res.status });
    }

    const data = await res.json();
    const text: string = data?.content?.map((c: { text?: string }) => c.text || "").join("") ?? "";
    const parsed = extractJson(text);

    if (mode === "cover") {
      const rows = Array.isArray(parsed?.rows) ? parsed!.rows : [];
      return NextResponse.json({
        contract: typeof parsed?.contract === "string" ? parsed.contract : "",
        date: typeof parsed?.date === "string" ? parsed.date : "",
        rows,
      });
    }
    const payItems =
      parsed && Array.isArray(parsed.payItems)
        ? (parsed.payItems as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
    return NextResponse.json({ payItems });
  } catch (e) {
    return NextResponse.json({ error: "request failed", detail: String(e) }, { status: 502 });
  }
}
