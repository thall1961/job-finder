"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConnectionsImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(content: string) {
    if (!content.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connections", { method: "POST", body: content });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setMessage(
        `Imported ${data.parsed} entries (${data.added} new) from ${
          data.format === "csv" ? "CSV export" : "page paste"
        } — ${data.total} total.`
      );
      setText("");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    submit(await file.text());
  }

  return (
    <div className="card">
      <div className="doc-header">
        <strong>Import connections</strong>
        <button onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <div style={{ marginTop: "0.6rem" }}>
          <p className="small muted" style={{ margin: "0 0 0.6rem" }}>
            Best option: LinkedIn → Settings → Data Privacy → “Get a copy of your data”
            → Connections. That CSV includes each person&apos;s position, company, and
            profile URL. Upload it here — or paste a raw copy of your connections page.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            disabled={busy}
          />
          <div className="small muted" style={{ margin: "0.6rem 0 0.3rem" }}>
            …or paste below:
          </div>
          <textarea
            rows={6}
            placeholder="Paste Connections.csv contents or the connections page here"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <button className="primary" onClick={() => submit(text)} disabled={busy || !text.trim()}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className="status-banner" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
          {message}
        </div>
      )}
    </div>
  );
}
