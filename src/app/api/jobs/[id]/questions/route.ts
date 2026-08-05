import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = Number(id);
  const body = await req.json();
  const answers: Array<{ id: number; answer: string }> = Array.isArray(body?.answers)
    ? body.answers
    : [];

  const db = getDb();
  const now = new Date().toISOString();
  const setAnswer = db.prepare(
    "UPDATE questions SET answer = ?, source = 'user', answered_at = ? WHERE id = ? AND job_id = ?"
  );
  const clearAnswer = db.prepare(
    "UPDATE questions SET answer = NULL, source = NULL, answered_at = NULL WHERE id = ? AND job_id = ?"
  );
  for (const a of answers) {
    const text = String(a.answer ?? "").trim();
    if (text) setAnswer.run(text, now, Number(a.id), jobId);
    else clearAnswer.run(Number(a.id), jobId);
  }
  return NextResponse.json({ ok: true });
}
