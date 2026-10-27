import { expect, test } from "@playwright/test";
import { BRAND } from "../../lib/brand";

/**
 * A browser with no WebGL. MapLibre cannot start there, and until 2026-10-27 /eye and
 * /app both showed Next's "Application error: a client-side exception has occurred"
 * (measured against production with these same flags). They now show
 * components/map/MapFallback.tsx: plain words, the camera directory and the source code.
 * The landing page never needed WebGL: its globe falls back to the 2D painter.
 */

test.use({ launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] } });

for (const path of ["/eye?place=westminster", "/app"]) {
  test(`${path} says the map cannot start, and offers the cameras and the source`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);

    const plate = page.locator("[data-map-fallback]");
    await expect(plate).toBeVisible({ timeout: 30_000 });
    await expect(plate).toContainText("The map can't start in this browser");
    await expect(plate.locator('a[href="/cameras"]')).toBeVisible();
    await expect(plate.locator(`a[href="${BRAND.repoUrl}"]`)).toBeVisible();
    await expect(page.getByText("Application error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("the God's eye page says so in its state, for scripts", async ({ page }) => {
  await page.goto("/eye?place=westminster");
  await expect(page.locator('main[data-eye-state="no-webgl"]')).toBeAttached({ timeout: 30_000 });
});
