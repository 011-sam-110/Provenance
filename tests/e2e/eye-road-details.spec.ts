import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import { streetsBody } from "@/lib/eye/streets";
import { normalizeTflNotices } from "@/lib/roads/tfl";

/**
 * The God's eye view's TfL road notices can be clicked (/eye): a click on a notice's
 * street line, ring or plate opens a panel with everything TfL sent, the notice's streets
 * are redrawn OVER the buildings, a vessel or an aircraft wins a click it shares with a
 * notice, "Also here" lists the rest, a recording stays a plain frame, and opening any
 * details panel closes the control hint (the "?" brings it back and closes the panel).
 *
 * THE FEEDS ARE ANSWERED FROM REAL CAPTURES. The streets route gets three verbatim TfL rows
 * (tests/fixtures/tfl-road-disruptions-mixed.json) with their times moved to "now"; the
 * view opens on the A12 at Gallows Corner, where the first row (TIMS-237054, utility
 * works) closes one stretch westbound and leaves the next open. A keyless server has no
 * boats, so the vessel feed is routed by pathname to an empty list; the aircraft feed is
 * the capture of tests/fixtures/eye-planes-uk.json with one aircraft moved onto the street
 * where a case needs a shared click.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map`, WorldMap's debug handle,
 * which says where a mark is on the screen.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

// The first page load of a fresh server draws the 3D city in software GL: give it the
// same 90 s the ready wait allows, not Playwright's 30 s default.
test.describe.configure({ timeout: 120_000 });

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");
const MIXED = JSON.parse(fixture("tfl-road-disruptions-mixed.json"));
const PLANES = JSON.parse(fixture("eye-planes-uk.json")) as { planes: Record<string, unknown>[] } & Record<string, unknown>;
const A12 = "/eye?lat=51.59268&lon=0.21294&z=16&tilt=45&heading=0";
const MIN = 60_000;
const NOTICE_ID = "TIMS-237054";

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const dialog = (page: Page) => page.getByRole("dialog");
const closeBtn = (page: Page) => dialog(page).getByRole("button", { name: "Close", exact: true });
const roadPlate = (page: Page) => page.getByRole("button", { name: /Utility works, road notice details/ });
const hintPlate = (page: Page) => page.getByRole("complementary", { name: "How to move the view" });
const hintToggle = (page: Page) => page.getByRole("button", { name: "How to move the view" });

/** The notice the first row becomes, with its times moved to "now". */
const NOW = Date.now();
const NOTICES = normalizeTflNotices(MIXED).map((n, i) => {
  const changed = NOW - 10 * MIN - i * 7 * MIN;
  return {
    ...n,
    updated: new Date(changed).toISOString(),
    updateAt: new Date(changed - MIN).toISOString(),
    starts: new Date(NOW - 3 * 60 * MIN).toISOString(),
    ends: new Date(NOW + 5 * 60 * MIN).toISOString(),
  };
});
const A12_NOTICE = NOTICES.find((n) => n.id === NOTICE_ID)!;
/** A vertex of the A12 closed line, [lon, lat], from the middle of the line. */
const CLOSED_LINE = A12_NOTICE.closedLines[0];
const OPEN_LINE = A12_NOTICE.openLines[0];

/**
 * Answer the feeds; collect what the page throws. `setPlane` puts one aircraft of the
 * capture at a [lon, lat] for the NEXT load of the page; until then the aircraft feed is
 * empty. The vessel feed is always empty.
 */
async function feeds(
  page: Page,
): Promise<{ errors: string[]; setPlane(at: [number, number] | null): void; setNotices(list: typeof NOTICES | null): void }> {
  const errors: string[] = [];
  let plane: [number, number] | null = null;
  let notices: typeof NOTICES = NOTICES;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const json = (body: string) => ({ status: 200, contentType: "application/json", body });
  await page.route((url) => url.pathname === "/api/eye/streets", (route) =>
    route.fulfill(json(streetsBody(notices, NOW - MIN))),
  );
  await page.route((url) => url.pathname === "/api/signals/ais", (route) => route.fulfill(json(JSON.stringify({ features: [] }))));
  await page.route((url) => url.pathname === "/api/eye/vessels", (route) =>
    route.fulfill(json(JSON.stringify({ ok: true, stream: "live", features: [] }))),
  );
  await page.route((url) => url.pathname === "/api/planes", (route) => {
    const planes = plane ? [{ ...PLANES.planes[0], lon: plane[0], lat: plane[1] }] : [];
    return route.fulfill(json(JSON.stringify({ ...PLANES, count: planes.length, planes })));
  });
  return { errors, setPlane: (at) => (plane = at), setNotices: (list) => (notices = list ?? NOTICES) };
}

