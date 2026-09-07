// app/admin/analytics/page.tsx
// A development-only view of the traffic this site actually receives.
//
// GATE. `assertDevOnly()` 404s this route in production, and it is called here as well
// as in the admin layout rather than trusted from the layout alone — a layout is a file
// someone else can restructure, and the failure mode of getting this wrong is a public
// admin page. The helper fails closed on either VERCEL_ENV or NODE_ENV, and
// `tests/unit/discovery-admin-gate.test.ts` enumerates this directory, so this page is
// picked up by that guard automatically.
//
// THE SOURCE CHANGED, AND THAT IS THE POINT OF THIS FILE'S REWRITE. It used to read
// Vercel's Web Analytics API. Collection there stopped the day the site left Vercel —
// <Analytics /> posted to /_vercel/insights, a path that exists only on their edge — so
// those numbers have been a closing archive since, on a rolling 31-day window that
// deletes the oldest day every day. The live source is now our own Caddy access log,
// folded into daily aggregates by scripts/rollup-access-log.mts. The Vercel archive is
// still readable and still worth reading; it is the last section rather than the first.
//
// EVERY PANEL SAYS WHAT ITS NUMBERS ARE NOT. A dashboard's failure mode is not being
// wrong, it is being confidently approximate: "visitors" here is a count of salted
// hashes over /16-masked addresses, "pageviews" excludes anything that declared itself
// a robot, and neither of those is qualified anywhere but on this screen. Panels state
// it inline rather than in a footnote, because a figure read on its own is exactly how
// a wrong number escapes into a decision.

import type { Metadata } from "next";
import { Panel, FailureNotice, EmptyNotice } from "@/components/admin/analytics/Panel";
import { CountTable } from "@/components/admin/analytics/CountTable";
import { DailySeries } from "@/components/admin/analytics/DailySeries";
import { DimensionTable } from "@/components/admin/analytics/DimensionTable";
import { Limitations } from "@/components/admin/analytics/Limitations";
import { VercelPlanNotes } from "@/components/admin/analytics/VercelPlanNotes";
import { dailySeries, loadDashboard, PANEL_LIMITS } from "@/lib/analytics/dashboard";
import { MAP_CAP } from "@/lib/analytics/rollup";
import { readRollups, stalenessSeconds } from "@/lib/analytics/rollupRead";
import {
  apiByteShare,
  buildWindow,
  bytes,
  directShare,
  durationBuckets,
  lastDays,
  rows,
} from "@/lib/analytics/rollupView";
import { assertDevOnly } from "@/lib/discovery/devOnly";
import { totals as sumDaily } from "@/lib/analytics/window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Traffic — development only",
  robots: { index: false, follow: false },
};

/** How many days of rollups the panels aggregate over. */
const WINDOW_DAYS = 30;

function Stat({ n, k, note }: { n: string; k: string; note?: string }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat-n">{n}</span>
      <span className="adm-stat-k">{k}</span>
      {note && <p className="adm-stat-note">{note}</p>}
    </div>
  );
}

function freshness(seconds: number | null): { text: string; stale: boolean } {
  if (seconds == null) {
    return { text: "The rollup job has never recorded a run.", stale: true };
  }
  const mins = Math.round(seconds / 60);
  // The timer fires every five minutes, so anything past fifteen is two missed runs and
  // not a slow one. A frozen dashboard looks exactly like a quiet night, which is why
  // this is stated rather than left to be noticed.
  if (seconds > 900) {
    return {
      text: `Last run ${mins.toLocaleString("en-GB")} minutes ago, which is at least two missed runs — check systemctl status provenance-rollup.service.`,
      stale: true,
    };
  }
  return { text: `Last run ${mins <= 1 ? "under a minute" : `${mins} minutes`} ago.`, stale: false };
}

