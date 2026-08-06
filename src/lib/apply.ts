import nodemailer from "nodemailer";
import {
  getDb,
  getPendingPlan,
  getProfileSettings,
  ApplyPlan,
  Job,
  JobDocument,
  PlanField,
  Profile,
  Question,
} from "./db";
import { detectApplicationQuestions, mapFormFields, tailorForJob } from "./claude";
import { markdownToPdf } from "./pdf";
import { notify } from "./notify";
import { findAtsTarget, guessAtsByCompany, AtsTarget } from "./ats";
import {
  discoverAtsWithBrowser,
  scrapeApplicationForm,
  submitApplicationForm,
  Attachment,
} from "./formfill";

export interface ApplyResult {
  jobId: number;
  title: string;
  company: string;
  method: "form" | "review" | "email" | "manual" | "questions";
  ok: boolean;
  detail: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Find an email address the listing explicitly asks applications to be sent
 * to. Requires apply-ish wording near the address — a bare contact email is
 * not an invitation to apply by email, and most employers expect applications
 * through their form.
 */
export function extractApplicationEmail(text: string): string | null {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let fallback: string | null = null;
  for (const m of text.matchAll(re)) {
    const email = m[0];
    if (/noreply|no-reply|donotreply|example\.com|sentry|support@/i.test(email)) continue;
    const context = text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + email.length + 60);
    if (!/apply|application|send|submit|email (me|us|your)|resume|cv|cover letter|interested/i.test(context))
      continue;
    if (/job|hiring|career|apply|recruit|talent|people|hr@/i.test(email)) return email;
    fallback ??= email;
  }
  return fallback;
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

function savedAnswers(jobId: number): Array<{ question: string; answer: string }> {
  return getDb()
    .prepare("SELECT question, answer FROM questions WHERE job_id = ? AND answer IS NOT NULL")
    .all(jobId) as Array<{ question: string; answer: string }>;
}

function markApplied(jobId: number) {
  getDb()
    .prepare("UPDATE jobs SET status = 'applied', status_updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), jobId);
}

/* ---------------- Form (ATS) applications ---------------- */

/**
 * Scrape the ATS form, have Claude fill it from the candidate's materials,
 * and store the result as a pending_review plan. Nothing is submitted here —
 * the user reviews and submits from the job page.
 */
async function prepareFormApplication(
  job: Job,
  target: AtsTarget,
  coverLetter: string
): Promise<ApplyResult> {
  const base = { jobId: job.id, title: job.title, company: job.company };
  const scrape = await scrapeApplicationForm(target.applyUrl);
  const substantive = scrape.fields.filter((f) => f.type !== "checkbox");
  if (substantive.length < 3) {
    throw new Error(`No usable application form at ${target.applyUrl}`);
  }

  const coverText = mdToPlainText(coverLetter).trim();
  const nonFile = scrape.fields.filter((f) => f.type !== "file");
  const mapped = await mapFormFields(job, nonFile, coverText, savedAnswers(job.id));
  const bySelector = new Map(mapped.map((m) => [m.selector, m]));

  const fields: PlanField[] = scrape.fields.map((f) => {
    if (f.type === "file") {
      return {
        ...f,
        value: /cover/i.test(`${f.label} ${f.selector}`)
          ? "Cover letter PDF (attached automatically)"
          : "Tailored resume PDF (attached automatically)",
        source: "attachment",
        needs_user: false,
      };
    }
    const m = bySelector.get(f.selector);
    const value = (m?.value ?? "").replace(/\[\[COVER_LETTER\]\]/g, coverText);
    const needsUser = m ? m.needs_user || (f.required && !value.trim()) : f.required;
    return { ...f, value, source: value ? "ai" : null, needs_user: needsUser };
  });

  const now = new Date().toISOString();
  const applyUrl = /^https?:/.test(scrape.finalUrl) ? scrape.finalUrl : target.applyUrl;
  getDb()
    .prepare(
      "INSERT INTO apply_plans (job_id, ats, apply_url, status, fields, created_at, updated_at) VALUES (?, ?, ?, 'pending_review', ?, ?, ?)"
    )
    .run(job.id, target.ats, applyUrl, JSON.stringify(fields), now, now);

  const needsInput = fields.filter((f) => f.needs_user).length;
  await notify(
    "Job Finder — application ready to review",
    `${job.company} — ${job.title.slice(0, 60)}\n${target.ats} form filled${
      needsInput ? `, ${needsInput} answer(s) need you` : ""
    }. Review & submit on the job page.`,
    { priority: needsInput ? "high" : "default", tags: "clipboard" }
  );
  return {
    ...base,
    method: "review",
    ok: true,
    detail: `${target.ats} form filled${
      needsInput ? ` — ${needsInput} answer(s) need you` : ""
    }. Review & submit on the job page.`,
  };
}

/**
 * Submit a reviewed plan. `edits` maps field selector → user-corrected value.
 * Returns a human-readable outcome; the plan stays pending_review on failure
 * so the user can adjust and retry.
 */
export async function submitApplyPlan(
  planId: number,
  edits: Record<string, string>
): Promise<{ ok: boolean; detail: string }> {
  const db = getDb();
  const plan = db.prepare("SELECT * FROM apply_plans WHERE id = ?").get(planId) as
    | ApplyPlan
    | undefined;
  if (!plan) return { ok: false, detail: "Plan not found." };
  if (plan.status !== "pending_review") return { ok: false, detail: `Plan already ${plan.status}.` };
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(plan.job_id) as Job | undefined;
  if (!job) return { ok: false, detail: "Job not found." };
  const profile = getProfileSettings();
  if (!profile?.name) return { ok: false, detail: "Profile incomplete — fill it in on Settings." };

  const fields = (JSON.parse(plan.fields) as PlanField[]).map((f) => {
    if (f.type === "file" || !(f.selector in edits)) return f;
    const value = edits[f.selector];
    if (value === f.value) return f;
    return { ...f, value, source: "user" as const, needs_user: false };
  });

  const missing = fields.filter(
    (f) =>
      f.required &&
      !["file", "checkbox", "checkboxgroup"].includes(f.type) &&
      !f.value.trim()
  );
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `Required answers missing: ${missing.map((f) => f.label).join(", ")}`,
    };
  }