/**
 * Six notices in a column, 80 px apart, down the left of the screen: the A12 row with the
 * words of other notices and no street line (built here, not TfL's data), so only their
 * plates and rings show. Open the A12, read where each spot is on the map, put a notice there
 * and load the page again. Returns the spots in page px, nearest the top first, with the
 * sub-category each notice carries as its plate's title.
 */
const CROWD_TITLES = ["Utility works", "Borough works", "TfL works", "Road resurfacing", "Gas works", "Water works"];
async function openWithCrowd(page: Page, feed: Awaited<ReturnType<typeof feeds>>, x: number) {
  await page.goto(A12);
  await ready(page);
  const spots = CROWD_TITLES.map((title, i) => ({ title, x, y: 230 + i * 80 }));
  const at = await page.evaluate((list) => {
    const map = (window as unknown as { __map: { unproject(p: [number, number]): { lng: number; lat: number } } }).__map;
    const r = document.querySelector("canvas.maplibregl-canvas")!.getBoundingClientRect();
    return list.map((p) => {
      const g = map.unproject([p.x - r.left, p.y - r.top]);
      return [g.lng, g.lat] as [number, number];
    });
  }, spots);
  feed.setNotices(
    spots.map((spot, i) => ({
      ...A12_NOTICE,
      id: `TIMS-CROWD-${i}`,
      subCategory: spot.title,
      severity: "Minimal",
      closure: undefined,
      namedStreets: undefined,
      location: `[A${100 + i}] CROWD ROAD ${i} (SW1A ) (Westminster)`,
      lon: at[i][0],
      lat: at[i][1],
      openLines: [],
      closedLines: [],
    })),
  );
  await page.reload();
  await ready(page);
  return spots;
}

/** The road plates on screen, with their boxes, and how many overlap each other or the frame's words. */
const platesOnScreen = (page: Page) =>
  page.evaluate(() => {
    const plates = [...document.querySelectorAll('div[data-kind="road"] [class*="tagPlate"]')].map((e) => ({
      title: e.querySelector("b")?.textContent ?? "",
      r: e.getBoundingClientRect(),
    }));
    const keeps = [...document.querySelectorAll("[data-eye-keep]")].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
    const hit = (a: DOMRect, b: DOMRect) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    let overlaps = 0;
    plates.forEach((p, i) => {
      for (const q of plates.slice(i + 1)) if (hit(p.r, q.r)) overlaps++;
      for (const k of keeps) if (hit(p.r, k)) overlaps++;
    });
    return { titles: plates.map((p) => p.title), overlaps, inside: plates.every((p) => p.r.left >= 0 && p.r.right <= innerWidth && p.r.top >= 0 && p.r.bottom <= innerHeight) };
  });

/**
 * Open the A12, put an aircraft on bare ground at a fraction of the screen (away from the
 * notice's plate and the frame's words) and load the page again, so the aircraft has a
 * plate of its own and the notice keeps its room.
 */
async function openWithPlaneAside(page: Page, feed: Awaited<ReturnType<typeof feeds>>) {
  await page.goto(A12);
  await ready(page);
  const size = page.viewportSize()!;
  const at = await page.evaluate(
    ([x, y]) => {
      const map = (window as unknown as { __map: { unproject(p: [number, number]): { lng: number; lat: number } } }).__map;
      const r = document.querySelector("canvas.maplibregl-canvas")!.getBoundingClientRect();
      const p = map.unproject([x - r.left, y - r.top]);
      return [p.lng, p.lat] as [number, number];
    },
    [size.width * 0.25, size.height * 0.62],
  );
  feed.setPlane(at);
  await page.reload();
  await ready(page);
}

