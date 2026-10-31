import { expect, test, type Page } from "@playwright/test";

/**
 * God's eye view's title on a portrait phone (eye-phone-title, 29 Oct 2026).
 *
 *   - The title stands under the search, beside the clock, so a title that wraps (a spot's
 *     coordinates, a camera's 49-character name) meets neither. Checked at 320, 360 and 390 wide.
 *   - A spot's title breaks only after its comma: "51.5072° N," then "0.1268° W", never a
 *     lone "W" on a line of its own.
 *   - A film's frame stacks its header and its ledger in flow, so a title that wraps pushes the
 *     ledger down; a recording keeps its header at 6.5% / 7% with the ledger under it, and a wide
 *     recording keeps its ledger 76 px above the bottom.
 *
 * /api/near is answered from a fixture, so the title and the ledger do not depend on TfL
 * being up. The phone layout is chosen by aspect ratio, so a plain context with
 * setViewportSize is enough.
 *
 * THE HOOKS: `main[data-eye-state="ready"]`, the first `header`, `header h1`, the first
 * `header p` (a film's sub line), `[data-eye-search]`, and
 * `section[aria-label="What this view shows"]` (a film's ledger).
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const A406 = "A406 North Circular Rd/Telford Rd/Bounds Green Rd";

const near = (id: string, name: string, lat: number, lon: number) =>
  JSON.stringify({
    cameras: [{ id, name, lat, lon, available: true, live: false, clip: false, refreshSeconds: 300, attribution: "TfL", km: 0.1 }],
  });
const none = JSON.stringify({ cameras: [] });

async function answerNear(page: Page, body: string) {
  await page.route(
    (url) => url.pathname === "/api/near",
    (route) => route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const ledgerOf = (page: Page) => page.locator('section[aria-label="What this view shows"]');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const bottom = (b: Box) => b.y + b.height;
const meet = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < bottom(b) && b.y < bottom(a);

/** A film's header, its title and sub line, the clock block and the ledger, as boxes. */
async function boxes(page: Page) {
  const get = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!;
  return {
    header: await get(page.locator("header").first()),
    h1: await get(page.locator("header h1")),
    sub: await get(page.locator("header p").first()),
    clock: await get(page.getByLabel("Time now, UTC")),
    ledger: await get(ledgerOf(page)),
  };
}

