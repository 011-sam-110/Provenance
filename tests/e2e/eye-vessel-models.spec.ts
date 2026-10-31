import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's vessel models (/eye), held to what the plan promised.
 *
 *   - At a preset on a wide screen and on a phone the custom layer `eye-ship-models` is on
 *     the map, the chevron layer `eye-ship` is hidden, every model file was fetched and
 *     answered 200, and nothing threw or logged an error.
 *   - It draws only when the map does: with no input, MapLibre goes idle within 3 s
 *     (a per-frame repaint would keep it from ever idling, and the reel recorder waits on idle).
 *   - Models that will not load leave the chevrons, the view still ready, and no page error.
 *   - The Sources tray's Ships switch hides the models and brings them back.
 *   - `/` and `/app` never ask for a model: three.js and the files are `/eye`'s alone.
 *
 * The boats are 34 verbatim vessels of production's /api/signals/ais on the Thames
 * (tests/fixtures/eye-ais-thames.json, 2026-10-28 22:49Z), each time moved to "now", and
 * the route is answered for both /api/eye/vessels (what /eye asks) and /api/signals/ais, so
 * no AISStream key is needed and none must be set on the server under test (production
 * holds one of AISStream's three sockets; see CLAUDE.md).
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map` (see eye.spec.ts); the layer's
 * own numbers are `window.__map.getLayer("eye-ship-models").implementation.stats()`.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md.
 */

// The first page load of a fresh server draws the 3D city in software GL.
test.describe.configure({ timeout: 120_000 });

const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/eye-ais-thames.json"), "utf8")).features as Record<string, unknown>[];
const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const json = (body: string) => ({ contentType: "application/json", body });

type MapHandle = {
  getLayer(id: string): { implementation?: { stats(): { vessels: number; drawCalls: number; renderMedianMs: number; lastSetMs: number } } } | undefined;
  getLayoutProperty(id: string, name: string): string | undefined;
  once(event: string, listener: () => void): void;
  triggerRepaint(): void;
};

/** Both routes the view could ask for its vessels, answered from the fixture with each time at "now". */
async function answerVessels(page: Page) {
  const features = () => FIXTURE.map((f) => ({ ...f, ts: new Date().toISOString() }));
  await page.route("**/api/signals/ais", (route) => route.fulfill(json(JSON.stringify({ ok: true, features: features() }))));
  await page.route("**/api/eye/vessels**", (route) =>
    route.fulfill(json(JSON.stringify({ ok: true, observedAt: Date.now(), stream: "live", count: FIXTURE.length, features: features() }))),
  );
}

/** Errors the page logs or throws. A 404 the test itself caused is not one the page raised. */
function watchErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !ignore.some((re) => re.test(m.text()))) errors.push(m.text());
  });
  return errors;
}

const layerState = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: MapHandle }).__map;
    return {
      models: Boolean(map.getLayer("eye-ship-models")),
      chevrons: map.getLayoutProperty("eye-ship", "visibility"),
      modelsVisibility: map.getLayoutProperty("eye-ship-models", "visibility"),
    };
  });

const SHAPES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

for (const shape of SHAPES) {
  test(`draws the vessels as models on a ${shape.name} screen, with every file fetched and nothing logged`, async ({ page }) => {
    const errors = watchErrors(page);
    const files: { url: string; status: number }[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname.startsWith("/models/vessels/")) files.push({ url: new URL(r.url()).pathname, status: r.status() });
    });
    await answerVessels(page);
    await page.setViewportSize({ width: shape.width, height: shape.height });
    await page.goto("/eye?place=tower-bridge");
    await ready(page);

    const state = await layerState(page);
    expect(state.models).toBe(true);
    expect(state.chevrons).toBe("none");
    expect(state.modelsVisibility).not.toBe("none");

    expect(files.map((f) => f.url).sort()).toEqual(
      ["cargo", "fishing", "highspeed", "passenger", "plain", "pleasure", "sailing", "service", "tanker", "tug"].map((c) => `/models/vessels/${c}.glb`),
    );
    expect(files.filter((f) => f.status !== 200)).toEqual([]);

    const stats = await page.evaluate(() =>
      (window as unknown as { __map: MapHandle }).__map.getLayer("eye-ship-models")!.implementation!.stats(),
    );
    expect(stats.vessels).toBeGreaterThan(0);
    // One draw call per class and level of detail that holds a boat, never one per boat.
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.drawCalls).toBeLessThanOrEqual(20);
    expect(errors).toEqual([]);
  });
}

test("draws only when the map does: with no input it goes idle within 3 s", async ({ page }) => {
  await answerVessels(page);
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const map = (window as unknown as { __map: MapHandle }).__map;
        const timer = setTimeout(() => reject(new Error("the map did not go idle in 3 s")), 3000);
        map.once("idle", () => {
          clearTimeout(timer);
          resolve();
        });
        // One repaint is asked for here, and the map must settle after it: a layer that asked
        // for a repaint on every frame would never let it.
        map.triggerRepaint();
      }),
  );
});

test("models that will not load leave the chevrons: still ready, no page error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await answerVessels(page);
  await page.route("**/models/vessels/**", (route) => route.fulfill({ status: 404, body: "gone" }));
  await page.goto("/eye?place=tower-bridge");
  await ready(page);

  const state = await layerState(page);
  expect(state.models).toBe(false);
  expect(state.chevrons).not.toBe("none");
  expect(pageErrors).toEqual([]);
});

test("the Sources tray's Ships switch hides the models, and shows them again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerVessels(page);
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  expect((await layerState(page)).modelsVisibility).not.toBe("none");

  await page.getByRole("button", { name: "Sources & layers" }).click();
  const ships = page.locator("aside#eye-sources").getByRole("switch", { name: /^Show Ships/ });
  await ships.click();
  await expect(ships).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await layerState(page)).modelsVisibility).toBe("none");
  expect((await layerState(page)).chevrons).toBe("none");

  await ships.click();
  await expect(ships).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await layerState(page)).modelsVisibility).not.toBe("none");
  expect((await layerState(page)).chevrons).toBe("none");
});

for (const path of ["/", "/app"]) {
  test(`${path} makes no request for a model`, async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/models/vessels/")) asked.push(r.url());
    });
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(4000);
    expect(asked).toEqual([]);
  });
}
