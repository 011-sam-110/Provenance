/**
 * Which paths the maintenance gate leaves alone.
 *
 * The site comes down to stop it costing money, so the list follows from that and not
 * from what is convenient:
 *
 *   CHROME AND CRAWL SIGNALS PASS. PAGES, DATA AND COMPUTE ARE GATED.
 *
 * A principle rather than a bare list, because a list says nothing about a file added
 * next month. Applying it:
 *
 *   api/gate            the unlock endpoint. Gating it locks everyone out for good.
 *   _next/  _vercel/    build assets, RSC payloads, the analytics beacon. The CDN
 *                       serves these with NO function invocation; gating them would
 *                       add one per request and hide nothing, because the HTML that
 *                       references them is gated.
 *   robots.txt          a 503 here makes Google stop crawling the site outright,
 *                       which is louder than a month-long outage warrants. The
 *                       sitemap is NOT exempt: a 503 sitemap is a mild signal Google
 *                       retries, and generating it can fan out to the camera registry.
 *   sw.js  manifest     the installed PWA re-checks these. A 503 breaks the install
 *   favicon icons/      and hides nothing.
 *   brand/              OG card images, so links already shared still render a card.
 *   .well-known/
 *
 * Everything else is gated, and two entries are worth naming because an earlier draft
 * of this file exempted them:
 *
 *   api/                42 handlers and every upstream feed. This is where the cost
 *                       is. Exempting it kept the Telegram and Discord webhooks and
 *                       /api/status working, and left the expensive half of the site
 *                       running - which is the thing the outage exists to stop.
 *   webcams/ textures/  8.4 MB and 3.4 MB of public/ (measured 2026-09-07). Only
 *   sky/ geo/           gated HTML ever asks for them, so real traffic is zero either
 *                       way; gating means a scraper costs one invocation instead of
 *                       the egress.
 *
 * ONE LIST, TWO CONSUMERS. `isGatedPath` is what the middleware function checks, and
 * `middleware.ts` ALSO carries a `config.matcher` built from the same list so that an
 * exempt request never invokes the function at all. Next needs the matcher to be a
 * string LITERAL, so it cannot import this list; `tests/unit/gate.test.ts` derives the
 * literal from the list and fails if the two ever disagree.
 *
 * Do not "simplify" this to "anything with a dot in it is a file": camera ids contain
 * dots (`tfl:JamCams_00001.01234`), so `/camera/<id>` pages would leak through.
 */
export const GATE_EXEMPT_STARTS = [
  "api/gate",
  "_next/",
  "_vercel/",
  ".well-known/",
  "sw.js",
  "manifest.webmanifest",
  "robots.txt",
  "favicon",
  "icons/",
  "brand/",
] as const;

/** True when a request for `pathname` must present the gate cookie. */
export function isGatedPath(pathname: string): boolean {
  return !GATE_EXEMPT_STARTS.some((start) => pathname.startsWith("/" + start));
}

/** Escape a literal so it means itself inside a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `config.matcher` string that `middleware.ts` must carry, derived from the list.
 * Same shape as the Next docs' "match everything except" pattern.
 *
 * The escape is load bearing and was wrong here once: written as `"\."` it is not an
 * escape at all, because JS collapses that to a bare `.` in a string literal, and the
 * dot then matches any character. `sw.js` would have exempted `swXjs` with it.
 *
 * Note the exemptions are PREFIXES, which is the only shape a negative lookahead can
 * express. `api/gate` therefore also exempts a route called `api/gateway`; the unit
 * test asserts no such route exists.
 */
export function gateMatcher(): string {
  const alternatives = GATE_EXEMPT_STARTS.map(escapeRegExp).join("|");
  return `/((?!${alternatives}).*)`;
}
