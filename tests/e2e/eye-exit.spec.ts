import { expect, test, type Page } from "@playwright/test";

/**
 * "Exit to main dashboard" on God's eye view (components/eye/EyeHud.tsx).
 *
 *   - It is always on screen: beside the name on a wide screen, under the place on a
 *     phone, 44 px tall there, clear of the ledger and the clock, and nothing scrolls
 *     sideways.
 *   - One click (or Enter on it) opens the console at the spot on screen NOW, wherever
 *     the view has been moved to, without the Sources rail, and the console then offers
 *     the way back ("God's eye view: back to <place>").
 *   - A recording (record=1) and an overlay-free film (overlay=0) draw no way out.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` on /eye, `window.__map` (WorldMap's debug
 * handle) on both maps, `[data-eye-exit]` for the link.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 * Set EYE_EXIT_SHOTS=<dir> to keep a screenshot of each step.
 */

// Each journey loads two map pages; a cold server takes most of the default 30 s on the first.
test.describe.configure({ timeout: 120_000 });

const SHOTS = process.env.EYE_EXIT_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const exit = (page: Page) => page.getByRole("link", { name: "Exit to main dashboard", exact: true });
const plate = (page: Page, place: string) => page.getByRole("link", { name: `God's eye view: back to ${place}` });

interface Spot {
  lat: number;
  lon: number;
  zoom: number;
}

/** The centre and zoom of the map on screen, from WorldMap's debug handle. */
async function mapSpot(page: Page): Promise<Spot> {
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), null, { timeout: 90_000 });
  return page.evaluate(() => {
    const m = (window as unknown as { __map: { getCenter(): { lat: number; lng: number }; getZoom(): number } }).__map;
    const c = m.getCenter();
    return { lat: c.lat, lon: c.lng, zoom: m.getZoom() };
  });
}

/** Pan the view and turn it, so "the same spot" cannot be the preset's own framing. */
async function moveTheView(page: Page) {
  await page.locator(".maplibregl-canvas").focus();
  for (const key of ["ArrowRight", "ArrowRight", "ArrowUp", "Shift+ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
}

/** The console's first-visit boot plate (BootSequence.tsx) covers the map for a few seconds. */
async function bootDone(page: Page) {
  await page.locator(".tnx-boot").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);
}

/** The address of the next full page load of /app, as the browser asked for it. */
function nextConsoleRequest(page: Page): Promise<URL> {
  return page
    .waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/app", { timeout: 60_000 })
    .then((r) => new URL(r.url()));
}

function expectSameSpot(a: Spot, b: Spot) {
  // The link rounds to 5 decimals (about a metre) and the zoom to 2.
  expect(Math.abs(a.lat - b.lat)).toBeLessThan(2e-4);
  expect(Math.abs(a.lon - b.lon)).toBeLessThan(2e-4);
  expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.05);
}

test("wide screen: the way out is beside the name, and one click opens the dashboard at the same spot", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=tower-bridge");
  await ready(page);

  const link = exit(page);
  await expect(link).toBeVisible();
  // On the name's row: its middle is level with the name's, and it starts after it.
  const [l, id] = [await link.boundingBox(), await page.locator("header a[href='/']").boundingBox()];
  expect(l && id).toBeTruthy();
  expect(Math.abs(l!.y + l!.height / 2 - (id!.y + id!.height / 2))).toBeLessThanOrEqual(4);
  expect(l!.x).toBeGreaterThan(id!.x + id!.width);
  expect(l!.height).toBeGreaterThanOrEqual(32);
  await shot(page, "01-desktop-eye");

  const opened = await mapSpot(page);
  await moveTheView(page);
  const left = await mapSpot(page);
  expect(Math.abs(left.lon - opened.lon) + Math.abs(left.lat - opened.lat)).toBeGreaterThan(1e-4); // it did move

  await link.hover();
  await shot(page, "02-desktop-hover");
  const asked = nextConsoleRequest(page);
  await link.click();
  const url = await asked;
  expect(url.searchParams.has("sources")).toBe(false);
  expect(url.searchParams.get("eye")).toMatch(/^place=tower-bridge&lat=/);

  await page.waitForURL(/\/app/);
  await expect(plate(page, "Tower Bridge")).toBeVisible({ timeout: 60_000 });
  expectSameSpot(await mapSpot(page), left);
  // The arrival flag has left the address; the spot has not.
  await expect.poll(() => new URL(page.url()).searchParams.has("eye")).toBe(false);
  await bootDone(page);
  await page.waitForTimeout(1500);
  await shot(page, "03-desktop-dashboard");

  // And the way back still returns to the view that was left.
  await plate(page, "Tower Bridge").click();
  await page.waitForURL(/\/eye\?place=tower-bridge&lat=/);
  await ready(page);
  expectSameSpot(await mapSpot(page), left);
  expect(errors).toEqual([]);
});

test("keyboard: Tab reaches it with a visible focus ring, and Enter follows it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);

  const link = exit(page);
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await link.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  const ring = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  await shot(page, "04-desktop-focus");

  const at = await mapSpot(page);
  const asked = nextConsoleRequest(page);
  await page.keyboard.press("Enter");
  const url = await asked;
  expect(url.searchParams.has("sources")).toBe(false);
  await page.waitForURL(/\/app/);
  await expect(plate(page, "Westminster")).toBeVisible({ timeout: 60_000 });
  expectSameSpot(await mapSpot(page), at);
});

test("phone: under the place, 44 px tall, clear of the ledger and the clock, and it works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  // A phone hides a zero row, so the ledger shows only once something has arrived.
  const ledger = page.locator('section[aria-label="What this view shows"]');
  await ledger.locator("p:not([data-zero]):not([data-note])").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);

  const link = exit(page);
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Under the place's line, and above the ledger.
  const sub = (await page.locator("header p").first().boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(sub.y + sub.height);
  if (await ledger.isVisible()) {
    const lb = (await ledger.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(lb.y);
  }
  // Clear of the clock and the "?" in the right-hand corner.
  for (const other of [page.getByLabel("Time now, UTC"), page.locator("header button").first()]) {
    const o = await other.boundingBox();
    if (!o) continue;
    const overlap = box.x < o.x + o.width && o.x < box.x + box.width && box.y < o.y + o.height && o.y < box.y + box.height;
    expect(overlap).toBe(false);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "05-phone-eye");

  const at = await mapSpot(page);
  const asked = nextConsoleRequest(page);
  await link.click();
  const url = await asked;
  expect(url.searchParams.has("sources")).toBe(false);
  await page.waitForURL(/\/app/);
  await expect(plate(page, "Tower Bridge")).toBeVisible({ timeout: 60_000 });
  expectSameSpot(await mapSpot(page), at);
  await bootDone(page);
  await page.waitForTimeout(1500);
  await shot(page, "06-phone-dashboard");
});

for (const [name, flags] of [
  ["a recording (record=1)", "record=1&clock=manual"],
  ["an overlay-free film (overlay=0)", "overlay=0&record=1&clock=manual"],
] as const) {
  test(`${name} draws no way out`, async ({ page }) => {
    await page.setViewportSize({ width: 1080 / 2, height: 1920 / 2 });
    await page.goto(`/eye?place=tower-bridge&${flags}`);
    await ready(page);
    await expect(page.locator("[data-eye-exit]")).toHaveCount(0);
    await expect(exit(page)).toHaveCount(0);
  });
}
