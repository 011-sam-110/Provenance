import { expect, test } from "@playwright/test";

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
