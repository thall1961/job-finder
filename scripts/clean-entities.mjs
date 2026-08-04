// One-off cleanup: decode HTML entities left in existing rows by the old
// stripHtml, and re-parse hn-whoishiring titles from the post header.
// Usage: node scripts/clean-entities.mjs
import Database from "better-sqlite3";
import path from "path";

const NAMED_ENTITIES = {
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

function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
    if (hex || dec) {
      const cp = hex ? parseInt(hex, 16) : Number(dec);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? m;
  });
}

// Mirrors parseHnHeader in src/lib/sources.ts
function parseHnHeader(text, keywords) {
  const segs = text.split("|").map((s) => s.trim());
  const isUrl = (s) => /^\(?https?:\/\/\S+\)?$/i.test(s);
  const isMeta = (s) =>
    /\b(remote|onsite|on-?site|hybrid|full[- ]?time|part[- ]?time|contract|intern(ship)?|permanent|multiple roles|equity|visa)\b/i.test(s) ||
    /^(all|any)$/i.test(s) ||
    /^[A-Z][A-Za-z .]+,\s*[A-Z]{2}$/.test(s) ||
    /\b(sf bay|bay area|nyc|new york|san francisco|london|berlin|boston|seattle|austin|denver|chicago|los angeles|toronto)\b/i.test(s) ||
    /\$\s?\d/.test(s);
  const isRole = (s) =>
    /\b(engineer(ing)?|developer|manager|director|designer|scientist|architect|founder|analyst|lead|staff|principal|head of|vp|cto|devops|sre|devrel|product|growth|recruit|marketing|sales|support)\b/i.test(s);
  const matches = (s) => keywords.some((k) => s.toLowerCase().includes(k));
  const rest = segs.slice(1, 7).filter((s) => s && s.length <= 90 && !isUrl(s));
  const company =
    segs[0].length <= 90
      ? segs[0].replace(/\(?https?:\/\/\S+\)?/g, "").trim().slice(0, 80) || "HN post"
      : "HN post";
  const roleLine = text
    .match(/\broles?:\s*([^.|:]{3,100})/i)?.[1]
    ?.replace(/\s+(contact|email|apply|about|location|salary|comp)$/i, "")
    .trim();
  const bracketed = segs
    .slice(1, 7)
    .map((s) => s.match(/\[([^\]]{3,110})\]/)?.[1]?.trim())
    .find((s) => s && matches(s));
  const found =
    rest.find((s) => matches(s) && !isMeta(s)) ??
    bracketed ??
    rest.find((s) => isRole(s) && !isMeta(s)) ??
    rest.find((s) => !isMeta(s)) ??
    (roleLine && !/^https?\b/i.test(roleLine) ? roleLine : undefined);
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

const db = new Database(path.join(process.cwd(), "data", "jobs.db"));
db.pragma("journal_mode = WAL");

const keywordsRaw = db
  .prepare("SELECT value FROM settings WHERE key = 'keywords'")
  .get()?.value;
const keywords = (keywordsRaw ?? "engineering manager\nengineering management\ndirector of engineering\nengineering director\nhead of engineering\nvp of engineering\nvp engineering\nvp, engineering\ncto\nchief technology officer\nhead of platform\ndirector of software")
  .split("\n")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

const jobs = db.prepare("SELECT * FROM jobs").all();
const update = db.prepare(
  "UPDATE jobs SET title = ?, company = ?, location = ?, salary = ?, description = ? WHERE id = ?"
);
const updateKey = db.prepare("UPDATE jobs SET dedupe_key = ? WHERE id = ?");

// Mirrors dedupeKey in src/lib/sources.ts — keys must match what a re-fetch
// of the same post would now generate, or every job comes back as a duplicate.
function dedupeKey(company, title) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${norm(company)}|${norm(title).slice(0, 60)}`;
}

let changed = 0;
db.transaction(() => {
  for (const job of jobs) {
    const description = job.description ? decodeEntities(job.description) : job.description;
    let { title, company, location, salary } = job;
    if (job.source === "hn-whoishiring" && description) {
      ({ title, company, location, salary } = parseHnHeader(description, keywords));
    } else {
      title = decodeEntities(title);
      company = decodeEntities(company);
      location = location ? decodeEntities(location) : location;
    }
    if (
      title !== job.title ||
      company !== job.company ||
      location !== job.location ||
      salary !== job.salary ||
      description !== job.description
    ) {
      update.run(title, company, location, salary, description, job.id);
      changed++;
    }
    const key = dedupeKey(company, title);
    if (key !== job.dedupe_key) {
      try {
        updateKey.run(key, job.id);
      } catch {
        // UNIQUE conflict: another row already owns this key — leave the old one
      }
    }
  }
})();

console.log(`Updated ${changed} of ${jobs.length} jobs.`);
