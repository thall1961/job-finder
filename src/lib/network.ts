import { getDb } from "./db";

export interface Connection {
  id: number;
  name: string;
  headline: string;
  company: string | null;
  position: string | null;
  url: string | null;
  email: string | null;
  connected_on: string | null;
}

export interface ConnectionEntry {
  name: string;
  headline: string;
  company: string | null;
  position?: string | null;
  url?: string | null;
  email?: string | null;
  connected_on: string | null;
}

export function ensureConnectionsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      headline TEXT NOT NULL DEFAULT '',
      company TEXT,
      connected_on TEXT,
      UNIQUE(name, headline)
    );
  `);
  const cols = (db.pragma("table_info(connections)") as { name: string }[]).map(
    (c) => c.name
  );
  for (const col of ["position", "url", "email"]) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE connections ADD COLUMN ${col} TEXT`);
    }
  }
}

/** Parse a raw copy-paste of the LinkedIn connections page into entries. */
export function parseConnectionsText(text: string): ConnectionEntry[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries: ConnectionEntry[] = [];

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

/** Character-scanning CSV row parser that handles quoted fields and "" escapes. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** True if the text looks like a LinkedIn data-export Connections.csv. */
export function isConnectionsCsv(text: string): boolean {
  return /First Name,\s*Last Name,\s*URL/i.test(text);
}

/**
 * Parse LinkedIn's official Connections.csv export
 * (Settings → Data Privacy → Get a copy of your data → Connections).
 * Columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On.
 */
export function parseConnectionsCsv(text: string): ConnectionEntry[] {
  const headerMatch = text.match(/First Name,\s*Last Name,\s*URL[^\n]*/i);
  if (!headerMatch || headerMatch.index === undefined) return [];
  const rows = parseCsvRows(text.slice(headerMatch.index));
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (label: string) => header.indexOf(label);
  const idx = {
    first: col("first name"),
    last: col("last name"),
    url: col("url"),
    email: col("email address"),
    company: col("company"),
    position: col("position"),
    connected: col("connected on"),
  };

  const entries: ConnectionEntry[] = [];
  for (const row of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
    const name = `${get(idx.first)} ${get(idx.last)}`.trim();
    if (!name) continue;
    const company = get(idx.company) || null;
    const position = get(idx.position) || null;
    const headline =
      position && company ? `${position} at ${company}` : position ?? company ?? "";
    entries.push({
      name,
      headline,
      company,
      position,
      url: get(idx.url) || null,
      email: get(idx.email) || null,
      connected_on: get(idx.connected) || null,
    });
  }
  return entries;
}

export function importConnections(entries: ConnectionEntry[]): number {
  ensureConnectionsTable();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO connections (name, headline, company, position, url, email, connected_on)
     VALUES (@name, @headline, @company, @position, @url, @email, @connected_on)
     ON CONFLICT(name, headline) DO UPDATE SET
       company = COALESCE(excluded.company, company),
       position = COALESCE(excluded.position, position),
       url = COALESCE(excluded.url, url),
       email = COALESCE(excluded.email, email),
       connected_on = COALESCE(excluded.connected_on, connected_on)`
  );
  // The CSV export is authoritative: match existing paste-imported rows by name
  // so the same person doesn't appear twice with different headlines.
  const findByName = db.prepare(
    "SELECT id FROM connections WHERE lower(name) = lower(?)"
  );
  const enrich = db.prepare(
    `UPDATE connections SET
       headline = CASE WHEN @headline != '' THEN @headline ELSE headline END,
       company = COALESCE(@company, company),
       position = COALESCE(@position, position),
       url = COALESCE(@url, url),
       email = COALESCE(@email, email),
       connected_on = COALESCE(@connected_on, connected_on)
     WHERE id = @id`
  );
  const before = connectionCount();
  // Names inserted during this run — never "enrich" those, or two distinct
  // people with the same name in one import would collapse into one row.
  const insertedThisRun = new Set<string>();
  const run = db.transaction(() => {
    for (const e of entries) {
      const params = {
        name: e.name,
        headline: e.headline,
        company: e.company,
        position: e.position ?? null,
        url: e.url ?? null,
        email: e.email ?? null,
        connected_on: e.connected_on,
      };
      const key = e.name.toLowerCase();
      const existing = findByName.all(e.name) as { id: number }[];
      if (existing.length === 1 && (e.url || e.position) && !insertedThisRun.has(key)) {
        enrich.run({ ...params, id: existing[0].id });
      } else {
        insert.run(params);
        insertedThisRun.add(key);
      }
    }
  });
  run();
  return connectionCount() - before;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Company names too generic (or artifacts of our sources) to match on.
const SKIP_COMPANIES = new Set(["unknown", "hn post", "stealth", "startup", "freelance", "self employed"]);

/** Find connections whose company/position/headline mentions the job's company. */
export function matchConnectionsForCompany(company: string): Connection[] {
  ensureConnectionsTable();
  const target = norm(company);
  if (target.length < 4 || SKIP_COMPANIES.has(target)) return [];
  const all = getDb().prepare("SELECT * FROM connections").all() as Connection[];
  return all.filter((c) => {
    const haystack = norm(`${c.company ?? ""} ${c.position ?? ""} ${c.headline}`);
    return haystack.includes(target);
  });
}

export function connectionCount(): number {
  ensureConnectionsTable();
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM connections").get() as { c: number };
  return row.c;
}

/** List connections, optionally filtered by a search term across all text fields. */
export function searchConnections(q?: string): Connection[] {
  ensureConnectionsTable();
  const db = getDb();
  if (!q || !q.trim()) {
    return db
      .prepare("SELECT * FROM connections ORDER BY name COLLATE NOCASE")
      .all() as Connection[];
  }
  const like = `%${q.trim()}%`;
  return db
    .prepare(
      `SELECT * FROM connections
       WHERE name LIKE ? OR headline LIKE ? OR company LIKE ? OR position LIKE ?
       ORDER BY name COLLATE NOCASE`
    )
    .all(like, like, like, like) as Connection[];
}
