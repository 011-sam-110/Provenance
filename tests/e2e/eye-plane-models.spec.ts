import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's aircraft models (/eye), held to what the plan promised.
 *
 *   - A plane of a known type is drawn with that type's model, and only the types in view are
 *     fetched. A type the table does not hold is drawn plain.
 *   - The tag gives the height the plane reported, whatever height it is drawn at.
 *   - A click on the model, on its line or on its ring selects the plane.
 *   - A plane above the cap says so in the panel; one below it does not.
 *   - It draws only when the map does. Models that will not load bring the chevrons back, and one
 *     type's file that will not load leaves only that type plain.
 *   - The Sources tray's Planes switch hides the models and brings them back.
 *   - `/` and `/app` never ask for a model or for three.js.
 *
 * The planes are answered at /api/eye/planes from the rows below, so the test does not depend on
 * what is in the sky over London. THE HOOKS: `main[data-eye-state="ready"]` and `window.__map`
 * (see eye.spec.ts); the layer's numbers are `implementation.stats()` and where it drew a plane is
 * `implementation.drawnAt(a)`. The gate (`npx tsc --noEmit && npm test`) does NOT run this file.
 * See CLAUDE.md.
 */

// The first page load of a fresh server draws the 3D city in software GL.
test.describe.configure({ timeout: 180_000 });

const SPOT = { lat: 51.5055, lon: -0.0754 };

interface Row {
  id: string;
  lat: number;
  lon: number;
  altKm?: number;
  heading: number;
  label: string;
  meta: Record<string, unknown>;
}

const row = (hex: string, dLat: number, dLon: number, feet: number | null, typeCode: string | undefined, typeLabel: string, callsign: string): Row => ({
  id: `plane:${hex}`,
  lat: SPOT.lat + dLat,
  lon: SPOT.lon + dLon,
  ...(feet == null ? {} : { altKm: feet / 3280.84 }),
  heading: 80,
  label: callsign,
  meta: { callsign, typeLabel, velocityMs: 120, ...(typeCode ? { typeCode } : {}) },
});

/** High: drawn at the cap. Low: drawn at the height it sent. Then a helicopter, and a type the table does not hold. */
const HIGH = row("aaa001", 0.0012, -0.002, 37_000, "A388", "Airliner", "HIGH1");
const LOW = row("aaa002", -0.0008, 0.0022, 300, "B738", "Airliner", "LOW2");
const HELI = row("aaa003", 0.0028, 0.004, 900, "EC35", "Helicopter", "HELI3");
const UNKNOWN = row("aaa004", -0.0022, -0.0042, 28_000, "ZZZZ", "Airliner", "ODD4");
const ROWS = [HIGH, LOW, HELI, UNKNOWN];

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 120_000 });
const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });

async function answerPlanes(page: Page, rows: Row[] = ROWS) {
  await page.route("**/api/eye/planes**", (route) => {
    const box = new URL(route.request().url()).searchParams.get("bbox")!.split(",").map(Number);
    return route.fulfill(
      json({
        ok: true,
        box,
        clamped: false,
        count: rows.length,
        sampled: false,
        fetchedAt: Date.now(),
        coverage: { returned: rows.length, available: rows.length, availableExact: true, capped: false },
        planes: rows,
      }),
    );
  });
}

type Stats = { planes: number; drawCalls: number; byModel: Record<string, number>; loaded: string[]; renderMedianMs: number };
type At = { x: number; y: number; radiusPx: number } | null;
type MapHandle = {
  getLayer(id: string): { implementation?: { stats(): Stats; drawnAt(a: unknown): At } } | undefined;
  getLayoutProperty(id: string, name: string): string | undefined;
  once(event: string, listener: () => void): void;
  triggerRepaint(): void;
  project(p: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
};

const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __map: MapHandle }).__map.getLayer("eye-plane-models")?.implementation?.stats() ?? null);

const layerState = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: MapHandle }).__map;
    return {
      models: Boolean(map.getLayer("eye-plane-models")),
      chevrons: map.getLayoutProperty("eye-plane", "visibility"),
      modelsVisibility: map.getLayoutProperty("eye-plane-models", "visibility"),
    };
  });

/** A row as the view holds it: what the layer's `drawnAt` is asked with. */
const held = (r: Row) => ({ lat: r.lat, lon: r.lon, feet: r.altKm == null ? null : Math.round((r.altKm * 3280.84) / 50) * 50, rot: r.heading, typeCode: r.meta.typeCode, classLabel: r.meta.typeLabel });

/** The page position of a plane's body, or of the ground under it. */
async function pageSpot(page: Page, r: Row, where: "body" | "ring" | "line") {
  return page.evaluate(
    ({ a, where }) => {
      const map = (window as unknown as { __map: MapHandle }).__map;
      const at = map.getLayer("eye-plane-models")!.implementation!.drawnAt(a)!;
      const ground = map.project([a.lon, a.lat]);
      const box = map.getCanvas().getBoundingClientRect();
      const t = where === "body" ? 0 : where === "ring" ? 1 : 0.5;
      return { x: box.left + at.x + (ground.x - at.x) * t, y: box.top + at.y + (ground.y - at.y) * t };
    },
    { a: held(r), where },
  );
}

