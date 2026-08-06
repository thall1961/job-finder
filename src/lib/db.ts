import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "jobs.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      salary TEXT,
      url TEXT,
      description TEXT,
      posted_at TEXT,
      fetched_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      fit_score INTEGER,
      fit_reason TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      status_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      method TEXT NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apply_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      ats TEXT NOT NULL,
      apply_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      fields TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      question TEXT NOT NULL,
      answer TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_apply_plans_job ON apply_plans(job_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(fit_score);
    CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_questions_job ON questions(job_id);
  `);
  return db;
}

export interface Job {
  id: number;
  source: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  url: string | null;
  description: string | null;
  posted_at: string | null;
  fetched_at: string;
  dedupe_key: string;
  fit_score: number | null;
  fit_reason: string | null;
  status: string;
  notes: string | null;
  status_updated_at: string | null;
}

export interface JobDocument {
  id: number;
  job_id: number;
  kind: string;
  content: string;
  created_at: string;
}

export const PIPELINE_STATUSES = [
  "new",
  "saved",
  "approved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived",
] as const;

/** An application question from a listing. `source` is 'ai' or 'user'; answer NULL = waiting on the user. */
export interface Question {
  id: number;
  job_id: number;
  question: string;
  answer: string | null;
  source: string | null;
  created_at: string;
  answered_at: string | null;
}

/**
 * One field of a scraped ATS application form, plus the value we intend to
 * submit. `needs_user` marks fields the AI couldn't honestly fill — the user
 * supplies those in the review panel before submitting.
 */
export interface PlanField {
  selector: string;
  label: string;
  type:
    | "text"
    | "email"
    | "tel"
    | "url"
    | "number"
    | "date"
    | "textarea"
    | "select"
    | "combobox"
    | "radio"
    | "checkbox"
    | "checkboxgroup"
    | "file";
  required: boolean;
  options?: string[];
  value: string;
  source: "profile" | "ai" | "user" | "attachment" | null;
  needs_user: boolean;
}

/** A prepared (scraped + AI-filled) ATS form application awaiting user review. */
export interface ApplyPlan {
  id: number;
  job_id: number;
  ats: string;
  apply_url: string;
  status: "pending_review" | "submitted";
  fields: string; // JSON-serialized PlanField[]
  created_at: string;
  updated_at: string;
}

export function getPendingPlan(jobId: number): ApplyPlan | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM apply_plans WHERE job_id = ? AND status = 'pending_review' ORDER BY created_at DESC LIMIT 1"
    )
    .get(jobId) as ApplyPlan | undefined;
}

export interface ApplicationLog {
  id: number;
  job_id: number;
  method: string;
  ok: number;
  detail: string | null;
  created_at: string;
}

export interface Profile {
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

export function getProfileSettings(): Profile | null {
  const raw = getSetting("profile");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}
