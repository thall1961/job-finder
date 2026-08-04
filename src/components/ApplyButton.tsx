"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApplyButton({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/apply-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Apply failed");
      const r = data.results?.[0];
      setResult(r ? `${r.ok ? "✓" : "✗"} ${r.detail}` : "No result");
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button onClick={apply} disabled={busy}>
        {busy ? "Applying…" : "Apply now"}
      </button>
      {result && <span className="small muted" style={{ marginLeft: "0.5rem" }}>{result}</span>}
    </span>
  );
}
