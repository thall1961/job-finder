import nodemailer from "nodemailer";
import { getDb, getProfileSettings, Job, JobDocument, Profile } from "./db";
import { tailorForJob } from "./claude";
import { markdownToPdf } from "./pdf";
import { notify } from "./notify";

export interface ApplyResult {
  jobId: number;
  title: string;
  company: string;
  method: "email" | "manual";
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
  const body = `${mdToPlainText(coverDoc.content).trim()}\n\n${signature(profile)}`;

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
    // In batch mode, skip jobs we've already flagged as manual so ntfy
    // doesn't repeat the same alert every day.
    if (!jobId && alreadyLogged(job.id, "manual_required")) continue;
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

  if (results.length > 0) {
    const sent = results.filter((r) => r.ok);
    const manual = results.filter((r) => !r.ok && r.method === "manual");
    const failed = results.filter((r) => !r.ok && r.method === "email");
    const lines: string[] = [];
    if (sent.length)
      lines.push(`Applied to ${sent.length}:`, ...sent.map((r) => `  ✓ ${r.company} — ${r.title.slice(0, 60)}`));
    if (manual.length)
      lines.push(`Needs manual apply (${manual.length}):`, ...manual.map((r) => `  → ${r.company}: ${r.detail}`));
    if (failed.length)
      lines.push(`Failed (${failed.length}):`, ...failed.map((r) => `  ✗ ${r.company}: ${r.detail}`));
    await notify(
      "Job Finder — apply run",
      lines.join("\n"),
      { priority: failed.length > 0 ? "high" : "default", tags: failed.length > 0 ? "warning" : "briefcase" }
    );
  }

  return results;
}
