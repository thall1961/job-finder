import Link from "next/link";
import { searchConnections, connectionCount } from "@/lib/network";
import AskNetwork from "@/components/AskNetwork";
import ConnectionsImport from "@/components/ConnectionsImport";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const total = connectionCount();
  const connections = searchConnections(q);

  return (
    <div>
      <h1>
        Network <span className="muted small">({total} connections)</span>
      </h1>

      <ConnectionsImport />
      {total > 0 && <AskNetwork />}

      <form className="toolbar" method="GET" style={{ marginTop: "1rem" }}>
        <input
          name="q"
          placeholder="Filter by name, company, or title…"
          defaultValue={q ?? ""}
          style={{ flex: 1, maxWidth: "24rem" }}
        />
        <button type="submit">Search</button>
        {q && (
          <Link className="small" href="/connections">
            Clear
          </Link>
        )}
      </form>

      {total === 0 && (
        <p className="muted">
          No connections imported yet — use the import box above to get started.
        </p>
      )}
      {total > 0 && q && (
        <p className="small muted">
          {connections.length} match{connections.length === 1 ? "" : "es"} for “{q}”
        </p>
      )}

      {connections.map((c) => (
        <div className="card job-row" key={c.id}>
          <div className="job-main">
            <div className="job-title">
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name} ↗
                </a>
              ) : (
                c.name
              )}
            </div>
            <div className="job-meta">
              {c.position && c.company
                ? `${c.position} · ${c.company}`
                : c.headline || "No title info"}
              {c.connected_on ? ` · connected ${c.connected_on}` : ""}
              {c.email ? ` · ${c.email}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
