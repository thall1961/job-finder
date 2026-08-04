import { NextRequest, NextResponse } from "next/server";
import { getDb, JobDocument, Job } from "@/lib/db";
import { markdownToPdf } from "@/lib/pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const document = db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(Number(id)) as JobDocument | undefined;
  if (!document || !["resume", "cover_letter"].includes(document.kind)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(document.job_id) as
    | Job
    | undefined;

  const pdf = await markdownToPdf(document.content);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 40);
  const label = document.kind === "resume" ? "resume" : "cover-letter";
  const filename = `${safe(job?.company ?? "job")}-${label}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
