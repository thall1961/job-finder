import Link from "next/link";
import { getDb, Job } from "@/lib/db";
import { matchConnectionsForCompany } from "@/lib/network";
import RefreshButton from "@/components/RefreshButton";
import JobList, { JobRow } from "@/components/JobList";

export const dynamic = "force-dynamic";

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

  const rows: JobRow[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    source: job.source,
    fit_score: job.fit_score,
    fit_reason: job.fit_reason,
    status: job.status,
    connections: matchConnectionsForCompany(job.company).length,
  }));

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

      <JobList jobs={rows} />
    </div>
  );
}
