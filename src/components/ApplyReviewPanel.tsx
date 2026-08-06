"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanField } from "@/lib/db";

export default function ApplyReviewPanel({
  planId,
  ats,
  applyUrl,
  fields,
}: {
  planId: number;
  ats: string;
  applyUrl: string;
  fields: PlanField[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.selector, f.value]))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needsInput = fields.filter(
    (f) =>
      f.required &&
      !["file", "checkbox", "checkboxgroup"].includes(f.type) &&
      !(values[f.selector] ?? "").trim()
  ).length;

  async function submit() {
    setBusy(true);
    setMessage("Submitting on the employer's form — this can take a minute…");
    try {
      const res = await fetch(`/api/apply-plans/${planId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits: values }),
      });
      const data = await res.json();
      setMessage(`${data.ok ? "✓" : "✗"} ${data.detail}`);
      if (data.ok) router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await fetch(`/api/apply-plans/${planId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function renderInput(f: PlanField) {
    const value = values[f.selector] ?? "";
    const set = (v: string) => setValues({ ...values, [f.selector]: v });
    if (f.type === "file") {
      return <p className="small muted" style={{ margin: 0 }}>📎 {f.value}</p>;
    }
    if (f.type === "select" || (f.type === "radio" && (f.options?.length ?? 0) > 0)) {
      return (
        <select value={value} onChange={(e) => set(e.target.value)}>
          <option value="">— leave blank —</option>
          {f.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !f.options!.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    }
    if (f.type === "checkboxgroup") {
      const selected = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const toggle = (o: string, on: boolean) =>
        set((on ? [...selected, o] : selected.filter((s) => s !== o)).join(", "));
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1rem" }}>
          {f.options?.map((o) => (
            <label key={o} className="small" style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => toggle(o, e.target.checked)}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    if (f.type === "checkbox") {
      return (
        <label className="small" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={/^(yes|true|1|checked|agreed?|accept(ed)?)$/i.test(value.trim())}
            onChange={(e) => set(e.target.checked ? "Yes" : "")}
          />
          {/^(yes|true|1|checked|agreed?|accept(ed)?)$/i.test(value.trim()) ? "Yes" : "No"}
        </label>
      );
    }
    if (f.type === "textarea" || value.length > 120) {
      return <textarea rows={Math.min(10, Math.max(3, Math.ceil(value.length / 90)))} value={value} onChange={(e) => set(e.target.value)} />;
    }
    return <input type="text" value={value} onChange={(e) => set(e.target.value)} />;
  }

  return (
    <div className="card">
      <strong>
        Ready to submit — review your application
        {needsInput > 0 && (
          <span className="muted small"> — {needsInput} required answer(s) still blank</span>
        )}
      </strong>
      <p className="small muted" style={{ margin: "0.4rem 0 0" }}>
        This was filled from your profile and resume for the {ats} form at{" "}
        <a href={applyUrl} target="_blank" rel="noreferrer">
          {new URL(applyUrl).hostname} ↗
        </a>
        . Nothing is sent until you hit Submit.
      </p>
      {fields.map((f) => (
        <div className="field" key={f.selector} style={{ marginTop: "0.75rem" }}>
          <label>
            {f.label || "(unlabeled field)"}
            {f.required && <span className="muted"> *</span>}
            {f.needs_user && !(values[f.selector] ?? "").trim() && (
              <span className="small" style={{ color: "#b45309" }}> — needs your answer</span>
            )}
            {f.source === "ai" && <span className="muted small"> (drafted by AI)</span>}
          </label>
          {renderInput(f)}
        </div>
      ))}
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button className="primary" onClick={submit} disabled={busy || needsInput > 0}>
          {busy ? "Working…" : "Submit application"}
        </button>
        <button onClick={discard} disabled={busy}>
          Discard
        </button>
        {message && <span className="small muted">{message}</span>}
      </div>
    </div>
  );
}
