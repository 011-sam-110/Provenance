import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's vessels and aircraft can be clicked (/eye): a click or a tap on a
 * mark, or on its plate, opens a panel with everything its feed sent, a ring marks the
 * selected one, neighbours are listed, and a recording stays a plain frame.
 *
 * THE FEEDS ARE ANSWERED FROM REAL CAPTURES (tests/fixtures/eye-*.json, taken 28 Oct
 * 2026), so a keyless dev server still has boats and aircraft to click. The vessel feed
 * is routed by PATHNAME, on both of its routes (`/api/signals/ais` and, after the
 * more-boats change, `/api/eye/vessels?bbox=...`), so a query string still matches.
 *
 * THE HOOKS: `main[data-eye-state="ready"]`, and `window.__map`, WorldMap's debug handle,
 * which says where a mark is on the screen.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");
const THAMES = fixture("eye-ais-thames.json");
const HELSINKI = fixture("eye-ais-helsinki.json");
const PLANES = fixture("eye-planes-uk.json");

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });

/** Answer the vessel and aircraft feeds from captures; collect what the page throws. */
async function feeds(page: Page, vessels: string, planes: string = PLANES): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const json = (body: string) => ({ status: 200, contentType: "application/json", body });
  await page.route((url) => url.pathname === "/api/signals/ais", (route) => route.fulfill(json(vessels)));
  await page.route(
    (url) => url.pathname === "/api/eye/vessels",
    (route) => route.fulfill(json(JSON.stringify({ ok: true, stream: "live", features: JSON.parse(vessels).features }))),
  );
  await page.route((url) => url.pathname === "/api/planes", (route) => route.fulfill(json(planes)));
  return errors;
}

/** Where a mark is on the page, in CSS px, from the map's own projection. */
const screenOf = (page: Page, lon: number, lat: number) =>
  page.evaluate(
    ([lo, la]) => {
      const map = (window as unknown as { __map: { project(p: [number, number]): { x: number; y: number } } }).__map;
      const p = map.project([lo, la]);
      const r = document.querySelector("canvas.maplibregl-canvas")!.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [lon, lat],
  );

/** How many features the selection ring's source holds. */
const ringFeatures = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: { getSource(id: string): { serialize(): { data: { features: unknown[] } } } | undefined } }).__map;
    return map.getSource("eye-selected")?.serialize().data.features.length ?? -1;
  });

const centreOf = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __map: { getCenter(): { lng: number; lat: number } } }).__map.getCenter();
    return { lng: c.lng, lat: c.lat };
  });

