import { NextRequest, NextResponse } from "next/server";
import { getDb, PIPELINE_STATUSES } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  if (body.status !== undefined) {
    if (!PIPELINE_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    db.prepare("UPDATE jobs SET status = ?, status_updated_at = ? WHERE id = ?").run(
      body.status,
      new Date().toISOString(),
      Number(id)
    );
  }
  if (body.notes !== undefined) {
    db.prepare("UPDATE jobs SET notes = ? WHERE id = ?").run(String(body.notes), Number(id));
  }
  return NextResponse.json({ ok: true });
}
