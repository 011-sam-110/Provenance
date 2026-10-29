import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clampBox, inBox, parseBox, snapBox, type Box } from "@/lib/eye/vessels";

/**
 * The God's eye view's vessels (/eye), held to what the plan promised.
 *
 *   - It asks /api/eye/vessels?bbox= for the boats around what is on screen, with a box
 *     that holds the view's centre, and never asks /api/signals/ais.
 *   - The HUD's vessel number is every boat drawn inside the frame, not the ones with a tag.
 *   - Once the view settles outside the box it holds, it asks again with a new box.
 *   - When the route says the stream is down, the vessel row says AISStream is not answering.
 *   - A film keeps the vessels it opened with: it asks once and never again for a move.
 *
 * The route is answered from 38 verbatim features of production's /api/signals/ais
 * (tests/fixtures/eye-ais-london.json: London and the Thames, 2026-10-28 22:49Z), kept to
 * the box asked for and with each time moved to "now". The data is the point of the fixture:
 * no AISStream key is needed, and none must be set on the server under test (production
 * holds one of AISStream's three sockets; see CLAUDE.md).
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map` (see eye.spec.ts).
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md.
 */

// The first page load of a fresh server draws the 3D city in software GL.
test.describe.configure({ timeout: 120_000 });

interface Feature {
  id: string;
  lat: number;
  lon: number;
  ts?: string;
  [k: string]: unknown;
}
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/eye-ais-london.json"), "utf8")).features as Feature[];
const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });

type MapHandle = { project(lngLat: [number, number]): { x: number; y: number }; getContainer(): HTMLElement; getCenter(): { lat: number; lng: number }; jumpTo(o: unknown): void; once(e: string, f: () => void): void };

/** Answers /api/eye/vessels from the fixture; every box asked for is recorded, and the paths watched. */
async function answerVessels(page: Page, opts: { stream?: "live" | "down" | "warming" | "off" } = {}) {
  const asked: { bbox: string; box: Box }[] = [];
  const answered: Feature[][] = [];
  const signalsAis: string[] = [];
  await page.route("**/api/signals/ais", (route) => {
    signalsAis.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, features: [] }) });
  });
  await page.route("**/api/eye/vessels**", (route) => {
    const bbox = new URL(route.request().url()).searchParams.get("bbox") ?? "";
    const parsed = parseBox(bbox);
    if (!parsed) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    const { box, clamped } = clampBox(snapBox(parsed));
    asked.push({ bbox, box });
    const features = FIXTURE.filter((f) => inBox(f.lat, f.lon, box)).map((f) => ({ ...f, ts: new Date().toISOString() }));
    answered.push(features);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        observedAt: Date.now(),
        stream: opts.stream ?? "live",
        feeds: { digitraffic: "ok", barentswatch: "off" },
        box,
        clamped,
        count: features.length,
        coverage: { returned: features.length, available: features.length, availableExact: true, capped: false },
        features,
      }),
    });
  });
  return { asked, answered, signalsAis };
}

const TOWER = "/eye?place=tower-bridge";
const row = (page: Page) => page.locator('p[data-k="ship"]');

test("asks for the boats around the view with a box that holds its centre, and never the chokepoint layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await answerVessels(page);
  await page.goto(TOWER);
  await ready(page);

  expect(seen.asked.length).toBeGreaterThanOrEqual(1);
  const centre = await page.evaluate(() => {
    const c = (window as unknown as { __map: MapHandle }).__map.getCenter();
    return { lat: c.lat, lon: c.lng };
  });
  for (const a of seen.asked) {
    expect(a.bbox).toMatch(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/);
    expect(inBox(centre.lat, centre.lon, a.box)).toBe(true);
  }
  expect(seen.signalsAis).toEqual([]);
  expect(errors).toEqual([]);
});

test("the vessel row counts every boat drawn inside the frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await answerVessels(page);
  await page.goto(TOWER);
  await ready(page);

  const drawn = async () => {
    const latest = seen.answered[seen.answered.length - 1].map((f) => [f.lon, f.lat]);
    return page.evaluate((pts) => {
      const map = (window as unknown as { __map: MapHandle }).__map;
      const box = map.getContainer();
      return pts.filter((p) => {
        const q = map.project(p as [number, number]);
        return q.x >= 0 && q.x <= box.clientWidth && q.y >= 0 && q.y <= box.clientHeight;
      }).length;
    }, latest);
  };
  const expected = await drawn();
  // The fixture has the Thames in it: a view at Tower Bridge has boats, or this proves nothing.
  expect(expected).toBeGreaterThan(0);
  await expect(row(page).locator("b")).toHaveText(String(expected));
  await expect(row(page)).toContainText(expected === 1 ? "vessel" : "vessels");
  await expect(row(page)).toContainText("named");
  await expect(row(page)).toContainText("moving");
  await expect(row(page)).toContainText("AIS heard in the last 20 min");
  await expect(row(page)).not.toContainText("nearby");
});

test("asks again with a new box once the view settles outside the one it holds", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await answerVessels(page);
  await page.goto(TOWER);
  await ready(page);
  const first = seen.asked.length;
  const firstBox = seen.asked[first - 1].bbox;

  await page.evaluate(() => {
    const map = (window as unknown as { __map: MapHandle }).__map;
    const c = map.getCenter();
    map.jumpTo({ center: [c.lng + 0.3, c.lat] });
  });
  await expect.poll(() => seen.asked.length, { timeout: 15_000 }).toBeGreaterThan(first);
  expect(seen.asked[seen.asked.length - 1].bbox).not.toBe(firstBox);
  // And only the one: a settled view does not keep asking.
  await page.waitForTimeout(3000);
  expect(seen.asked.length).toBe(first + 1);
});

test("says AISStream is not answering when the route says the stream is down", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerVessels(page, { stream: "down" });
  await page.goto(TOWER);
  await ready(page);
  await expect(row(page)).toContainText("AISStream not answering");
  await expect(row(page)).toContainText("showing what was heard in the last 20 min");
});

test("in a film, the vessels it opened with stay, whatever the view does", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 960 });
  const seen = await answerVessels(page);
  await page.goto(`${TOWER}&record=1&clock=manual`);
  await ready(page);
  // It opened with its vessels. (A dev server mounts the overlay twice, so the opening can be two identical asks.)
  const opened = seen.asked.length;
  expect(opened).toBeGreaterThanOrEqual(1);
  expect(new Set(seen.asked.map((a) => a.bbox)).size).toBe(1);

  await page.evaluate(() => {
    const map = (window as unknown as { __map: MapHandle }).__map;
    const c = map.getCenter();
    map.jumpTo({ center: [c.lng + 0.3, c.lat] });
  });
  await page.waitForTimeout(4000);
  expect(seen.asked).toHaveLength(opened);
});
