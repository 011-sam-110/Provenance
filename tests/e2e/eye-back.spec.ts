import { expect, test, type Page } from "@playwright/test";

/**
 * The way back to God's eye view from the console (components/console/EyeReturn.tsx).
 *
 *   - From /eye, Exit to dashboard opens the console; the console's map then shows "God's eye
 *     view / Back to <place>" at its top left, and one click returns to the same place,
 *     heading and tilt, wherever the console map has been moved to since.
 *   - It is there only after arriving from /eye: a console opened directly has none,
 *     and a forged `eye=` shows none and leaves the address.
 *   - With the HUD readout on it sits below the readout; on a phone it clears the
 *     Sources sheet and nothing scrolls sideways.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` on /eye, `.maplibregl-canvas` for the map.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const consoleMap = (page: Page) => page.waitForSelector("main .maplibregl-canvas, .tn-cw-stage .maplibregl-canvas", { timeout: 90_000 });

/** The heading on /eye's compass and the map's tilt, as whole numbers. */
async function readout(page: Page): Promise<{ heading: number; tilt: number }> {
  const text = (await page.locator("[data-compass-chip]").textContent()) ?? "";
  const heading = /^(\d+)°/.exec(text);
  expect(heading, text).not.toBeNull();
  const tilt = await page.evaluate(() => (window as unknown as { __map: { getPitch(): number } }).__map.getPitch());
  return { heading: Number(heading![1]), tilt: Math.round(tilt) };
}

/**
 * Turn the view three notches left and tilt it once. MapLibre eases each key press over
 * 300 ms from where the view is NOW, so presses must wait for each other or they do
 * not add up.
 */
async function moveTheView(page: Page) {
  await page.locator(".maplibregl-canvas").focus();
  for (const key of ["Shift+ArrowLeft", "Shift+ArrowLeft", "Shift+ArrowLeft", "Shift+ArrowDown"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(500);
}

/** Focus the way to the console (it takes its address on focus) and follow it. */
async function exitToDashboard(page: Page) {
  if ((page.viewportSize()?.width ?? 0) <= 900) await page.locator('[data-rail="eye"] [data-rail-menu]').click();
  const exit = page.locator("[data-eye-exit]");
  await exit.focus();
  await exit.click();
  await page.waitForURL(/\/app/);
}

/** The same address with the console's Sources rail open, as the landing page's "All sources" asks. */
async function exitWithSourcesOpen(page: Page) {
  if ((page.viewportSize()?.width ?? 0) <= 900) await page.locator('[data-rail="eye"] [data-rail-menu]').click();
  const exit = page.locator("[data-eye-exit]");
  await exit.focus();
  const href = (await exit.getAttribute("href"))!;
  await page.goto(href.replace("&eye=", "&sources=open&eye="));
}

const plate = (page: Page, place: string) => page.getByRole("link", { name: `God's eye view: back to ${place}` });

test("the way back: Tower Bridge, turned, the dashboard, a source changed, and one click to the same view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  await moveTheView(page);
  const left = await readout(page);
  expect(left.heading).not.toBe(292); // the preset's own heading: it did turn

  await exitWithSourcesOpen(page);
  await expect(plate(page, "Tower Bridge")).toBeVisible({ timeout: 60_000 });
  // Both arrival flags have left the address.
  await expect.poll(() => new URL(page.url()).searchParams.has("eye")).toBe(false);
  expect(new URL(page.url()).searchParams.has("sources")).toBe(false);

  // Change a source in the console: the way back carries nothing of it.
  await page.getByRole("switch", { name: "Show Planes on the map" }).click();

  await plate(page, "Tower Bridge").click();
  await page.waitForURL(/\/eye\?place=tower-bridge&lat=/);
  await ready(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tower Bridge");
  expect(await readout(page)).toEqual(left);
  expect(errors).toEqual([]);
});

test("a console opened directly has no way back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await consoleMap(page);
  await expect(page.locator(".tn-eye-return")).toHaveCount(0);
});

for (const [name, eye] of [
  ["an outside address", "https%3A%2F%2Fevil.example"],
  ["a place that does not exist", "place%3Datlantis"],
] as const) {
  test(`a forged eye= (${name}) shows no way back, and leaves the address`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/app?eye=${eye}`);
    await consoleMap(page);
    await expect.poll(() => new URL(page.url()).searchParams.has("eye")).toBe(false);
    await expect(page.locator(".tn-eye-return")).toHaveCount(0);
  });
}

test("with the HUD readout on, the way back sits below it", async ({ page }) => {
  // Only the console reads this key: /eye has its own frame.
  await page.addInitScript(() => {
    if (location.pathname.startsWith("/app")) {
      localStorage.setItem("tn.hud.v1", JSON.stringify({ v: 1, d: { enabled: true, variant: "full", animate: false, opacity: 88 } }));
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  await exitToDashboard(page);

  const back = plate(page, "Tower Bridge");
  await expect(back).toBeVisible({ timeout: 60_000 });
  const hud = page.locator("[data-tn-hud]");
  await expect(hud).toBeVisible();
  await expect
    .poll(async () => {
      const [h, b] = [await hud.boundingBox(), await back.boundingBox()];
      return h && b ? b.y - (h.y + h.height) : -999;
    })
    .toBeGreaterThanOrEqual(0);
});

test("on a phone the way back is on the map, clear of the Sources sheet, and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  await exitWithSourcesOpen(page);

  const back = plate(page, "Westminster");
  await expect(back).toBeVisible({ timeout: 60_000 });
  const sheet = page.locator("aside.tn-rail").first();
  await expect(sheet).toBeVisible();
  const [b, s] = [await back.boundingBox(), await sheet.boundingBox()];
  expect(b).not.toBeNull();
  expect(s).not.toBeNull();
  expect(b!.y + b!.height).toBeLessThanOrEqual(s!.y);
  expect(b!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