  // Persist edits so a failed submit doesn't lose them.
  db.prepare("UPDATE apply_plans SET fields = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(fields),
    new Date().toISOString(),
    planId
  );

  const safeCompany = job.company.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 40);
  const safeName = profile.name.replace(/\s+/g, "_");
  const attachments: Attachment[] = [];
  const resumeDoc = latestDoc(job.id, "resume");
  if (!resumeDoc) return { ok: false, detail: "No tailored resume found — run Tailor first." };
  attachments.push({
    name: `${safeName}_Resume_${safeCompany}.pdf`,
    buffer: await markdownToPdf(resumeDoc.content),
  });
  const coverDoc = latestDoc(job.id, "cover_letter");
  if (coverDoc && fields.some((f) => f.type === "file" && /cover/i.test(`${f.label} ${f.selector}`))) {
    attachments.push({
      name: `${safeName}_Cover_Letter_${safeCompany}.pdf`,
      buffer: await markdownToPdf(coverDoc.content),
    });
  }

  const result = await submitApplicationForm(plan.apply_url, fields, attachments);
  if (result.ok) {
    db.prepare("UPDATE apply_plans SET status = 'submitted', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      planId
    );
    markApplied(job.id);
    logApplication(job.id, "form", true, `${result.detail} (${plan.ats})`);
  } else {
    logApplication(job.id, "form_error", false, result.detail);
  }
  return result;
}

/* ---------------- Email applications ---------------- */

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
    const detected = await detectApplicationQuestions(job, savedAnswers(job.id));
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

async function applyByEmail(
  job: Job,
  email: string,
  profile: Profile,
  resumeDoc: JobDocument,
  coverDoc: JobDocument
): Promise<ApplyResult> {
  const base = { jobId: job.id, title: job.title, company: job.company };
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

  markApplied(job.id);
  logApplication(job.id, "email", true, `Sent to ${email}`);
  return { ...base, method: "email", ok: true, detail: `Sent to ${email}` };
}

/* ---------------- Orchestration ---------------- */

/**
 * Apply to one job, preferring the official application form:
 * 1. An existing pending plan → point the user at the review panel.
 * 2. A supported ATS form (from the URL, the description, or by following the
 *    listing's Apply links) → scrape + AI-fill it and queue it for review.
 * 3. A listing that explicitly asks for email applications → email flow.
 * 4. Otherwise → flag for manual apply.
 */
export async function applyToJob(job: Job): Promise<ApplyResult> {
  const base = { jobId: job.id, title: job.title, company: job.company };
  const profile = getProfileSettings();
  if (!profile || !profile.name || !profile.email) {
    return { ...base, method: "manual", ok: false, detail: "Profile incomplete — fill it in on Settings." };
  }

  const pending = getPendingPlan(job.id);
  if (pending) {
    return {
      ...base,
      method: "review",
      ok: true,
      detail: "Application form ready — review & submit on the job page.",
    };
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

  // Prefer the official application form.
  let formNote = "";
  let target = findAtsTarget(job);
  if (!target && !alreadyLogged(job.id, "form_unavailable")) {
    // Cheap first: the big ATSs expose public job-board APIs, so probe them
    // by company name + title. Browser-follow the listing's Apply link last.
    target = await guessAtsByCompany(job.company, job.title).catch(() => null);
    if (!target && job.url) {
      try {
        target = await discoverAtsWithBrowser(job.url);
      } catch (e) {
        console.error(`ATS discovery failed for job ${job.id}:`, e);
      }
    }
    if (!target) {
      logApplication(job.id, "form_unavailable", false, "No supported ATS form found from the listing.");
    }
  }
  if (target) {
    try {
      return await prepareFormApplication(job, target, coverDoc.content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logApplication(job.id, "form_error", false, msg);
      formNote = "Form apply failed; ";
    }
  }

  // Email only when the listing explicitly asks for it.
  const email = extractApplicationEmail(job.description ?? "");
  if (email) {
    const result = await applyByEmail(job, email, profile, resumeDoc, coverDoc);
    return formNote ? { ...result, detail: formNote + result.detail } : result;
  }

  logApplication(job.id, "manual_required", false, "No application form or email instruction found — apply via the listing URL.");
  return {
    ...base,
    method: "manual",
    ok: false,
    detail: `${formNote}No form or email found — apply manually: ${job.url ?? "no URL"}`,
  };
}

export async function runApplyBatch(jobId?: number): Promise<ApplyResult[]> {
  const db = getDb();
  const jobs = jobId
    ? (db.prepare("SELECT * FROM jobs WHERE id = ?").all(jobId) as Job[])
    : (db.prepare("SELECT * FROM jobs WHERE status = 'approved' ORDER BY id").all() as Job[]);

  const results: ApplyResult[] = [];
  for (const job of jobs) {
    // Jobs already flagged as manual-apply don't need re-processing — report
    // them without re-running the pipeline (or re-logging). A single-job run
    // (the job page's Apply button) always retries.
    if (!jobId && alreadyLogged(job.id, "manual_required") && !getPendingPlan(job.id)) {
      results.push({
        jobId: job.id,
        title: job.title,
        company: job.company,
        method: "manual",
        ok: false,
        detail: `Flagged for manual apply: ${job.url ?? "no URL"}`,
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
