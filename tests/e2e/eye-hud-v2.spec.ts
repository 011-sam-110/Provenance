import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BRAND } from "@/lib/brand";

/**
 * The God's eye view's frame (components/eye/EyeHud.tsx), on real journeys: the sidebar and what
 * moves with it, its switches changing the scene, the Sources tray beside it, the pill search
 * finding a place, a camera and a vessel, the compass following the real bearing, the way out
 * carrying the spot on screen, the credits behind their button with the source link outside it,
 * a film keeping its own frame, and all of that at 360 px.
 *
 * THE FEEDS ARE ANSWERED FROM CAPTURES where a test needs a named mark: /api/near with two of
 * TfL's cameras and the vessel routes with tests/fixtures/eye-ais-thames.json (MILLENNIUM
 * DIAMOND is on the river at Westminster), so a keyless dev server still has boats.
 *
 * THE HOOKS: `main[data-eye-state="ready"]`, `window.__map` (WorldMap's debug handle),
 * `[data-rail="eye"]`, `[data-rail-entry="<id>"]`, `[data-eye-search]`, `[data-compass-chip]`,
 * `[data-eye-exit]`, `[data-eye-tray]`.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

test.describe.configure({ timeout: 120_000 });

const THAMES = readFileSync(resolve(__dirname, "../fixtures/eye-ais-thames.json"), "utf8");
const TRAFALGAR = { id: "tfl:JamCams_00001.06514", name: "Trafalgar Square", lat: 51.5077, lon: -0.1277 };
const PARLIAMENT = { id: "tfl:JamCams_00001.06520", name: "Parliament Square", lat: 51.5008, lon: -0.1268 };
const VESSEL = "MILLENNIUM DIAMOND";

const json = (body: string) => ({ status: 200, contentType: "application/json", body });

async function feeds(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(
    (url) => url.pathname === "/api/near",
    (route) =>
      route.fulfill(
        json(
          JSON.stringify({
            cameras: [TRAFALGAR, PARLIAMENT].map((c) => ({ ...c, available: true, live: false, clip: false, refreshSeconds: 300, attribution: "TfL", km: 0.1 })),
          }),
        ),
      ),
  );
  await page.route((url) => url.pathname === "/api/signals/ais", (route) => route.fulfill(json(THAMES)));
  await page.route(
    (url) => url.pathname === "/api/eye/vessels",
    (route) => route.fulfill(json(JSON.stringify({ ok: true, stream: "live", features: JSON.parse(THAMES).features }))),
  );
  return errors;
}

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const rail = (page: Page) => page.getByRole("navigation", { name: "Map tools" });
const menu = (page: Page) => page.locator('[data-rail="eye"] [data-rail-menu]');
const entry = (page: Page, id: string) => page.locator(`[data-rail="eye"] [data-rail-entry="${id}"]`);
const search = (page: Page) => page.getByRole("combobox", { name: "Search places, cameras and vessels" });
const options = (page: Page) => page.getByRole("listbox", { name: "Search results" }).getByRole("option");
const tray = (page: Page) => page.locator("[data-eye-tray]");
const chip = (page: Page) => page.locator("[data-compass-chip]");
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

type MapHandle = {
  getBearing(): number;
  getCenter(): { lat: number; lng: number };
  jumpTo(o: unknown): void;
  once(e: string, f: () => void): void;
  isMoving(): boolean;
};
const bearing = (page: Page) => page.evaluate(() => (window as unknown as { __map: MapHandle }).__map.getBearing());
const center = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __map: MapHandle }).__map.getCenter();
    return { lat: c.lat, lon: c.lng };
  });
const jumpBearing = (page: Page, b: number) =>
  page.evaluate((to) => (window as unknown as { __map: MapHandle }).__map.jumpTo({ bearing: to }), b);

const left = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!.x;

type Box = { x: number; y: number; width: number; height: number };
const meet = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the frame holds what the design holds, and none of the old bar, chips or counts", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Westminster");
    await expect(page.getByLabel("Time now, UTC")).toContainText("UTC");
    await expect(search(page)).toHaveAttribute("placeholder", "Search places, cameras, vessels");
    // Top to bottom in the sidebar.
    const ids = await page.locator('[data-rail="eye"] [data-rail-entry]').evaluateAll((els) => els.map((e) => e.getAttribute("data-rail-entry")));
    expect(ids).toEqual(["previews", "turn", "sources", "exit", "controls"]);
    // What left.
    await expect(page.getByRole("navigation", { name: "View controls" })).toHaveCount(0);
    await expect(page.locator('section[aria-label="What this view shows"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Places", exact: true })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/Heading \d/);
    await expect(page.locator("main")).not.toContainText("refreshed");
    // No pop-up from the community note here.
    await expect(page.locator(".tn-note")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the sidebar opens and closes, the search moves with it, and the choice is remembered", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const widthOf = async () => (await rail(page).boundingBox())!.width;
    expect(await widthOf()).toBe(64);
    expect(await left(page, "[data-eye-search]")).toBeCloseTo(88, 0);

    await menu(page).click();
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(widthOf).toBe(232);
    await expect.poll(() => left(page, "[data-eye-search]")).toBeCloseTo(256, 0);
    // The title moves with it, and the column covers neither.
    expect((await page.locator("h1").boundingBox())!.x).toBeGreaterThan(232);
    await expect(entry(page, "sources")).toContainText("Sources & layers");

    await page.reload();
    await ready(page);
    await expect.poll(widthOf).toBe(232);

    await menu(page).click();
    await expect.poll(widthOf).toBe(64);
    await expect.poll(() => left(page, "[data-eye-search]")).toBeCloseTo(88, 0);
  });

  test("Camera previews and Auto-turn change the scene", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);

    const previews = page.getByRole("switch", { name: "Camera previews" });
    await expect(previews).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => page.locator('a[href^="/camera/"]').count()).toBeGreaterThanOrEqual(1);
    await previews.click();
    await expect(previews).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("main")).toHaveAttribute("data-previews", "off");
    await expect(page.locator('a[href^="/camera/"]')).toHaveCount(0);
    await expect.poll(() => page.locator("[data-cam-icon]").count()).toBeGreaterThanOrEqual(1);
    await previews.click();
    await expect(page.locator("[data-cam-icon]")).toHaveCount(0);

    const turn = page.getByRole("switch", { name: "Auto-turn" });
    await expect(turn).toHaveAttribute("aria-checked", "false");
    const before = await bearing(page);
    await turn.click();
    await expect(turn).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(1500);
    expect(Math.abs((await bearing(page)) - before)).toBeGreaterThan(3);
    await turn.click();
    await expect(turn).toHaveAttribute("aria-checked", "false");
    const stopped = await bearing(page);
    await page.waitForTimeout(500);
    expect(await bearing(page)).toBeCloseTo(stopped, 3);
  });

  test("Sources & layers stands beside the sidebar and switches a layer", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const row = entry(page, "sources");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const box = (await tray(page).boundingBox())!;
    // Its left edge is the search pill's.
    expect(box.x).toBeCloseTo((await page.locator("[data-eye-search]").boundingBox())!.x, 0);
    // Under the title, and it does not run into the compass.
    expect(box.y).toBeGreaterThanOrEqual((await page.locator("h1").boundingBox())!.y);
    expect(meet(box, (await chip(page).boundingBox())!)).toBe(false);

    // A name, a detail line, and no count of how many.
    const words = await tray(page).innerText();
    expect(words).not.toMatch(/\b\d+\s+(here|named|nearby|in view)\b/);
    expect(words).toContain("Ships");

    const ships = tray(page).getByRole("switch", { name: /^Show Ships/ });
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached();
    await ships.click();
    await expect(ships).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-kind="ship"]')).toHaveCount(0);
    await ships.click();
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached({ timeout: 15_000 });

    // A pin is a switch in the sidebar, under Sources & layers, and it works from there.
    await tray(page).locator('.tn-src-row[data-source-row="ais"] .tn-src-add').click();
    const pinned = entry(page, "pin-ais");
    await expect(pinned).toHaveAttribute("role", "switch");
    await pinned.click();
    await expect(pinned).toHaveAttribute("aria-checked", "false");
    await expect(ships).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-kind="ship"]')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(entry(page, "pin-ais")).toHaveAttribute("aria-checked", "false");
    expect(errors).toEqual([]);
  });

  test("the tray and a details panel stand side by side, and neither covers the sidebar", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await menu(page).click();
    await entry(page, "sources").click();
    await expect(tray(page)).toBeVisible();
    await page.getByRole("button", { name: /details/ }).first().click();
    const panel = page.locator('[role="dialog"]:not([data-eye-tray])');
    await expect(panel).toBeVisible();
    await expect(tray(page)).toBeVisible();
    const [t, p, r] = [(await tray(page).boundingBox())!, (await panel.boundingBox())!, (await rail(page).boundingBox())!];
    expect(meet(t, p)).toBe(false);
    expect(meet(t, r)).toBe(false);
    expect(meet(p, r)).toBe(false);
  });

  test("the search lists the three places on focus, and picks one with the keys or a click", async ({ page }) => {
    await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill(json(JSON.stringify({ results: [] }))));
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).focus();
    await expect(options(page)).toHaveCount(3);
    await expect(options(page).first()).toContainText("Place");
    // Results stand 56 px below the top of the pill.
    const pill = (await page.locator("[data-eye-search]").boundingBox())!;
    const list = (await page.getByRole("listbox", { name: "Search results" }).boundingBox())!;
    expect(list.y - pill.y).toBeGreaterThanOrEqual(56);
    expect(list.y - pill.y).toBeLessThanOrEqual(64);

    // Down, Down, Down, Up, then Enter: the second row is a full page load.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(search(page)).toHaveAttribute("aria-activedescendant", /.+/);
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options(page).nth(1)).toContainText("Tower Bridge");
    await page.keyboard.press("Enter");
    await page.waitForURL(/place=tower-bridge/);
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tower Bridge");

    // Typed, then clicked.
    await search(page).fill("picc");
    await expect(options(page).first()).toContainText("Piccadilly Circus");
    await options(page).first().click();
    await page.waitForURL(/place=piccadilly/);
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Piccadilly Circus");
  });

  test("the search says when nothing matches, closes on Escape, and never sends an address to the geocoder", async ({ page }) => {
    const errors = await feeds(page);
    const asked: string[] = [];
    await page.route(
      (url) => url.pathname === "/api/geocode",
      (route) => {
        asked.push(new URL(route.request().url()).searchParams.get("q") ?? "");
        return route.fulfill(json(JSON.stringify({ results: [] })));
      },
    );
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).fill("qqqqqq");
    await expect(page.locator("[data-eye-search]")).toContainText("No matches");
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe("qqqqqq");

    await search(page).fill("8.8.8.8");
    await page.waitForTimeout(700);
    await search(page).fill("example.com");
    await page.waitForTimeout(700);
    expect(asked).toEqual(["qqqqqq"]);
    await expect(page.locator("[data-eye-search]")).toContainText("No matches");

    // Escape closes the list, a second one clears the box.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
    await expect(search(page)).toHaveValue("example.com");
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    expect(errors).toEqual([]);
  });

  test("a geocoder that fails is said quietly and throws nothing", async ({ page }) => {
    const errors = await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).fill("tower");
    // The presets still answer, and the line says the rest did not.
    await expect(options(page).first()).toContainText("Tower Bridge");
    await expect(page.locator("[data-eye-search]")).toContainText("Place search is not answering");
    expect(errors).toEqual([]);
  });

  test("the search finds a place from the geocoder, and it opens there", async ({ page }) => {
    await feeds(page);
    await page.route(
      (url) => url.pathname === "/api/geocode",
      (route) => route.fulfill(json(JSON.stringify({ results: [{ name: "Lisbon, Portugal", lat: 38.7223, lon: -9.1393 }] }))),
    );
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).fill("lisbon");
    await expect(options(page).first()).toContainText("Lisbon, Portugal");
    await options(page).first().click();
    await page.waitForURL(/lat=38\.72/);
    await ready(page);
    const c = await center(page);
    expect(c.lat).toBeCloseTo(38.72, 1);
    expect(c.lon).toBeCloseTo(-9.14, 1);
  });

  test("the search finds a camera: the map flies there and its card stands on it", async ({ page }) => {
    await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill(json(JSON.stringify({ results: [] }))));
    // Previews off: the pick opens the one camera it names.
    await page.addInitScript(() => localStorage.setItem("tn.eye.v1", JSON.stringify({ v: 1, d: { previews: false } })));
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).fill("trafalgar");
    const row = options(page).first();
    await expect(row).toContainText(TRAFALGAR.name);
    await expect(row).toContainText("Camera");
    await row.click();
    await expect(search(page)).toHaveValue("");
    await expect(page.locator(`a[href^="/camera/"]`)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(`a[href^="/camera/"]`)).toHaveAttribute("href", /06514/);
    // The camera stands low in the middle of the view, so its card has room above it.
    const at = await page.evaluate(
      ([lon, lat]) => (window as unknown as { __map: { project(l: [number, number]): { x: number; y: number } } }).__map.project([lon, lat]),
      [TRAFALGAR.lon, TRAFALGAR.lat],
    );
    expect(Math.abs(at.x - 720)).toBeLessThanOrEqual(8);
    expect(Math.abs(at.y - 900 * 0.68)).toBeLessThanOrEqual(30);
  });

  test("with previews on, a camera picked in the search stands in the view with its card", async ({ page }) => {
    await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill(json(JSON.stringify({ results: [] }))));
    await page.goto("/eye?place=tower-bridge");
    await ready(page);
    await search(page).fill("parliament");
    await options(page).first().click();
    const card = page.locator(`a[href*="${PARLIAMENT.id.split(".").pop()}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  });

  test("the search finds a vessel: the map flies there and its panel opens", async ({ page }) => {
    await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill(json(JSON.stringify({ results: [] }))));
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).fill("millennium");
    const row = options(page).filter({ hasText: VESSEL }).first();
    await expect(row).toContainText("Vessel");
    await row.click();
    await expect(page.getByRole("dialog", { name: VESSEL })).toBeVisible({ timeout: 15_000 });
    const c = await center(page);
    expect(c.lat).toBeCloseTo(51.505, 2);
    expect(c.lon).toBeCloseTo(-0.12, 2);
  });

  test("the compass follows the map's real bearing, through north", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await jumpBearing(page, 32);
    await expect(chip(page)).toHaveText("032° NE");
    await jumpBearing(page, 90);
    await expect(chip(page)).toHaveText("090° E");
    await jumpBearing(page, -1);
    await expect(chip(page)).toHaveText("359° N");
    await jumpBearing(page, 1);
    await expect(chip(page)).toHaveText("001° N");

    // At north the red N stands under the pointer, and the strip took one transform to get there.
    const offset = await page.evaluate(() => {
      const chipBox = document.querySelector("[data-compass-chip]")!.getBoundingClientRect();
      const ticks = [...document.querySelectorAll('[data-eye-compass] [data-kind="north"]')].map((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const middle = chipBox.left + chipBox.width / 2;
      return Math.min(...ticks.map((x) => Math.abs(x - middle)));
    });
    // 1 degree off: 520 px over 150 degrees is 3.5 px a degree.
    expect(offset).toBeLessThanOrEqual(5);

    // It takes no press: the map under it still does.
    const box = (await chip(page).boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-eye-compass]") != null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe(false);
  });

  test("a turning view re-renders neither the chip nor the frame per frame", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const writes = await page.evaluate(async () => {
      const chipEl = document.querySelector("[data-compass-chip]")!;
      let n = 0;
      const seen = new MutationObserver((m) => (n += m.length));
      seen.observe(chipEl, { childList: true, characterData: true, subtree: true });
      const map = (window as unknown as { __map: MapHandle }).__map;
      // Forty small moves inside one degree: the text does not change.
      const start = map.getBearing();
      for (let i = 0; i < 40; i++) {
        map.jumpTo({ bearing: Math.round(start) + i / 100 });
        await new Promise((r) => requestAnimationFrame(r));
      }
      seen.disconnect();
      return n;
    });
    expect(writes).toBeLessThanOrEqual(2);
  });

  test("Exit to dashboard carries the spot on screen, read as it is used", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=tower-bridge");
    await ready(page);
    await page.evaluate(() => {
      const map = (window as unknown as { __map: MapHandle }).__map;
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng + 0.01, c.lat + 0.005] });
    });
    const at = await center(page);
    const exit = page.locator("[data-eye-exit]");
    await expect(exit).toHaveText("Exit to dashboard");
    const asked = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/app", { timeout: 60_000 });
    await exit.click();
    const url = new URL((await asked).url());
    expect(Number(url.searchParams.get("lat"))).toBeCloseTo(at.lat, 3);
    expect(Number(url.searchParams.get("lon"))).toBeCloseTo(at.lon, 3);
    expect(url.searchParams.get("eye")).toMatch(/^place=tower-bridge&lat=/);
    expect(url.searchParams.has("sources")).toBe(false);
  });

  test("the source and the licence are on screen, and © Credits opens every source", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    // AGPL-3.0 section 13: with the pop-up closed.
    await expect(page.locator(`footer a[href="${BRAND.repoUrl}"]`)).toBeVisible();
    await expect(page.locator(`footer a[href="${BRAND.license.url}"]`)).toBeVisible();

    const credits = page.getByRole("button", { name: "© Credits" });
    await expect(credits).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("footer")).not.toContainText("Imagery © Esri");
    await credits.click();
    await expect(credits).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("footer")).toContainText("Imagery © Esri");
    await expect(page.locator("footer")).toContainText("OpenStreetMap");
    // The way to the landing page, now the brand link has left the top.
    await expect(page.locator('footer a[href="/"]')).toHaveText("About Provenance");

    await page.keyboard.press("Escape");
    await expect(credits).toHaveAttribute("aria-expanded", "false");
    await expect(credits).toBeFocused();
    await credits.click();
    await page.mouse.click(720, 500);
    await expect(credits).toHaveAttribute("aria-expanded", "false");

    // MapLibre's own credit is hidden only while the frame holds them.
    await expect(page.locator(".maplibregl-ctrl-attrib")).toBeHidden();
  });

  test("the coordinates follow the map, beside the credits", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?lat=51.5&lon=-0.1&z=15");
    await ready(page);
    await expect(page.locator("footer")).toContainText("51.5000° N, 0.1000° W");
    await page.evaluate(() => (window as unknown as { __map: MapHandle }).__map.jumpTo({ center: [-0.2, 51.6] }));
    await expect(page.locator("footer")).toContainText("51.6000° N, 0.2000° W");
  });
});

test.describe("a film", () => {
  test("a recording keeps the old frame: the ledger, and no sidebar, search or compass", async ({ page }) => {
    await feeds(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await page.goto("/eye?place=westminster&record=1&clock=manual");
    await ready(page);
    await expect(page.locator('section[aria-label="What this view shows"]')).toBeVisible();
    await expect(page.locator('p[data-k="cam"]')).toHaveCount(1);
    await expect(page.locator("header p").first()).toContainText("Heading");
    await expect(page.locator('header a[href="/"]')).toContainText("Provenance");
    await expect(page.locator('footer')).toContainText("Imagery © Esri");
    await expect(page.locator(`footer a[href="${BRAND.repoUrl}"]`)).toHaveCount(1);
    for (const gone of ['[data-rail="eye"]', "[data-eye-search]", "[data-eye-compass]", "[data-eye-tray]", "[data-eye-exit]"]) {
      await expect(page.locator(gone), gone).toHaveCount(0);
    }
    // The clock to the minute.
    expect(((await page.getByLabel("Time now, UTC").innerText()).match(/:/g) ?? []).length).toBe(1);
    // And it publishes no sidebar width for anything to read.
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--rail-w"))).toBe("");
  });

  test("clock=manual alone draws the film's frame too", async ({ page }) => {
    await feeds(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/eye?place=westminster&clock=manual");
    await ready(page);
    await expect(page.locator('section[aria-label="What this view shows"]')).toBeVisible();
    await expect(page.locator('[data-rail="eye"]')).toHaveCount(0);
  });

  test("overlay=0 draws neither frame", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/eye?place=westminster&overlay=0");
    await ready(page);
    await expect(page.locator('[data-rail="eye"]')).toHaveCount(0);
    await expect(page.locator('section[aria-label="What this view shows"]')).toHaveCount(0);
  });
});

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("the menu, the search, the title, the compass and the credits each have their own room", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);

    const m = (await menu(page).boundingBox())!;
    expect(m).toMatchObject({ x: 10, y: 12, width: 44, height: 44 });
    const pill = (await page.locator("[data-eye-search]").boundingBox())!;
    expect(pill.x).toBeGreaterThanOrEqual(54);
    expect(pill.x + pill.width).toBeLessThanOrEqual(360);
    const title = (await page.locator("h1").boundingBox())!;
    expect(title.y).toBeGreaterThanOrEqual(pill.y + pill.height);
    const compass = (await page.locator("[data-eye-compass]").boundingBox())!;
    expect(compass.x).toBeGreaterThanOrEqual(0);
    expect(compass.x + compass.width).toBeLessThanOrEqual(360);
    const foot = (await page.locator("footer").boundingBox())!;
    expect(compass.y + compass.height).toBeLessThanOrEqual(foot.y);
    expect(foot.y + foot.height).toBeLessThanOrEqual(740);
    expect(meet(title, compass)).toBe(false);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("☰ opens the sheet; its rows are 44 px and work; Escape gives focus back", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await expect(page.getByRole("switch", { name: "Camera previews" })).toBeHidden();
    await menu(page).tap();
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    const previews = page.getByRole("switch", { name: "Camera previews" });
    await expect(previews).toBeVisible();
    for (const id of ["previews", "turn", "sources", "exit", "controls"]) {
      expect((await entry(page, id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    }
    await previews.tap();
    await expect(page.locator("main")).toHaveAttribute("data-previews", "off");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(menu(page)).toBeFocused();
  });

  test("Sources & layers and Controls close the sheet and open beside nothing", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await menu(page).tap();
    await entry(page, "sources").tap();
    await expect(tray(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    const t = (await tray(page).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(10);
    expect(t.x + t.width).toBeLessThanOrEqual(350);
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await menu(page).tap();
    await entry(page, "controls").tap();
    await expect(tray(page)).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "How to move the view" })).toBeVisible();
  });

  test("a sheet opened over a details panel closes the panel", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).tap();
    await search(page).fill("millennium");
    await options(page).filter({ hasText: VESSEL }).first().tap();
    const panel = page.getByRole("dialog", { name: VESSEL });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await menu(page).tap();
    await expect(panel).toHaveCount(0);
  });

  test("the search box and its list stay inside the phone", async ({ page }) => {
    await feeds(page);
    await page.route((url) => url.pathname === "/api/geocode", (route) => route.fulfill(json(JSON.stringify({ results: [] }))));
    await page.goto("/eye?place=westminster");
    await ready(page);
    await search(page).tap();
    await expect(options(page)).toHaveCount(3);
    const list = (await page.getByRole("listbox", { name: "Search results" }).boundingBox())!;
    expect(list.x + list.width).toBeLessThanOrEqual(360);
    // It covers the title whole: a list that starts at the pill cut the title in half.
    const panel = (await page.getByRole("listbox", { name: "Search results" }).locator("xpath=..").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x).toBeLessThanOrEqual((await page.locator("header h1").boundingBox())!.x);
    for (const o of await options(page).all()) expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test("© Credits opens inside the phone, and the source link stays on screen", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const source = page.locator(`footer a[href="${BRAND.repoUrl}"]`);
    await expect(source).toBeVisible();
    await page.getByRole("button", { name: "© Credits" }).tap();
    await expect(page.locator("footer")).toContainText("Imagery © Esri");
    const pop = (await page.locator("footer").getByText("Imagery © Esri").boundingBox())!;
    expect(pop.x).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.width).toBeLessThanOrEqual(360);
    await expect(source).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});
