"use client";

import { useEffect, useState } from "react";

interface Profile {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  work_authorization: string;
  sponsorship: string;
  salary_expectation: string;
  notice_period: string;
  relocation: string;
}

const PROFILE_FIELDS: Array<{ key: keyof Profile; label: string; hint?: string }> = [
  { key: "name", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "website", label: "Website" },
  { key: "work_authorization", label: "Work authorization", hint: "e.g. US citizen, authorized to work in the US" },
  { key: "sponsorship", label: "Needs sponsorship?", hint: "e.g. No" },
  { key: "salary_expectation", label: "Salary expectation", hint: "What you'd tell a recruiter" },
  { key: "notice_period", label: "Notice period", hint: "e.g. 2 weeks" },
  { key: "relocation", label: "Open to relocation?", hint: "e.g. No — remote, SoCal, SLC, or DFW area only" },
];

export default function SettingsForm() {
  const [resume, setResume] = useState("");
  const [preferences, setPreferences] = useState("");
  const [keywords, setKeywords] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
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
        setProfile(data.profile);
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
        body: JSON.stringify({ resume, preferences, keywords, profile }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !profile) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h2>Applicant profile</h2>
      <p className="small muted">
        Used to fill applications and sign emails. The screening answers are what the
        auto-apply email and future form-filling will use.
      </p>
      <div className="profile-grid">
        {PROFILE_FIELDS.map(({ key, label, hint }) => (
          <div className="field" key={key}>
            <label>{label}</label>
            {hint && <div className="hint">{hint}</div>}
            <input
              value={profile[key]}
              onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      <h2>Resume</h2>
      <div className="field">
        <div className="hint">
          Your full resume (plain text or Markdown). Used for fit scoring and tailoring.
        </div>
        <textarea rows={18} value={resume} onChange={(e) => setResume(e.target.value)} />
      </div>

      <h2>Preferences</h2>
      <div className="field">
        <div className="hint">
          Locations, compensation targets, company stage — anything the fit scorer should
          weigh.
        </div>
        <textarea
          rows={6}
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
        />
      </div>

      <h2>Title keywords</h2>
      <div className="field">
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
