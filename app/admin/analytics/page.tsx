// app/admin/analytics/page.tsx
// A development-only view of the traffic this site actually receives.
//
// GATE. `assertDevOnly()` 404s this route in production, and it is called here as well
// as in the admin layout rather than trusted from the layout alone — a layout is a file
// someone else can restructure, and the failure mode of getting this wrong is a public
// admin page over a team-wide API token. The helper fails closed on either VERCEL_ENV or
// NODE_ENV, and `tests/unit/discovery-admin-gate.test.ts` enumerates this directory, so
// this page is picked up by that guard automatically.
//
// The token is read in lib/analytics/vercelApi.ts, on the server, and only aggregate
// numbers are passed down as props. Nothing credential-shaped crosses into the client.

import type { Metadata } from "next";
import { Panel, FailureNotice, EmptyNotice } from "@/components/admin/analytics/Panel";
import { TrafficOverTime } from "@/components/admin/analytics/TrafficOverTime";
import { DimensionTable } from "@/components/admin/analytics/DimensionTable";
import { Limitations } from "@/components/admin/analytics/Limitations";
import { dailySeries, loadDashboard, PANEL_LIMITS } from "@/lib/analytics/dashboard";
import { assertDevOnly } from "@/lib/discovery/devOnly";
import { totals as sumDaily } from "@/lib/analytics/window";
import type { AggregateRow, AnalyticsResult } from "@/lib/analytics/vercelApi";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Traffic — development only",
  robots: { index: false, follow: false },
};

function Grouped({
  result,
  dimension,
  valueHeading,
  emptyLabel,
  limit,
  what,
  since,
  until,
}: {
  result: AnalyticsResult<AggregateRow[]>;
  dimension: string;
  valueHeading: string;
  emptyLabel?: string;
  limit: number;
  what: string;
  since: string;
  until: string;
}) {
  if (!result.ok) return <FailureNotice failure={result.failure} />;
  if (result.data.length === 0) return <EmptyNotice what={what} since={since} until={until} />;
  return (
    <DimensionTable
      rows={result.data}
      dimension={dimension}
      valueHeading={valueHeading}
      emptyLabel={emptyLabel}
      limit={limit}
    />
  );
}

export default async function AnalyticsPage() {
  assertDevOnly();

  const now = new Date();
  const d = await loadDashboard(now);
  const sinceLabel = d.since.toISOString().slice(0, 10);
  const untilLabel = d.until.toISOString().slice(0, 10);

  const series = d.daily.ok ? dailySeries(d.daily.data, d.since, d.until) : [];
  const seriesTotals = sumDaily(series);
  const uniqueVisitors = d.totals.ok ? d.totals.data.visitors : null;
  const cameraPageCount = d.cameraPaths.ok
    ? d.cameraPaths.data.filter((r) => r.requestPath !== "Others").length
    : null;

  return (
    <>
      <h1 className="adm-h1">Traffic</h1>
      <p className="adm-lede">
        What the site actually received, read back from Vercel Web Analytics: {sinceLabel} to{" "}
        {untilLabel}, a rolling {d.windowDays}-day window that is the whole of what this plan
        retains. Every panel below states which of its numbers were measured and which were never
        available, because on a dashboard an unexplained empty panel reads as a zero.
      </p>

      <Panel
        title="1 · Traffic over time"
        subtitle="Visitors and pageviews per day, with the retention edge drawn rather than described"
      >
        {d.daily.ok ? (
          series.length === 0 ? (
            <EmptyNotice what="pageviews" since={sinceLabel} until={untilLabel} />
          ) : (
            <TrafficOverTime
              points={series}
              windowDays={d.windowDays}
              uniqueVisitors={uniqueVisitors}
              totalPageviews={seriesTotals.pageviews}
            />
          )
        ) : (
          <FailureNotice failure={d.daily.failure} />
        )}
      </Panel>

      <Panel title="2 · Where they land" subtitle="Top routes by pageviews">
        <Grouped
          result={d.routes}
          dimension="route"
          valueHeading="Route"
          limit={PANEL_LIMITS.routes}
          what="routes"
          since={sinceLabel}
          until={untilLabel}
        />
      </Panel>

      <Panel
        title="2b · Did the generated camera pages get visited?"
        subtitle="Individual paths under the /camera/[id] route"
      >
        {cameraPageCount != null && (
          <p style={{ fontSize: 13, marginTop: 0 }}>
            <strong>{cameraPageCount.toLocaleString("en-GB")}</strong> distinct camera pages
            recorded at least one visit in this window.{" "}
            <span style={{ color: "var(--adm-ink-faint)" }}>
              This is a floor: the query asks for the top {PANEL_LIMITS.cameraPaths} distinct paths
              and Vercel buckets the rest, so the true number can only be higher. It is not
              comparable to the total number of camera pages the site generates, which is a
              different measurement and is not made here.
            </span>
          </p>
        )}
        <Grouped
          result={d.cameraPaths}
          dimension="requestPath"
          valueHeading="Path"
          limit={PANEL_LIMITS.cameraPaths}
          what="camera-page visits"
          since={sinceLabel}
          until={untilLabel}
        />
      </Panel>

      <Panel title="3 · Where they came from" subtitle="Referring hostname, as reported by the browser">
        <Grouped
          result={d.referrers}
          dimension="referrerHostname"
          valueHeading="Referrer"
          emptyLabel="(direct — typed, bookmarked, or an app that sends no referrer)"
          limit={PANEL_LIMITS.referrers}
          what="referrers"
          since={sinceLabel}
          until={untilLabel}
        />
      </Panel>

      <Panel
        title="3b · Campaign attribution (UTM)"
        subtitle="Requested live on every load, so the answer below is the current one rather than a remembered one"
      >
        <Grouped
          result={d.utm}
          dimension="utmSource"
          valueHeading="utm_source"
          limit={PANEL_LIMITS.referrers}
          what="tagged campaign visits"
          since={sinceLabel}
          until={untilLabel}
        />
      </Panel>

      <Panel title="4 · Who" subtitle="Country, device and browser">
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <h3 style={{ fontSize: 11.5, color: "var(--adm-ink-faint)", margin: "0 0 4px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Country</h3>
            <Grouped
              result={d.countries}
              dimension="country"
              valueHeading="Country"
              limit={PANEL_LIMITS.countries}
              what="countries"
              since={sinceLabel}
              until={untilLabel}
            />
          </div>
          <div>
            <h3 style={{ fontSize: 11.5, color: "var(--adm-ink-faint)", margin: "0 0 4px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Device</h3>
            <Grouped
              result={d.devices}
              dimension="deviceType"
              valueHeading="Device"
              limit={PANEL_LIMITS.devices}
              what="device types"
              since={sinceLabel}
              until={untilLabel}
            />
          </div>
          <div>
            <h3 style={{ fontSize: 11.5, color: "var(--adm-ink-faint)", margin: "0 0 4px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Browser</h3>
            <Grouped
              result={d.browsers}
              dimension="browserName"
              valueHeading="Browser"
              limit={PANEL_LIMITS.browsers}
              what="browsers"
              since={sinceLabel}
              until={untilLabel}
            />
          </div>
        </div>
      </Panel>

      <Panel title="5 · What this cannot tell you">
        <Limitations windowDays={d.windowDays} />
      </Panel>
    </>
  );
}
