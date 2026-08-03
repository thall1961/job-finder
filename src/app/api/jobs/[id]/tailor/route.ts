import { NextRequest, NextResponse } from "next/server";
import { getDb, Job } from "@/lib/db";
import { tailorForJob } from "@/lib/claude";

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(Number(id)) as
    | Job
    | undefined;
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  try {
    const result = await tailorForJob(job);
    return NextResponse.json(result);
  } catch (e) {
    console.error("tailoring failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
