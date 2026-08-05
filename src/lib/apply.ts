import nodemailer from "nodemailer";
import { getDb, getProfileSettings, Job, JobDocument, Profile, Question } from "./db";
import { detectApplicationQuestions, tailorForJob } from "./claude";
import { markdownToPdf } from "./pdf";
import { notify } from "./notify";

export interface ApplyResult {
  jobId: number;
  title: string;
  company: string;
  method: "email" | "manual" | "questions";
  ok: boolean;
  detail: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Pick the most application-looking email address out of a job description. */
export function extractApplicationEmail(text: string): string | null {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const candidates = matches.filter(
    (e) => !/noreply|no-reply|donotreply|example\.com|sentry|support@/i.test(e)
  );
  if (candidates.length === 0) return null;
  const preferred = candidates.find((e) =>
    /job|hiring|career|apply|recruit|talent|people|hr@/i.test(e)
  );
  return preferred ?? candidates[0];
}

function mdToPlainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1");
}

function signature(profile: Profile): string {
  const lines = [profile.name];
  if (profile.phone) lines.push(profile.phone);
  if (profile.email) lines.push(profile.email);
  if (profile.linkedin) lines.push(profile.linkedin);
  if (profile.website) lines.push(profile.website);
  return lines.filter(Boolean).join("\n");
}

function latestDoc(jobId: number, kind: string): JobDocument | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM documents WHERE job_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(jobId, kind) as JobDocument | undefined;
}

function logApplication(jobId: number, method: string, ok: boolean, detail: string) {
  getDb()
    .prepare(
      "INSERT INTO applications (job_id, method, ok, detail, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(jobId, method, ok ? 1 : 0, detail, new Date().toISOString());
}

function alreadyLogged(jobId: number, method: string): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM applications WHERE job_id = ? AND method = ? LIMIT 1")
      .get(jobId, method)
  );
}

/**
 * Make sure the listing's application questions are answered before we send.
 * Runs Claude detection once per job (marked by a 'questions_checked' log entry);
 * questions the model can't answer are stored blank, pushed to ntfy, and block
 * the application until the user fills them in on the job page.
 * Returns the answered Q&A to include in the email, or an ApplyResult when blocked.
 */
async function resolveQuestions(
  job: Job
): Promise<{ answered: Question[] } | { blocked: ApplyResult }> {
  const db = getDb();
  const base = { jobId: job.id, title: job.title, company: job.company };

  const pendingCount = () =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM questions WHERE job_id = ? AND answer IS NULL")
        .get(job.id) as { n: number }
    ).n;

  if (!alreadyLogged(job.id, "questions_checked")) {
    const saved = db
      .prepare("SELECT question, answer FROM questions WHERE job_id = ? AND answer IS NOT NULL")
      .all(job.id) as Array<{ question: string; answer: string }>;
    const detected = await detectApplicationQuestions(job, saved);
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO questions (job_id, question, answer, source, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const open: string[] = [];
    for (const q of detected) {
      if (q.needs_user || !q.answer.trim()) {
        insert.run(job.id, q.question, null, null, now, null);
        open.push(q.question);
      } else {
        insert.run(job.id, q.question, q.answer, "ai", now, now);
      }
    }
    logApplication(job.id, "questions_checked", true, `${detected.length} question(s) found, ${open.length} need input`);
    if (open.length > 0) {
      await notify(
        "Job Finder — needs your input",
        `${job.company} — ${job.title.slice(0, 60)}\n\n${open.map((q) => `• ${q}`).join("\n")}\n\nAnswer on the job page, then hit Apply again.`,
        { priority: "high", tags: "question" }
      );
    }
  }

  const pending = pendingCount();
  if (pending > 0) {
    return {
      blocked: {
        ...base,
        method: "questions",
        ok: false,
        detail: `Waiting on your answer to ${pending} application question(s) — open the job page.`,
      },
    };
  }
  const answered = db
    .prepare("SELECT * FROM questions WHERE job_id = ? AND answer IS NOT NULL ORDER BY id")
    .all(job.id) as Question[];
  return { answered };
}

export async function applyToJob(job: Job): Promise<ApplyResult> {
  const base = { jobId: job.id, title: job.title, company: job.company };
  const profile = getProfileSettings();
  if (!profile || !profile.name || !profile.email) {
    return { ...base, method: "manual", ok: false, detail: "Profile incomplete — fill it in on Settings." };
  }

  // Make sure tailored documents exist.
  let resumeDoc = latestDoc(job.id, "resume");
  let coverDoc = latestDoc(job.id, "cover_letter");
  if (!resumeDoc || !coverDoc) {
    await tailorForJob(job);
    resumeDoc = latestDoc(job.id, "resume");
    coverDoc = latestDoc(job.id, "cover_letter");
  }
  if (!resumeDoc || !coverDoc) {
    return { ...base, method: "manual", ok: false, detail: "Could not generate tailored documents." };
  }

  const email = extractApplicationEmail(job.description ?? "");
  if (!email) {
    logApplication(job.id, "manual_required", false, "No application email found — apply via the listing URL.");
    return {
      ...base,
      method: "manual",
      ok: false,
      detail: `No email in listing — apply manually: ${job.url ?? "no URL"}`,
    };
  }

  const questions = await resolveQuestions(job);
  if ("blocked" in questions) return questions.blocked;

  if (!smtpConfigured()) {
    return { ...base, method: "email", ok: false, detail: "SMTP not configured — set SMTP_USER/SMTP_PASS secrets." };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_PORT ?? "465") === "465",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  const pdf = await markdownToPdf(resumeDoc.content);
  const safeCompany = job.company.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 40);
  const qaBlock =
    questions.answered.length > 0
      ? `\n\n---\n\nYour application questions:\n\n${questions.answered
          .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
          .join("\n\n")}`
      : "";
  const body = `${mdToPlainText(coverDoc.content).trim()}${qaBlock}\n\n${signature(profile)}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER!,
    to: email,
    subject: `Application: ${job.title.slice(0, 90)} — ${profile.name}`,
    text: body,
    attachments: [
      { filename: `${profile.name.replace(/\s+/g, "_")}_Resume_${safeCompany}.pdf`, content: pdf },
    ],
  });

  getDb()
    .prepare("UPDATE jobs SET status = 'applied', status_updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), job.id);
  logApplication(job.id, "email", true, `Sent to ${email}`);
  return { ...base, method: "email", ok: true, detail: `Sent to ${email}` };
}

export async function runApplyBatch(jobId?: number): Promise<ApplyResult[]> {
  const db = getDb();
  const jobs = jobId
    ? (db.prepare("SELECT * FROM jobs WHERE id = ?").all(jobId) as Job[])
    : (db.prepare("SELECT * FROM jobs WHERE status = 'approved' ORDER BY id").all() as Job[]);

  const results: ApplyResult[] = [];
  for (const job of jobs) {
    // Jobs already flagged as manual-apply don't need re-processing — report
    // them without re-running the pipeline (or re-logging).
    if (!jobId && alreadyLogged(job.id, "manual_required")) {
      results.push({
        jobId: job.id,
        title: job.title,
        company: job.company,
        method: "manual",
        ok: false,
        detail: `No email in listing — apply manually: ${job.url ?? "no URL"}`,
      });
      continue;
    }
    try {
      results.push(await applyToJob(job));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      logApplication(job.id, "error", false, detail);
      results.push({
        jobId: job.id,
        title: job.title,
        company: job.company,
        method: "manual",
        ok: false,
        detail,
      });
    }
  }

  return results;
}
