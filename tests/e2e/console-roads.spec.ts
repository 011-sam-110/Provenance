import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type maplibregl from "maplibre-gl";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { roadLayerFeatures, type RoadLayer } from "@/lib/signals/roads";

/**
 * The console's three London road layers (/app), held to the road layer's rules:
 *
 *   - A notice is never a solid line. Works are dashes, incidents are dots, and only a
 *     street TfL marks Closed gets bars. No road line's width reads a feature property,
 *     because MapLibre then draws a dashed line solid.
 *   - The legend names each pattern, and says once that a notice is not a speed and
 *     that no line does not mean a clear road.
 *   - A click on a road line opens that notice, like a click on a cable.
 *
 * The three routes are answered from three verbatim TfL rows (tests/fixtures/tfl-road-
 * disruptions-mixed.json) through the same pure function the server uses, so the
 * test reads what the map draws, not what TfL happens to list today.
 *
 * THE HOOK: `window.__map` (components/WorldMap.tsx).
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md.
 */

test.describe.configure({ timeout: 120_000 });

// The first-visit boot plate covers the map and takes the first clicks. Stamping its
// "seen" flag before the app boots skips it, as console.spec.ts does (lib/terminal/boot.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

const MIXED = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));
const NOTICES = normalizeTflNotices(MIXED);
const ROADS = "sig=road-works,road-incidents,road-closures&layers=&base=light";

async function answerRoads(page: Page) {
  for (const layer of ["works", "incidents", "closures"] as RoadLayer[]) {
    const features = roadLayerFeatures(NOTICES, layer);
    await page.route(`**/api/signals/road-${layer}`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, observedAt: Date.now(), count: features.length, features }),
      }),
    );
  }
}

/**
 * Waits until the map has drawn a closed street. The check is synchronous on purpose:
 * waitForFunction takes a returned Promise as a truthy answer and stops at once.
 */
async function roadLinesDrawn(page: Page) {
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __map?: maplibregl.Map }).__map;
      if (!map?.getSource("signal-lines")) return false;
      return map.querySourceFeatures("signal-lines").some((f) => f.properties?.line === "bar");
    },
    undefined,
    { timeout: 90_000, polling: 500 },
  );
}

test("draws works as dashes and closed streets as bars, and no width reads a feature", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerRoads(page);
  await page.goto(`/app?lat=51.48&lon=-0.05&z=10&${ROADS}`);
  await roadLinesDrawn(page);

  const drawn = await page.evaluate(async () => {
    const map = (window as unknown as { __map: maplibregl.Map }).__map;
    const data = (await (map.getSource("signal-lines") as maplibregl.GeoJSONSource).getData()) as GeoJSON.FeatureCollection;
    const count: Record<string, number> = {};
    for (const f of data.features) {
      const k = String(f.properties?.line);
      count[k] = (count[k] ?? 0) + 1;
    }
    const ids = ["signal-line-bar-base", "signal-line-bar", "signal-line-dash", "signal-line-dot"];
    const layers = ids.map((id) => ({
      id,
      present: map.getLayer(id) != null,
      width: JSON.stringify(map.getPaintProperty(id, "line-width")),
      dash: map.getPaintProperty(id, "line-dasharray") ?? null,
      filter: JSON.stringify(map.getFilter(id)),
    }));
    return { count, layers, solidFilter: JSON.stringify(map.getFilter("signal-line-paths")) };
  });

  // One works line (the A12's open stretch) and three closures (the A12's closed
  // stretch, Hook Road, Blackstock Road). The water main and the police close every
  // street they name, so neither is drawn twice as an incident.
  expect(drawn.count).toEqual({ dash: 1, bar: 3 });
  for (const l of drawn.layers) {
    expect(l.present, l.id).toBe(true);
    expect(l.width, l.id).not.toContain('"get"');
  }
  expect(drawn.layers.find((l) => l.id === "signal-line-dash")?.dash).toEqual([1.6, 1.1]);
  expect(drawn.layers.find((l) => l.id === "signal-line-bar")?.dash).toEqual([1, 1]);
  // The solid line layer draws only a feature that names no pattern.
  expect(drawn.solidFilter).toBe(JSON.stringify(["==", ["get", "line"], "solid"]));
  expect(errors).toEqual([]);
});

test("the legend names each road pattern and says no line is not a clear road", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerRoads(page);
  await page.goto(`/app?lat=51.48&lon=-0.05&z=10&${ROADS}`);
  await roadLinesDrawn(page);

  const legend = page.getByTestId("mark-legend");
  await expect(legend.locator('[data-mark="dash"]')).toContainText("Dashed line");
  await expect(legend.locator('[data-mark="bar"]')).toContainText("Barred line");
  // No incident is drawn in this answer, so its row is not listed.
  await expect(legend.locator('[data-mark="dot"]')).toHaveCount(0);
  await expect(legend).toContainText("Notices, not speeds. No line does not mean a clear road.");
});

test("a click on a closed street opens that notice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerRoads(page);
  // The A12's closed stretch at Gallows Corner: a 175 m segment, middle at the centre.
  await page.goto(`/app?lat=51.593146&lon=0.209296&z=17&${ROADS}`);
  await roadLinesDrawn(page);
  await page.waitForTimeout(1500);

  const at = await page.evaluate(() => {
    const map = (window as unknown as { __map: maplibregl.Map }).__map;
    const p = map.project([0.209296, 51.593146]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(at.x, at.y);

  // The detail opens in the rail's Inspector (lib/overlay.ts), named by the notice.
  const inspector = page.locator(".tn-inspector[role=dialog]");
  await expect(inspector).toHaveCount(1, { timeout: 10_000 });
  await expect(inspector).toHaveAttribute("aria-label", "Utility works, [A12] EASTERN AVENUE EAST");
  await expect(inspector).toContainText("Road closures");
  await expect(inspector).toContainText("Closed, westbound");
});
