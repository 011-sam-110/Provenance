import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import nextConfig from "../../next.config";

/**
 * The landing page must stay STATICALLY RENDERED, and the legacy deep-link shim must
 * keep working without it.
 *
 * WHY THIS TEST EXISTS RATHER THAN A COMMENT. Taking `searchParams` in a page is how
 * you opt a route into dynamic rendering, and Next does it UNCONDITIONALLY — not just
 * for the requests that carry a query. It is a one-word change with no local symptom:
 * `tsc --noEmit` passes, the whole suite passes, the page looks identical in dev, and
 * the only evidence is a header on production:
 *
 *     GET /  ->  Cache-Control: private, no-cache, no-store, must-revalidate
 *                X-Vercel-Cache: MISS   (every request, forever)
 *
 * That is the shape of defect this repo has been bitten by before — green locally,
 * green in CI, expensive on deploy. It reached production once already: `/` served a
 * full React server render to every visitor for the entire launch, purely to support
 * a redirect for `?v=`/`?c=` links. The cost lands on Active CPU rather than
 * bandwidth, so nothing about the page's size hints at it.
 *
 * The shim now lives in `redirects()` in next.config.ts, which the routing layer
 * applies with NO function invocation at all — strictly cheaper than both a server
 * render and middleware.
 */

const SITE_DIR = resolve(__dirname, "../../app/(site)");

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/**
 * Comments are stripped before matching, deliberately. The page carries a warning in
 * its own docblock telling the next person not to reintroduce this prop, and a guard
 * that fired on the warning would force the warning to be deleted — the test would
 * have removed the very thing most likely to prevent the bug. Only code counts.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("no page under app/(site) takes searchParams, which would silently make it dynamic", () => {
  const offenders = pagesUnder(SITE_DIR)
    .filter((f) => /\bsearchParams\b/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => f.replace(resolve(__dirname, "../.."), ""));
  expect(offenders).toEqual([]);
});

/**
 * The behaviour half. `has` entries are AND-ed within one rule, so `?v=` OR `?c=`
 * needs two rules rather than one with two conditions — a single rule would only fire
 * for links carrying BOTH, which is almost none of them.
 */
test("/ redirects to /app when a legacy ?v= or ?c= deep link arrives", async () => {
  const rules = await nextConfig.redirects!();
  const forParam = (key: string) =>
    rules.filter(
      (r) =>
        r.source === "/" &&
        r.destination === "/app" &&
        (r.has ?? []).some((h) => h.type === "query" && h.key === key),
    );

  expect(forParam("v")).toHaveLength(1);
  expect(forParam("c")).toHaveLength(1);

  // Temporary, not permanent: /app is where the console lives today, and a 308 would
  // be cached by every browser that ever followed one of these links.
  for (const key of ["v", "c"]) expect(forParam(key)[0].permanent).toBe(false);
});
