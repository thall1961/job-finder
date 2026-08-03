import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, Job, JobDocument } from "@/lib/db";
import StatusSelect from "@/components/StatusSelect";
import TailorPanel from "@/components/TailorPanel";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(id)) as
    | Job
    | undefined;
  if (!job) notFound();

  const docs = db
    .prepare("SELECT * FROM documents WHERE job_id = ? ORDER BY created_at DESC")
    .all(job.id) as JobDocument[];
  const latestResume = docs.find((d) => d.kind === "resume");
  const latestCover = docs.find((d) => d.kind === "cover_letter");
  const latestKeywords = docs.find((d) => d.kind === "keywords");
  let missingKeywords: string[] = [];
  if (latestKeywords) {
    try {
      missingKeywords = JSON.parse(latestKeywords.content);
    } catch {}
  }

  return (
    <div>
      <p className="small">
        <Link href="/">← Back to jobs</Link>
      </p>
      <h1>{job.title}</h1>
      <div className="job-meta" style={{ marginBottom: "1rem" }}>
        {job.company} · {job.location ?? "location unknown"} ·{" "}
        <span className="pill">{job.source}</span>
        {job.salary ? ` · ${job.salary}` : ""}
        {job.url && (
          <>
            {" · "}
            <a href={job.url} target="_blank" rel="noreferrer">
              Original listing ↗
            </a>
          </>
        )}
      </div>

      <div className="toolbar">
        <StatusSelect jobId={job.id} status={job.status} />
        <TailorPanel jobId={job.id} />
      </div>

      {job.fit_score !== null && (
        <div className="card">
          <strong>Fit score: {job.fit_score}</strong>
          <p className="small" style={{ margin: "0.4rem 0 0" }}>
            {job.fit_reason}
          </p>
        </div>
      )}

      {missingKeywords.length > 0 && (
        <div className="card">
          <strong>Keywords missing from your resume</strong>
          <p className="small muted" style={{ margin: "0.4rem 0 0" }}>
            {missingKeywords.join(" · ")}
          </p>
        </div>
      )}

      {latestResume && (
        <>
          <h2>Tailored resume</h2>
          <div className="doc">{latestResume.content}</div>
        </>
      )}

      {latestCover && (
        <>
          <h2>Cover letter draft</h2>
          <div className="doc">{latestCover.content}</div>
        </>
      )}

      <h2>Job description</h2>
      <div className="card description">{job.description ?? "No description captured."}</div>
    </div>
  );
}
