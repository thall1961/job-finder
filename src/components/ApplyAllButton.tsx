"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplyResult } from "@/lib/apply";

export default function ApplyAllButton({ approvedCount }: { approvedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function applyAll() {
    setBusy(true);
    setMessage("Applying to approved jobs…");
    try {
      const res = await fetch("/api/apply-run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Apply run failed");
      const results: ApplyResult[] = data.results ?? [];
      const review = results.filter((r) => r.method === "review").length;
      const sent = results.filter((r) => r.ok && r.method !== "review").length;
      const questions = results.filter((r) => r.method === "questions").length;
      const manual = results.filter((r) => !r.ok && r.method === "manual").length;
      const failed = results.filter((r) => !r.ok && r.method === "email").length;
      const parts: string[] = [];
      if (review) parts.push(`${review} form(s) ready for your review`);
      if (sent) parts.push(`applied to ${sent}`);
      if (questions) parts.push(`${questions} waiting on your answers`);
      if (manual) parts.push(`${manual} need manual apply`);
      if (failed) parts.push(`${failed} failed`);
      setMessage(parts.length ? parts.join(" · ") : "No approved jobs to apply to.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (approvedCount === 0) return null;

  return (
    <>
      <button onClick={applyAll} disabled={busy}>
        {busy ? "Applying…" : `Apply to ${approvedCount} approved`}
      </button>
      {message && <span className="small muted">{message}</span>}
    </>
  );
}
