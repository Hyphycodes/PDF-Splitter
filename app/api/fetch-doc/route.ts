import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Proxy-download a manufacturer datasheet/cert PDF so the browser can save it as a
// local reference (avoids CORS). Reference-only — never merged into output files.

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 CertSplitter/1.0" } });
    if (!res.ok) return NextResponse.json({ error: `fetch failed (${res.status})` }, { status: 502 });

    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "file too large" }, { status: 413 });
    }
    const isPdf = type.includes("pdf") || buf.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!isPdf) return NextResponse.json({ error: "not a pdf" }, { status: 415 });

    return new NextResponse(buf, {
      status: 200,
      headers: { "content-type": "application/pdf", "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
