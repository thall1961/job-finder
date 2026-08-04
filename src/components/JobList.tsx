"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusSelect from "./StatusSelect";

export interface JobRow {
  id: number;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  source: string;
  fit_score: number | null;
  fit_reason: string | null;
  status: string;
  connections: number;
}

const BULK_STATUSES = [
  "saved",
  "approved",
  "applied",
  "rejected",
  "archived",
] as const;

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="score none">–</span>;
  const cls = score >= 75 ? "high" : score >= 50 ? "mid" : "low";
  return <span className={`score ${cls}`}>{score}</span>;
}

export default function JobList({ jobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("archived");
  const [busy, setBusy] = useState(false);

  const allSelected = jobs.length > 0 && selected.size === jobs.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(jobs.map((j) => j.id)));
  }

  async function applyBulk() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch("/api/jobs/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status: bulkStatus }),
      });
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="bulk-bar">
        <label className="small">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all
        </label>
        {selected.size > 0 && (
          <>
            <span className="small muted">{selected.size} selected</span>
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              {BULK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="primary" onClick={applyBulk} disabled={busy}>
              {busy ? "Updating…" : `Mark ${selected.size} as ${bulkStatus}`}
            </button>
            <button onClick={() => setSelected(new Set())} disabled={busy}>
              Clear
            </button>
          </>
        )}
      </div>

      {jobs.map((job) => (
        <div className="card job-row" key={job.id}>
          <input
            type="checkbox"
            className="job-check"
            checked={selected.has(job.id)}
            onChange={() => toggle(job.id)}
          />
          <ScoreBadge score={job.fit_score} />
          <div className="job-main">
            <div className="job-title">
              <Link href={`/jobs/${job.id}`}>{job.title}</Link>
            </div>
            <div className="job-meta">
              {job.company} · {job.location ?? "location unknown"} ·{" "}
              <span className="pill">{job.source}</span>
              {job.salary ? ` · ${job.salary}` : ""}{" "}
              {job.connections > 0 && (
                <span className="network-pill">
                  🤝 {job.connections} connection{job.connections > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {job.fit_reason && <div className="job-reason">{job.fit_reason}</div>}
          </div>
          <StatusSelect jobId={job.id} status={job.status} />
        </div>
      ))}
    </div>
  );
}
