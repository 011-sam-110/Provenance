import { expect, test, type Page } from "@playwright/test";

/**
 * The landing page's bottom band carries two separate lines that are written by two
 * different owners:
 *
 *   - `.pv-hero-strip`, a bar absolutely positioned at the bottom of the hero, holding the
 *     page's first factual claim (the measured layer/feature counts) and the attributions.
 *   - `.pv-stage-status`, the boot ticker, which `GlobeStage` fixes to the viewport and
 *     fills from the queue of lines the globe hands up as each layer lands.
 *
 * The ticker's whole life is spent during boot — which is exactly when the hero, and so
 * the strip, is the thing on screen. Fixing it to the bottom-left of the viewport put it
 * on top of the strip's first line, so the two read as one smear of overlapping text for
 * the first seconds of every visit. Neither owner can see the other in review, so the
 * geometry is asserted here instead.
 */
test("the boot ticker does not collide with the hero strip", async ({ page }) => {
  await page.goto("/");

  const status = page.locator(".pv-stage-status");
  const strip = page.locator(".pv-hero-strip");

  // The strip fades in on a 1.5s delay; the ticker carries a line from first paint.
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).not.toBeEmpty();

  const a = await status.boundingBox();
  const b = await strip.boundingBox();
  expect(a, "the ticker should have a box").not.toBeNull();
  expect(b, "the hero strip should have a box").not.toBeNull();

  const overlaps =
    a!.x < b!.x + b!.width &&
    b!.x < a!.x + a!.width &&
    a!.y < b!.y + b!.height &&
    b!.y < a!.y + a!.height;

  expect(
    overlaps,
    `ticker ${JSON.stringify(a)} overlaps hero strip ${JSON.stringify(b)}`,
  ).toBe(false);
});

/**
 * The ticker is hidden below 60rem, where there is no room beside the strip for it. If the
 * breakpoint is ever dropped, the collision comes back on phones only — where nobody runs
 * a desktop review. Asserted rather than trusted.
 */
test("the boot ticker is not drawn at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".pv-hero-strip")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".pv-stage-status")).toBeHidden();
});

/**
 * The strip is nailed to the bottom of the hero, so it scrolls WITH the hero: 400px down it
 * is a hard opaque band across the middle of the screen and the globe. The ticker is fixed
 * to the viewport, so 400px down it is printed over the next section's heading. Both were
 * reported from a real screenshot at that position. They now belong to scroll 0 only:
 * `GlobeStage` writes `--pv-hero-out` and both rules fade on it.
 *
 * `toBeHidden` and not an opacity check alone: Playwright counts an opacity-0 box as
 * visible, and so does the accessibility tree. A faded band that is still exposed to a
 * screen reader, or a live region still announcing under the next section, is the bug in
 * a quieter form.
 */
const opacityOf = (sel: string) => (page: Page) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).opacity : "missing";
  }, sel);

const scrollToY = (page: Page, y: number) =>
  // "instant", because a smooth scroll would still be travelling when the assertion reads.
  page.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);

/**
 * The fade is written by GlobeStage's rAF loop, which starts at hydration. The server HTML
 * paints the strip before that, so a test that scrolls on the bare HTML is timing the
 * build's hydration rather than the page (it did, once, under `next dev`). The MapLibre
 * canvas only mounts after hydration, so its presence says the loop is running.
 */
const stageRunning = (page: Page) =>
  expect(page.locator(".pv-stage-globe canvas").first()).toBeAttached({ timeout: 30_000 });

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`the hero strip and the ticker are gone once the reader scrolls (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    const strip = page.locator(".pv-hero-strip");
    const status = page.locator(".pv-stage-status");

    // At the top: the strip as it always was, once its 1.5s-delayed intro fade has run.
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => opacityOf(".pv-hero-strip")(page), { timeout: 10_000 }).toBe("1");
    if (vp.width > 960) await expect(status).toBeVisible();
    await stageRunning(page);

    // Where the screenshot was taken.
    await scrollToY(page, 400);
    await expect(strip).toBeHidden();
    await expect(status).toBeHidden();
    expect(await opacityOf(".pv-hero-strip")(page)).toBe("0");

    // And back.
    await scrollToY(page, 0);
    await expect(strip).toBeVisible();
    await expect.poll(() => opacityOf(".pv-hero-strip")(page)).toBe("1");
    if (vp.width > 960) await expect(status).toBeVisible();
  });
}

/**
 * Under `prefers-reduced-motion: reduce` there is no fade at all: the strip is either there
 * or not, so a scroll that would leave the full-motion version part-way through its fade
 * must find it already gone.
 */
test("with reduced motion the strip swaps out instead of fading", async ({ browser }) => {
  const ctx = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    const strip = page.locator(".pv-hero-strip");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    expect(await opacityOf(".pv-hero-strip")(page)).toBe("1");
    await stageRunning(page);

    await scrollToY(page, 40);
    await expect.poll(() => opacityOf(".pv-hero-strip")(page)).toBe("0");
    await expect(strip).toBeHidden();

    await scrollToY(page, 0);
    await expect.poll(() => opacityOf(".pv-hero-strip")(page)).toBe("1");
    await expect(strip).toBeVisible();
  } finally {
    await ctx.close();
  }
});
