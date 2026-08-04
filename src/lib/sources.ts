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
  // Word-boundary match so short keywords like "cto" don't hit inside "director"
  return keywords.some((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(lower);
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  // Single pass so already-decoded output is never re-decoded (&amp;lt; -> &lt;)
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
    if (hex || dec) {
      const cp = hex ? parseInt(hex, 16) : Number(dec);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? m;
  });
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
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

/* ---------------- RemoteOK (public JSON API) ---------------- */

async function fetchRemoteOK(keywords: string[]): Promise<FetchedJob[]> {
  const jobs: FetchedJob[] = [];
  try {
    // First array element is a legal notice, not a job
    const data = (await fetchJson("https://remoteok.com/api")) as Array<{
      position?: string;
      company?: string;
      location?: string;
      salary_min?: number;
      salary_max?: number;
      url?: string;
      description?: string;
      date?: string;
    }>;
    for (const j of data) {
      if (!j.position || !matchesKeywords(j.position, keywords)) continue;
      const salary =
        j.salary_min && j.salary_max
          ? `$${j.salary_min.toLocaleString()}–$${j.salary_max.toLocaleString()}`
          : null;
      jobs.push({
        source: "remoteok",
        title: j.position,
        company: j.company || "Unknown",
        location: j.location || "Remote",
        salary,
        url: j.url ?? "",
        description: stripHtml(j.description ?? "").slice(0, 20000),
        posted_at: j.date ?? null,
      });
    }
  } catch (e) {
    console.error("remoteok fetch failed:", e);
  }
  return jobs;
}

/* ---------------- Himalayas (public JSON API) ---------------- */

async function fetchHimalayas(keywords: string[]): Promise<FetchedJob[]> {
  const jobs: FetchedJob[] = [];
  try {
    const data = (await fetchJson("https://himalayas.app/jobs/api?limit=100")) as {
      jobs?: Array<{
        title: string;
        companyName?: string;
        description?: string;
        excerpt?: string;
        minSalary?: number;
        maxSalary?: number;
        currency?: string;
        salaryPeriod?: string;
        locationRestrictions?: string[];
        guid?: string;
        applicationLink?: string;
        pubDate?: number | string;
      }>;
    };
    for (const j of data.jobs ?? []) {
      if (!matchesKeywords(j.title, keywords)) continue;
      const salary =
        j.minSalary && j.maxSalary
          ? `${j.minSalary.toLocaleString()}–${j.maxSalary.toLocaleString()} ${j.currency ?? "USD"}`
          : null;
      jobs.push({
        source: "himalayas",
        title: j.title,
        company: j.companyName || "Unknown",
        location: j.locationRestrictions?.length
          ? `Remote (${j.locationRestrictions.join(", ")})`
          : "Remote (worldwide)",
        salary,
        url: j.guid || j.applicationLink || "",
        description: stripHtml(j.description ?? j.excerpt ?? "").slice(0, 20000),
        posted_at:
          typeof j.pubDate === "number"
            ? new Date(j.pubDate * 1000).toISOString()
            : j.pubDate ?? null,
      });
    }
  } catch (e) {
    console.error("himalayas fetch failed:", e);
  }
  return jobs;
}

/* ---------------- Working Nomads (public JSON API) ---------------- */

async function fetchWorkingNomads(keywords: string[]): Promise<FetchedJob[]> {
  const jobs: FetchedJob[] = [];
  try {
    const data = (await fetchJson(
      "https://www.workingnomads.com/api/exposed_jobs/"
    )) as Array<{
      title?: string;
      company_name?: string;
      url?: string;
      location?: string;
      description?: string;
      pub_date?: string;
    }>;
    for (const j of data) {
      if (!j.title || !matchesKeywords(j.title, keywords)) continue;
      jobs.push({
        source: "workingnomads",
        title: j.title,
        company: j.company_name || "Unknown",
        location: j.location || "Remote",
        salary: null,
        url: j.url ?? "",
        description: stripHtml(j.description ?? "").slice(0, 20000),
        posted_at: j.pub_date ? new Date(j.pub_date).toISOString() : null,
      });
    }
  } catch (e) {
    console.error("workingnomads fetch failed:", e);
  }
  return jobs;
}

/* ---------------- Jobicy (public JSON API) ---------------- */

async function fetchJobicy(keywords: string[]): Promise<FetchedJob[]> {
  const queries = ["engineering manager", "director of engineering", "vp engineering"];
  const jobs: FetchedJob[] = [];
  for (const q of queries) {
    try {
      const data = (await fetchJson(
        `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(q)}`
      )) as {
        jobs?: Array<{
          jobTitle?: string;
          companyName?: string;
          url?: string;
          jobGeo?: string;
          jobDescription?: string;
          jobExcerpt?: string;
          pubDate?: string;
        }>;
      };
      for (const j of data.jobs ?? []) {
        if (!j.jobTitle || !matchesKeywords(j.jobTitle, keywords)) continue;
        let posted: string | null = null;
        if (j.pubDate) {
          const d = new Date(j.pubDate);
          if (!Number.isNaN(d.getTime())) posted = d.toISOString();
        }
        jobs.push({
          source: "jobicy",
          title: j.jobTitle,
          company: j.companyName || "Unknown",
          location: j.jobGeo || "Remote",
          salary: null,
          url: j.url ?? "",
          description: stripHtml(j.jobDescription ?? j.jobExcerpt ?? "").slice(0, 20000),
          posted_at: posted,
        });
      }
    } catch (e) {
      console.error("jobicy fetch failed:", e);
    }
  }
  return jobs;
}

/* ---------------- HN "Who is hiring" via Algolia API ---------------- */

// HN convention: "Company | Role | Location | ..." — but posts also wedge in
// URLs, regexes, and salaries, and the last header segment runs into the body
// text once newlines are collapsed.
export function parseHnHeader(
  text: string,
  keywords: string[]
): { company: string; title: string; location: string | null; salary: string | null } {
  const segs = text.split("|").map((s) => s.trim());
  const isUrl = (s: string) => /^\(?https?:\/\/\S+\)?$/i.test(s);
  const isMeta = (s: string) =>
    /\b(remote|onsite|on-?site|hybrid|full[- ]?time|part[- ]?time|contract|intern(ship)?|permanent|multiple roles|equity|visa)\b/i.test(s) ||
    /^(all|any)$/i.test(s) ||
    /^[A-Z][A-Za-z .]+,\s*[A-Z]{2}$/.test(s) || // "New York, NY"
    /\b(sf bay|bay area|nyc|new york|san francisco|london|berlin|boston|seattle|austin|denver|chicago|los angeles|toronto)\b/i.test(s) ||
    /\$\s?\d/.test(s);
  const isRole = (s: string) =>
    /\b(engineer(ing)?|developer|manager|director|designer|scientist|architect|founder|analyst|lead|staff|principal|head of|vp|cto|devops|sre|devrel|product|growth|recruit|marketing|sales|support)\b/i.test(s);
  // A plausible header segment is short; anything long is body text.
  const rest = segs.slice(1, 7).filter((s) => s && s.length <= 90 && !isUrl(s));
  const company =
    segs[0].length <= 90
      ? segs[0].replace(/\(?https?:\/\/\S+\)?/g, "").trim().slice(0, 80) || "HN post"
      : "HN post";
  const roleLine = text
    .match(/\broles?:\s*([^.|:]{3,100})/i)?.[1]
    ?.replace(/\s+(contact|email|apply|about|location|salary|comp)$/i, "")
    .trim();
  // "Roles: [Role A, Role B] body text…" — a bracketed role list inside a
  // segment that's otherwise too long to be a header field.
  const bracketed = segs
    .slice(1, 7)
    .map((s) => s.match(/\[([^\]]{3,110})\]/)?.[1]?.trim())
    .find((s) => s && matchesKeywords(s, keywords));
  const found =
    rest.find((s) => matchesKeywords(s, keywords) && !isMeta(s)) ??
    bracketed ??
    rest.find((s) => isRole(s) && !isMeta(s)) ??
    rest.find((s) => !isMeta(s)) ??
    (roleLine && !/^https?\b/i.test(roleLine) ? roleLine : undefined);
  // Some posts lead with the role instead of the company.
  const leadsWithRole = !found && isRole(segs[0]) && segs[0].length <= 90;
  const title =
    (found ?? (leadsWithRole ? segs[0] : undefined) ?? rest[0] ?? text.slice(0, 120))
      .replace(/\s*[—–\-=>→]*\s*https?\S*$/i, "")
      .replace(/\s*\b(apply( here)?|more info|contact)\b[\s—–\-=>→]*$/i, "")
      .trim() || text.slice(0, 120);
  const location =
    rest.find((s) => s !== title && /\b(remote|onsite|on-?site|hybrid)\b/i.test(s)) ?? null;
  const salary = rest.find((s) => s !== title && /\$\s?\d/.test(s)) ?? null;
  return {
    company: leadsWithRole ? "HN post" : company,
    title: title.slice(0, 120),
    location,
    salary,
  };
}

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
      const header = parseHnHeader(text, keywords);
      jobs.push({
        source: "hn-whoishiring",
        title: header.title,
        company: header.company,
        location: header.location,
        salary: header.salary,
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
    fetchRemoteOK(keywords),
    fetchHimalayas(keywords),
    fetchWorkingNomads(keywords),
    fetchJobicy(keywords),
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
