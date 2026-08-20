import { assertDevOnly } from "@/lib/discovery/devOnly";
import { AdminActions, AdminEstate } from "@/components/admin/AdminActions";
import { discoveryFunnel, gatePressure, portalYield, verdictBreakdown } from "@/lib/discovery/analytics";
import { readCandidates, readLedger } from "@/lib/discovery/store";
import { DISCOVERED_FEEDS } from "@/lib/sources/discovered";

/**
 * /admin — the state of the curation pipeline.
 *
 * DEV ONLY (404 in production).
 *
 * Everything on this page is read from two JSON files in the working tree, so it
 * renders instantly and tells the truth about the repository you are standing in
 * rather than about a deployment. The live camera estate is the one thing it does not
 * server-render: reading the registry means fourteen upstream fetches, and a page that
 * takes forty seconds to tell you the queue is empty is a page nobody opens.
 */

export const dynamic = "force-dynamic";

export default function AdminOverview() {
  assertDevOnly();

  const candidates = readCandidates();
  const ledger = readLedger();
  const funnel = discoveryFunnel(candidates, ledger, DISCOVERED_FEEDS.length);
  const verdicts = verdictBreakdown(ledger);
  const gates = gatePressure(candidates);
  const portals = portalYield(candidates);
  const widest = Math.max(1, ...funnel.map((f) => f.n));
  const camerasWaiting = candidates
    .filter((c) => !c.gates.some((g) => g.status === "fail"))
    .filter((c) => !ledger.feeds.some((f) => f.candidateId === c.id && f.verdict !== "hold"))
    .reduce((n, c) => n + c.samples.length, 0);

  return (
    <>
      <h1 className="adm-h1">Curation</h1>
      <p className="adm-lede">
        Discovery proposes camera networks; nothing reaches the map without a person looking at the
        pictures. This is where a run is started, where the queue is measured, and where an admitted
        feed is written into the source tree.
      </p>

      <AdminActions queued={candidates.length} camerasWaiting={camerasWaiting} />

      <h2 className="adm-h2">The funnel</h2>
      <div className="adm-funnel">
        {funnel.map((s) => (
          <div key={s.key} className="adm-funnel-row">
            <span className="adm-funnel-label">
              {s.label}
              <br />
              <span style={{ color: "var(--adm-ink-faint)", fontSize: 11.5 }}>{s.note}</span>
            </span>
            <span className="adm-funnel-track">
              <span className="adm-funnel-fill" style={{ width: (s.n / widest) * 100 + "%" }} />
            </span>
            <span className="adm-funnel-n">{s.n}</span>
          </div>
        ))}
      </div>

      <h2 className="adm-h2">What reviewers decided</h2>
      {verdicts.length === 0 ? (
        <p style={{ color: "var(--adm-ink-faint)" }}>No camera has been judged yet.</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Verdict</th>
              <th style={{ textAlign: "right" }}>Cameras</th>
              <th style={{ textAlign: "right" }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {verdicts.map((v) => (
              <tr key={v.verdict}>
                <td>{v.verdict}</td>
                <td className="adm-num">{v.n}</td>
                <td className="adm-num">
                  {Math.round((v.n / ledger.cameras.length) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="adm-h2">Which gate is doing the work</h2>
      <p style={{ color: "var(--adm-ink-faint)", fontSize: 12.5, marginTop: -6, maxWidth: "78ch" }}>
        The useful reading is not that the gates fire. It is <em>which</em> rule the catalogues keep
        tripping: mostly <code>overlap</code> means the portals are re-offering networks already
        served and the queries need narrowing; mostly <code>relay</code> means the search terms are
        surfacing directories instead of operators. Opposite fixes.
      </p>
      {gates.length === 0 ? (
        <p style={{ color: "var(--adm-ink-faint)" }}>Nothing queued, so no gate has anything to say.</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Gate</th>
              <th style={{ textAlign: "right" }}>Blocked</th>
              <th style={{ textAlign: "right" }}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {gates.map((g) => (
              <tr key={g.gate}>
                <td>{g.gate}</td>
                <td className="adm-num">{g.fail || ""}</td>
                <td className="adm-num">{g.warn || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="adm-h2">Where the candidates came from</h2>
      {portals.length === 0 ? (
        <p style={{ color: "var(--adm-ink-faint)" }}>No run has been recorded into the queue yet.</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Portal</th>
              <th style={{ textAlign: "right" }}>Candidates</th>
              <th style={{ textAlign: "right" }}>Past the gates</th>
            </tr>
          </thead>
          <tbody>
            {portals.map((p) => (
              <tr key={p.portal}>
                <td>{p.portal}</td>
                <td className="adm-num">{p.candidates}</td>
                <td className="adm-num">{p.admissible}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="adm-h2">Live camera estate</h2>
      <p style={{ color: "var(--adm-ink-faint)", fontSize: 12.5, marginTop: -6, maxWidth: "78ch" }}>
        Loaded on demand, because reading it means fourteen upstream fetches. It is a{" "}
        <strong>composition, not a time series</strong>: the registry keeps its cache per serverless
        instance, so two reads minutes apart can differ by thousands with no deploy between them.
        Read the shape, never the trend.
      </p>
      <AdminEstate />
    </>
  );
}