export default async function AnalyticsPage() {
  assertDevOnly();

  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  const source = readRollups();
  const view = buildWindow(lastDays(source.days, WINDOW_DAYS));
  const fresh = freshness(stalenessSeconds(source, now.getTime()));

  // Still issued, so the archive section shows what Vercel says today rather than what
  // it said when this file was last edited.
  const vercel = await loadDashboard(now);
  const vercelSeries = vercel.daily.ok ? dailySeries(vercel.daily.data, vercel.since, vercel.until) : [];
  const vercelTotals = sumDaily(vercelSeries);

  return (
    <>
      <h1 className="adm-h1">Traffic</h1>

      {!view ? (
        <>
          <p className="adm-lede">
            There are no rollups to show. This is the expected state anywhere but the production
            box.
          </p>
          <div className="adm-note">
            <p style={{ margin: 0 }}>{source.reason}</p>
            <p style={{ margin: "6px 0 0" }}>
              Looked in <code>{source.dir}</code>. Override with{" "}
              <code>ANALYTICS_ROLLUP_DIR</code>.
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="adm-lede">
            Read from this server&rsquo;s own Caddy access log, folded into one aggregate per UTC
            day: {view.from} to {view.to}, {view.dayCount}{" "}
            {view.dayCount === 1 ? "day" : "days"}. <strong>These aggregates do not expire.</strong>{" "}
            The log itself holds about three and a half days before it rotates, so the rollups are
            the only durable record — and the reason they exist is that the previous source, a
            hosting provider&rsquo;s dashboard, stopped being ours to read.
          </p>
          <div className={fresh.stale ? "adm-note" : undefined}>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--adm-ink-dim)" }}>{fresh.text}</p>
          </div>

          <Panel
            title="1 · The window"
            subtitle="Totals across every day above. Read the qualifiers on each figure — they are not decoration."
          >
            <div className="adm-stats">
              <Stat
                n={view.totals.pageviews.toLocaleString("en-GB")}
                k="Pageviews"
                note="Documents delivered to something that did not declare itself a robot. Excludes API responses, static files and probes."
              />
              <Stat
                n={`≈ ${view.visitorsMean.toLocaleString("en-GB")}`}
                k="Visitors per day"
                note={`Mean of the daily figures; the busiest day was ≈ ${view.visitorsPeak.toLocaleString("en-GB")}. There is deliberately no window total — see section 6.`}
              />
              <Stat
                n={view.totals.requests.toLocaleString("en-GB")}
                k="Requests"
                note="Everything, including assets, API calls, robots and probes."
              />
              <Stat
                n={bytes(view.totals.bytes)}
                k="Sent"
                note={`${(apiByteShare(view.totals) * 100).toFixed(0)}% of it API responses, not pages.`}
              />
              <Stat
                n={view.meanDurationMs == null ? "—" : `${view.meanDurationMs} ms`}
                k="Mean page response"
                note="Time the origin took, measured at Caddy. Not what a visitor waited for."
              />
              <Stat
                n={view.totals.byPath["(other)"] ? `${MAP_CAP.toLocaleString("en-GB")}+` : Object.keys(view.totals.byPath).length.toLocaleString("en-GB")}
                k="Distinct pages seen"
                note="Paths with at least one pageview in the window."
              />
            </div>
          </Panel>

          <Panel title="2 · By day" subtitle="Pageviews per UTC day, with the approximate visitor count beside it">
            <DailySeries points={view.points} todayUtc={todayUtc} />
          </Panel>

          <Panel
            title="3 · Where they land"
            subtitle="Top pages by pageview. Query strings are stripped, so every /app visit is one row rather than one row per map position."
          >
            <CountTable rows={rows(view.totals.byPath, 25)} heading="Page" valueHeading="Pageviews" cap={MAP_CAP} />
          </Panel>

          <Panel
            title="4 · Where they came from"
            subtitle="Referring hostname as the browser reported it. This is the panel that corrected “search beats Reddit” to the opposite, so it is worth reading before believing anything about a channel."
          >
            <CountTable
              rows={rows(view.totals.byReferrer, 20)}
              heading="Referrer"
              valueHeading="Pageviews"
              cap={MAP_CAP}
            />
          </Panel>

          <Panel title="5 · Who" subtitle="Country from Cloudflare's header; device class from the user-agent string">
            <div style={{ display: "grid", gap: 18 }}>
              <div>
                <h3 className="adm-stat-k" style={{ display: "block", marginBottom: 4 }}>
                  Country
                </h3>
                <CountTable rows={rows(view.totals.byCountry, 15)} heading="Country" valueHeading="Pageviews" />
              </div>
              <div>
                <h3 className="adm-stat-k" style={{ display: "block", marginBottom: 4 }}>
                  Device
                </h3>
                <CountTable rows={rows(view.totals.byDevice, 6)} heading="Device" valueHeading="Pageviews" />
                <p className="adm-stat-note">
                  Three classes and no more. A user-agent string cannot give a model or a screen
                  size without a lookup table that goes stale, and the question this answers is
                  whether the console is being opened on a phone.
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="6 · What “visitors” means here, exactly"
            subtitle="Because it is the figure most likely to be quoted and the one with the most caveats"
          >
            <div className="adm-note">
              <p style={{ margin: 0 }}>
                A visitor is one distinct salted hash of{" "}
                <strong>a /16-masked address plus a user-agent string</strong>. The address arrives
                already masked — Caddy writes <code>86.20.0.0</code>, never the full address — so a
                /16 names a block of about 65,000 machines. Two people on the same network using
                the same browser build are therefore <strong>one</strong> visitor, and one person on
                a phone and a laptop is <strong>two</strong>.
              </p>
              <p style={{ margin: "8px 0 0" }}>
                There is no window total, and that absence is deliberate. The per-day hash sets are
                deleted when a day is finalised, because keeping them would be keeping a
                per-visitor record — the thing this whole design exists to avoid. So the unique
                count across several days is not merely unknown to us, it is{" "}
                <strong>unknowable from this data</strong>. Summing the days would answer a
                different question while looking like an answer to this one: someone who visits
                every day would appear seven times in a week.
              </p>
            </div>
          </Panel>

          <Panel
            title="7 · What it costs to serve"
            subtitle="The bandwidth question, which pages do not answer"
          >
            <div className="adm-stats" style={{ marginBottom: 14 }}>
              <Stat n={bytes(view.totals.apiBytes)} k="API bytes" note={`${(apiByteShare(view.totals) * 100).toFixed(0)}% of everything sent`} />
              <Stat n={view.totals.apiRequests.toLocaleString("en-GB")} k="API requests" />
              <Stat
                n={view.totals.assetRequests.toLocaleString("en-GB")}
                k="Static requests"
                note="Reaching the ORIGIN. Cloudflare serves /_next/static from its edge, so this is what got past the cache, not what browsers asked for."
              />
            </div>
            <CountTable
              rows={rows(view.totals.byApiBytes, 15)}
              heading="API path"
              valueHeading="Sent"
              cap={MAP_CAP}
              format={bytes}
            />
            <p className="adm-stat-note">
              Ranked by bytes rather than by call count, because those give different answers and
              only one of them is the bill. A single <code>/api/planes</code> response was measured
              at 1.3 MB.
            </p>
          </Panel>

          <Panel title="8 · What is broken" subtitle="Every 4xx and 5xx, by status and path">
            <CountTable
              rows={rows(view.totals.errors, 20)}
              heading="Status and path"
              valueHeading="Responses"
              cap={MAP_CAP}
              empty="No 4xx or 5xx responses in this window."
            />
            <p className="adm-stat-note">
              A 502 here is the origin being unreachable from Caddy, which in practice means a
              deploy restart caught a request mid-flight. A 404 on a path nobody links to is a
              probe; one on a path the site does link to is a bug.
            </p>
          </Panel>

          <Panel
            title="9 · Robots, probes, and who is bypassing the edge"
            subtitle="Three counts that are not traffic and should never be added to it"
          >
            <div className="adm-stats" style={{ marginBottom: 14 }}>
              <Stat
                n={view.totals.botRequests.toLocaleString("en-GB")}
                k="Declared robots"
                note="A floor, never a ceiling. This counts clients that said so; anything pretending to be a browser is in the pageview figure instead."
              />
              <Stat
                n={view.totals.scannerRequests.toLocaleString("en-GB")}
                k="Probes"
                note="Requests for /wp-login.php, /.env, /server-status and the like — software this site has never run."
              />
              <Stat
                n={`${(directShare(view.totals) * 100).toFixed(1)}%`}
                k="Bypassed Cloudflare"
                note="Requests with no country header, so they reached the origin directly. Above roughly zero means some resolver still hands out the origin address."
              />
            </div>
            <div className="adm-note">
              <p style={{ margin: 0 }}>
                That last figure is the one deploy/cloudflare-firewall.sh refuses to run against.
                Closing the origin while it is non-zero does not move those visitors to the edge,
                it times them out — which happened, on the day a ten-minute traffic sample read
                zero and the firewall was closed anyway.
              </p>
            </div>
          </Panel>

          <Panel title="10 · How fast" subtitle="Page response time at the origin, bucketed">
            <CountTable
              rows={durationBuckets(view.totals).map((b) => ({ key: b.label, count: b.count, share: b.share }))}
              heading="Response time"
              valueHeading="Pageviews"
            />
            <p className="adm-stat-note">
              Measured by Caddy, from receiving the request to finishing the response. It does not
              include the visitor&rsquo;s network, Cloudflare&rsquo;s leg, or any time the browser
              spent rendering — so a fast column here is consistent with a page that feels slow.
            </p>
          </Panel>
        </>
      )}

      <Panel title="11 · What this cannot tell you">
        <Limitations windowDays={WINDOW_DAYS} />
      </Panel>

      <Panel
        title="12 · Vercel archive, closing"
        subtitle="Read live on every load, so what appears here is what Vercel says today"
      >
        <p style={{ fontSize: 13, marginTop: 0 }}>
          Collection stopped when the site left Vercel, and the window is rolling: each day the
          earliest day drops off and nothing is added at the other end.{" "}
          <strong>Read a fall to zero as the move, not as a collapse in traffic.</strong> The free
          tier answers any request for a date older than 31 days with a flat 400, so whatever needs
          keeping should be exported before the plan changes rather than after.
        </p>
        {vercel.daily.ok ? (
          vercelSeries.length === 0 ? (
            <EmptyNotice
              what="pageviews"
              since={vercel.since.toISOString().slice(0, 10)}
              until={vercel.until.toISOString().slice(0, 10)}
            />
          ) : (
            <>
              <div className="adm-stats" style={{ marginBottom: 14 }}>
                <Stat n={vercelTotals.pageviews.toLocaleString("en-GB")} k="Archived pageviews" />
                <Stat
                  n={vercel.totals.ok ? vercel.totals.data.visitors.toLocaleString("en-GB") : "—"}
                  k="Archived visitors"
                  note="Vercel's own de-duplication, not ours — not comparable with the figure above."
                />
              </div>
              {vercel.routes.ok && (
                <DimensionTable
                  rows={vercel.routes.data}
                  dimension="route"
                  valueHeading="Route"
                  limit={PANEL_LIMITS.routes}
                />
              )}
            </>
          )
        ) : (
          <FailureNotice failure={vercel.daily.failure} />
        )}
        <VercelPlanNotes />
      </Panel>
    </>
  );
}
