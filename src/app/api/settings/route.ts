import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, getProfileSettings, Profile } from "@/lib/db";
import { DEFAULT_KEYWORDS } from "@/lib/sources";
import { DEFAULT_PREFERENCES } from "@/lib/defaults";

const EMPTY_PROFILE: Profile = {
  name: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  website: "",
  work_authorization: "",
  sponsorship: "",
  salary_expectation: "",
  notice_period: "",
  relocation: "",
};

export async function GET() {
  return NextResponse.json({
    resume: getSetting("resume") ?? "",
    preferences: getSetting("preferences") ?? DEFAULT_PREFERENCES,
    keywords: getSetting("keywords") ?? DEFAULT_KEYWORDS.join("\n"),
    profile: { ...EMPTY_PROFILE, ...(getProfileSettings() ?? {}) },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  for (const key of ["resume", "preferences", "keywords"] as const) {
    if (typeof body[key] === "string") setSetting(key, body[key]);
  }
  if (body.profile && typeof body.profile === "object") {
    setSetting("profile", JSON.stringify({ ...EMPTY_PROFILE, ...body.profile }));
  }
  return NextResponse.json({ ok: true });
}
