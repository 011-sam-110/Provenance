// components/admin/analytics/CountTable.tsx
// A ranked table of counted things: pages, referrers, countries, API paths, errors.
//
// This is NOT DimensionTable. That one renders Vercel's rows, which carry a visitor
// count per row; the access log has no such thing, because a visitor is a per-day set
// and not an attribute of a path. Handing rollup rows to a table with a Visitors column
// would leave a column that is either empty or invented, so there are two tables.
//
// EVERY SHARE IS AGAINST THE WHOLE MAP, INCLUDING THE ROWS NOT SHOWN. lib/analytics/
// rollupView.ts computes it that way on purpose: a share taken against the visible rows
// adds up to 100% however much was cut off, which is exactly how a truncated table
// implies it is complete.

import type { Row } from "@/lib/analytics/rollupView";

/**
 * "(other)" is the rollup's own overflow bucket, written by capMap when a map outgrows
 * its cardinality cap. It is not a page called "(other)", and the same is true of
 * "(direct)", "(self)" and "(unknown)" — each is a category the counting rules created,
 * so each is explained where it is rendered rather than in a caption somewhere else.
 */
const SYNTHETIC: Record<string, string> = {
  "(other)": "everything past the cap this map keeps, added together",
  "(direct)": "no referrer at all — typed, bookmarked, or an app that sends none",
  "(self)": "a page on this site — internal navigation, not a traffic source",
  "(unknown)": "no country header, which means the request did not come through Cloudflare",
  "(unparseable)": "a referrer the browser sent that is not a URL",
};

export function CountTable({
  rows,
  heading,
  valueHeading = "Requests",
  cap,
  empty = "Nothing recorded in this window.",
  format = (n) => n.toLocaleString("en-GB"),
}: {
  rows: Row[];
  heading: string;
  valueHeading?: string;
  /** The map's cardinality cap, so the table can say when it may be truncated. */
  cap?: number;
  empty?: string;
  /**
   * How to render the value. Defaults to a grouped integer, which is right for a count
   * of things and wrong for a count of bytes: the API table is ranked by bytes, and
   * "573,209,816" beside a tile reading "1.5 GB" makes the reader do the arithmetic to
   * find out whether the two agree.
   */
  format?: (n: number) => string;
}) {
  if (rows.length === 0) return <p className="adm-empty">{empty}</p>;
  const top = rows[0]?.count || 1;

  return (
    <div>
      <table className="adm-table">
        <thead>
          <tr>
            <th>{heading}</th>
            <th style={{ width: "34%" }} />
            <th style={{ textAlign: "right", width: 110 }}>{valueHeading}</th>
            <th style={{ textAlign: "right", width: 72 }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ wordBreak: "break-word" }}>
                <span style={{ fontFamily: "var(--tn-font-mono, ui-monospace, monospace)", fontSize: 12.5 }}>
                  {r.key}
                </span>
                {SYNTHETIC[r.key] && (
                  <span style={{ color: "var(--adm-ink-faint)", fontSize: 11.5, display: "block" }}>
                    {SYNTHETIC[r.key]}
                  </span>
                )}
              </td>
              <td>
                {/* Width is against the largest row, so the bars compare rows to each
                    other. The Share column is the one that compares to the total. */}
                <span className="adm-funnel-track" aria-hidden="true">
                  <span className="adm-funnel-fill" style={{ width: `${Math.max(2, (r.count / top) * 100)}%` }} />
                </span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {format(r.count)}
              </td>
              <td
                style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-dim)" }}
              >
                {(r.share * 100).toFixed(r.share < 0.01 ? 2 : 1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cap != null && rows.some((r) => r.key === "(other)") && (
        <p className="adm-stat-note">
          This map reached its {cap.toLocaleString("en-GB")}-key cap, so the tail is added together
          rather than listed. The totals are unaffected — nothing is discarded, only the names.
        </p>
      )}
    </div>
  );
}
