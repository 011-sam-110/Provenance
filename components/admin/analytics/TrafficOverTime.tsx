"use client";
// components/admin/analytics/TrafficOverTime.tsx
// Daily visitors and pageviews, with the retention edge drawn as part of the chart
// rather than mentioned underneath it.
//
// The left edge of this chart is the most misleading pixel on the page. On the Hobby
// plan there is no data before it — not "no traffic", NO DATA, the API refuses the
// question — so the axis is labelled with the edge date and the reason, and the
// series is never extended past it. Everything here arrives as plain numbers from a
// server component; no credential crosses into the browser.

import { Chart, type ChartPoint } from "@/components/Chart";
import type { DailyPoint } from "@/lib/analytics/window";

export function TrafficOverTime({
  points,
  windowDays,
  uniqueVisitors,
  totalPageviews,
}: {
  points: DailyPoint[];
  windowDays: number;
  /** De-duplicated across the whole range by Vercel — NOT the sum of the daily column. */
  uniqueVisitors: number | null;
  totalPageviews: number;
}) {
  if (points.length < 2) {
    return (
      <div className="adm-note">
        Fewer than two days of data in the window, so there is no line to draw. Showing nothing
        rather than a single point stretched across an axis.
      </div>
    );
  }

  const pv: ChartPoint[] = points.map((p, i) => ({ x: i, y: p.pageviews }));
  const vis: ChartPoint[] = points.map((p, i) => ({ x: i, y: p.visitors }));
  const first = points[0].day;
  const last = points[points.length - 1].day;
  const quietDays = points.filter((p) => p.pageviews === 0).length;
  const peak = points.reduce((a, b) => (b.pageviews > a.pageviews ? b : a));

  return (
    <div>
      <div className="adm-stats" style={{ marginBottom: 16 }}>
        <Stat
          k="Pageviews"
          n={totalPageviews.toLocaleString("en-GB")}
          note={`across ${points.length} days`}
        />
        <Stat
          k="Unique visitors"
          n={uniqueVisitors == null ? "—" : uniqueVisitors.toLocaleString("en-GB")}
          note={uniqueVisitors == null ? "not returned by this query" : "de-duplicated over the whole range"}
        />
        <Stat k="Busiest day" n={peak.day} note={`${peak.pageviews.toLocaleString("en-GB")} pageviews`} />
        <Stat k="Days with no traffic" n={String(quietDays)} note="measured zeroes, inside the window" />
      </div>

      <Series title="Pageviews per day" points={pv} />
      <Series title="Visitors per day" points={vis} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--adm-ink-faint)",
          marginTop: 4,
        }}
      >
        <span>{first} — oldest date this plan will serve</span>
        <span>{last}</span>
      </div>

      <div className="adm-note" style={{ marginTop: 12 }}>
        <strong>The left edge is a wall, not a beginning.</strong> This plan serves the latest{" "}
        {windowDays} days only, so {first} is the oldest date that can be asked about. Traffic
        before that date is not zero here — it is unknown, and the chart stops rather than implying
        otherwise.
        <div style={{ fontSize: 12, color: "var(--adm-ink-faint)", marginTop: 6 }}>
          The two lines are scaled independently, so their heights are not comparable to each other.
          Adding up the daily visitor column would double-count anyone who came back on another day;
          the unique figure above is a separate query and is the one to quote.
        </div>
      </div>
    </div>
  );
}

function Series({ title, points }: { title: string; points: ChartPoint[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--adm-ink-faint)", marginBottom: 2, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </div>
      <Chart points={points} height={110} up={null} zeroBaseline />
    </div>
  );
}

function Stat({ k, n, note }: { k: string; n: string; note: string }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat-n">{n}</span>
      <span className="adm-stat-k">{k}</span>
      <div className="adm-stat-note">{note}</div>
    </div>
  );
}
