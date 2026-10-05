import { expect, test, type Page } from "@playwright/test";
import { BRAND } from "@/lib/brand";

/**
 * The landing page, held to the things the rest of the repo says about it.
 *
 * WHAT THIS FILE USED TO BE. Five tests about `.pv-hero-strip` and `.pv-stage-status`, the
 * hero's bottom band and the boot ticker: that they did not overlap, and that both were gone
 * 400px down. The 2026-10-05 rebuild removed both elements with the MapLibre hero they
 * belonged to, so those tests had nothing left to find and are deleted, not skipped.
 *
 * WHAT IT ASSERTS NOW. The page is one continuous scroll in which one globe changes state,
 * and almost everything a reviewer would check by eye is choreography. None of that is
 * asserted here, because a pixel position is a design decision and this file would have to
 * be edited every time one moved. What IS asserted is what other files depend on:
 *
 *   - the eight sections exist, in order, each under its id;
 *   - nothing scrolls sideways, at either width, in either motion mode;
 *   - with reduced motion the page is a complete document that needs no scrolling to read;
 *   - the page asks this site's API for nothing, and a visit contacts no third party except
 *     the visit counter. `CLAUDE.md` states the first, and `/privacy` tells the public which
 *     hosts a visitor's browser reaches, so each is a factual claim with nothing else
 *     checking it;
 *   - the links the licence and the camera directory depend on are still there.
 *
 * THE HOOKS. Section ids `hero inset split plates layers flat street close`, the globe
 * canvas `[data-testid="landing-globe"]`, and `window.__pvLanding.ready`, which
 * `LandingStage` sets. If one is renamed, rename it here in the same change; do not loosen a
 * selector to make a rename pass.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const SECTIONS = ["hero", "inset", "split", "plates", "layers", "flat", "street", "close"] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const MOTION = ["no-preference", "reduce"] as const;

/**
 * Wait until the stage is running and has its data.
 *
 * The canvas is in the server HTML, so "the canvas is attached" says nothing about
 * hydration. `LandingStage` publishes `window.__pvLanding` when its effect runs, for the
 * review screenshots and for this file, and `ready` turns true once the snapshot and the
 * stills have arrived. Before that the pinned sections have not been given their heights,
 * and a test that scrolls is measuring the server layout and not the page.
 *
 * If this times out, the snapshot or an image failed to load, or the handle was renamed.
 */
const stageReady = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { __pvLanding?: { ready: boolean } }).__pvLanding?.ready === true,
    null,
    { timeout: 30_000 },
  );

/**
 * Scroll from the top to the bottom the way a reader does, most of a screen at a time.
 *
 * "instant", because a smooth scroll would still be travelling when the next line reads.
 * Two animation frames after each step: the stage smooths one scroll value inside its own
 * loop, and anything a section starts when it comes into view starts on a frame.
 */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; ; y += step) {
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      await frame();
      await frame();
      // Read the height on every pass. A pinned section can change it after hydration.
      if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
    }
  });
}

test("the eight sections are on the page, in order", async ({ page }) => {
  await page.goto("/");
  // One selector for all eight, so the result comes back in DOCUMENT order. A missing id, a
  // duplicated id and two sections swapped all show up as a different array.
  const found = await page.evaluate(
    (ids) => Array.from(document.querySelectorAll(ids.map((id) => `#${id}`).join(","))).map((el) => el.id),
    [...SECTIONS],
  );
  expect(found).toEqual([...SECTIONS]);
});

/**
 * Sideways scroll is measured all the way down the page, most of a screen at a time, not once
 * at load. The page pins stages and slides a row of cards across one of them, so the document
 * can be exactly as wide as the window at scroll 0 and wider 9,000px down.
 *
 * A sweep of the document and not "the top of each section": two of the sections are scenes
 * inside one pinned stage, so a section's own box does not say where in the scroll it plays.
 *
 * Both motion modes, because they are two layouts. Reduced motion un-pins everything and
 * lays the stills out in normal flow, and an image that was clipped by its pinned stage is
 * not clipped there.
 */
