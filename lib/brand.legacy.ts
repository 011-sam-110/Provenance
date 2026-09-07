/**
 * Hosts this site used to be served from, and the one it is served from now.
 *
 * A MOVED SITE KEEPS ITS OLD ADDRESS FOREVER. Links posted to Reddit, the OG cards
 * already unfurled in other people's chat logs, and every search result Google has
 * indexed all still name the old host. Measured over this project's whole life on
 * 2026-09-07, search was the LARGEST referred channel — 1,551 visitors from google.com
 * plus 386 from the Android search app, against 956 + 239 from Reddit — and all of it
 * points at the Vercel host. Dropping that host loses the traffic; redirecting it moves
 * the ranking to the new domain instead.
 *
 * EXACT MATCH, NOT A SUFFIX. Vercel gives every preview deployment its own
 * `*.vercel.app` hostname, and previews exist to be reviewed, not redirected away. A
 * `.endsWith(".vercel.app")` test would bounce every preview to production and make the
 * review surface useless. Only the production alias belongs here.
 */
export const LEGACY_HOSTS: readonly string[] = ["provenance-online.vercel.app"];

/** The host this site is served from now. Redirect target for every entry above. */
export const CANONICAL_HOST = "provenance-online.com";

/**
 * The absolute URL a request for a legacy host should be sent to, or null to pass it
 * through. Pure, so tests/unit/legacy-host-redirect.test.ts can enumerate the cases
 * without a request object.
 */
export function legacyRedirect(host: string | null, pathAndQuery: string): string | null {
  if (!host) return null;
  // Strip a port before comparing: a Host header may carry one, the list never does.
  const bare = host.toLowerCase().split(":")[0];
  if (!LEGACY_HOSTS.includes(bare)) return null;
  return `https://${CANONICAL_HOST}${pathAndQuery}`;
}
