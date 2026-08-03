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

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(fit_score);
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
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "archived",
] as const;

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