for (const vp of VIEWPORTS) {
  for (const motion of MOTION) {
    test(`nothing scrolls sideways (${vp.name}, motion ${motion})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/");
      // Both modes publish the handle. In reduced motion it means the in-flow globes have
      // been drawn, which is when that layout has its final boxes.
      await stageReady(page);

      const wider = await page.evaluate(async () => {
        const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
        const out: string[] = [];
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        let samples = 0;
        for (let y = 0; ; y += step) {
          window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
          await frame();
          await frame();
          samples += 1;
          const width = document.documentElement.scrollWidth;
          if (width > window.innerWidth) {
            out.push(`at scrollY ${Math.round(window.scrollY)}: scrollWidth ${width} > innerWidth ${window.innerWidth}`);
          }
          if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
        }
        // The precondition. A page one screen tall has nothing to sweep, and "no overflow
        // found" would then be a statement about the hero alone.
        if (samples < 5) out.push(`only ${samples} scroll positions: the page is not the long document this test expects`);
        return out;
      });

      expect(wider).toEqual([]);
    });
  }
}

/**
 * `prefers-reduced-motion: reduce` is not "the same page with the easing removed". The fixed
 * canvas is hidden and every section shows a still, so the page has to read from top to
 * bottom with no scroll position driving anything.
 *
 * So this test NEVER SCROLLS, and that is the assertion. A heading whose opacity or position
 * waits on a scroll-driven custom property is still waiting when the checks run.
 *
 * Opacity is multiplied up the ancestors by hand: Playwright's `toBeVisible` counts an
 * opacity-0 box as visible, and a faded-out heading is the likely way for this to break.
 * The poll allows a load-in transition to finish. It does not allow a scroll to happen.
 *
 * LIMIT. A heading hidden by an ancestor's `clip-path` passes every check here. Nothing
 * short of a screenshot sees that.
 */
test("with reduced motion every section's heading reads without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  for (const id of SECTIONS) {
    const heading = page.locator(`#${id}`).locator("h1, h2, h3").first();
    await expect(heading, `#${id} has no h1, h2 or h3`).toBeAttached();
    await expect(heading, `the heading of #${id} is not visible`).toBeVisible();
  }

  const hiddenHeadings = () =>
    page.evaluate((ids) => {
      const out: string[] = [];
      for (const id of ids) {
        const heading = document.getElementById(id)?.querySelector("h1, h2, h3");
        if (!heading) {
          out.push(`#${id}: no heading`);
          continue;
        }
        let opacity = 1;
        for (let el: Element | null = heading; el; el = el.parentElement) {
          opacity *= Number(getComputedStyle(el).opacity);
        }
        if (opacity < 0.99) out.push(`#${id}: heading opacity ${opacity.toFixed(2)}`);
        if (heading.textContent?.trim() === "") out.push(`#${id}: heading is empty`);
      }
      return out;
    }, [...SECTIONS]);

  await expect.poll(hiddenHeadings, { timeout: 10_000 }).toEqual([]);
  expect(await page.evaluate(() => window.scrollY), "this test must not scroll").toBe(0);
});

/**
 * `CLAUDE.md` says the landing page makes no `/api` call: its globe draws one committed
 * snapshot and its figures are imported at build time. That is why `/` costs no function
 * invocation per visitor, and it is one `fetch("/api/...")` in a client component away from
 * being false with nothing else to notice.
 *
 * Requests are collected from before navigation until after a scroll to the bottom, since a
 * section that fetched when it came into view would not have fetched yet at load.
 */
test("the page asks this site's API for nothing, from load to the bottom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));

  await page.goto("/");
  await stageReady(page);
  await scrollThrough(page);
  // A request is recorded when it is sent, so this only has to outlast the frame or two
  // between a section coming into view and whatever it starts.
  await page.waitForTimeout(1_500);

  const origin = new URL(page.url()).origin;
  const apiCalls = requested.filter((url) => {
    const u = new URL(url);
    return u.origin === origin && u.pathname.startsWith("/api/");
  });
  expect(apiCalls).toEqual([]);
  // The precondition, or an empty list proves nothing: the page did load things.
  expect(requested.length).toBeGreaterThan(0);
});

/**
 * `/privacy` lists who sees a visitor's IP address, and since 2026-10-05 it says the front
 * page loads no map tiles from anyone and that every typeface is served from this domain.
 * Before that the hero globe was MapLibre on OpenFreeMap tiles, so a landing visit reached a
 * tile host without the visitor opening anything.
 *
 * This is an allow-list on purpose. A deny-list of the map and font hosts would pass the day
 * a new third party arrived, which is exactly the day `/privacy` needs an edit. The one
 * third party allowed is the visit counter, which has its own card on that page; it is not
 * loaded at all unless NEXT_PUBLIC_POSTHOG_KEY is set, so most local runs see none.
 *
 * A red here means: either remove the request, or add the host to `/privacy` and then here.
 */
test("a visit contacts this site and the visit counter, and no other host", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));

  await page.goto("/");
  await stageReady(page);
  await scrollThrough(page);
  await page.waitForTimeout(1_500);

  const origin = new URL(page.url()).origin;
  const others = new Set<string>();
  for (const url of requested) {
    const u = new URL(url);
    // data: and blob: never leave the browser.
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.origin === origin) continue;
    if (/(^|\.)posthog\.com$/.test(u.hostname)) continue;
    others.add(u.hostname);
  }
  expect([...others].sort()).toEqual([]);
});

/**
 * Four links, each load-bearing somewhere else:
 *
 *   /app      the product. The first one in the document must be visible at load, without
 *             a scroll, or the page has no call to action on its first screen.
 *   /cameras  the home page takes nearly every search click, and this is its only link into
 *             the camera directory. Without it those pages are reachable through the
 *             sitemap alone. tests/unit/seo-share-cards.test.ts pins the source; this pins
 *             that it renders.
 *   /privacy  or the privacy page is orphaned.
 *   the repo  AGPL-3.0 section 13: a hosted AGPL program must offer its source to the people
 *             using it. Removing this link is a licence breach, not a styling decision.
 */
test("the calls to action and the footer links are on the page", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('a[href="/app"]').first()).toBeVisible();
  await expect(page.locator('a[href="/cameras"]').first()).toBeAttached();
  await expect(page.locator('a[href="/privacy"]').first()).toBeAttached();
  await expect(
    page.locator(`a[href="${BRAND.repoUrl}"], a[href="${BRAND.repoUrl}/"]`).first(),
    `no link to ${BRAND.repoUrl}`,
  ).toBeAttached();
});
