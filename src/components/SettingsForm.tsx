"use client";

import { useEffect, useState } from "react";

export default function SettingsForm() {
  const [resume, setResume] = useState("");
  const [preferences, setPreferences] = useState("");
  const [keywords, setKeywords] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setResume(data.resume);
        setPreferences(data.preferences);
        setKeywords(data.keywords);
        setLoaded(true);
      });
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, preferences, keywords }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="field">
        <label>Resume</label>
        <div className="hint">
          Paste your full resume (plain text or Markdown). Used for fit scoring and
          tailoring — it never leaves your machine except in API calls to Anthropic.
        </div>
        <textarea rows={18} value={resume} onChange={(e) => setResume(e.target.value)} />
      </div>

      <div className="field">
        <label>Preferences</label>
        <div className="hint">
          Locations, compensation targets, company stage, anything the fit scorer should
          weigh.
        </div>
        <textarea
          rows={6}
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Title keywords</label>
        <div className="hint">
          One per line. Listings must match at least one keyword to be pulled in.
        </div>
        <textarea rows={8} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </div>

      <button className="primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
      {message && <span className="small muted" style={{ marginLeft: "0.75rem" }}>{message}</span>}
    </div>
  );
}
