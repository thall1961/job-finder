"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface QuestionItem {
  id: number;
  question: string;
  answer: string | null;
  source: string | null;
}

export default function QuestionsPanel({
  jobId,
  questions,
}: {
  jobId: number;
  questions: QuestionItem[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.answer ?? ""]))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = questions.filter((q) => q.answer === null).length;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? "" })),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage("Saved — hit Apply now to send.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>
        Application questions
        {pending > 0 && <span className="muted small"> — {pending} waiting on you</span>}
      </strong>
      <p className="small muted" style={{ margin: "0.4rem 0 0" }}>
        This listing asks applicants to answer these. Answers are included in the
        application email; a blank answer holds the application.
      </p>
      {questions.map((q) => (
        <div className="field" key={q.id} style={{ marginTop: "0.75rem" }}>
          <label>
            {q.question}
            {q.source === "ai" && <span className="muted small"> (drafted by AI)</span>}
          </label>
          <textarea
            rows={3}
            value={answers[q.id] ?? ""}
            placeholder="Your answer…"
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
          />
        </div>
      ))}
      <div style={{ marginTop: "0.75rem" }}>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save answers"}
        </button>
        {message && <span className="small muted" style={{ marginLeft: "0.5rem" }}>{message}</span>}
      </div>
    </div>
  );
}
