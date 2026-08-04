"use client";

import { useState } from "react";

export default function DocActions({
  docId,
  content,
}: {
  docId: number;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <span className="doc-actions">
      <button onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
      <a className="btn" href={`/api/documents/${docId}/pdf`}>
        Download PDF
      </a>
    </span>
  );
}
