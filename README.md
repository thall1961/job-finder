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

- **Jobs** — "Fetch new jobs" pulls listings from Remotive, We Work Remotely, and the
  latest HN "Who is hiring" thread, filtered to engineering-management titles
  (keywords editable in Settings), dedupes them, and scores up to 12 new ones per run
  (0–100 fit score with rationale). "Score unscored" processes the backlog.
- **Pipeline** — change a job's status (saved → applied → interviewing → offer) from
  any list; the Pipeline page groups everything you're tracking.
- **Job detail** — full description, score rationale, and a "Tailor resume + cover
  letter" button that drafts both from your real resume and reports job-description
  keywords missing from it (useful for automated resume screeners).

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