const panel = (page: Page) => page.getByRole("complementary").filter({ hasText: /ICAO address/ });

async function open(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await answerPlanes(page);
  await page.goto("/eye?place=tower-bridge");
  await ready(page);
  await expect.poll(async () => (await stats(page))?.planes ?? 0, { timeout: 30_000 }).toBe(ROWS.length);
}

test("draws each type with its model, an unlisted type plain, and fetches only the types in view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const files: { path: string; status: number }[] = [];
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/models/planes/")) files.push({ path, status: r.status() });
  });
  await open(page);

  await expect
    .poll(async () => (await stats(page))?.byModel ?? {}, { timeout: 30_000 })
    .toEqual({ A388: 1, B738: 1, EC35: 1, "plain-jet": 1 });

  const state = await layerState(page);
  expect(state.models).toBe(true);
  expect(state.chevrons).toBe("none");
  expect(state.modelsVisibility).not.toBe("none");

  expect(files.map((f) => f.path).sort()).toEqual(
    ["A388", "B738", "EC35", "plain-heli", "plain-jet", "plain-light"].map((m) => `/models/planes/${m}.glb`),
  );
  expect(files.filter((f) => f.status !== 200)).toEqual([]);
  // One draw call per model and level that holds a plane, never one per plane.
  const s = (await stats(page))!;
  expect(s.drawCalls).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

test("the tag gives the height the plane reported, not the height it is drawn at", async ({ page }) => {
  await open(page);
  await expect(page.locator("main").getByText(/HIGH1/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main").getByText(/37,000 ft/).first()).toBeVisible();
});

for (const where of ["body", "line", "ring"] as const) {
  test(`a click on a plane's ${where} selects it, and the panel gives its real height`, async ({ page }) => {
    await open(page);
    await page.waitForTimeout(800);
    const at = await pageSpot(page, HIGH, where);
    await page.mouse.click(at.x, at.y);
    const text = panel(page);
    await expect(text).toContainText("HIGH1", { timeout: 15_000 });
    await expect(text).toContainText("37,000 ft");
    await expect(text).toContainText("Drawn lower than its real height");
  });
}

test("a plane under the cap does not say it is drawn lower", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(800);
  const at = await pageSpot(page, LOW, "body");
  await page.mouse.click(at.x, at.y);
  const text = panel(page);
  await expect(text).toContainText("LOW2", { timeout: 15_000 });
  await expect(text).not.toContainText("Drawn lower");
});

test("draws only when the map does: with no input it goes idle within 3 s", async ({ page }) => {
  await open(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const map = (window as unknown as { __map: MapHandle }).__map;
        const timer = setTimeout(() => reject(new Error("the map did not go idle in 3 s")), 3000);
        map.once("idle", () => {
          clearTimeout(timer);
          resolve();
        });
        map.triggerRepaint();
      }),
  );
});

test("models that will not load leave the chevrons: still ready, no page error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await answerPlanes(page);
  await page.route("**/models/planes/**", (route) => route.fulfill({ status: 404, body: "gone" }));
  await page.goto("/eye?place=tower-bridge");
  await ready(page);

  const state = await layerState(page);
  expect(state.models).toBe(false);
  expect(state.chevrons).not.toBe("none");
  expect(pageErrors).toEqual([]);
});

test("one type's file that will not load leaves that plane plain and the layer up", async ({ page }) => {
  await page.route("**/models/planes/A388.glb", (route) => route.fulfill({ status: 404, body: "gone" }));
  await open(page);
  await expect
    .poll(async () => (await stats(page))?.byModel ?? {}, { timeout: 30_000 })
    .toEqual({ "plain-jet": 2, B738: 1, EC35: 1 });
  expect((await layerState(page)).chevrons).toBe("none");
});

test("the Sources tray's Planes switch hides the models, and shows them again", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Sources/ }).click();
  const planes = page.locator("aside#eye-sources").getByRole("switch", { name: /^Show (Planes|Aircraft)/ });
  await planes.click();
  await expect(planes).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await layerState(page)).modelsVisibility).toBe("none");
  expect((await layerState(page)).chevrons).toBe("none");

  await planes.click();
  await expect(planes).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await layerState(page)).modelsVisibility).not.toBe("none");
  expect((await layerState(page)).chevrons).toBe("none");
});

for (const path of ["/", "/app"]) {
  test(`${path} makes no request for a model or for three.js`, async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/models/")) asked.push(url.pathname);
    });
    page.on("response", async (r) => {
      const url = new URL(r.url());
      if (!url.pathname.endsWith(".js")) return;
      const body = await r.text().catch(() => "");
      // three.js's own revision string, in whatever chunk the build put it.
      if (body.includes("WebGLRenderer") && body.includes("InstancedMesh")) asked.push(url.pathname);
    });
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(4000);
    expect(asked).toEqual([]);
  });
}
