import Link from "next/link";
import { getDb, Job } from "@/lib/db";
import StatusSelect from "@/components/StatusSelect";

export const dynamic = "force-dynamic";

const STAGES = ["saved", "approved", "applied", "interviewing", "offer", "rejected"] as const;

export default async function PipelinePage() {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT * FROM jobs WHERE status IN ('saved','approved','applied','interviewing','offer','rejected')
       ORDER BY status_updated_at DESC`
    )
    .all() as Job[];

  const byStage = new Map<string, Job[]>();
  for (const stage of STAGES) byStage.set(stage, []);
  for (const job of jobs) byStage.get(job.status)?.push(job);

  return (
    <div>
      <h1>Pipeline</h1>
      {jobs.length === 0 && (
        <p className="muted">
          Nothing tracked yet. Mark jobs as “saved” or “applied” from the{" "}
          <Link href="/">jobs list</Link>.
        </p>
      )}
      {STAGES.map((stage) => {
        const stageJobs = byStage.get(stage) ?? [];
        if (stageJobs.length === 0) return null;
        return (
          <section key={stage}>
            <h2 style={{ textTransform: "capitalize" }}>
              {stage} <span className="muted small">({stageJobs.length})</span>
            </h2>
            {stageJobs.map((job) => (
              <div className="card job-row" key={job.id}>
                <div className="job-main">
                  <div className="job-title">
                    <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                  </div>
                  <div className="job-meta">
                    {job.company} · {job.location ?? "location unknown"}
                    {job.status_updated_at &&
                      ` · updated ${job.status_updated_at.slice(0, 10)}`}
                  </div>
                </div>
                <StatusSelect jobId={job.id} status={job.status} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
