import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

/**
 * Guards the cache boundary in front of the crawlable pages.
 *
 * WHY A SOURCE-SHAPE TEST RATHER THAN A BEHAVIOURAL ONE. What this protects is a
 * Next.js render-mode decision, and that decision is invisible from inside the
 * process: calling the page function returns the same markup whether the route was
 * prerendered or rendered from scratch. The difference only shows up in a built
 * `.next/prerender-manifest.json`, or as an `X-Vercel-Cache: MISS` on a deployment.
 * Neither is reachable from a unit test, so the thing worth pinning is the property
 * that CAUSES the mode: whether a page can reach a live upstream fetch.
 *
 * The failure being prevented is silent. Per Next's caching docs, "if a route has a
 * fetch request that is not cached, this will opt the route out of the Full Route
 * Cache", and Next 15 makes every `fetch` uncached by default. `getRegistry()`
 * fetches whenever its 5-minute module cache is cold. So a page importing it
 * directly renders correctly, passes every test, deploys green, and quietly costs a
 * full server render on every one of the ~19k crawlable URLs.
 *
 * Reading through `lib/seo/registrySnapshot` instead puts an `unstable_cache`
 * boundary in the way, and its callback runs in a swapped work-unit store so the
 * fetch inside it cannot mark the surrounding render dynamic.
 *
 * If you are here because this test failed: you have not broken the page, you have
 * broken its caching. Add what you need to `lib/seo/registrySnapshot.ts` and read it
 * from there. API routes under `app/api/**` are exempt by design - they are
 * `force-dynamic` already and have nothing to lose.
 */
const CRAWLABLE_PAGES = [
  "app/cameras/page.tsx",
  "app/cameras/[country]/page.tsx",
  "app/cameras/[country]/[region]/[[...paging]]/page.tsx",
  "app/camera/[id]/page.tsx",
];

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

test.each(CRAWLABLE_PAGES)("%s reads the registry through the cached snapshot", (page) => {
  const text = source(page);
  expect(text).toContain('from "@/lib/seo/registrySnapshot"');
});

test.each(CRAWLABLE_PAGES)("%s does not import the live registry directly", (page) => {
  expect(source(page)).not.toContain('from "@/lib/sources/registry"');
});

test("every cached reader declares a revalidate window", () => {
  const text = source("lib/seo/registrySnapshot.ts");
  const readers = text.match(/unstable_cache\(/g) ?? [];
  const windows = text.match(/\{ revalidate: [A-Z_]+ \}/g) ?? [];
  expect(readers.length).toBeGreaterThan(0);
  // A reader with no revalidate is cached for a year by default, which would pin a
  // camera page to a snapshot long after the feed that produced it changed.
  expect(windows).toHaveLength(readers.length);
});

test("the snapshot never caches the whole registry", () => {
  // A Vercel Data Cache entry is capped at 2 MB and the full camera array is ~6.4 MB
  // of JSON, so a reader that returns `cameras` wholesale would fail to store - and
  // fail SILENTLY, falling back to recomputing on every request, which is the exact
  // cost this module exists to remove.
  const text = source("lib/seo/registrySnapshot.ts");
  expect(text).toContain("pageSlice(");
  expect(text).not.toMatch(/return\s+await\s+getRegistry\(\)/);
});
