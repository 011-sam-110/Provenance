import { expect, test, type Page } from "@playwright/test";

/**
 * Which cameras the God's eye view holds (31 Oct 2026). It used to ask once, where it
 * opened, for the 25 nearest, and it sorted TfL's recordings under Static cams. Now it asks
 * for every camera within 4 km, asks again when the view moves 2 km, and a recording is
 * under Live cams while its card still says what it shows. A camera with no room for a card
 * is an icon.
 *
 * Every feed is a fixture, so the counts do not depend on TfL. THE HOOKS: main[data-eye-state
 * ="ready"], the tray's switches by name, the ledger region, `[data-media]` (one camera
 * card), the layer `eye-cam-ring`, the source `eye-cams`, and window.__map.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const WESTMINSTER = { lat: 51.5013, lon: -0.1218 };
const SPOT = `/eye?lat=${WESTMINSTER.lat}&lon=${WESTMINSTER.lon}&z=16&tilt=0&heading=0`;
/** About 3 km north, past NEAR_REASK_KM. */
const FAR_LAT = WESTMINSTER.lat + 0.027;
/** About 1 km north, short of it. */
const CLOSE_LAT = WESTMINSTER.lat + 0.009;

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Fake = { id?: string; name: string; lat: number; lon: number; clip?: boolean; live?: boolean; attribution?: string };

const body = (cams: Fake[]) =>
  JSON.stringify({
    cameras: cams.map((c, i) => ({
      id: `fake:${c.name}`,
      available: true,
      live: false,
      clip: false,
      refreshSeconds: 300,
      attribution: "Powered by TfL Open Data",
      km: 0.1 + i / 1000,
      ...c,
    })),
  });

