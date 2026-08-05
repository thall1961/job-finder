import Anthropic from "@anthropic-ai/sdk";
import { getDb, getProfileSettings, getSetting, Job } from "./db";
import { DEFAULT_PREFERENCES } from "./defaults";
import { matchConnectionsForCompany, searchConnections } from "./network";

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
  const connections = matchConnectionsForCompany(job.company);
  const networkNote =
    connections.length > 0
      ? `\nNetwork: the candidate has ${connections.length} LinkedIn connection(s) at or associated with this company (${connections
          .slice(0, 3)
          .map((c) => c.name)
          .join(", ")}). Warm intros meaningfully raise the odds of a response — treat this as a significant plus.`
      : "";

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
        content: `<resume>\n${resume.slice(0, 12000)}\n</resume>\n\n<preferences>\n${preferences || "Open to both remote and local/hybrid roles."}\n</preferences>\n\n<job source="${job.source}">\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "unknown"}\nSalary: ${job.salary ?? "not listed"}${networkNote}\n\n${(job.description ?? "").slice(0, 6000)}\n</job>\n\nScore this job for the candidate.`,
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

/* ---------------- Network queries ---------------- */

/** Answer a free-form question about the user's LinkedIn connections. */
export async function queryNetwork(question: string): Promise<string> {
  const connections = searchConnections();
  if (connections.length === 0) {
    throw new Error("No connections imported yet.");
  }
  const roster = connections
    .map((c) => {
      const role = c.position && c.company ? `${c.position} at ${c.company}` : c.headline;
      const extras = [
        role || null,
        c.connected_on ? `connected ${c.connected_on}` : null,
      ].filter(Boolean);
      return `- ${c.name}${extras.length ? ` — ${extras.join("; ")}` : ""}`;
    })
    .join("\n");

  const pipeline = getDb()
    .prepare(
      `SELECT DISTINCT company, status FROM jobs
       WHERE status IN ('saved','approved','applied','interviewing','offer')
       ORDER BY status_updated_at DESC LIMIT 50`
    )
    .all() as { company: string; status: string }[];
  const pipelineNote = pipeline.length
    ? `\n\n<pipeline_companies>\n${pipeline
        .map((p) => `- ${p.company} (${p.status})`)
        .join("\n")}\n</pipeline_companies>`
    : "";

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: BETAS,
    fallbacks: FALLBACKS,
    output_config: { effort: "medium" },
    system:
      "You help a job seeker mine their LinkedIn connections for warm introductions, referrals, and networking opportunities. Answer questions about their network using only the connection list provided. Be specific: name the relevant people and why each one fits the question. If nothing in the network matches, say so plainly. Answer in concise Markdown.",
    messages: [
      {
        role: "user",
        content: `<connections>\n${roster}\n</connections>${pipelineNote}\n\nQuestion: ${question}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  return firstText(response.content);
}

/* ---------------- Application questions ---------------- */

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description:
        "Questions or information requests the listing explicitly asks applicants to answer when applying (beyond sending a resume and cover letter). Empty array if the listing asks none.",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, quoted or lightly paraphrased from the listing.",
          },
          answer: {
            type: "string",
            description:
              "The answer, written in the candidate's first-person voice, grounded strictly in the candidate's materials. Empty string when needs_user is true.",
          },
          needs_user: {
            type: "boolean",
            description:
              "True when the candidate's materials do not contain the information needed to answer honestly — never guess personal facts, opinions, or preferences the candidate hasn't stated.",
          },
        },
        required: ["question", "answer", "needs_user"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export interface DetectedQuestion {
  question: string;
  answer: string;
  needs_user: boolean;
}

/**
 * Find application questions in a job listing and answer the ones the candidate's
 * materials cover. Questions the model can't honestly answer come back with
 * needs_user = true so the user can fill them in.
 */
export async function detectApplicationQuestions(
  job: Job,
  savedAnswers: Array<{ question: string; answer: string }>
): Promise<DetectedQuestion[]> {
  const profile = getProfile();
  if (!profile) throw new Error("No resume saved. Add your resume in Settings first.");
  const applicant = getProfileSettings();

  const screening = applicant
    ? [
        applicant.work_authorization && `Work authorization: ${applicant.work_authorization}`,
        applicant.sponsorship && `Needs sponsorship: ${applicant.sponsorship}`,
        applicant.salary_expectation && `Salary expectation: ${applicant.salary_expectation}`,
        applicant.notice_period && `Notice period: ${applicant.notice_period}`,
        applicant.relocation && `Open to relocation: ${applicant.relocation}`,
        applicant.location && `Location: ${applicant.location}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const savedBlock = savedAnswers.length
    ? `\n\n<saved_answers>\n${savedAnswers
        .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
        .join("\n\n")}\n</saved_answers>`
    : "";

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: BETAS,
    fallbacks: FALLBACKS,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: QUESTIONS_SCHEMA },
    },
    system:
      "You screen job listings for explicit application questions — things like \"tell us about a project you're proud of\", \"include the word 'banana' in your subject line\", or \"answer: why do you want to work here?\" — that an applicant must address when applying by email. Ignore generic instructions satisfied by a resume and cover letter. Answer each question in the candidate's first-person voice using ONLY the candidate's materials; if the materials don't contain what's needed (personal anecdotes, opinions, facts they haven't stated), flag it for the candidate instead of guessing.",
    messages: [
      {
        role: "user",
        content: `<resume>\n${profile.resume.slice(0, 12000)}\n</resume>\n\n<preferences>\n${profile.preferences}\n</preferences>${
          screening ? `\n\n<screening_answers>\n${screening}\n</screening_answers>` : ""
        }${savedBlock}\n\n<job>\nTitle: ${job.title}\nCompany: ${job.company}\n\n${(job.description ?? "").slice(0, 12000)}\n</job>\n\nList the application questions in this listing and answer the ones the candidate's materials cover.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  const parsed = JSON.parse(firstText(response.content)) as { questions: DetectedQuestion[] };
  return parsed.questions ?? [];
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
