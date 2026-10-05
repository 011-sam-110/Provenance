import { expect, test, type Page } from "@playwright/test";

// THIRD LIFE OF THIS FILE, and each rewrite was for the same reason: the assertion outlived
// the page it described, and nothing ran the suite to notice.
//
//   1. It read `stat-line` off `/`, from when `/` WAS the Globe.GL homepage.
//   2. It read a MapLibre canvas and the measured counts in `.pv-hero-strip`, from when the
//      hero was a live MapLibre globe.
//   3. Now (2026-10-05): the globe on `/` is a 2D canvas drawn by
//      `lib/marketing/landingGlobe.ts` from one committed snapshot. There is no MapLibre on
//      the page, no map tile and no `/api` call, and the hero strip is gone.
//
// The second test used to request `/textures/earth-night.jpg`, the Globe.GL texture. No code
// references that file any more, so the test was guarding an asset nothing loads. Its
// modern equivalent is below: the Earth photograph the hero opens on.

const GLOBE = '[data-testid="landing-globe"]';

/**
 * How many different colours the globe canvas holds, capped at 64.
 *
 * Read from a 1:1 COPY of the canvas and not through the canvas's own context. A copy works
 * whatever kind of context the stage holds and leaves that context alone, where
 * `getContext("2d")` on the original would return null for any other kind. No downscaling:
 * the data is sparse 2px dots on a transparent ground, and a scaled copy can step straight
 * over every one of them.
 *
 * 0 means there is no canvas or it has no size yet. 1 means it is blank: fully transparent,
 * or one flat fill.
 */
const distinctColours = (page: Page) =>
  page.evaluate((selector) => {
    const source = document.querySelector<HTMLCanvasElement>(selector);
    if (!source || source.width === 0 || source.height === 0) return 0;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(source, 0, 0);
    const px = new Uint32Array(ctx.getImageData(0, 0, copy.width, copy.height).data.buffer);
    const seen = new Set<number>();
    for (let i = 0; i < px.length && seen.size < 64; i += 1) seen.add(px[i]);
    return seen.size;
  }, GLOBE);

/**
 * `LandingStage` publishes `window.__pvLanding` when its effect runs, and `ready` turns true
 * once the snapshot and the stills have arrived. See the same helper in landing.spec.ts.
 */
const stageReady = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { __pvLanding?: { ready: boolean } }).__pvLanding?.ready === true,
    null,
    { timeout: 30_000 },
  );

test("the landing globe is on the page and draws", async ({ page }) => {
  // Stated, not inherited from the machine: with reduced motion the fixed canvas is hidden
  // on purpose and each section shows a still instead.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  await expect(page.locator(GLOBE)).toBeAttached();
  // THE DATA ARRIVED. This is the assertion the pixels below cannot make: without the
  // snapshot the stage still draws an ocean disc and the photographs, which is more than
  // one colour, so a globe with no dots on it would pass a pixel count.
  await stageReady(page);

  // "More than one colour" is a low bar on purpose. It separates a canvas that drew from a
  // blank one, which is the failure nobody sees in a screenshot diff nobody opens. It does
  // not say the globe is right. A poll, because the stage paints on its next frame.
  //
  // At load the canvas holds the hero: the rendered photograph of Earth.
  await expect
    .poll(() => distinctColours(page), { timeout: 30_000, message: "the canvas is blank at the top of the page" })
    .toBeGreaterThan(1);

  // At the "inset" moment it holds the data globe at full strength, with the photograph
  // faded out. Two positions, because they are two different draws.
  //
  // Reached through the stage's own named mark and not through the box of `#inset`: the
  // inset and the split are two scenes inside one pinned stage, so the section's box does
  // not say where in the scroll its scene plays. `go` returns -1 for a name it does not
  // know, which is how a renamed mark shows up here.
  const y = await page.evaluate(() =>
    (window as unknown as { __pvLanding: { go(name: string): number } }).__pvLanding.go("inset"),
  );
  expect(y, 'the stage has no scroll mark named "inset"').toBeGreaterThan(0);
  await expect
    .poll(() => distinctColours(page), { timeout: 30_000, message: 'the canvas is blank at the "inset" mark' })
    .toBeGreaterThan(1);
});

/**
 * The hero opens on a photograph of Earth, and it must come from this site.
 *
 * The first globe this project shipped was black in production because its texture came
 * from an external CDN whose redirect chain the loader could not follow. The texture moved
 * into the repo and this file has asserted "the Earth is served locally" ever since. The
 * image is a different one now; the rule is the same, and `/privacy` gives a second reason
 * for it: an image on another host shows that host every visitor's IP address.
 *
 * Asserted on the network and not on a selector, so it holds whether the hero uses an
 * `<img>`, a CSS background, `next/image`, or loads the still and draws it into the canvas.
 * Every image the landing page ships lives under `public/marketing/landing/`
 * (docs/IMAGE-LICENSES.md). So at load, with only the hero on screen, at least one file
 * must have come from there, and no image at all may have come from another origin.
 */
test("the hero Earth image is served from this site's own origin", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const responses: { url: string; status: number; image: boolean }[] = [];
  page.on("response", (res) => {
    responses.push({ url: res.url(), status: res.status(), image: res.request().resourceType() === "image" });
  });

  await page.goto("/");
  await stageReady(page);

  const origin = new URL(page.url()).origin;
  // By path and not by resource type: a still that is fetched and decoded by hand is a
  // "fetch" to the browser. decodeURIComponent, because next/image asks for
  // /_next/image?url=%2Fmarketing%2Flanding%2F...
  const fromLanding = () =>
    responses.filter((r) => new URL(r.url).origin === origin && decodeURIComponent(r.url).includes("/marketing/landing/"));

  await expect
    .poll(() => fromLanding().length, {
      timeout: 30_000,
      message: "nothing under /marketing/landing/ was requested from this origin at load",
    })
    .toBeGreaterThan(0);

  // Served, not merely asked for. A renamed or missing file is a 404 here, and on the page
  // it is an empty disc where the Earth should be.
  expect(fromLanding().filter((r) => r.status >= 400)).toEqual([]);

  const elsewhere = responses.filter((r) => r.image && /^https?:/.test(r.url) && new URL(r.url).origin !== origin);
  expect(elsewhere.map((r) => r.url)).toEqual([]);
});