/**
 * Open the A12, find a spot on its street that is bare canvas and far from TfL's own point
 * (where the notice's plate hangs), put the aircraft there and load the page again, so the
 * aircraft's plate and the notice's plate do not fight for the same room.
 */
async function openWithPlaneOnStreet(page: Page, feed: Awaited<ReturnType<typeof feeds>>) {
  await page.goto(A12);
  await ready(page);
  const v = await vertexOnCanvas(page);
  feed.setPlane(v.at);
  await page.reload();
  await ready(page);
  return v;
}

/** Where a lon/lat is on the page, in CSS px, from the map's own projection. */
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

/**
 * A vertex of the closed line that is on the bare canvas (no plate, panel or control over
 * it), away from TfL's own point, so the click is a click on the STREET.
 */
async function vertexOnCanvas(page: Page, line: [number, number][] = CLOSED_LINE) {
  const spot = await screenOf(page, A12_NOTICE.lon, A12_NOTICE.lat);
  const size = page.viewportSize()!;
  const scored: { at: [number, number]; x: number; y: number; far: number }[] = [];
  for (const at of line) {
    const p = await screenOf(page, at[0], at[1]);
    const onCanvas = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y) === document.querySelector("canvas.maplibregl-canvas"),
      [p.x, p.y],
    );
    const inside = p.x > 20 && p.y > 20 && p.x < size.width - 20 && p.y < size.height - 20;
    if (onCanvas && inside) scored.push({ at, ...p, far: Math.hypot(p.x - spot.x, p.y - spot.y) });
  }
  expect(scored.length, "a vertex of the street is on the bare canvas").toBeGreaterThan(0);
  scored.sort((a, b) => b.far - a.far);
  return scored[0];
}

