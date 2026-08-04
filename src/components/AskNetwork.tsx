"use client";

import { useState } from "react";
import Markdown from "./Markdown";

const SUGGESTIONS = [
  "Who could give me a warm intro at companies in my pipeline?",
  "Who do I know in engineering leadership at startups?",
  "Which connections work at companies that are likely hiring engineering managers?",
];

export default function AskNetwork() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/connections/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Query failed");
      setAnswer(data.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>Ask your network</strong>
      <p className="small muted" style={{ margin: "0.3rem 0 0.6rem" }}>
        Free-form questions answered against your imported connections (and the
        companies in your pipeline).
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          style={{ flex: 1 }}
          placeholder="e.g. Who do I know at fintech startups?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
        />
        <button className="primary" onClick={() => ask(question)} disabled={busy}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      <div className="small" style={{ marginTop: "0.5rem" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="suggestion"
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            disabled={busy}
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <div className="status-banner error" style={{ marginTop: "0.75rem" }}>
          {error}
        </div>
      )}
      {answer && (
        <div className="doc answer" style={{ marginTop: "0.75rem" }}>
          <Markdown text={answer} />
        </div>
      )}
    </div>
  );
}
