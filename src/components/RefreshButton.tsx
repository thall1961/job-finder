"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage("Fetching listings…");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refresh failed");
      setMessage(
        `Found ${data.fetched} matching listings, ${data.inserted} new, scored ${data.scored}.`
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function score() {
    setBusy(true);
    setMessage("Scoring jobs against your resume…");
    try {
      const res = await fetch("/api/score", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scoring failed");
      setMessage(`Scored ${data.scored} jobs.`);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="primary" onClick={refresh} disabled={busy}>
        {busy ? "Working…" : "Fetch new jobs"}
      </button>
      <button onClick={score} disabled={busy}>
        Score unscored
      </button>
      {message && <span className="small muted">{message}</span>}
    </>
  );
}
