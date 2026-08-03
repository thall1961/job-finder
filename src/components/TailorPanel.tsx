"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TailorPanel({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tailor() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/tailor`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tailoring failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="primary" onClick={tailor} disabled={busy}>
        {busy ? "Drafting (can take a minute)…" : "Tailor resume + cover letter"}
      </button>
      {error && <div className="status-banner error">{error}</div>}
    </div>
  );
}
