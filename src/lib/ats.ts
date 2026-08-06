import { Job } from "./db";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable";

export interface AtsTarget {
  ats: AtsKind;
  /** URL of the page that carries the application form. */
  applyUrl: string;
}

const ATS_URL_PATTERNS: Array<{ ats: AtsKind; re: RegExp }> = [
  { ats: "greenhouse", re: /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/[^\s"'<>)\]]+/i },
  { ats: "lever", re: /https?:\/\/jobs\.(?:eu\.)?lever\.co\/[^\s"'<>)\]]+/i },
  { ats: "ashby", re: /https?:\/\/jobs\.ashbyhq\.com\/[^\s"'<>)\]]+/i },
  { ats: "workable", re: /https?:\/\/apply\.workable\.com\/[^\s"'<>)\]]+/i },
];

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|lever-|ref$|source$)/i.test(p)) u.searchParams.delete(p);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Normalize an ATS listing URL to the page that actually hosts the
 * application form (Lever and Ashby keep it on a sub-path).
 */
export function toApplyUrl(ats: AtsKind, url: string): string {
  const clean = stripTracking(url);
  switch (ats) {
    case "lever":
      return clean.endsWith("/apply") ? clean : `${clean}/apply`;
    case "ashby":
      return clean.endsWith("/application") ? clean : `${clean}/application`;
    case "workable": {
      // apply.workable.com/<account>/j/<code>[/apply]
      const m = clean.match(/^(https?:\/\/apply\.workable\.com\/[^/]+\/j\/[^/]+)/i);
      return m ? `${m[1]}/apply/` : clean;
    }
    case "greenhouse":
      return clean; // form lives on the listing page itself
  }
}

/* ---------------- Company-board probing ---------------- */

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titlesMatch(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Candidate URL slugs for a company name, e.g. "Gusto, Inc." → gusto, gustoinc, gusto-inc. */
function companySlugs(company: string): string[] {
  const cleaned = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp(oration)?|co|gmbh|technologies|labs)\b\.?/g, " ")
    .trim();
  const raw = company.toLowerCase();
  const slugs = [
    cleaned.replace(/[^a-z0-9]+/g, ""),
    cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    raw.replace(/[^a-z0-9]+/g, ""),
    raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  ].filter(Boolean);
  return [...new Set(slugs)].slice(0, 4);
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Probe the public job-board APIs of the supported ATSs for a board matching
 * the company name, then look for a posting whose title matches. Lets us find
 * the real application page even when the aggregator hides its apply link.
 */
export async function guessAtsByCompany(company: string, title: string): Promise<AtsTarget | null> {
  for (const slug of companySlugs(company)) {
    const gh = (await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`
    )) as { jobs?: Array<{ title: string; absolute_url: string }> } | null;
    const ghHit = gh?.jobs?.find((j) => titlesMatch(j.title, title));
    if (ghHit) return { ats: "greenhouse", applyUrl: toApplyUrl("greenhouse", ghHit.absolute_url) };

    const lever = (await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`)) as Array<{
      text: string;
      hostedUrl: string;
    }> | null;
    const leverHit = Array.isArray(lever)
      ? lever.find((j) => titlesMatch(j.text, title))
      : undefined;
    if (leverHit) return { ats: "lever", applyUrl: toApplyUrl("lever", leverHit.hostedUrl) };

    const ashby = (await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`)) as {
      jobs?: Array<{ title: string; jobUrl: string }>;
    } | null;
    const ashbyHit = ashby?.jobs?.find((j) => titlesMatch(j.title, title));
    if (ashbyHit) return { ats: "ashby", applyUrl: toApplyUrl("ashby", ashbyHit.jobUrl) };

    const workable = (await fetchJson(
      `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=false`
    )) as { jobs?: Array<{ title: string; url: string }> } | null;
    const workableHit = workable?.jobs?.find((j) => titlesMatch(j.title, title));
    if (workableHit) return { ats: "workable", applyUrl: toApplyUrl("workable", workableHit.url) };
  }
  return null;
}

/** Classify a URL as a supported ATS, if it is one. */
export function classifyUrl(url: string | null | undefined): AtsTarget | null {
  if (!url) return null;
  for (const { ats, re } of ATS_URL_PATTERNS) {
    const m = url.match(re);
    if (m) return { ats, applyUrl: toApplyUrl(ats, m[0]) };
  }
  return null;
}

/**
 * Find a supported ATS application page for a job without opening a browser:
 * the job's own URL, or an ATS link embedded in the description.
 */
export function findAtsTarget(job: Job): AtsTarget | null {
  return classifyUrl(job.url) ?? classifyUrl(job.description ?? undefined);
}
