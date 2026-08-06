import { NextRequest, NextResponse } from "next/server";
import { submitApplyPlan } from "@/lib/apply";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let edits: Record<string, string> = {};
  try {
    const body = await req.json();
    if (body?.edits && typeof body.edits === "object") edits = body.edits;
  } catch {
    // no body — submit the plan as-is
  }
  try {
    const result = await submitApplyPlan(Number(id), edits);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    console.error("plan submit failed:", e);
    return NextResponse.json({ ok: false, detail: String(e) }, { status: 500 });
  }
}
