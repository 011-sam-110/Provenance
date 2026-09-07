// components/admin/analytics/DailySeries.tsx
// Pageviews and approximate visitors per day, drawn from the access-log rollups.
//
// NOT TrafficOverTime. That component draws Vercel's rolling retention edge — the line
// past which their plan simply stops answering — which is a fact about a plan we have
// left. These rollups do not expire, so there is no edge to draw, and drawing one would
// be describing a limit that no longer applies.
//
// A BAR PER DAY AND NO SMOOTHING. A line chart interpolates between days and invents
// values at every point in between; with a handful of days that interpolation is most
// of the ink on the page. Bars also make a partial day obvious, which matters because
// today is always partial and a line sloping down to it reads as a collapse in traffic.

import type { DayPoint } from "@/lib/analytics/rollupView";

const W = 720;
const H = 200;
const PAD = { top: 14, right: 12, bottom: 34, left: 52 };

export function DailySeries({ points, todayUtc }: { points: DayPoint[]; todayUtc: string }) {
  if (points.length === 0) return <p className="adm-empty">No days recorded yet.</p>;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...points.map((p) => p.pageviews));
  const slot = plotW / points.length;
  const barW = Math.max(3, Math.min(46, slot * 0.62));

  // Ticks at 0, half and max. Every label names a value the chart actually reaches,
  // rather than a round number the axis was stretched to meet.
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Pageviews per day from ${points[0]!.date} to ${points[points.length - 1]!.date}`}
          style={{ display: "block", minWidth: 420 }}
        >
          {ticks.map((t) => {
            const y = PAD.top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--adm-line)" strokeWidth={1} />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--adm-ink-faint)"
                  fontSize={11}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {t.toLocaleString("en-GB")}
                </text>
              </g>
            );
          })}

          {points.map((p, i) => {
            const h = (p.pageviews / max) * plotH;
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const partial = p.date === todayUtc;
            return (
              <g key={p.date}>
                <rect
                  x={x}
                  y={PAD.top + plotH - h}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={2}
                  fill={partial ? "var(--adm-ink-faint)" : "var(--adm-accent)"}
                />
                {/* Only the ends and every other label, or they collide at 30 days. */}
                {(i === 0 || i === points.length - 1 || points.length <= 14) && (
                  <text
                    x={x + barW / 2}
                    y={H - 14}
                    textAnchor="middle"
                    fill="var(--adm-ink-faint)"
                    fontSize={10.5}
                  >
                    {p.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="adm-stat-note">
        Bars are pageviews. The grey bar is today, which is <strong>partial by definition</strong> —
        it holds only the hours that have happened, so reading it as a fall in traffic is the one
        mistake this chart invites.
      </p>
      <table className="adm-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Day (UTC)</th>
            <th style={{ textAlign: "right" }}>Pageviews</th>
            <th style={{ textAlign: "right" }}>Visitors ≈</th>
            <th style={{ textAlign: "right" }}>Requests</th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.date}>
              <td style={{ fontFamily: "var(--tn-font-mono, ui-monospace, monospace)", fontSize: 12.5 }}>
                {p.date}
                {p.date === todayUtc && (
                  <span style={{ color: "var(--adm-ink-faint)" }}> · partial</span>
                )}
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {p.pageviews.toLocaleString("en-GB")}
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {p.visitors.toLocaleString("en-GB")}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--adm-ink-dim)",
                }}
              >
                {p.requests.toLocaleString("en-GB")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
