"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  "new",
  "saved",
  "approved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived",
];

export default function StatusSelect({
  jobId,
  status,
}: {
  jobId: number;
  status: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  async function update(next: string) {
    setValue(next);
    setBusy(true);
    try {
      await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select value={value} disabled={busy} onChange={(e) => update(e.target.value)}>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
