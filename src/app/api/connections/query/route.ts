import { NextRequest, NextResponse } from "next/server";
import { queryNetwork } from "@/lib/claude";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "No question provided" }, { status: 400 });
  }
  try {
    const answer = await queryNetwork(question);
    return NextResponse.json({ answer });
  } catch (e) {
    console.error("network query failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
