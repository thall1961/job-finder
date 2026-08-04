import { NextRequest, NextResponse } from "next/server";
import { runApplyBatch } from "@/lib/apply";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let jobId: number | undefined;
  try {
    const body = await req.json();
    if (body?.jobId) jobId = Number(body.jobId);
  } catch {
    // no body — full batch run
  }
  try {
    const results = await runApplyBatch(jobId);
    return NextResponse.json({ results });
  } catch (e) {
    console.error("apply run failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
