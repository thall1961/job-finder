import { NextRequest, NextResponse } from "next/server";
import { parseConnectionsText, importConnections, connectionCount } from "@/lib/network";

export async function GET() {
  return NextResponse.json({ count: connectionCount() });
}

/** Import connections from a raw text paste of the LinkedIn connections page. */
export async function POST(req: NextRequest) {
  const text = await req.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  const entries = parseConnectionsText(text);
  const added = importConnections(entries);
  return NextResponse.json({ parsed: entries.length, added, total: connectionCount() });
}
