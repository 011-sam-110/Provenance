import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

/**
 * The CONSOLE must stay STATICALLY RENDERED. Sibling of landing-static.test.ts,
 * which guards `/` for the same reason and carries the longer write-up.
 *
 * Taking `searchParams` in a page is how you opt a route into dynamic rendering,
 * and Next does it UNCONDITIONALLY — for every request, not only the ones carrying
 * a query. It is a one-word change with no local symptom: `tsc --noEmit` passes,
 * the whole suite passes, the page looks identical in dev, and the only evidence is
 * a header on production:
 *
 *     GET /app  ->  Cache-Control: private, no-cache, no-store, must-revalidate
 *                   X-Vercel-Cache: MISS   (every request, forever)
 *
 * `/app` shipped exactly that, for ~150 requests a day, to run a Node function that
 * produced byte-identical HTML: the body is `<ConsoleShell feeds={…} />` and nothing
 * else, and the board is resolved on the client after mount by
 * `variantStore.bootstrap`. Only `<head>` varied, and only by `?v=`.
 *
 * `/` had already been bitten by this once — it served a full server render to every
 * visitor for an entire launch, purely to support a `?v=`/`?c=` redirect. The lesson
 * did not transfer to `/app` on its own, which is why this file exists rather than
 * another comment.
 *
 * If per-board social cards are ever wanted back, give each board a ROUTE
 * (`/app/aviation`) so each card is statically rendered. A query param cannot be.
 */

const CONSOLE_DIR = resolve(__dirname, "../../app/(console)");

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

test("no page under app/(console) takes searchParams, which would silently make it dynamic", () => {
  const offenders = pagesUnder(CONSOLE_DIR)
    .filter((f) => /\bsearchParams\b/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => f.replace(resolve(__dirname, "../.."), ""));
  expect(offenders).toEqual([]);
});

/**
 * The other three ways to lose a static route, none of which look like a mistake in
 * review. `cookies()`/`headers()` are dynamic APIs; `force-dynamic` and
 * `revalidate = 0` say it outright.
 */
test("no page under app/(console) opts into dynamic rendering another way", () => {
  const offenders: string[] = [];
  for (const f of pagesUnder(CONSOLE_DIR)) {
    const src = stripComments(readFileSync(f, "utf8"));
    const rel = f.replace(resolve(__dirname, "../.."), "");
    if (/\b(cookies|headers|draftMode|connection)\s*\(/.test(src)) offenders.push(`${rel}: dynamic API`);
    if (/dynamic\s*=\s*["']force-dynamic["']/.test(src)) offenders.push(`${rel}: force-dynamic`);
    if (/revalidate\s*=\s*0\b/.test(src)) offenders.push(`${rel}: revalidate = 0`);
  }
  expect(offenders).toEqual([]);
});
