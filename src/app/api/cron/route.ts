import { NextRequest, NextResponse } from "next/server";
import { fetchAllSources } from "@/lib/sources";
import { scoreUnscoredJobs, getProfile } from "@/lib/claude";
import { getDb } from "@/lib/db";
import { notify } from "@/lib/notify";

export const maxDuration = 300;

/** Fit scores below this are auto-archived; the rest are worth a look. */
const KEEP_THRESHOLD = Number(process.env.SCORE_ARCHIVE_THRESHOLD ?? 85);
/** Cap Claude scoring calls per run so a large backlog can't run up API costs. */
const MAX_SCORED_PER_RUN = 48;

/**
 * Scheduled pipeline: fetch all sources, score everything new, archive
 * low-fit listings, and push an ntfy summary. Behind the same basic auth
 * as the rest of the app; invoked by an external scheduler (GitHub Actions).
 */
async function run() {
  const db = getDb();
  const beforeMaxId =
    (db.prepare("SELECT MAX(id) AS m FROM jobs").get() as { m: number | null }).m ?? 0;

  const { fetched, inserted } = await fetchAllSources();

  let scored = 0;
  if (getProfile()) {
    while (scored < MAX_SCORED_PER_RUN) {
      const batch = await scoreUnscoredJobs(12);
      scored += batch;
      if (batch === 0) break;
    }
  }

  const archived = db
    .prepare(
      "UPDATE jobs SET status = 'archived', status_updated_at = ? WHERE status = 'new' AND fit_score IS NOT NULL AND fit_score < ?"
    )
    .run(new Date().toISOString(), KEEP_THRESHOLD).changes;

  const kept = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE id > ? AND status = 'new' AND fit_score >= ?"
      )
      .get(beforeMaxId, KEEP_THRESHOLD) as { n: number }
  ).n;

  const summary = { fetched, inserted, scored, archived, kept };
  await notify(
    `Job fetch: ${kept} worth a look`,
    `${inserted} new listings (${fetched} fetched, ${scored} scored). ` +
      `${kept} scored ${KEEP_THRESHOLD}+ and are waiting in Jobs; ${archived} auto-archived below ${KEEP_THRESHOLD}.`,
    { priority: kept > 0 ? "high" : "low", tags: kept > 0 ? "dart" : "zzz" }
  );
  return summary;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("x-cron-secret") === secret;
  // No CRON_SECRET set: open only in unprotected local dev, never on a
  // basic-auth-protected deployment (this route bypasses the auth proxy).
  return !process.env.BASIC_AUTH_USER;
}

async function handler(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await run());
  } catch (e) {
    console.error("cron run failed:", e);
    await notify("Job fetch failed", String(e), { priority: "high", tags: "rotating_light" });
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handler(req);
}

export async function GET(req: NextRequest) {
  return handler(req);
}
