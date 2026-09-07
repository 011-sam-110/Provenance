// Configuration for the client-side analytics beacon, kept as a pure module so the
// arming rule is testable without a browser.
//
// WHY THERE IS A BEACON AT ALL, HAVING JUST REMOVED ONE. `<Analytics />` was deleted
// because it posted to /_vercel/insights, a path that exists only on Vercel's edge, so
// self-hosted it collected nothing while looking exactly like collection. The access
// log replaced it for traffic. But a server log physically cannot answer three of the
// questions actually being asked of it:
//
//   bounce rate      needs to know that two requests were the same visit
//   time on page     needs to know when the visitor LEFT, which sends no request
//   misclicks        needs to see a click that produced no navigation at all
//
// None of those are a shortcoming of the log. They are events that never reach a
// server. So the split is deliberate and permanent: the ACCESS LOG is the source of
// truth for traffic (it cannot be blocked, and it sees crawlers), and the beacon is the
// only source for engagement. Where the two disagree about visitor counts, the log is
// right.
//
// EXPECT THE BEACON TO UNDERCOUNT, BADLY. This site's audience is OSINT and infosec
// people, who block third-party analytics at rates far above the web average, and
// `respect_dnt` below means we decline to count anyone who asked not to be. Treating a
// beacon number as a traffic total would understate reality; that is the log's job.
//
// DORMANT-SAFE, like every other upstream in this repo: with no key set, nothing loads,
// no request is made, and no placeholder pretends otherwise.

/** PostHog EU cloud. EU rather than US so visitor data does not leave the region. */
export const DEFAULT_BEACON_HOST = "https://eu.i.posthog.com";

export type BeaconConfig = {
  readonly key: string;
  readonly host: string;
};

/**
 * The beacon's config, or null when it is not configured.
 *
 * A PostHog project key is a WRITE-ONLY PUBLIC key. It ships inside the client bundle
 * by design — every visitor's browser can read it — so it is not a secret and belongs
 * in NEXT_PUBLIC_*. It cannot read data back; that needs a separate personal API key
 * which must never appear here.
 */
export function beaconConfig(env: Record<string, string | undefined> = process.env): BeaconConfig | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return null;

  // A placeholder left in a .env file is worse than an unset variable: it looks
  // configured, loads the library, and posts every event into nothing.
  if (/^(your|changeme|placeholder|phc_xxx|todo)/i.test(key)) return null;

  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_BEACON_HOST;
  return { key, host };
}

/**
 * Runtime options for posthog-js.
 *
 * `persistence: "sessionStorage"` IS THE LOAD-BEARING LINE, and it is a compromise
 * chosen on purpose rather than the most private option available.
 *
 *   "memory"          no storage at all, so no cookie-consent question — but PostHog
 *                     then cannot tell that page 2 belongs to the same visit as page 1.
 *                     Every pageview becomes a new anonymous person, unique visitors
 *                     inflate to equal pageviews, and BOUNCE RATE READS ~100% FOREVER.
 *                     It would deliver the metric as a number that is always wrong.
 *   "sessionStorage"  session-scoped, first-party, no cookie, and cleared when the tab
 *                     closes. Sessions are coherent, so bounce rate and time on page
 *                     are real, and nothing links one visit to the next.
 *   default           localStorage + cookie, which persists across visits and is the
 *                     thing app/(site)/privacy promises we do not do.
 *
 * So: no cookies, nothing that survives the tab, and metrics that mean something.
 *
 * NOT PROXIED THROUGH OUR OWN DOMAIN, and that is a choice. Routing the beacon through
 * a first-party path is the standard trick for defeating blocklists and it would raise
 * capture a lot. We do not do it. A visitor who blocked trackers made a decision, and
 * disguising ours as first-party traffic to overturn it would contradict the page that
 * tells them what we collect.
 */
export function beaconOptions(config: BeaconConfig) {
  return {
    api_host: config.host,
    persistence: "sessionStorage" as const,
    // Autocapture is what buys the click data — including PostHog's $rageclick and
    // dead-click detection, which are derived from captured clicks and do NOT require
    // session replay. Replay is off below.
    autocapture: true,
    capture_pageview: true,
    // Bounce rate and time-on-page are computed from a leave event. Without this the
    // dashboard has arrival times and nothing else.
    capture_pageleave: true,
    // Session replay records the DOM — what the visitor saw and typed. It is a
    // different order of collection from counting, it needs a consent banner, and it
    // was explicitly not chosen. Keep both of these off.
    disable_session_recording: true,
    disable_surveys: true,
    // Honour Do Not Track. Costs some coverage; the log still counts the request.
    respect_dnt: true,
  };
}
