import { NextRequest, NextResponse } from "next/server";
import {
  parseConnectionsText,
  parseConnectionsCsv,
  isConnectionsCsv,
  importConnections,
  connectionCount,
} from "@/lib/network";

export async function GET() {
  return NextResponse.json({ count: connectionCount() });
}

/**
 * Import connections. Accepts either:
 * - LinkedIn's official Connections.csv data export (preferred — includes
 *   position, company, profile URL, and email), or
 * - a raw text paste of the LinkedIn connections page.
 */
export async function POST(req: NextRequest) {
  const text = await req.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  const csv = isConnectionsCsv(text);
  const entries = csv ? parseConnectionsCsv(text) : parseConnectionsText(text);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Nothing recognized — paste the connections page or the Connections.csv export." },
      { status: 400 }
    );
  }
  const added = importConnections(entries);
  return NextResponse.json({
    format: csv ? "csv" : "paste",
    parsed: entries.length,
    added,
    total: connectionCount(),
  });
}
