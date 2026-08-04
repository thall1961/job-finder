import { getDb } from "./db";

export interface Connection {
  id: number;
  name: string;
  headline: string;
  company: string | null;
  connected_on: string | null;
}

export function ensureConnectionsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      headline TEXT NOT NULL DEFAULT '',
      company TEXT,
      connected_on TEXT,
      UNIQUE(name, headline)
    );
  `);
}

/** Parse a raw copy-paste of the LinkedIn connections page into entries. */
export function parseConnectionsText(
  text: string
): Array<{ name: string; headline: string; company: string | null; connected_on: string | null }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries: Array<{ name: string; headline: string; company: string | null; connected_on: string | null }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/[’']s profile picture$/.test(line)) continue;

    // Name is the next non-empty line.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const name = lines[j]?.trim();
    if (!name) continue;

    // Headline lines run until "Connected on ..." or "Message".
    const headlineParts: string[] = [];
    let connectedOn: string | null = null;
    for (let k = j + 1; k < lines.length && k < j + 12; k++) {
      const l = lines[k].trim();
      if (l === "" || l === "Message") continue;
      const conn = l.match(/^Connected on (.+)$/);
      if (conn) {
        connectedOn = conn[1];
        break;
      }
      if (/[’']s profile picture$/.test(l)) break;
      headlineParts.push(l);
    }
    const headline = headlineParts.join(" | ");

    // Company: text after the last " at " segment, trimmed at the next delimiter.
    let company: string | null = null;
    const atMatch = headline.match(/\bat ([^|•,;]+)/);
    if (atMatch) company = atMatch[1].trim();

    entries.push({ name, headline, company, connected_on: connectedOn });
  }
  return entries;
}

export function importConnections(
  entries: Array<{ name: string; headline: string; company: string | null; connected_on: string | null }>
): number {
  ensureConnectionsTable();
  const db = getDb();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO connections (name, headline, company, connected_on) VALUES (?, ?, ?, ?)"
  );
  let added = 0;
  const run = db.transaction(() => {
    for (const e of entries) {
      added += insert.run(e.name, e.headline, e.company, e.connected_on).changes;
    }
  });
  run();
  return added;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Company names too generic (or artifacts of our sources) to match on.
const SKIP_COMPANIES = new Set(["unknown", "hn post", "stealth", "startup", "freelance", "self employed"]);

/** Find connections whose company/headline mentions the job's company. */
export function matchConnectionsForCompany(company: string): Connection[] {
  ensureConnectionsTable();
  const target = norm(company);
  if (target.length < 4 || SKIP_COMPANIES.has(target)) return [];
  const all = getDb().prepare("SELECT * FROM connections").all() as Connection[];
  return all.filter((c) => {
    const haystack = norm(`${c.company ?? ""} ${c.headline}`);
    return haystack.includes(target);
  });
}

export function connectionCount(): number {
  ensureConnectionsTable();
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM connections").get() as { c: number };
  return row.c;
}
