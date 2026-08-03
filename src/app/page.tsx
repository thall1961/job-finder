import Link from "next/link";
import { getDb, Job } from "@/lib/db";
import RefreshButton from "@/components/RefreshButton";
import StatusSelect from "@/components/StatusSelect";

export const dynamic = "force-dynamic";

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="score none">–</span>;
  const cls = score >= 75 ? "high" : score >= 50 ? "mid" : "low";
  return <span className={`score ${cls}`}>{score}</span>;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ minScore?: string; source?: string; showAll?: string }>;
}) {
  const params = await searchParams;
  const minScore = params.minScore ? Number(params.minScore) : null;
  const showAll = params.showAll === "1";

  const db = getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (!showAll) {
    conditions.push("status NOT IN ('archived', 'rejected')");
  }
  if (minScore !== null && !Number.isNaN(minScore)) {
    conditions.push("fit_score >= ?");
    args.push(minScore);
  }
  if (params.source) {
    conditions.push("source = ?");
    args.push(params.source);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const jobs = db
    .prepare(
      `SELECT * FROM jobs ${where}
       ORDER BY fit_score IS NULL, fit_score DESC, fetched_at DESC
       LIMIT 200`
    )
    .all(...args) as Job[];

  const sources = (
    db.prepare("SELECT DISTINCT source FROM jobs ORDER BY source").all() as {
      source: string;
    }[]
  ).map((r) => r.source);

  const hasResume = db
    .prepare("SELECT 1 FROM settings WHERE key = 'resume' AND length(value) > 0")
    .get();

  return (
    <div>
      <h1>Jobs</h1>
      {!hasResume && (
        <div className="status-banner">
          Add your resume in <Link href="/settings">Settings</Link> to enable fit scoring
          and tailoring.
        </div>
      )}
      <div className="toolbar">
        <RefreshButton />
        <div className="right small">
          <Link href="/?minScore=75">75+</Link>
          <Link href="/?minScore=50">50+</Link>
          <Link href="/">All active</Link>
          <Link href="/?showAll=1">Everything</Link>
          {sources.map((s) => (
            <Link key={s} href={`/?source=${s}`}>
              {s}
            </Link>
          ))}
        </div>
      </div>

      {jobs.length === 0 && (
        <p className="muted">
          No jobs yet — hit “Fetch new jobs” to pull listings from Remotive, We Work
          Remotely, and HN Who&apos;s Hiring.
        </p>
      )}

      {jobs.map((job) => (
        <div className="card job-row" key={job.id}>
          <ScoreBadge score={job.fit_score} />
          <div className="job-main">
            <div className="job-title">
              <Link href={`/jobs/${job.id}`}>{job.title}</Link>
            </div>
            <div className="job-meta">
              {job.company} · {job.location ?? "location unknown"} ·{" "}
              <span className="pill">{job.source}</span>
              {job.salary ? ` · ${job.salary}` : ""}
            </div>
            {job.fit_reason && <div className="job-reason">{job.fit_reason}</div>}
          </div>
          <StatusSelect jobId={job.id} status={job.status} />
        </div>
      ))}
    </div>
  );
}
