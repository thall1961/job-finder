import { NextResponse } from "next/server";
import { scoreUnscoredJobs, getProfile } from "@/lib/claude";

export const maxDuration = 300;

export async function POST() {
  if (!getProfile()) {
    return NextResponse.json(
      { error: "No resume saved. Add your resume in Settings first." },
      { status: 400 }
    );
  }
  try {
    const scored = await scoreUnscoredJobs(12);
    return NextResponse.json({ scored });
  } catch (e) {
    console.error("scoring failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
