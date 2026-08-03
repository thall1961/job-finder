import { NextResponse } from "next/server";
import { fetchAllSources } from "@/lib/sources";
import { scoreUnscoredJobs, getProfile } from "@/lib/claude";

export const maxDuration = 300;

export async function POST() {
  try {
    const { fetched, inserted } = await fetchAllSources();
    let scored = 0;
    if (getProfile()) {
      scored = await scoreUnscoredJobs(12);
    }
    return NextResponse.json({ fetched, inserted, scored });
  } catch (e) {
    console.error("refresh failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