/** How many features the selection source holds, by geometry type. */
const selectedFeatures = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __map: { getSource(id: string): { serialize(): { data: { features: { geometry: { type: string } }[] } } } | undefined } }).__map;
    const out: Record<string, number> = {};
    for (const f of map.getSource("eye-selected")?.serialize().data.features ?? []) out[f.geometry.type] = (out[f.geometry.type] ?? 0) + 1;
    return out;
  });

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the road plate is a button: it opens TfL's panel, and Escape hands focus back to it", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(A12);
    await ready(page);

    const plate = roadPlate(page);
    await expect(plate).toHaveAttribute("class", /tagBtn/);
    await plate.click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2, name: "Utility works" })).toBeVisible();
    for (const label of ["Severity", "From", "Until"]) await expect(panel).toContainText(label);
    for (const heading of ["TfL's description", "Where", "Notice"]) await expect(panel.getByRole("heading", { name: heading })).toBeVisible();
    await expect(panel.getByText("TfL reference")).toBeVisible();
    await expect(panel).toContainText(NOTICE_ID);
    await expect(panel).toContainText("Cadent Gas works");
    await expect(panel).toContainText("Powered by TfL Open Data");
    // The footer is TfL's credit alone; the panel names no "Works by".
    await expect(panel).not.toContainText("Every value is TfL's own");
    await expect(panel.locator("footer p")).toHaveText(["Powered by TfL Open Data"]);
    await expect(panel).not.toContainText("Works by");
    // TfL's own sentences come before the groups.
    const order = await panel.locator("h3").allTextContents();
    expect(order.slice(0, 2)).toEqual(["TfL's description", expect.stringMatching(/^TfL's latest update, \d\d:\d\d UTC$/)]);
    expect(order.slice(2)).toEqual(["Where", "Notice"]);
    // The panel's own box is docked on the right, 340 px wide.
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.width)).toBe(340);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(plate).toBeFocused();

    await plate.focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await closeBtn(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a click on a street line opens the same panel, and its streets are drawn over the buildings", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(A12);
    await ready(page);
    expect(await selectedFeatures(page)).toEqual({});

    const v = await vertexOnCanvas(page);
    await page.mouse.click(v.x, v.y);
    await expect(page.getByRole("dialog", { name: "Utility works" })).toBeVisible();
    await expect(dialog(page)).toContainText(NOTICE_ID);

    // One ring at TfL's point, and one line for each of the notice's streets.
    expect(await selectedFeatures(page)).toEqual({
      Point: 1,
      LineString: A12_NOTICE.openLines.length + A12_NOTICE.closedLines.length,
    });
    // The selected streets draw ABOVE the buildings; the unselected ones stay beneath them.
    const order = await page.evaluate((building) => {
      const map = (window as unknown as { __map: { getStyle(): { layers: { id: string }[] } } }).__map;
      const ids = map.getStyle().layers.map((l) => l.id);
      return {
        building: ids.indexOf(building),
        selected: ids.filter((id) => id.startsWith("eye-selected-") && id !== "eye-selected-ring").map((id) => [id, ids.indexOf(id)] as const),
        ring: ids.indexOf("eye-selected-ring"),
        streets: ids.filter((id) => id.startsWith("eye-street-")).map((id) => [id, ids.indexOf(id)] as const),
      };
    }, BUILDING_LAYER);
    expect(order.building).toBeGreaterThanOrEqual(0);
    expect(order.selected.map(([id]) => id)).toEqual([
      "eye-selected-casing",
      "eye-selected-closed-base",
      "eye-selected-closed",
      "eye-selected-works",
      "eye-selected-incident",
    ]);
    for (const [id, at] of order.selected) expect(at, `${id} above the buildings`).toBeGreaterThan(order.building);
    for (const [id, at] of order.streets) expect(at, `${id} under the buildings`).toBeLessThan(order.building);
    // The ring sits on top of the selected streets.
    for (const [, at] of order.selected) expect(order.ring).toBeGreaterThan(at);

    // Clicking bare ground closes it and clears the streets and the ring.
    await page.mouse.click(v.x - 260, v.y + 180);
    await expect(dialog(page)).toHaveCount(0);
    expect(await selectedFeatures(page)).toEqual({});
    expect(errors).toEqual([]);
  });

  test("a click on the open stretch's line opens the notice too, and the cursor shows a street is clickable", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(A12);
    await ready(page);
    const v = await vertexOnCanvas(page, OPEN_LINE);
    await page.mouse.move(v.x, v.y);
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>("canvas.maplibregl-canvas")!.style.cursor)).toBe("pointer");
    await page.mouse.click(v.x, v.y);
    await expect(dialog(page)).toContainText(NOTICE_ID);
    expect(errors).toEqual([]);
  });

  test("an aircraft on the street wins the click, lists the notice in Also here, and the chip switches to it", async ({ page }) => {
    const feed = await feeds(page);
    const { errors } = feed;
    const at = await openWithPlaneOnStreet(page, feed);
    await page.mouse.click(at.x, at.y);
    const panel = page.getByRole("dialog", { name: "RYR3737" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("EI-IGJ");
    const chips = panel.getByRole("list").getByRole("button");
    await expect(panel.getByRole("heading", { name: "Also here" })).toBeVisible();
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText("Utility works, [A12] EASTERN AVENUE EAST");

    await chips.first().click();
    await expect(page.getByRole("dialog", { name: "Utility works" })).toBeVisible();
    await expect(dialog(page)).toContainText(NOTICE_ID);
    expect(await selectedFeatures(page)).toEqual({
      Point: 1,
      LineString: A12_NOTICE.openLines.length + A12_NOTICE.closedLines.length,
    });
    expect(errors).toEqual([]);
  });

  test("a recording draws the notice's plate as plain text, and a click on its street opens nothing", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(`${A12}&record=1`);
    await ready(page);

    await expect(page.getByRole("button", { name: /road notice details/ })).toHaveCount(0);
    await expect(page.locator('[data-kind="road"]').filter({ hasText: "Utility works" }).first()).toBeVisible();
    const v = await vertexOnCanvas(page);
    await page.mouse.click(v.x, v.y);
    await expect(dialog(page)).toHaveCount(0);
    expect(await selectedFeatures(page)).toEqual({});
    expect(errors).toEqual([]);
  });

  test("opening a panel closes the control hint, and the ? brings it back and closes the panel", async ({ page }) => {
    const feed = await feeds(page);
    await openWithPlaneAside(page, feed);
    await hintCase(page);
    expect(feed.errors).toEqual([]);
  });

  test("the same crowd gets two plates on a wide screen, as before", async ({ page }) => {
    const feed = await feeds(page);
    await openWithCrowd(page, feed, 420);
    await expect(page.locator('div[data-kind="road"] [class*="tagPlate"]')).toHaveCount(2);
    const shown = await platesOnScreen(page);
    expect(shown.overlaps).toBe(0);
    expect(feed.errors).toEqual([]);
  });

  test("a screenshot of the panel on the A12", async ({ page }) => {
    await feeds(page);
    await page.goto(A12);
    await ready(page);
    await roadPlate(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(__dirname, "../../persona-shots/eye-works-click-desktop.png") });
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the panel is a bottom sheet that fits the screen, with a thumb-sized Close", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(A12);
    await ready(page);

    await roadPlate(page).tap();
    const sheet = dialog(page);
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.y).toBeGreaterThan(844 * 0.3);
    const close = (await closeBtn(page).boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await closeBtn(page).tap();
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a tap on the street opens it, with a thumb's reach", async ({ page }) => {
    const { errors } = await feeds(page);
    await page.goto(A12);
    await ready(page);
    const v = await vertexOnCanvas(page);
    // 20 px off the line is inside the phone's 24 px reach and outside a pointer's 18 px.
    await page.touchscreen.tap(v.x, v.y);
    await expect(dialog(page)).toContainText(NOTICE_ID);
    expect(errors).toEqual([]);
  });

  test("opening a panel closes the control hint, and the ? brings it back and closes the panel", async ({ page }) => {
    const feed = await feeds(page);
    await openWithPlaneAside(page, feed);
    await hintCase(page);
    expect(feed.errors).toEqual([]);
  });

  test("a crowd of notices gets up to four plates, never overlapping, and the rest stay tappable", async ({ page }) => {
    const feed = await feeds(page);
    const spots = await openWithCrowd(page, feed, 60);

    // Six notices, a cap of four: four plates, clear of each other and of the frame's words.
    await expect(page.locator('div[data-kind="road"] [class*="tagPlate"]')).toHaveCount(4);
    const shown = await platesOnScreen(page);
    expect(shown.overlaps).toBe(0);
    expect(shown.inside).toBe(true);
    for (const t of shown.titles) expect(CROWD_TITLES).toContain(t);
    expect(new Set(shown.titles).size).toBe(4);
    // The ledger counts what has a plate, as it does for every kind.
    await expect(page.locator('section[aria-label="What this view shows"] p[data-k="road"] b')).toHaveText("4");

    // A notice with no plate is still a ring you can tap.
    const bare = spots.find((s) => !shown.titles.includes(s.title))!;
    await page.touchscreen.tap(bare.x, bare.y);
    await expect(page.getByRole("dialog", { name: bare.title })).toBeVisible();
    expect(feed.errors).toEqual([]);
  });

  test("a screenshot of the sheet on the A12", async ({ page }) => {
    await feeds(page);
    await page.goto(A12);
    await ready(page);
    await roadPlate(page).tap();
    await expect(dialog(page)).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(__dirname, "../../persona-shots/eye-works-click-phone.png") });
  });
});

/**
 * The hint rule, at either width: the hint is up on arrival; opening a road notice closes it
 * (and the "?" reads "collapsed"); the "?" brings it back and closes the panel, with focus on
 * the "?"; and an aircraft's panel closes it again.
 */
async function hintCase(page: Page) {
  const toggle = page.locator("[data-hint-toggle]");
  await expect(hintPlate(page)).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await roadPlate(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(hintPlate(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Switching marks while the panel is open keeps the hint closed; closing the panel does not bring it back.
  await closeBtn(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(hintPlate(page)).toHaveCount(0);
  await roadPlate(page).click();
  await expect(dialog(page)).toBeVisible();

  await hintToggle(page).click();
  await expect(hintPlate(page)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();

  // An aircraft's panel closes the hint again.
  await page.getByRole("button", { name: /aircraft details/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(hintPlate(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}
