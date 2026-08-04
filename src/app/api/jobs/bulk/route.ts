import { NextRequest, NextResponse } from "next/server";
import { getDb, PIPELINE_STATUSES } from "@/lib/db";

/** Bulk-update jobs: { ids: number[], status?: string }. */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No job ids provided" }, { status: 400 });
  }
  if (body.status === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (!PIPELINE_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const db = getDb();
  const update = db.prepare(
    "UPDATE jobs SET status = ?, status_updated_at = ? WHERE id = ?"
  );
  const now = new Date().toISOString();
  let updated = 0;
  const run = db.transaction(() => {
    for (const id of ids) {
      updated += update.run(body.status, now, id).changes;
    }
  });
  run();
  return NextResponse.json({ ok: true, updated });
}
