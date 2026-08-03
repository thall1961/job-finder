import { XMLParser } from "fast-xml-parser";
import { getDb, getSetting } from "./db";

export interface FetchedJob {
  source: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: string;
  posted_at: string | null;
}

export const DEFAULT_KEYWORDS = [
  "engineering manager",
  "engineering management",
  "director of engineering",
  "engineering director",
  "head of engineering",
  "vp of engineering",
  "vp engineering",
  "vp, engineering",
  "cto",
  "chief technology officer",
  "head of platform",
  "director of software",
];

export function getKeywords(): string[] {
  const raw = getSetting("keywords");
  if (!raw) return DEFAULT_KEYWORDS;
  const parsed = raw
    .split("\n")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_KEYWORDS;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "job-finder (personal job search tool)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/* ---------------- Remotive (public API, scrape-friendly) ---------------- */

async function fetchRemotive(keywords: string[]): Promise<FetchedJob[]> {
  const queries = ["engineering manager", "director of engineering", "VP engineering"];
  const jobs: FetchedJob[] = [];
  for (const q of queries) {
    try {
      const data = (await fetchJson(
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`
      )) as {
        jobs?: Array<{
          title: string;
          company_name: string;
          candidate_required_location?: string;
          salary?: string;
          url: string;
          description?: string;
          publication_date?: string;
        }>;
      };
      for (const j of data.jobs ?? []) {
        if (!matchesKeywords(j.title, keywords)) continue;
        jobs.push({
          source: "remotive",
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || "Remote",
          salary: j.salary || null,
          url: j.url,
          description: stripHtml(j.description ?? "").slice(0, 20000),
          posted_at: j.publication_date ?? null,
        });
      }
    } catch (e) {
      console.error("remotive fetch failed:", e);
    }
  }
  return jobs;
}

/* ---------------- We Work Remotely (public RSS) ---------------- */

async function fetchWeWorkRemotely(keywords: string[]): Promise<FetchedJob[]> {
  const jobs: FetchedJob[] = [];
  try {
    const res = await fetch("https://weworkremotely.com/remote-jobs.rss", {
      headers: { "User-Agent": "job-finder (personal job search tool)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`WWR RSS -> HTTP ${res.status}`);
    const xml = await res.text();
    const parser = new XMLParser();
    const feed = parser.parse(xml);
    const items: Array<{
      title?: string;
      link?: string;
      description?: string;
      pubDate?: string;
      region?: string;
    }> = feed?.rss?.channel?.item ?? [];
    for (const item of items) {
      const rawTitle = String(item.title ?? "");
      if (!matchesKeywords(rawTitle, keywords)) continue;
      // WWR titles look like "Company: Job Title"
      const sep = rawTitle.indexOf(":");
      const company = sep > 0 ? rawTitle.slice(0, sep).trim() : "Unknown";
      const title = sep > 0 ? rawTitle.slice(sep + 1).trim() : rawTitle;
      jobs.push({
        source: "weworkremotely",
        title,
        company,
        location: item.region ? String(item.region) : "Remote",
        salary: null,
        url: String(item.link ?? ""),
        description: stripHtml(String(item.description ?? "")).slice(0, 20000),
        posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      });
    }
  } catch (e) {
    console.error("weworkremotely fetch failed:", e);
  }
  return jobs;
}

/* ---------------- HN "Who is hiring" via Algolia API ---------------- */

async function fetchHackerNews(keywords: string[]): Promise<FetchedJob[]> {
  const jobs: FetchedJob[] = [];
  try {
    const search = (await fetchJson(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10"
    )) as { hits?: Array<{ objectID: string; title: string; created_at: string }> };
    const thread = (search.hits ?? []).find((h) =>
      h.title.toLowerCase().includes("who is hiring")
    );
    if (!thread) return jobs;

    const comments = (await fetchJson(
      `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&hitsPerPage=1000`
    )) as {
      hits?: Array<{
        objectID: string;
        comment_text?: string;
        created_at: string;
        parent_id?: number;
      }>;
    };
    for (const c of comments.hits ?? []) {
      // Only top-level comments (job posts reply directly to the thread)
      if (String(c.parent_id) !== thread.objectID) continue;
      const text = stripHtml(c.comment_text ?? "");
      if (!text || !matchesKeywords(text, keywords)) continue;
      // HN convention: "Company | Role | Location | ..."
      const firstLine = text.split(/(?<=\.)\s|\|/)[0] ?? "";
      const company = firstLine.trim().slice(0, 80) || "HN post";
      jobs.push({
        source: "hn-whoishiring",
        title: text.slice(0, 120),
        company,
        location: null,
        salary: null,
        url: `https://news.ycombinator.com/item?id=${c.objectID}`,
        description: text.slice(0, 20000),
        posted_at: c.created_at,
      });
    }
  } catch (e) {
    console.error("hn fetch failed:", e);
  }
  return jobs;
}

/* ---------------- Ingestion ---------------- */

function dedupeKey(job: FetchedJob): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${norm(job.company)}|${norm(job.title).slice(0, 60)}`;
}

export async function fetchAllSources(): Promise<{ fetched: number; inserted: number }> {
  const keywords = getKeywords();
  const results = await Promise.all([
    fetchRemotive(keywords),
    fetchWeWorkRemotely(keywords),
    fetchHackerNews(keywords),
  ]);
  const all = results.flat();

  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (source, title, company, location, salary, url, description, posted_at, fetched_at, dedupe_key)
    VALUES
      (@source, @title, @company, @location, @salary, @url, @description, @posted_at, @fetched_at, @dedupe_key)
  `);
  let inserted = 0;
  const now = new Date().toISOString();
  const insertMany = db.transaction((jobs: FetchedJob[]) => {
    for (const job of jobs) {
      const info = insert.run({
        ...job,
        fetched_at: now,
        dedupe_key: dedupeKey(job),
      });
      inserted += info.changes;
    }
  });
  insertMany(all);
  return { fetched: all.length, inserted };
}
