// components/admin/analytics/Limitations.tsx
// What the access log cannot answer, and which of the three sources can.
//
// THIS PANEL USED TO BE ABOUT VERCEL'S PRICING TABLE — what a paid plan would unlock —
// because the dashboard read Vercel's API and the boundary was commercial. The boundary
// is now physical, and that is a better problem to have but a worse one to be vague
// about: no amount of money buys a server log a record of something that never reached
// the server. The plan table moved to the archive section, where it still applies.
//
// The one job of this panel is to stop a figure being used for a question it cannot
// answer. Someone reading "1,015 pageviews" will want a bounce rate next, and the
// honest answer is not "we have not built it" — it is that a bounce leaves no trace on
// this side of the wire at all.

const SPLIT: { source: string; answers: string; cannot: string }[] = [
  {
    source: "This access log",
    answers:
      "Every request that reached the server: which page, how often, how large, how fast, from which country, referred by whom, and what errored.",
    cannot:
      "Anything a visitor did without making another request — how long they stayed, how far they scrolled, what they clicked that was not a link, whether they left immediately.",
  },
  {
    source: "The beacon (PostHog)",
    answers:
      "Engagement: bounce rate, time on page, scroll depth, rage clicks and dead clicks. Cookieless, session-scoped, no replay.",
    cannot:
      "Being complete. This audience blocks trackers heavily, so it undercounts by an unknown and probably large margin, and it stops existing entirely for anyone with an ad blocker. It is a sample of behaviour, never a census of traffic.",
  },
  {
    source: "Google Search Console",
    answers:
      "Impressions, queries, average position and click-through — the entire SEO picture.",
    cannot:
      "Being reconstructed later. It has no backfill: whatever it did not record while verified is gone. It also only ever describes Google.",
  },
];

export function Limitations({ windowDays }: { windowDays: number }) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <p style={{ marginTop: 0, maxWidth: "78ch", color: "var(--adm-ink-dim)" }}>
        The panels above cover up to {windowDays} days of requests. That is a complete record of
        what was <em>asked for</em> and no record at all of what was <em>done</em>. A visitor who
        opens a page, reads it for four minutes, toggles six layers and leaves is, in this data,
        identical to one who opens the same page and closes it at once: both are exactly one
        request. The gap is not a missing feature, it is the shape of the medium — those actions
        never travel to a server, so no server log at any price contains them.
      </p>

      <h3
        style={{
          fontSize: 12.5,
          margin: "18px 0 8px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--adm-ink-faint)",
        }}
      >
        Three sources, and the question each one owns
      </h3>
      <table className="adm-table">
        <thead>
          <tr>
            <th style={{ width: "22%" }}>Source</th>
            <th>Answers</th>
            <th>Cannot</th>
          </tr>
        </thead>
        <tbody>
          {SPLIT.map((s) => (
            <tr key={s.source}>
              <td>
                <strong>{s.source}</strong>
              </td>
              <td style={{ color: "var(--adm-ink-dim)" }}>{s.answers}</td>
              <td style={{ color: "var(--adm-ink-faint)" }}>{s.cannot}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="adm-note" style={{ marginTop: 14 }}>
        <p style={{ margin: 0 }}>
          <strong>The three do not reconcile, and should not be made to.</strong> The log counts
          requests that arrived; the beacon counts sessions that ran its script; Search Console
          counts what Google showed. A visitor who blocks trackers is in the first and not the
          second. A crawler is in the first and neither of the others. Averaging them, or picking
          whichever is highest, produces a number that describes none of them.
        </p>
      </div>

      <h3
        style={{
          fontSize: 12.5,
          margin: "24px 0 4px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--adm-ink-faint)",
        }}
      >
        And what the log is not
      </h3>
      <ul style={{ color: "var(--adm-ink-dim)", maxWidth: "78ch", paddingLeft: 20 }}>
        <li>
          <strong>Not a person count.</strong> Addresses arrive masked to a /16 before anything
          reads them, so &ldquo;visitors&rdquo; is a lower bound on households and an upper bound
          on nothing.
        </li>
        <li>
          <strong>Not a robot filter.</strong> The bot count is of clients that <em>said</em> they
          were bots. Anything sending a browser&rsquo;s user-agent string is counted as a person,
          and the well-behaved crawlers are the ones being excluded.
        </li>
        <li>
          <strong>Not everything the browser asked for.</strong> Cloudflare answers cached static
          files from its own edge, so those requests never reach this log. The static figure is
          what got <em>past</em> the cache.
        </li>
        <li>
          <strong>Not retroactive.</strong> The rollups begin the day the job was installed. The
          log holds about three and a half days, so nothing before that window exists anywhere.
        </li>
      </ul>
    </div>
  );
}