/** `count` cameras on a grid around a spot, all inside a 1440 x 900 frame at zoom 16. */
function grid(prefix: string, at: { lat: number; lon: number }, count: number, over: Partial<Fake> = {}): Fake[] {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix} ${i}`,
    lat: at.lat - 0.002 + (0.004 * Math.floor(i / side)) / side,
    lon: at.lon - 0.004 + (0.008 * (i % side)) / side,
    ...over,
  }));
}

/** The view's other feeds, answered empty. `near` answers each camera ask, and records it. */
async function feeds(page: Page, near: (ask: URL, nth: number) => { status?: number; cams?: Fake[] }) {
  const asks: URL[] = [];
  const json = (b: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route((u) => u.pathname === "/api/eye/vessels", (r) => r.fulfill(json({ ok: true, stream: "off", features: [] })));
  await page.route((u) => u.pathname === "/api/planes", (r) => r.fulfill(json({ planes: [] })));
  await page.route((u) => u.pathname === "/api/eye/streets", (r) => r.fulfill(json({ ok: true, fetchedAt: null, features: [] })));
  await page.route((u) => u.pathname === "/api/camera-road", (r) => r.fulfill(json({ roads: {} })));
  // No recording to play, so a card falls back to its still: it shows, and its chip says Still.
  await page.route(
    (u) => u.pathname === "/api/proxy",
    (r) =>
      new URL(r.request().url()).searchParams.get("clip")
        ? r.fulfill({ status: 404 })
        : r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PIXEL, "base64") }),
  );
  await page.route(
    (u) => u.pathname === "/api/near",
    (route) => {
      const ask = new URL(route.request().url());
      asks.push(ask);
      const answer = near(ask, asks.length);
      return route.fulfill({ status: answer.status ?? 200, contentType: "application/json", body: body(answer.cams ?? []) });
    },
  );
  return asks;
}

const open = async (page: Page, url = SPOT) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
};

const openTray = (page: Page) => page.getByRole("button", { name: "Sources", exact: false }).first().click();
const rowSwitch = (page: Page, row: string) => page.getByRole("switch", { name: `Show ${row} in this view` });

/** Every camera the map holds, in frame or not, by its tray row. */
const held = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as {
      __map: { getSource: (id: string) => { serialize: () => { data: { features: { properties: { row: string } }[] } } } };
    }).__map;
    const out: Record<string, number> = {};
    for (const f of map.getSource("eye-cams").serialize().data.features) out[f.properties.row] = (out[f.properties.row] ?? 0) + 1;
    return out;
  });

/** What the ring layer has drawn: each camera once, by its tray row. */
const rings = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: { queryRenderedFeatures: (o: unknown) => { properties: { id: string; row: string } }[] } }).__map;
    const out: Record<string, number> = {};
    const seen = new Set<string>();
    for (const f of map.queryRenderedFeatures({ layers: ["eye-cam-ring"] })) {
      if (seen.has(f.properties.id)) continue;
      seen.add(f.properties.id);
      out[f.properties.row] = (out[f.properties.row] ?? 0) + 1;
    }
    return out;
  });

const cardNames = (page: Page) => page.locator("[data-media]").allInnerTexts();
/** How many cards stand for each kind of fake camera, by the name on the card. */
const cardsOf = (texts: string[]) => ({
  clip: texts.filter((t) => /Clip \d/.test(t)).length,
  still: texts.filter((t) => /Still \d/.test(t)).length,
});

const moveTo = (page: Page, lat: number) =>
  page.evaluate(
    ([la, lo]) => (window as unknown as { __map: { jumpTo: (o: unknown) => void } }).__map.jumpTo({ center: [lo, la] }),
    [lat, WESTMINSTER.lon],
  );

test("asks for every camera of a dense place, not the 25 nearest", async ({ page }) => {
  const asks = await feeds(page, () => ({ cams: grid("Clip", WESTMINSTER, 197, { clip: true }) }));
  await open(page);

  expect(asks).toHaveLength(1);
  expect(asks[0].searchParams.get("n")).toBe("600");
  expect(asks[0].searchParams.get("km")).toBe("4");

  await expect.poll(() => held(page), { timeout: 15_000 }).toEqual({ livecams: 197 });
  await expect.poll(async () => (await rings(page)).livecams ?? 0, { timeout: 15_000 }).toBeGreaterThan(25);
});

test("a recording is under Live cams and a still under Static cams, and each switch moves its own", async ({ page }) => {
  await feeds(page, () => ({
    cams: [...grid("Clip", WESTMINSTER, 6, { clip: true }), ...grid("Still", { lat: WESTMINSTER.lat, lon: WESTMINSTER.lon + 0.001 }, 4)],
  }));
  await open(page);
  await openTray(page);
  await expect.poll(() => held(page), { timeout: 15_000 }).toEqual({ livecams: 6, staticcams: 4 });
  await expect.poll(() => rings(page), { timeout: 15_000 }).toEqual({ livecams: 6, staticcams: 4 });

  await rowSwitch(page, "Static cams").click();
  await expect.poll(() => rings(page)).toEqual({ livecams: 6 });
  await expect.poll(async () => cardsOf(await cardNames(page)), { timeout: 15_000 }).toMatchObject({ still: 0 });
  expect(cardsOf(await cardNames(page)).clip).toBeGreaterThan(0);

  await rowSwitch(page, "Static cams").click();
  await rowSwitch(page, "Live cams").click();
  await expect.poll(() => rings(page)).toEqual({ staticcams: 4 });
  await expect.poll(async () => cardsOf(await cardNames(page)), { timeout: 15_000 }).toMatchObject({ clip: 0 });
  await expect.poll(async () => cardsOf(await cardNames(page)).still, { timeout: 15_000 }).toBeGreaterThan(0);

  await rowSwitch(page, "Static cams").click();
  await expect.poll(() => rings(page)).toEqual({});
  await expect.poll(async () => (await cardNames(page)).length).toBe(0);
});

test("every camera in the frame is a card or an icon, and a tapped icon opens its card", async ({ page }) => {
  await feeds(page, () => ({ cams: grid("Clip", WESTMINSTER, 20, { clip: true }) }));
  await open(page);
  const cards = page.locator('a[href^="/camera/"]');
  const icons = page.locator("[data-cam-icon]");
  await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await cards.count()).toBeLessThanOrEqual(5);
  expect(await icons.count()).toBeGreaterThan(0);
  const before = await cards.count();
  await icons.first().click();
  const close = page.getByRole("button", { name: /^Close (?!this hint)/ });
  await expect(close).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(close).toHaveCount(0);
  await expect.poll(() => cards.count()).toBeLessThanOrEqual(5);
  expect(before).toBeGreaterThan(0);
});

test("asks again once the view has moved 2 km, and takes the new operator's credit", async ({ page }) => {
  const asks = await feeds(page, (ask) =>
    Number(ask.searchParams.get("lat")) > WESTMINSTER.lat + 0.02
      ? { cams: grid("North", { lat: FAR_LAT, lon: WESTMINSTER.lon }, 9, { clip: true, attribution: "Other operator" }) }
      : { cams: grid("Clip", WESTMINSTER, 5, { clip: true }) },
  );
  await open(page);
  await expect.poll(() => held(page), { timeout: 15_000 }).toEqual({ livecams: 5 });

  await moveTo(page, CLOSE_LAT);
  await page.waitForTimeout(2_600);
  expect(asks).toHaveLength(1);

  await moveTo(page, FAR_LAT);
  await expect.poll(() => asks.length, { timeout: 8_000 }).toBe(2);
  expect(Number(asks[1].searchParams.get("lat"))).toBeCloseTo(FAR_LAT, 3);
  await expect.poll(() => held(page), { timeout: 15_000 }).toEqual({ livecams: 9 });
  await expect.poll(() => rings(page), { timeout: 15_000 }).toEqual({ livecams: 9 });
  const credit = await page.evaluate(
    () => (window as unknown as { __map: { getSource: (id: string) => { attribution?: string } } }).__map.getSource("eye-cams").attribution,
  );
  expect(credit).toBe("Other operator");
});

test("a failed ask keeps what is drawn, and the next move asks again", async ({ page }) => {
  const asks = await feeds(page, (_ask, nth) => (nth === 2 ? { status: 500 } : { cams: grid("Clip", WESTMINSTER, 5, { clip: true }) }));
  await open(page);
  await expect.poll(() => held(page), { timeout: 15_000 }).toEqual({ livecams: 5 });

  await moveTo(page, FAR_LAT);
  await expect.poll(() => asks.length, { timeout: 8_000 }).toBe(2);
  await page.waitForTimeout(500);
  expect(await held(page)).toEqual({ livecams: 5 });

  await page.waitForTimeout(2_100);
  await moveTo(page, FAR_LAT + 0.0001);
  await expect.poll(() => asks.length, { timeout: 8_000 }).toBe(3);
});

test("a camera link keeps its name in the title after the view moves away", async ({ page }) => {
  const name = "Parliament Square";
  const id = "tfl:JamCams_00001.06501";
  await feeds(page, (ask) =>
    Number(ask.searchParams.get("lat")) > WESTMINSTER.lat + 0.02
      ? { cams: grid("North", { lat: FAR_LAT, lon: WESTMINSTER.lon }, 3, { clip: true }) }
      : { cams: [{ id, name, lat: WESTMINSTER.lat, lon: WESTMINSTER.lon, clip: true }] },
  );
  await open(page, `/eye?cam=${id}&lat=${WESTMINSTER.lat}&lon=${WESTMINSTER.lon}`);
  await expect(page.locator("header h1")).toContainText(name);

  await moveTo(page, FAR_LAT);
  await expect.poll(async () => (await cardNames(page)).some((t) => t.includes("North")), { timeout: 15_000 }).toBe(true);
  await expect(page.locator("header h1")).toContainText(name);
});

test("a film keeps the cameras it opened with", async ({ page }) => {
  const asks = await feeds(page, () => ({ cams: grid("Clip", WESTMINSTER, 3, { clip: true }) }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SPOT}&clock=manual`);
  await expect.poll(() => asks.length, { timeout: 90_000 }).toBe(1);
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), undefined, { timeout: 90_000 });
  await moveTo(page, FAR_LAT);
  await page.waitForTimeout(3_000);
  expect(asks).toHaveLength(1);
  await expect(page.locator("[data-cam-icon]")).toHaveCount(0);
});
