// components/admin/analytics/DimensionTable.tsx
// A grouped-by-dimension table: routes, referrers, countries, devices, browsers.
//
// Two values in these responses mean something other than what they look like, and
// both were observed live on 2026-08-19:
//   ""       on referrerHostname is a visit with no referrer at all — a typed URL, a
//            bookmark, an app. It is not an unnamed website.
//   "Others" is the API's own overflow bucket for everything past `limit`. It is not
//            a country called Others. Rendering it as an ordinary row would invent a
//            category and, worse, make the long tail look like a single large source.
// Both are labelled here rather than in a caption, because a row read on its own is
// exactly how a wrong number escapes into a slide.

import { dimensionLabel, isOthersBucket, type AggregateRow } from "@/lib/analytics/vercelApi";

export function DimensionTable({
  rows,
  dimension,
  valueHeading,
  emptyLabel,
  limit,
}: {
  rows: AggregateRow[];
  /** The `by` key these rows were grouped on. */
  dimension: string;
  valueHeading: string;
  /** What an empty-string value means for THIS dimension. */
  emptyLabel?: string;
  /** The distinct-value cap that was sent, so the table can say when it may be truncated. */
  limit: number;
}) {
  const sorted = [...rows].sort((a, b) => b.pageviews - a.pageviews);
  const truncated = rows.some((r) => isOthersBucket(r, dimension));

  return (
    <div>
      <table className="adm-table">
        <thead>
          <tr>
            <th>{valueHeading}</th>
            <th style={{ textAlign: "right", width: 110 }}>Visitors</th>
            <th style={{ textAlign: "right", width: 110 }}>Pageviews</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const others = isOthersBucket(row, dimension);
            const raw = dimensionLabel(row, dimension);
            const label = raw === "(none)" ? (emptyLabel ?? "(no value)") : raw;
            return (
              <tr key={`${label}-${i}`}>
                <td style={{ overflowWrap: "anywhere" }}>
                  {others ? (
                    <span style={{ color: "var(--adm-ink-faint)", fontStyle: "italic" }}>
                      everything past the top {limit}, bucketed by Vercel
                    </span>
                  ) : (
                    label
                  )}
                </td>
                <td className="adm-num">{row.visitors.toLocaleString("en-GB")}</td>
                <td className="adm-num">{row.pageviews.toLocaleString("en-GB")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {truncated && (
        <p style={{ fontSize: 11.5, color: "var(--adm-ink-faint)", marginTop: 8, marginBottom: 0 }}>
          This query asked for the top {limit} distinct values and Vercel folded the rest into one
          bucket, so the number of distinct values here is a floor, not a total.
        </p>
      )}
    </div>
  );
}