const dialog = (page: Page) => page.getByRole("dialog");

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a click on a boat opens its details, rings it, and Escape closes them", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?place=westminster");
    await ready(page);
    expect(await ringFeatures(page)).toBe(0);

    const at = await screenOf(page, -0.12, 51.50532);
    await page.mouse.click(at.x, at.y);
    const panel = page.getByRole("dialog", { name: "MILLENNIUM DIAMOND" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("235092958");
    await expect(panel).toContainText("Flag (from MMSI)");
    await expect(panel).toContainText("United Kingdom");
    await expect(panel).toContainText("Vessel positions © AISStream.io");
    expect(await ringFeatures(page)).toBe(1);
    // The panel's own box is docked on the right, 340 px wide, under the controls.
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.width)).toBe(340);
    expect(box.x + box.width).toBeLessThanOrEqual(1440 - 20);
    expect(box.y).toBeGreaterThanOrEqual(100);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(await ringFeatures(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("its plate is a button: a click opens the panel, and so does focus and Enter", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?place=westminster");
    await ready(page);

    const plate = page.getByRole("button", { name: /MILLENNIUM DIAMOND, vessel details/ });
    await plate.click();
    await expect(page.getByRole("dialog", { name: "MILLENNIUM DIAMOND" })).toBeVisible();
    await expect(plate).toHaveAttribute("class", /tagBtn/);
    // The plate takes the selected state, and Escape hands focus back to it.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(plate).toBeFocused();

    await plate.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "MILLENNIUM DIAMOND" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a drag that starts on a boat pans the map and opens nothing; empty water closes the panel", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const before = await centreOf(page);
    const at = await screenOf(page, -0.12, 51.50532);

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 40, at.y + 10, { steps: 4 });
    await page.mouse.move(at.x - 80, at.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(dialog(page)).toHaveCount(0);
    const after = await centreOf(page);
    expect(Math.abs(after.lng - before.lng) + Math.abs(after.lat - before.lat)).toBeGreaterThan(0.0001);

    // The same for a plate: a press that moves 40 px is a pan, not a choice.
    const plate = page.getByRole("button", { name: /MILLENNIUM DIAMOND, vessel details/ });
    const pb = (await plate.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2 - 40, pb.y + pb.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(dialog(page)).toHaveCount(0);

    // Open it, then click on empty water.
    await plate.click();
    await expect(dialog(page)).toBeVisible();
    const boat = await screenOf(page, -0.12, 51.50532);
    await page.mouse.click(boat.x - 150, boat.y + 60);
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a boat in a cluster lists its neighbours, and a neighbour is one click away", async ({ page }) => {
    const errors = await feeds(page, HELSINKI);
    await page.goto("/eye?lat=60.16883&lon=24.96983&z=15.6&tilt=45&heading=0");
    await ready(page);

    const at = await screenOf(page, 24.969833, 60.168833);
    await page.mouse.click(at.x, at.y);
    const panel = page.getByRole("dialog", { name: "MT5300" });
    await expect(panel).toBeVisible();
    const also = panel.getByRole("list").getByRole("button");
    await expect(panel.getByRole("heading", { name: "Also here" })).toBeVisible();
    expect(await also.count()).toBeGreaterThanOrEqual(1);

    await also.first().click();
    await expect(page.getByRole("dialog", { name: "MT5300" })).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("an aircraft opens the same panel, with what its transponder sent and who it came from", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?lat=51.00729&lon=-0.00923&z=15&tilt=45&heading=0");
    await ready(page);

    const at = await screenOf(page, -0.009232, 51.007287);
    await page.mouse.click(at.x, at.y);
    const panel = page.getByRole("dialog", { name: "EZY78XP" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("G-UZHI");
    await expect(panel).toContainText("Squawk");
    await expect(panel).toContainText("1167");
    await expect(panel).toContainText("Aircraft © adsb.lol contributors (ODbL)");
    expect(await ringFeatures(page)).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap a little off a boat opens a bottom sheet that fits the screen", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?place=tower-bridge");
    await ready(page);

    const at = await screenOf(page, -0.07279, 51.5041);
    await page.touchscreen.tap(at.x + 10, at.y);
    const sheet = page.getByRole("dialog", { name: "EDWARDIAN" });
    await expect(sheet).toBeVisible();

    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.y).toBeGreaterThan(844 * 0.4);
    const close = (await page.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The mark is panned up clear of the sheet, not left under it.
    await page.waitForTimeout(600);
    const now = await screenOf(page, -0.07279, 51.5041);
    expect(now.y).toBeLessThan(box.y);

    await page.getByRole("button", { name: "Close" }).tap();
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("in a recording", () => {
  test.use({ viewport: { width: 540, height: 960 } });

  test("no plate is a button and a click on a boat opens nothing", async ({ page }) => {
    const errors = await feeds(page, THAMES);
    await page.goto("/eye?place=westminster&record=1");
    await ready(page);

    await expect(page.getByRole("button", { name: /vessel details|aircraft details/ })).toHaveCount(0);
    const at = await screenOf(page, -0.12, 51.50532);
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toHaveCount(0);
    expect(await ringFeatures(page)).toBe(-1);
    expect(errors).toEqual([]);
  });
});
