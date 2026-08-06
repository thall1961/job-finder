# Job Finder

Personal job-search tool for engineering-management roles: aggregates listings from
scrape-friendly sources, scores each one against your resume with Claude, tracks your
application pipeline, and drafts tailored resumes + cover letters per job.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Provide an Anthropic API key (needed for fit scoring and tailoring; fetching and
   tracking work without it). Either export `ANTHROPIC_API_KEY`, put it in
   `.env.local`, or log in once with `ant auth login` — the SDK picks up any of these.

3. Run the app:

   ```sh
   npm run dev
   ```

4. Open http://localhost:3000, go to **Settings**, and paste your resume. Location and
   compensation preferences are pre-seeded but editable there too.

## Usage

- **Jobs** — "Fetch new jobs" pulls listings from Remotive, We Work Remotely, RemoteOK,
  Himalayas, Working Nomads, Jobicy, and the
  latest HN "Who is hiring" thread, filtered to engineering-management titles
  (keywords editable in Settings), dedupes them, and scores up to 12 new ones per run
  (0–100 fit score with rationale). "Score unscored" processes the backlog.
- **Pipeline** — change a job's status (saved → applied → interviewing → offer) from
  any list; the Pipeline page groups everything you're tracking.
- **Job detail** — full description, score rationale, and a "Tailor resume + cover
  letter" button that drafts both from your real resume and reports job-description
  keywords missing from it (useful for automated resume screeners).

## Apply pipeline

Applications go through the employer's official channel, in order of preference:
the listing's **application form** (Greenhouse, Lever, Ashby, Workable), then
**email** only when the listing explicitly asks for email applications, then a
**manual** flag with the listing link as last resort.

1. Fill in the **Applicant profile** in Settings (contact info + screening answers).
2. Mark jobs as **approved** (from the jobs list or detail page).
3. Hit **Apply to N approved** on the Jobs page (or "Apply now" on a job page).
   For each job it tailors documents if missing, then finds the real application
   page — from the listing URL, an ATS link in the description, or by following
   the aggregator's Apply link in a headless browser. It scrapes the form and
   fills every field from your profile/resume (select and demographic questions
   pick real options; self-identification defaults to "decline to answer").
4. **Nothing is submitted automatically.** The filled form is queued for review:
   you get an ntfy push, and the job page shows every field with its drafted
   answer. Fields the AI couldn't honestly answer are highlighted and block
   submission until you fill them in. Hit **Submit application** and the browser
   fills the real form, attaches the tailored resume PDF (and cover letter PDF
   where the form takes one), submits, and records the confirmation. **Discard**
   drops the plan; hitting Apply again re-scrapes from scratch.
5. Email fallback: when a listing says "email your resume to…", the old flow
   runs — application questions are AI-answered or held for you, then the cover
   letter + resume PDF go out by email.

Notes: ATS discovery for a listing runs the browser only once (logged as
`form_unavailable` when nothing is found); forms with a visible captcha and
multi-step ATSs (Workday, Taleo) are flagged for manual apply. There is no
scheduled/automated run — applications only move when you press Apply, and form
submissions additionally require your review. Email sending requires SMTP
secrets (`SMTP_USER`, `SMTP_PASS`; optional `SMTP_HOST`, `SMTP_PORT`,
`SMTP_FROM` — defaults to Gmail over port 465). Headless Chromium comes from
Playwright locally (`npx playwright install chromium` once) and from apt in the
Docker image (`CHROMIUM_PATH`).

## Network mapper

`POST /api/connections` with a raw text paste of your LinkedIn connections page
imports your network. Jobs at companies where you have connections get a 🤝 badge,
the job detail page lists who you know there, and the fit scorer treats a warm intro
as a plus.

## Deployment (Fly.io)

Deployed at https://job-finder-thall.fly.dev behind HTTP Basic auth. The SQLite
database lives on a persistent volume mounted at `/app/data` (LAX region, single
machine, auto-stops when idle).

```sh
fly deploy -a job-finder-thall --ha=false     # redeploy after changes
fly secrets set -a job-finder-thall BASIC_AUTH_PASS=...   # rotate the password
fly logs -a job-finder-thall                  # tail logs
```

Secrets in use: `ANTHROPIC_API_KEY`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`. Auth is
enforced by `src/proxy.ts` and only activates when the auth secrets are set, so local
dev stays open.

## Notes

- Data lives in `data/jobs.db` (SQLite, gitignored).
- Scoring uses `claude-opus-5` with a server-side fallback to `claude-opus-4-8`
  enabled, so occasional safety-classifier declines are retried automatically.
- LinkedIn/Indeed block scraping, so they're deliberately not sources. See
  `FUTURE_FEATURES.md` for the roadmap (daily digest, interview prep, network mapper,
  more sources).
- `scripts/seed-preferences.mjs` re-seeds the default preferences if you ever reset
  the database.
