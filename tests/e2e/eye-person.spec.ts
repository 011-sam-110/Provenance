import { expect, test, type Locator, type Page } from "@playwright/test";
import type maplibregl from "maplibre-gl";

/**
 * The person on the console's map (components/console/EyePerson.tsx), driven by real pointer
 * events on the real map.
 *
 *   - It stands directly above the i, in line with it, does not jump when the credit opens,
 *     and does not cover the credit's words. A control added later lands above it (PR #339's
 *     compass does exactly this).
 *   - A drag: the figure follows the pointer, larger and tilted; a ring marks the point; a drop
 *     opens /eye at the place under the ring, within one pixel's distance of `map.unproject`.
 *   - It cancels on Escape (one press, and the selection and an open tool stay), off the map,
 *     and in the space off the globe, where `unproject` answers with a real-looking place.
 *   - A tap, Enter and Space open the centre of the map.
 *   - It hides on Streets and on an expanded widget. The old chip and Map settings' section
 *     are gone, and an old link with `eye=` still opens the console with no error.
 *   - A finger: the ring stands clear above it, and neither the page nor the map moves.
 *   - Reduced motion: no tilt and no spring, and it still works.
 *
 * THE HOOKS: `window.__map` (WorldMap's debug handle), `[data-eye-person-layer]` and
 * `[data-eye-person-ring]` while carrying, `main[data-eye-state="ready"]` on /eye. The stores
 * that would cover the map (the boot plate and the two corner notes) are stamped first.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 * Set EYE_PERSON_SHOTS=<dir> to keep a screenshot of each state.
 */

// Each journey can load two map pages; a cold dev server takes most of the default 30 s.
test.describe.configure({ timeout: 120_000 });

const NAME = "Open God's eye view at the centre of the map";
const DROP = "Drop to open God's eye view";
const OFF = "Not on the map. Let go to cancel";

const SHOTS = process.env.EYE_PERSON_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 70 });
};

type Skin = "light" | "dark";
type Pt = { x: number; y: number };
type Win = Window & { __map: maplibregl.Map };

const person = (page: Page) => page.getByRole("button", { name: NAME });
const layer = (page: Page) => page.locator("[data-eye-person-layer]");
const ring = (page: Page) => page.locator("[data-eye-person-ring]");
const iButton = (page: Page) => page.locator(".maplibregl-ctrl-attrib-button");
/** The i as it is drawn. On main its button sits 1 px off this circle; PR #339 lines them up. */
const iCircle = (page: Page) => page.locator(".maplibregl-ctrl-attrib");

