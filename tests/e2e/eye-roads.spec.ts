import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { streetsBody } from "@/lib/eye/streets";

/**
 * The God's eye view's road notices (/eye), held to the two rules of the road layer:
 *
 *   - Every time says whose it is. The Sources tray (and a film's ledger) names TfL's
 *     newest change and the time the server asked TfL, apart, in UTC, and says how long
 *     ago once the server's answer is old.
 *   - Closed is per street. Only the stretch TfL marks Closed gets the closure paint;
 *     the notice's other streets keep its kind. No street line's width reads a feature
 *     property, because MapLibre then draws a dashed line solid, and a solid line is
 *     how a measured speed will look.
 *
 * The route is answered from three verbatim TfL rows (tests/fixtures/tfl-road-
 * disruptions-mixed.json), with their times moved to "now", so the words can be read
 * exactly. The view opens on the A12 at Gallows Corner, where the first row closes one
 * stretch westbound and leaves the next open.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map` (see eye.spec.ts).
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md.
 */

// The first page load of a fresh server draws the 3D city in software GL: give it the
// same 90 s the ready wait allows, not Playwright's 30 s default.
test.describe.configure({ timeout: 120_000 });

const MIXED = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));
const A12 = "/eye?lat=51.59268&lon=0.21294&z=16&tilt=45&heading=0";
const MIN = 60_000;

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });

/** Answers /api/eye/streets with the fixture, TfL's newest change `changedAgo` before now. */
async function answerStreets(page: Page, opts: { changedAgo: number; fetchedAgo: number }) {
  const now = Date.now();
  const notices = normalizeTflNotices(MIXED).map((n, i) => ({
    ...n,
    updated: new Date(now - opts.changedAgo - i * 7 * MIN).toISOString(),
  }));
  const times = { changedAt: now - opts.changedAgo, fetchedAt: now - opts.fetchedAgo };
  await page.route("**/api/eye/streets", (route) =>
    route.fulfill({ contentType: "application/json", body: streetsBody(notices, times.fetchedAt) }),
  );
  return times;
}

test("the Sources tray names TfL's newest change and the fetch apart", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  const t = await answerStreets(page, { changedAgo: 10 * MIN, fetchedAgo: MIN });
  await page.goto(A12);
  await ready(page);

  await page.locator('[data-rail="eye"] [data-rail-entry="sources"]').click();
  const tray = page.locator("[data-eye-tray]");
  await expect(tray).toContainText(`TfL's newest change ${hhmm(t.changedAt)} UTC`);
  await expect(tray).toContainText(`fetched ${hhmm(t.fetchedAt)} UTC`);
  await expect(tray).toContainText("Powered by TfL Open Data");
  await expect(tray).not.toContainText("every 2 min");
  expect(errors).toEqual([]);
});

test("an old answer says how old it is", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const t = await answerStreets(page, { changedAgo: 30 * MIN, fetchedAgo: 22 * MIN });
  await page.goto(A12);
  await ready(page);
  await page.locator('[data-rail="eye"] [data-rail-entry="sources"]').click();
  await expect(page.locator("[data-eye-tray]")).toContainText(`fetched ${hhmm(t.fetchedAt)} UTC, 22 min ago`);
});

test("a film's bottom band on a phone carries the same two times", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 693 });
  const t = await answerStreets(page, { changedAgo: 10 * MIN, fetchedAgo: MIN });
  await page.goto(`${A12}&record=1`);
  await ready(page);
  await expect(page.locator("main")).toContainText(
    `No open road-speed feed for London · TfL notices: newest change ${hhmm(t.changedAt)} UTC · fetched ${hhmm(t.fetchedAt)} UTC`,
  );
});

test("only the stretch TfL marks Closed gets the closure paint, and no width reads a feature", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerStreets(page, { changedAgo: 10 * MIN, fetchedAgo: MIN });
  await page.goto(A12);
  await ready(page);

  const drawn = await page.evaluate(async () => {
    const map = (window as unknown as { __map: import("maplibre-gl").Map }).__map;
    const src = map.getSource("eye-streets") as import("maplibre-gl").GeoJSONSource;
    const data = (await src.getData()) as GeoJSON.FeatureCollection;
    const count: Record<string, number> = {};
    for (const f of data.features) {
      if (f.geometry.type !== "LineString") continue;
      const p = String(f.properties?.paint);
      count[p] = (count[p] ?? 0) + 1;
    }
    const ids = ["eye-street-closed-base", "eye-street-closed", "eye-street-works", "eye-street-incident"];
    const layers = ids.map((id) => ({
      id,
      present: map.getLayer(id) != null,
      width: JSON.stringify(map.getPaintProperty(id, "line-width")),
      dash: map.getPaintProperty(id, "line-dasharray") ?? null,
    }));
    return { count, layers };
  });

  // The A12 notice: 7 segments Closed westbound, 13 Open, each street joined into one
  // line so its pattern runs (joinLines in lib/roads/tfl.ts). The other two rows lie
  // outside the view's area (Chessington, Finsbury Park), so they are not drawn here.
  expect(drawn.count).toEqual({ closed: 1, works: 1 });
  for (const l of drawn.layers) {
    expect(l.present).toBe(true);
    expect(l.width).not.toContain('"get"');
  }
  expect(drawn.layers.find((l) => l.id === "eye-street-works")?.dash).toEqual([1.4, 1]);
  expect(drawn.layers.find((l) => l.id === "eye-street-closed")?.dash).toEqual([1, 1]);
});
