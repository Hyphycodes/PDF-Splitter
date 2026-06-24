import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Lets the client know whether the server already has an Anthropic key linked
// (env var), so it can hide the "paste your key" field and just work.
export async function GET() {
  return NextResponse.json({ hasServerKey: !!process.env.ANTHROPIC_API_KEY });
}
