import Anthropic from "@anthropic-ai/sdk";
import { getDb, getSetting, Job } from "./db";
import { DEFAULT_PREFERENCES } from "./defaults";

const MODEL = "claude-opus-5";
const FALLBACKS = [{ model: "claude-opus-4-8" }];
const BETAS = ["server-side-fallback-2026-06-01"];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function firstText(content: Array<{ type: string }>): string {
  const block = content.find((b) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return block?.text ?? "";
}

export function getProfile(): { resume: string; preferences: string } | null {
  const resume = getSetting("resume");
  if (!resume || !resume.trim()) return null;
  return { resume, preferences: getSetting("preferences") ?? DEFAULT_PREFERENCES };
}

/* ---------------- Fit scoring ---------------- */

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description:
        "Fit score from 0 to 100. 80+ means apply now, 60-79 worth a look, below 40 skip.",
    },
    reason: {
      type: "string",
      description:
        "Two or three sentences explaining the score: seniority match, domain match, location fit, and any red flags.",
    },
  },
  required: ["score", "reason"],
  additionalProperties: false,
} as const;

export async function scoreJob(
  job: Job,
  resume: string,
  preferences: string
): Promise<{ score: number; reason: string } | null> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: BETAS,
    fallbacks: FALLBACKS,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCORE_SCHEMA },
    },
    system:
      "You are a pragmatic career advisor scoring job listings for a candidate seeking engineering management roles (manager, director, VP, CTO). Score how well each listing fits the candidate's resume and preferences. Be discriminating: most listings should not score above 80.",
    messages: [
      {
        role: "user",
        content: `<resume>\n${resume.slice(0, 12000)}\n</resume>\n\n<preferences>\n${preferences || "Open to both remote and local/hybrid roles."}\n</preferences>\n\n<job source="${job.source}">\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "unknown"}\nSalary: ${job.salary ?? "not listed"}\n\n${(job.description ?? "").slice(0, 6000)}\n</job>\n\nScore this job for the candidate.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return null;
  try {
    const parsed = JSON.parse(firstText(response.content));
    return { score: parsed.score, reason: parsed.reason };
  } catch {
    return null;
  }
}

export async function scoreUnscoredJobs(limit = 12): Promise<number> {
  const profile = getProfile();
  if (!profile) return 0;
  const db = getDb();
  const jobs = db
    .prepare(
      "SELECT * FROM jobs WHERE fit_score IS NULL AND status != 'archived' ORDER BY fetched_at DESC LIMIT ?"
    )
    .all(limit) as Job[];
  const update = db.prepare("UPDATE jobs SET fit_score = ?, fit_reason = ? WHERE id = ?");
  let scored = 0;
  for (const job of jobs) {
    try {
      const result = await scoreJob(job, profile.resume, profile.preferences);
      if (result) {
        update.run(result.score, result.reason, job.id);
        scored++;
      }
    } catch (e) {
      console.error(`scoring job ${job.id} failed:`, e);
    }
  }
  return scored;
}

/* ---------------- Tailoring ---------------- */

const TAILOR_SCHEMA = {
  type: "object",
  properties: {
    tailored_resume: {
      type: "string",
      description:
        "The candidate's resume rewritten in Markdown, reordered and rephrased to emphasize experience most relevant to this job. Never invent experience that is not in the original resume.",
    },
    cover_letter: {
      type: "string",
      description:
        "A concise, specific cover letter draft in Markdown (under 350 words) connecting the candidate's actual experience to this role and company.",
    },
    missing_keywords: {
      type: "array",
      items: { type: "string" },
      description:
        "Important keywords from the job description that appear neither in the original nor tailored resume — gaps the candidate should be aware of.",
    },
  },
  required: ["tailored_resume", "cover_letter", "missing_keywords"],
  additionalProperties: false,
} as const;

export interface TailorResult {
  tailored_resume: string;
  cover_letter: string;
  missing_keywords: string[];
}

export async function tailorForJob(job: Job): Promise<TailorResult> {
  const profile = getProfile();
  if (!profile) throw new Error("No resume saved. Add your resume in Settings first.");

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: FALLBACKS,
    output_config: {
      format: { type: "json_schema", schema: TAILOR_SCHEMA },
    },
    system:
      "You tailor resumes and draft cover letters for a candidate pursuing engineering leadership roles. Ground everything in the candidate's real experience — never fabricate roles, metrics, or skills. Mirror the job description's terminology where the candidate genuinely has the experience, to help with automated resume screeners.",
    messages: [
      {
        role: "user",
        content: `<resume>\n${profile.resume.slice(0, 12000)}\n</resume>\n\n<preferences>\n${profile.preferences}\n</preferences>\n\n<job>\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "unknown"}\n\n${(job.description ?? "").slice(0, 12000)}\n</job>\n\nProduce the tailored resume, cover letter draft, and missing-keyword report.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  const parsed = JSON.parse(firstText(response.content)) as TailorResult;

  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO documents (job_id, kind, content, created_at) VALUES (?, ?, ?, ?)"
  );
  insert.run(job.id, "resume", parsed.tailored_resume, now);
  insert.run(job.id, "cover_letter", parsed.cover_letter, now);
  insert.run(job.id, "keywords", JSON.stringify(parsed.missing_keywords), now);
  return parsed;
}