/** The HUD: the title under the search, clear of the clock, inside the screen. */
async function expectClear(page: Page, width: number) {
  const pill = (await page.locator("[data-eye-search]").boundingBox())!;
  const h1 = (await page.locator("header h1").boundingBox())!;
  const clock = (await page.getByLabel("Time now, UTC").boundingBox())!;
  const compass = (await page.locator("[data-eye-compass]").boundingBox())!;
  expect(h1.y, "the title starts below the search").toBeGreaterThanOrEqual(bottom(pill) - 0.5);
  expect(meet(h1, clock), "the title and the clock do not meet").toBe(false);
  expect(meet(h1, compass), "the title and the compass do not meet").toBe(false);
  expect(h1.x + h1.width, "the title stays inside the screen").toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** A film: nothing of the header runs under the ledger, and nothing scrolls sideways. */
async function expectStacked(page: Page, width: number) {
  const b = await boxes(page);
  expect(b.ledger.y, "the ledger starts at or below the header's bottom").toBeGreaterThanOrEqual(bottom(b.header) - 0.5);
  expect(meet(b.h1, b.ledger), "the title and the ledger do not meet").toBe(false);
  expect(meet(b.sub, b.ledger), "the sub line and the ledger do not meet").toBe(false);
  expect(meet(b.h1, b.clock), "the title and the clock do not meet").toBe(false);
  expect(b.h1.x + b.h1.width, "the title stays inside the screen").toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** The tops of "W" and of the first digit of the longitude: the same line, or the title broke before the W. */
async function expectBreaksAfterComma(page: Page) {
  const tops = await page.evaluate(() => {
    const h1 = document.querySelector("header h1")!;
    const text = h1.firstChild as Text;
    const topOf = (i: number) => {
      const r = document.createRange();
      r.setStart(text, i);
      r.setEnd(text, i + 1);
      return r.getBoundingClientRect().top;
    };
    const s = text.data;
    return { w: topOf(s.length - 1), digit: topOf(s.indexOf(", ") + 2), n: topOf(s.indexOf(",") - 1), first: topOf(0) };
  });
  expect(tops.w, "the W is on the longitude's line").toBeCloseTo(tops.digit, 0);
  expect(tops.n, "the N is on the latitude's line").toBeCloseTo(tops.first, 0);
}

const PHONES = [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
  { width: 390, height: 844 },
] as const;

for (const size of PHONES) {
  test.describe(`${size.width} x ${size.height}`, () => {
    test.use({ viewport: size });

    test("a spot: coordinates break after the comma, clear of the clock", async ({ page }) => {
      // A spot with a name is titled by it (useSpotName). This test is about the coordinates.
      await page.route("**/api/geocode?**", (r) => r.fulfill({ json: { results: [] } }));
      await answerNear(page, near("tfl:JamCams_00001.06520", "Trafalgar Square", 51.5077, -0.1277));
      await page.goto("/eye?lat=51.5072&lon=-0.1268&z=16&tilt=50&heading=320");
      await ready(page);
      await expect(page.locator("header h1")).toHaveText("51.5072° N, 0.1268° W");
      await expectClear(page, size.width);
      await expectBreaksAfterComma(page);
    });

    test("a three-digit south and east spot", async ({ page }) => {
      await page.route("**/api/geocode?**", (r) => r.fulfill({ json: { results: [] } }));
      await answerNear(page, none);
      await page.goto("/eye?lat=-33.8568&lon=151.2153&z=16&tilt=50&heading=320");
      await ready(page);
      await expect(page.locator("header h1")).toHaveText("33.8568° S, 151.2153° E");
      await expectClear(page, size.width);
      await expectBreaksAfterComma(page);
    });

    test("a camera link with the longest TfL name", async ({ page }) => {
      await answerNear(page, near("tfl:JamCams_00001.09060", A406, 51.6112, -0.13544));
      await page.goto("/eye?cam=tfl:JamCams_00001.09060&lat=51.6112&lon=-0.13544");
      await ready(page);
      await expect(page.locator("header h1")).toHaveText(A406);
      await expectClear(page, size.width);
    });

    test("a film: the same name pushes the ledger down", async ({ page }) => {
      await answerNear(page, near("tfl:JamCams_00001.09060", A406, 51.6112, -0.13544));
      await page.goto("/eye?cam=tfl:JamCams_00001.09060&lat=51.6112&lon=-0.13544&clock=manual");
      await ready(page);
      await expect(page.locator("header h1")).toHaveText(A406);
      await expectStacked(page, size.width);
    });

    test("a place: Piccadilly Circus", async ({ page }) => {
      await answerNear(page, near("tfl:JamCams_00001.07530", "Piccadilly Circus", 51.5101, -0.134));
      await page.goto("/eye?place=piccadilly");
      await ready(page);
      await expectClear(page, size.width);
    });
  });
}

test("320 wide: a film's ledger holds all four counts inside its own box", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await answerNear(page, none);
  await page.goto("/eye?place=piccadilly&clock=manual");
  await ready(page);
  // A phone draws a row only once it counts something; show all four, as London can.
  const fits = await ledgerOf(page).evaluate((el) => {
    el.querySelectorAll("p").forEach((p) => {
      p.removeAttribute("data-zero");
      p.removeAttribute("data-note");
    });
    return el.scrollWidth <= el.clientWidth;
  });
  expect(fits).toBe(true);
});

test("a one-line title on a film: the ledger follows the header and does not drift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await answerNear(page, near("tfl:JamCams_00001.06520", "Westminster Bridge", 51.5008, -0.1218));
  await page.goto("/eye?place=westminster&clock=manual");
  await ready(page);
  const b = await boxes(page);
  const gap = b.ledger.y - bottom(b.header);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(8);
});

test("a wide film is as it was: header 22 px down, ledger 76 px above the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerNear(page, near("tfl:JamCams_00001.06520", "Westminster Bridge", 51.5008, -0.1218));
  await page.goto("/eye?place=westminster&clock=manual");
  await ready(page);
  const b = await boxes(page);
  expect(b.header.y).toBeCloseTo(22, 0);
  expect(900 - bottom(b.ledger)).toBeCloseTo(76, 0);
});

test("a recording keeps its header at 6.5% / 7% and the ledger right under it", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 960 });
  await answerNear(page, near("tfl:JamCams_00001.06520", "Westminster Bridge", 51.5008, -0.1218));
  await page.goto("/eye?place=westminster&record=1&clock=manual");
  await ready(page);
  const b = await boxes(page);
  expect(Math.abs(b.header.y - 960 * 0.065)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(b.header.x - 540 * 0.07)).toBeLessThanOrEqual(1.5);
  const gap = b.ledger.y - bottom(b.header);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(8);
});
