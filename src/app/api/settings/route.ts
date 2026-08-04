import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import { DEFAULT_KEYWORDS } from "@/lib/sources";
import { DEFAULT_PREFERENCES } from "@/lib/defaults";

export async function GET() {
  return NextResponse.json({
    resume: getSetting("resume") ?? "",
    preferences: getSetting("preferences") ?? DEFAULT_PREFERENCES,
    keywords: getSetting("keywords") ?? DEFAULT_KEYWORDS.join("\n"),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  for (const key of ["resume", "preferences", "keywords"] as const) {
    if (typeof body[key] === "string") setSetting(key, body[key]);
  }
  return NextResponse.json({ ok: true });
}