async function seed(page: Page, skin: Skin = "dark") {
  await page.addInitScript((s) => {
    const env = (d: unknown) => JSON.stringify({ v: 1, d });
    const ls = window.localStorage;
    ls.setItem("tn.terminal.boot.v1", env({ seenVersion: 1 }));
    ls.setItem("tn.feedback.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
    ls.setItem("tn.community.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
    ls.setItem("tn.terminal.skin.v2", env(s));
  }, skin);
}

/** Open the console, with the person up and the map in its final projection. */
async function openMap(page: Page, url: string, projection: "globe" | "mercator" | null = "globe") {
  await page.goto(url);
  await expect(person(page)).toBeVisible({ timeout: 90_000 });
  if (!projection) return;
  await page.waitForFunction(
    (want) => (window as unknown as Win).__map?.getProjection?.()?.type === want,
    projection,
    { timeout: 90_000 },
  );
}

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${loc}`);
  return b;
}

const centre = (b: { x: number; y: number; width: number; height: number }): Pt => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** Where a place is on screen, in window px. */
const windowPoint = (page: Page, lng: number, lat: number): Promise<Pt> =>
  page.evaluate(
    ([lng, lat]) => {
      const m = (window as unknown as Win).__map;
      const r = m.getContainer().getBoundingClientRect();
      const p = m.project([lng, lat]);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [lng, lat],
  );

/** What the map says is under a window point, and how far one pixel reaches there. */
const underPoint = (page: Page, at: Pt) =>
  page.evaluate(({ x, y }) => {
    const m = (window as unknown as Win).__map;
    const r = m.getContainer().getBoundingClientRect();
    const px = x - r.left;
    const py = y - r.top;
    const u = m.unproject([px, py]);
    const dx = m.unproject([px + 1, py]);
    const dy = m.unproject([px, py + 1]);
    const back = m.project(u);
    return {
      lat: u.lat,
      lon: u.lng,
      perPixel: Math.max(Math.abs(dx.lat - u.lat), Math.abs(dx.lng - u.lng), Math.abs(dy.lat - u.lat), Math.abs(dy.lng - u.lng)),
      roundTrip: Math.hypot(back.x - px, back.y - py),
    };
  }, at);

const mapCentre = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as Win).__map;
    const c = m.getCenter();
    return { lat: c.lat, lon: c.lng, zoom: m.getZoom(), bearing: m.getBearing() };
  });

const eyeQuery = (page: Page) => new URL(page.url()).searchParams;

/** Press on the person and move to a window point, with real mouse events. */
async function carryTo(page: Page, to: Pt) {
  const from = centre(await box(person(page)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(ring(page)).toBeVisible();
  // One frame for the last move's write.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function expectAtHome(page: Page) {
  await expect(layer(page)).toHaveCount(0);
  await expect(person(page)).toHaveAttribute("data-state", "idle");
  expect(new URL(page.url()).pathname).toBe("/app");
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

const PARIS = { lng: 2.3522, lat: 48.8566 };
const AT_PARIS = "/app?lat=48&lon=2&z=4&layers=&base=light";

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const skin of ["dark", "light"] as Skin[]) {
    test(`${skin}: directly above the i, in line, and the credit moves neither it nor its words under it`, async ({ page }) => {
      await seed(page, skin);
      await openMap(page, "/app?lat=20&lon=-20&z=2.3&layers=&base=satellite");
      const before = await box(person(page));
      const i = await box(iCircle(page));
      expect([before.width, before.height]).toEqual([36, 36]);
      expect(Math.abs(centre(before).x - centre(i).x)).toBeLessThanOrEqual(0.5);
      expect(i.y - (before.y + before.height)).toBeCloseTo(8, 0);
      await shot(page, `1440-${skin}-rest`);

      await iButton(page).click();
      await expect(page.locator(".maplibregl-compact-show")).toHaveCount(1);
      await page.waitForFunction(() => {
        const inner = document.querySelector(".maplibregl-ctrl-attrib-inner");
        return Boolean(inner && inner.textContent && inner.textContent.length > 0);
      });
      expect(await box(person(page))).toEqual(before);

      // Every line of the open credit, as drawn, stays clear of the person.
      const lines = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        const overlaps = l.left < before.x + before.width && before.x < l.right && l.top < before.y + before.height && before.y < l.bottom;
        expect(overlaps, JSON.stringify(l)).toBe(false);
      }
      await shot(page, `1440-${skin}-credit-open`);

      await iButton(page).click();
      await expect(page.locator(".maplibregl-compact-show")).toHaveCount(0);
      expect(await box(person(page))).toEqual(before);
    });
  }

  test("a control added to the corner later lands above the person, and the person stays above the i", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    const before = await box(person(page));
    // What PR #339's compass does: a `.maplibregl-ctrl` through map.addControl, 8 px up.
    await page.evaluate(() => {
      const div = document.createElement("div");
      div.className = "maplibregl-ctrl";
      div.id = "late-control";
      div.style.cssText = "width:30px;height:30px;margin:0 0 8px 0;background:#888;border-radius:50%";
      (window as unknown as Win).__map.addControl({ onAdd: () => div, onRemove: () => div.remove() }, "bottom-right");
    });
    const late = await box(page.locator("#late-control"));
    expect(await box(person(page))).toEqual(before);
    expect(late.y + late.height + 8).toBeCloseTo(before.y, 0);
    expect(Math.abs(centre(late).x - centre(before).x)).toBeLessThanOrEqual(0.5);
    // In the corner's stack: the late control, the person's slot, the credit.
    const order = await page.locator(".maplibregl-ctrl-bottom-right > *").evaluateAll((els) =>
      els.map((el) => (el.id === "late-control" ? "late" : el.hasAttribute("data-eye-person-slot") ? "slot" : el.classList.contains("maplibregl-ctrl-attrib") ? "credit" : "?")),
    );
    expect(order).toEqual(["late", "slot", "credit"]);
  });

  for (const skin of ["dark", "light"] as Skin[]) {
    test(`${skin}: a drop opens God's eye view at the place under the ring, with the map's bearing`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await seed(page, skin);
      await openMap(page, AT_PARIS);
      await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ bearing: 40 }));
      const to = await windowPoint(page, PARIS.lng, PARIS.lat);
      const homeBefore = await box(person(page));

      await carryTo(page, to);
      // The ring is on the point, and the words say what a release does.
      const r = centre(await box(ring(page)));
      expect(Math.abs(r.x - to.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.y - to.y)).toBeLessThanOrEqual(1);
      await expect(layer(page)).toContainText(DROP);
      // Its place shows it dimmed, and it has not moved.
      expect(await box(person(page))).toEqual(homeBefore);
      const dim = await page.locator("[data-eye-person] svg").evaluate((el) => Number(getComputedStyle(el).opacity));
      expect(dim).toBeLessThan(0.6);
      // Larger and tilted, with a shadow.
      const carried = await page.locator("[data-eye-person-layer] svg").evaluate((el) => {
        const parent = el.parentElement as HTMLElement;
        const s = getComputedStyle(parent);
        return { width: el.getBoundingClientRect().width, transform: s.transform, filter: s.filter };
      });
      expect(carried.width).toBeGreaterThan(40);
      expect(carried.transform).not.toBe("none");
      expect(carried.filter).toContain("drop-shadow");
      await shot(page, `1440-${skin}-carry`);

      const under = await underPoint(page, to);
      expect(under.roundTrip).toBeLessThan(1);
      expect(Math.abs(under.lat - PARIS.lat)).toBeLessThan(under.perPixel * 2);
      await page.mouse.up();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });

      const q = eyeQuery(page);
      expect(Math.abs(Number(q.get("lat")) - under.lat)).toBeLessThanOrEqual(under.perPixel);
      expect(Math.abs(Number(q.get("lon")) - under.lon)).toBeLessThanOrEqual(under.perPixel);
      expect(q.get("heading")).toBe("40");
      expect(q.get("z")).toBe("16");
      expect(q.get("tilt")).toBe("55");

      // /eye opens that spot, and its title is the coordinates and no name.
      await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^48\.\d{4}°\sN,\s2\.\d{4}°\sE$/);
      await shot(page, `1440-${skin}-eye-city`);
      expect(errors).toEqual([]);

      // Back to the console: the person is at rest, not stuck mid-drop.
      await page.goBack();
      await expect(person(page)).toBeVisible({ timeout: 60_000 });
      await expect(person(page)).toHaveAttribute("data-state", "idle");
      await expect(layer(page)).toHaveCount(0);
    });
  }

  test("a drop in mid-ocean reads as honestly as one in a city", async ({ page }) => {
    await seed(page);
    await openMap(page, "/app?lat=35&lon=-40&z=3&layers=&base=light");
    const to = await windowPoint(page, -40, 35);
    await carryTo(page, to);
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^3\d\.\d{4}°\sN,\s[34]\d\.\d{4}°\sW$/);
    // A spot has no area line: the second line starts at the heading.
    await expect(page.locator("header p").first()).toHaveText(/^Heading/);
    await page.waitForTimeout(1500);
    await shot(page, "1440-dark-eye-ocean");
  });

  test("a release at the far zoom and at a close zoom both open a city view", async ({ page }) => {
    await seed(page);
    await openMap(page, "/app?lat=51.5&lon=-0.1&z=17.4&layers=&base=light");
    await page.waitForFunction(() => (window as unknown as Win).__map.getZoom() > 17);
    const stage = await box(page.locator(".tn-cw-stage"));
    await carryTo(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    // Closer than a city already: not thrown back out.
    expect(Number(eyeQuery(page).get("z"))).toBeCloseTo(17.4, 1);
  });

  test("Escape cancels with one press, and the selection and the panel stay", async ({ page }) => {
    await page.addInitScript(() => {
      if (window.localStorage.getItem("tn.inspector.v1")) return;
      window.localStorage.setItem(
        "tn.inspector.v1",
        JSON.stringify({
          v: 1,
          d: { world: {}, editing: null, areas: [{ id: "area:1", label: "West Pacific", polygon: [[90, -60], [180, -60], [180, 70], [90, 70]], bbox: [90, -60, 180, 70], createdAt: 1, sources: { earthquakes: true } }] },
        }),
      );
    });
    await seed(page);
    await openMap(page, AT_PARIS);
    // A selection (the area's own row, as tests/e2e/inspector-rail.spec.ts does it).
    await page.keyboard.press("ControlOrMeta+k");
    await page.click("#tn-rail-tab-inspector");
    await page.click("#inspector-rail .tn-insp-rail-btn-draw");
    await page.click(".tn-insp-row");
    const dossier = page.locator(".tn-inspector[role=dialog]");
    await expect(dossier).toHaveCount(1);

    const stage = await box(page.locator(".tn-cw-stage"));
    await carryTo(page, { x: stage.x + stage.width * 0.6, y: stage.y + stage.height * 0.4 });
    await expect(person(page)).toHaveAttribute("data-owns-escape", "");
    await page.keyboard.press("Escape");
    await expect(layer(page)).toHaveCount(0, { timeout: 2000 });
    await expect(person(page)).not.toHaveAttribute("data-owns-escape", "");
    await expect(dossier).toHaveCount(1);

    // A later release opens nothing, even over the map or back on the button.
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expectAtHome(page);
  });

  test("a release on the person's own place, or off the map, opens nothing and it goes home", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    const header = await box(page.locator(".tnx-hdr"));
    await carryTo(page, { x: header.x + header.width / 2, y: header.y + header.height / 2 });
    await expect(layer(page)).toContainText(OFF);
    await expect(layer(page)).toHaveAttribute("data-on", "false");
    await shot(page, "1440-dark-off-map");
    await page.mouse.up();
    await expect(layer(page)).toHaveCount(0, { timeout: 2000 });
    await expectAtHome(page);

    // Out and back onto its own button: a drag that went nowhere, and not a tap.
    const home = centre(await box(person(page)));
    await carryTo(page, { x: home.x - 120, y: home.y - 120 });
    await page.mouse.move(home.x, home.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expectAtHome(page);
  });

  test("a release in the space off the globe opens nothing, where unproject names a real-looking place", async ({ page }) => {
    await seed(page);
    await openMap(page, "/app?lat=20&lon=10&z=0.6&layers=&base=light");
    const stage = await box(page.locator(".tn-cw-stage"));
    // The map's corner, far off the disc at this zoom. Clear of the panels on the left.
    const space = { x: stage.x + stage.width - 60, y: stage.y + 60 };

    const under = await underPoint(page, space);
    // The trap is real: a finite place, on the far side of nothing.
    expect(Number.isFinite(under.lat)).toBe(true);
    expect(Number.isFinite(under.lon)).toBe(true);
    expect(under.roundTrip).toBeGreaterThan(50);

    await carryTo(page, space);
    await expect(layer(page)).toHaveAttribute("data-on", "false");
    await expect(layer(page)).toContainText(OFF);
    await shot(page, "1440-dark-off-globe");
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expectAtHome(page);
    await expect(person(page)).toBeVisible();

    // Walking out from the middle of the disc: exact on it, and off by the distance past it.
    const walk = await page.evaluate(() => {
      const m = (window as unknown as Win).__map;
      const c = m.project(m.getCenter());
      const out: Array<[number, number]> = [];
      for (let r = 0; r < 700; r += 2) {
        const q = m.project(m.unproject([c.x + r, c.y]));
        out.push([r, Math.hypot(q.x - (c.x + r), q.y - c.y)]);
      }
      return out;
    });
    const edge = walk.findIndex(([, off]) => off > 3);
    expect(edge).toBeGreaterThan(10);
    const worstOn = Math.max(...walk.slice(0, edge - 3).map(([, off]) => off));
    console.log(`globe: disc edge at r=${walk[edge][0]} px, worst round trip on the disc ${worstOn.toFixed(4)} px`);
    expect(worstOn).toBeLessThan(1);
    // Past the edge the error grows with the distance, so nothing further out comes back in.
    expect(walk.slice(edge).every(([, off]) => off > 3)).toBe(true);

    // The same pointer on the disc does open.
    const on = await windowPoint(page, 10, 20);
    await carryTo(page, on);
    await expect(layer(page)).toHaveAttribute("data-on", "true");
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
  });

  /** Switch to the flat map the way a visitor does, and shut the rail again. */
  async function goFlat(page: Page, also?: () => Promise<void>) {
    await page.keyboard.press("ControlOrMeta+k");
    await page.click("#tn-rail-tab-inspector");
    await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
    const tool = page.locator(".tn-insp-tool");
    await tool.getByRole("radiogroup", { name: "Projection" }).getByRole("radio", { name: "2D" }).click();
    await page.waitForFunction(() => (window as unknown as Win).__map.getProjection()?.type === "mercator");
    if (also) await also();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".tn-rail")).toHaveCount(0);
  }

  /** The largest round trip at a grid of points clear of the frame's edges, in px. */
  const worstRoundTrip = (page: Page) =>
    page.evaluate(() => {
      const m = (window as unknown as Win).__map;
      const c = m.getContainer();
      let worst = 0;
      for (let i = 1; i < 8; i++) {
        for (let j = 1; j < 8; j++) {
          const p: [number, number] = [(c.clientWidth * i) / 8, (c.clientHeight * j) / 8];
          const q = m.project(m.unproject(p));
          worst = Math.max(worst, Math.hypot(q.x - p[0], q.y - p[1]));
        }
      }
      return worst;
    });

  test("a flat map: a drop opens the place under the ring", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    await goFlat(page);
    await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ center: [2, 48], zoom: 5 }));
    const to = await windowPoint(page, PARIS.lng, PARIS.lat);
    expect(await worstRoundTrip(page)).toBeLessThan(1);
    await carryTo(page, to);
    await expect(layer(page)).toHaveAttribute("data-on", "true");
    const under = await underPoint(page, to);
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    const q = eyeQuery(page);
    expect(Math.abs(Number(q.get("lat")) - under.lat)).toBeLessThanOrEqual(under.perPixel);
    expect(Math.abs(Number(q.get("lon")) - under.lon)).toBeLessThanOrEqual(under.perPixel);
  });

  test("with terrain on, a point on the map still counts as on the map", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    await goFlat(page, async () => {
      await page.locator(".tn-insp-tool").getByRole("switch", { name: "Terrain" }).click();
    });
    // The Alps, close enough for the terrain to be attached, tilted so the relief counts.
    await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ center: [8.0, 46.5], zoom: 10, pitch: 55 }));
    await page.waitForFunction(() => Boolean((window as unknown as Win).__map.getTerrain()), null, { timeout: 30_000 });
    await page.waitForFunction(() => (window as unknown as Win).__map.areTilesLoaded(), null, { timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const worst = await worstRoundTrip(page);
    console.log(`terrain: worst round trip ${worst.toFixed(3)} px`);
    const stage = await box(page.locator(".tn-cw-stage"));
    await carryTo(page, { x: stage.x + stage.width * 0.5, y: stage.y + stage.height * 0.55 });
    await expect(layer(page)).toHaveAttribute("data-on", "true");
    await page.keyboard.press("Escape");
    await expect(layer(page)).toHaveCount(0, { timeout: 2000 });
  });

  for (const how of ["tap", "wobble", "Enter", "Space"] as const) {
    test(`${how} opens God's eye view at the centre of the map`, async ({ page }) => {
      await seed(page);
      await openMap(page, "/app?lat=40.7&lon=-74&z=5&layers=&base=light");
      await page.evaluate(() => (window as unknown as Win).__map.jumpTo({ bearing: -30 }));
      const c = await mapCentre(page);
      if (how === "tap") {
        await person(page).click();
      } else if (how === "wobble") {
        // Under the threshold, so it is still a tap.
        const at = centre(await box(person(page)));
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + 3, at.y + 2);
        await page.mouse.up();
      } else {
        await person(page).focus();
        await page.keyboard.press(how);
      }
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      const q = eyeQuery(page);
      expect(Math.abs(Number(q.get("lat")) - c.lat)).toBeLessThan(1e-4);
      expect(Math.abs(Number(q.get("lon")) - c.lon)).toBeLessThan(1e-4);
      expect(q.get("heading")).toBe("330");
      expect(q.get("z")).toBe("16");
    });
  }

  test("the button has a focus ring, a name and a title that says what the drag does", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    await expect(person(page)).toHaveAttribute("title", "Drag onto the map to open God's eye view there");
    // A keyboard focus: Tab into it from the control before it in the tab order.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await person(page).evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    const outline = await person(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await shot(page, "1440-dark-focus");
  });

  test("the old chip and the Map settings section are gone", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    await expect(page.locator(".tn-eye-return")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /back to/i })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await page.click("#tn-rail-tab-inspector");
    await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
    const tool = page.locator(".tn-insp-tool");
    // The tool did render: the row beside the section is there.
    await expect(tool.getByRole("switch", { name: "Buildings" })).toBeVisible();
    await expect(tool.getByText("God's eye view")).toHaveCount(0);
    await expect(tool.getByText("Open this spot")).toHaveCount(0);
    await expect(tool.getByText("Zoom in on a city")).toHaveCount(0);
  });

  for (const [name, eye] of [
    ["a link kept from the old chip", "place%3Dtower-bridge%26lat%3D51.5%26lon%3D-0.08"],
    ["an outside address", "https%3A%2F%2Fevil.example"],
    ["a place that does not exist", "place%3Datlantis"],
  ] as const) {
    test(`${name} in eye= opens the console, with no chip and no error, and leaves the address`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await seed(page);
      await openMap(page, `/app?lat=48&lon=2&z=4&eye=${eye}`);
      await expect.poll(() => new URL(page.url()).searchParams.has("eye")).toBe(false);
      expect(new URL(page.url()).searchParams.get("lat")).not.toBeNull();
      await expect(page.locator(".tn-eye-return")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("sources=open still opens the rail, because the landing page's All sources uses it", async ({ page }) => {
    await seed(page);
    await openMap(page, "/app?lat=48&lon=2&z=4&sources=open");
    await expect(page.locator("aside.tn-rail").first()).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has("sources")).toBe(false);
  });

  test("it stands down on the Streets wall and comes back on the Globe", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    await page.getByRole("button", { name: /STREETS board/ }).click();
    await expect(person(page)).toHaveCount(0);
    await expect(page.locator("[data-eye-person-slot]")).toHaveCount(0);
    await page.getByRole("button", { name: /GLOBE board/ }).click();
    await expect(person(page)).toBeVisible();
  });

  test("it stands down on an expanded widget and comes back with the map", async ({ page }) => {
    await seed(page);
    await openMap(page, "/app?lat=48&lon=2&z=4&preset=news&layers=&base=light", null);
    const expand = page.getByRole("button", { name: /^Expand / }).first();
    await expect(expand).toBeVisible({ timeout: 30_000 });
    await expand.click();
    await expect(page.locator(".tn-detail-back")).toBeVisible();
    await expect(person(page)).toHaveCount(0);
    await page.locator(".tn-detail-back").click();
    await expect(person(page)).toBeVisible({ timeout: 30_000 });
  });

  test("with reduced motion: no tilt, no spring, and it still opens and cancels", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await openMap(page, AT_PARIS);
    const to = await windowPoint(page, PARIS.lng, PARIS.lat);
    await carryTo(page, to);
    const style = await page.locator("[data-eye-person-layer] svg").evaluate((el) => {
      const s = getComputedStyle(el.parentElement as HTMLElement);
      return { transform: s.transform, animation: s.animationName };
    });
    expect(style.transform).toBe("none");
    expect(style.animation).toBe("none");
    // Cancelled, it is simply home.
    await page.keyboard.press("Escape");
    await expect(layer(page)).toHaveCount(0);
    await page.mouse.up();
    await expectAtHome(page);

    await carryTo(page, to);
    await page.mouse.up();
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
  });
});

