import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  getDb().prepare("DELETE FROM apply_plans WHERE id = ? AND status = 'pending_review'").run(Number(id));
  return NextResponse.json({ ok: true });
}
