import { expect, test } from "@playwright/test";

// This test used to read `stat-line` off `/`, from when `/` WAS the Globe.GL homepage.
// `stat-line` now lives in the console shell at `/app`, so the assertion had been failing
// against a page that no longer contains the element — and nothing ran the suite to notice,
// because no workflow runs Playwright. Re-pointed at the contract the homepage actually has
// now: a globe canvas, and a non-zero measured figure printed beside it.
test("homepage renders the globe and a non-zero measured count", async ({ page }) => {
  await page.goto("/");
  // MapLibre renders the stage globe into a <canvas>.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  const strip = page.locator(".pv-hero-strip-inner p").first();
  // Regex avoids the substring trap where e.g. "34 layers" contains "4 layers".
  await expect(strip).toContainText(/[1-9]\d* layers · [1-9]\d* live/, { timeout: 30_000 });
  await expect(strip).toContainText(/features placed in [1-9]\d* countries/);
});

test("the Earth texture is served locally (guards the black-globe regression)", async ({
  request,
}) => {
  // The globe was once black because the texture came from an external CDN
  // whose redirect chain three.js couldn't follow. The texture is now a local
  // static asset; this asserts it actually serves so a missing/renamed file
  // (which would render a black sphere) fails the suite instead of passing it.
  const res = await request.get("/textures/earth-night.jpg");
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("image");
});