test.describe("a phone, 390 px, with a finger", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** A real touch, through the browser's input pipeline, so it becomes pointer events. */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", at?: Pt) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] });
    return {
      async drag(from: Pt, to: Pt, steps = 10) {
        await send("touchStart", from);
        await this.move(from, to, steps);
      },
      async move(from: Pt, to: Pt, steps = 10) {
        for (let i = 1; i <= steps; i++) {
          await send("touchMove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
        }
      },
      lift: () => send("touchEnd"),
    };
  }

  for (const skin of ["dark", "light"] as Skin[]) {
    test(`${skin}: a touch drag opens the place under the ring, and neither the page nor the map moves`, async ({ page }) => {
      await seed(page, skin);
      await openMap(page, AT_PARIS);
      const start = await mapCentre(page);
      const home = await box(person(page));

      // In line with the i, above it, and a 44 px target around the 36 px plate.
      const i = await box(iCircle(page));
      expect(Math.abs(centre(home).x - centre(i).x)).toBeLessThanOrEqual(0.5);
      expect(home.y + home.height).toBeLessThanOrEqual(i.y);
      const c = centre(home);
      for (const [dx, dy] of [[-21.5, 0], [21.5, 0], [0, -21.5], [0, 21.5]]) {
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-eye-person]") != null, [c.x + dx, c.y + dy]);
        expect(hit, `${dx},${dy}`).toBe(true);
      }
      await shot(page, `390-${skin}-rest`);

      const stage = await box(page.locator(".tn-cw-stage"));
      const fingerAt = { x: stage.x + stage.width / 2, y: stage.y + stage.height * 0.55 };
      const t = await finger(page);
      await t.drag(c, fingerAt);
      await expect(ring(page)).toBeVisible();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      // The ring is above the finger, so the finger does not hide it, and it is on the map.
      const r = centre(await box(ring(page)));
      expect(Math.abs(r.x - fingerAt.x)).toBeLessThanOrEqual(1);
      expect(fingerAt.y - r.y).toBeGreaterThan(40);
      await expect(layer(page)).toHaveAttribute("data-on", "true");
      await expect(layer(page)).toContainText(DROP);
      // The whole label is on screen, and above the figure, clear of the finger.
      const label = await box(page.locator("[data-eye-person-label]"));
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(390);
      expect(label.y + label.height).toBeLessThanOrEqual(r.y);
      await shot(page, `390-${skin}-carry`);

      // Nothing under the finger moved.
      expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollWidth - window.innerWidth])).toEqual([0, 0, 0]);
      const during = await mapCentre(page);
      expect(during.lat).toBeCloseTo(start.lat, 6);
      expect(during.lon).toBeCloseTo(start.lon, 6);

      const under = await underPoint(page, r);
      await t.lift();
      await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
      const q = eyeQuery(page);
      expect(Math.abs(Number(q.get("lat")) - under.lat)).toBeLessThanOrEqual(under.perPixel * 1.5);
      expect(Math.abs(Number(q.get("lon")) - under.lon)).toBeLessThanOrEqual(under.perPixel * 1.5);
      expect(q.get("z")).toBe("16");
    });
  }

  test("a tap opens the centre of the map, and the label keeps inside the window at its edge", async ({ page }) => {
    await seed(page);
    await openMap(page, AT_PARIS);
    const c = centre(await box(person(page)));
    const t = await finger(page);
    // Close to the right edge, where a centred label would run off.
    await t.drag(c, { x: 380, y: c.y - 200 });
    await expect(ring(page)).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const label = await box(page.locator("[data-eye-person-label]"));
    expect(label.x + label.width).toBeLessThanOrEqual(390);
    expect(label.x).toBeGreaterThanOrEqual(0);
    // Back on its own place: a release there opens nothing.
    await t.move({ x: 380, y: c.y - 200 }, { x: c.x, y: c.y + 72 }, 4);
    await t.lift();
    await page.waitForTimeout(500);
    await expectAtHome(page);

    const before = await mapCentre(page);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForURL(/\/eye\?/, { timeout: 60_000 });
    const q = eyeQuery(page);
    expect(Math.abs(Number(q.get("lat")) - before.lat)).toBeLessThan(1e-4);
    expect(Math.abs(Number(q.get("lon")) - before.lon)).toBeLessThan(1e-4);
  });
});
