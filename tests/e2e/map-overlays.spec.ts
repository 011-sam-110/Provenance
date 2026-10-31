import { expect, test, type Locator, type Page } from "@playwright/test";
import type maplibregl from "maplibre-gl";

/**
 * The console map's overlays (/app), measured in a real browser: a HUD that is always
 * solid, the compass above the i, an i that stays put and can be read in the dark skin,
 * a Marks key that folds to a chip, and a Streets map that takes only the free width.
 *
 *   - HUD: opacity 1, no corner brackets, no Opacity slider, an old stored opacity dropped.
 *   - Compass: 30px, 8px above the i (14px on a phone), the needle turns with the map, a
 *     click faces north and keeps the tilt, reduced motion makes it instant, and God's
 *     eye view has none.
 *   - The i: its button is its circle, it does not move when it opens, no blue glow after
 *     a click, an outline for the keyboard, a readable mark and credit in the dark skin.
 *   - Marks: folds to a one-line chip, remembered in this browser, below the HUD on a
 *     phone and never over the compass.
 *   - Streets with no tiles is Globe's frame (x50 w1366 at 1440, x10 w370 at 390).
 *
 * Needs the keyless dev server or a production build; it reads no feed. The marks come
 * from switching the layers on in the link (`sig=`), which draws the legend with no data.
 * Writes persona-shots/console-map-overlays-{1440,390}-{light,dark}.png (UI evidence).
 *
 * THE HOOK: `window.__map` (components/WorldMap.tsx). The gate does NOT run this file.
 */

test.describe.configure({ timeout: 120_000 });

const SIGS = "earthquakes,nuclear,internet-outages,weather-warnings,displacement,road-works";
const LINK = `/app?lat=51.5&lon=-0.1&z=6&sig=${SIGS}&layers=&base=light`;
const LEGEND_KEY = "tn.map.legend.v1";

type Skin = "light" | "dark";
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "390", width: 390, height: 844, phone: true },
] as const;

/** Stamp what would otherwise cover the map: the boot plate and the two corner notes. */
async function seed(page: Page, skin: Skin, hud: Record<string, unknown> | null = { enabled: true, variant: "full", animate: false }) {
  await page.addInitScript(
    ([skin, hud]) => {
      const env = (d: unknown) => JSON.stringify({ v: 1, d });
      const ls = window.localStorage;
      ls.setItem("tn.terminal.boot.v1", env({ seenVersion: 1 }));
      ls.setItem("tn.feedback.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
      ls.setItem("tn.community.v1", env({ visits: 3, activeMs: 0, resolved: "dismissed" }));
      if (hud) ls.setItem("tn.hud.v1", env(hud));
      if (skin === "dark") ls.setItem("tn.terminal.skin.v2", env("dark"));
    },
    [skin, hud] as const,
  );
}

async function openMap(page: Page, url = LINK) {
  await page.goto(url);
  await expect(page.locator(".tn-compass")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("mark-legend")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map));
}

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box for " + loc);
  return b;
}

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

const compass = (page: Page) => page.locator(".tn-compass");
const iButton = (page: Page) => page.locator(".maplibregl-ctrl-attrib-button");
const iCircle = (page: Page) => page.locator(".maplibregl-ctrl-attrib");
const stage = (page: Page) => page.locator(".tn-cw-stage");

const bearingOf = (page: Page) =>
  page.evaluate(() => {
    const b = (window as unknown as { __map: maplibregl.Map }).__map.getBearing();
    return ((b % 360) + 540) % 360 - 180; // (-180, 180]
  });

// ── the HUD ─────────────────────────────────────────────────────────────────────

test.describe("the HUD is always solid", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opacity 1, no corner brackets, and an old stored opacity is dropped from the saved prefs", async ({ page }) => {
    await seed(page, "light", { enabled: true, variant: "full", animate: false, opacity: 40 });
    await openMap(page);
    const hud = page.locator("[data-tn-hud]");
    await expect(hud).toBeVisible();
    await expect(hud).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-tn-hud] [data-corner]")).toHaveCount(0);

    // hudStore.hydrate() writes once on the first load, and what it writes has no opacity.
    const stored = await page.evaluate(() => window.localStorage.getItem("tn.hud.v1"));
    expect(stored).toBeTruthy();
    expect(stored).not.toContain("opacity");
    expect(JSON.parse(stored as string).d).toEqual({ enabled: true, variant: "full", animate: false });
  });

  test("Settings > HUD has no opacity slider", async ({ page }) => {
    await seed(page, "light");
    await openMap(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".tn-rail")).toBeVisible();
    await page.click("#tn-rail-tab-inspector");
    await page.locator("#inspector-rail").getByRole("button", { name: "Map settings" }).click();
    const tool = page.locator(".tn-insp-tool");
    // The row beside the removed one is there, so the section did render.
    await expect(tool.getByRole("switch", { name: "Split-flap animation" })).toBeVisible();
    await expect(tool.getByRole("slider", { name: "HUD opacity" })).toHaveCount(0);
    await expect(tool.getByText("Opacity", { exact: true })).toHaveCount(0);
  });
});

// ── the compass, the i and the Marks key, Globe, in both widths and both skins ──

for (const vp of VIEWPORTS) {
  for (const skin of ["light", "dark"] as Skin[]) {
    test.describe(`Globe, ${vp.name}px, ${skin}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      test.beforeEach(async ({ page }) => {
        await seed(page, skin);
        await openMap(page);
      });

      test("the compass sits right above the i, the corner clears the clock, and the needle turns with the map", async ({ page }) => {
        const [c, i, s] = [await box(compass(page)), await box(iButton(page)), await box(stage(page))];
        expect([c.width, c.height]).toEqual([30, 30]);
        expect([i.width, i.height]).toEqual([30, 30]);
        // 8px apart on a desktop, 14px on a phone (their 44px tap areas then touch).
        expect(near(c.y + c.height + (vp.phone ? 14 : 8), i.y)).toBe(true);
        expect(near(c.x + c.width / 2, i.x + i.width / 2)).toBe(true);
        // The corner's bottom edge: 46px above the map's bottom until the clock block sets
        // --tnx-stage-foot-clear, 10px on a phone (no clock).
        expect(near(s.y + s.height - (i.y + i.height), vp.phone ? 10 : 46, 1)).toBe(true);
        // Both fully inside the window.
        for (const b of [c, i]) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
          expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
        }
        await expect(page.locator(".maplibregl-ctrl-group")).toHaveCount(0);

        await page.evaluate(() => (window as unknown as { __map: maplibregl.Map }).__map.setBearing(250));
        await expect
          .poll(() => page.evaluate(() => document.querySelector<SVGElement>(".tn-compass svg")?.style.getPropertyValue("--tn-compass-turn")))
          .toBe("110deg");
      });

      test("the i's button is its circle, and it does not move when it opens", async ({ page }) => {
        const circle0 = await box(iCircle(page));
        const btn0 = await box(iButton(page));
        for (const k of ["x", "y", "width", "height"] as const) expect(near(btn0[k], circle0[k])).toBe(true);

        await iButton(page).click();
        await expect(iCircle(page)).toHaveClass(/maplibregl-compact-show/);
        const btn1 = await box(iButton(page));
        for (const k of ["x", "y", "width", "height"] as const) expect(near(btn1[k], btn0[k]), `button ${k}`).toBe(true);

        // A one-line credit is as tall as the button, and the pill holds it. (On a phone
        // the credit wraps, so only the floor and the containment are asserted there.)
        const pill = await box(iCircle(page));
        if (!vp.phone) expect(near(pill.height, 30)).toBe(true);
        else expect(pill.height).toBeGreaterThanOrEqual(29.5);
        expect(btn1.x).toBeGreaterThanOrEqual(pill.x - 0.5);
        expect(btn1.x + btn1.width).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
        expect(btn1.y).toBeGreaterThanOrEqual(pill.y - 0.5);
        expect(btn1.y + btn1.height).toBeLessThanOrEqual(pill.y + pill.height + 0.5);

        // No blue glow after a mouse click.
        await expect(iButton(page)).toHaveCSS("box-shadow", "none");

        // The credit is readable in both skins: its text is --tnx-ink-faint, never maplibre's black.
        const faint = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--tnx-ink-faint)";
          document.querySelector(".tn-terminal")?.appendChild(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        });
        await expect(iCircle(page)).toHaveCSS("color", faint);
        // (The satellite credit is plain text; a basemap that links its credit gets the same ink.)
        const link = iCircle(page).locator("a").first();
        if ((await link.count()) > 0) await expect(link).toHaveCSS("color", faint);
        if (skin === "dark") {
          const bg = await iButton(page).evaluate((el) => getComputedStyle(el).backgroundImage);
          expect(bg).toContain("c9d1a6");
        }

        // The corner alone, with the credit open: compass, i and pill.
        await page.mouse.move(5, 5);
        const c = await box(compass(page));
        const x = Math.max(0, pill.x - 24);
        const y = Math.max(0, c.y - 24);
        await page.screenshot({
          path: `persona-shots/console-map-overlays-${vp.name}-${skin}-i-open.png`,
          clip: { x, y, width: Math.min(vp.width - x, 520), height: Math.min(vp.height - y, pill.y + pill.height - c.y + 48) },
        });
      });

      test("keyboard focus rings the i with an outline, not a glow", async ({ page }) => {
        await compass(page).focus();
        await page.keyboard.press("Tab");
        await expect(iButton(page)).toBeFocused();
        await expect(iButton(page)).toHaveCSS("outline-style", "solid");
        await expect(iButton(page)).toHaveCSS("outline-width", "2px");
        await expect(iButton(page)).toHaveCSS("box-shadow", "none");
      });

      test("the key sits clear of the HUD and the compass, and the evidence shot is written", async ({ page }) => {
        const key = page.getByTestId("mark-legend");
        const [k, h, c, s] = [await box(key), await box(page.locator("[data-tn-hud]")), await box(compass(page)), await box(stage(page))];
        expect(k.y + k.height).toBeLessThanOrEqual(c.y - 8 + 0.5);
        if (vp.phone) {
          // The HUD and the key share the width: the key drops below the HUD.
          expect(k.y).toBeGreaterThanOrEqual(h.y + h.height + 8 - 0.5);
          // …and it scrolls inside when it runs out of map.
          expect(await key.locator(".tn-markkey-body").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
          await expect(key).toHaveAttribute("data-scroll", "");
        } else {
          expect(near(k.y, s.y + 10)).toBe(true);
          expect(near(k.x + k.width, s.x + s.width - 10)).toBe(true);
        }
        // A shot with "The map couldn't start in this browser" over it is not evidence (a busy
        // machine can lose the WebGL context): fail here rather than write it.
        await expect(page.getByText(/The map couldn.t start/)).toHaveCount(0);
        // Turned, so the shot shows the needle following the map.
        await page.evaluate(() => (window as unknown as { __map: maplibregl.Map }).__map.setBearing(250));
        await page.waitForTimeout(600);
        await page.mouse.move(5, 5);
        await page.screenshot({ path: `persona-shots/console-map-overlays-${vp.name}-${skin}.png` });
      });
    });
  }
}

// ── the compass, pressed ────────────────────────────────────────────────────────

test.describe("the compass faces north", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a click turns to north and keeps the tilt", async ({ page }) => {
    await seed(page, "light");
    await openMap(page);
    await page.evaluate(() => {
      const map = (window as unknown as { __map: maplibregl.Map }).__map;
      map.setPitch(40);
      map.setBearing(250);
    });
    await expect.poll(() => bearingOf(page)).toBeCloseTo(-110, 0);
    await compass(page).click();
    await page.waitForTimeout(900);
    expect(Math.abs(await bearingOf(page))).toBeLessThanOrEqual(0.5);
    const pitch = await page.evaluate(() => (window as unknown as { __map: maplibregl.Map }).__map.getPitch());
    expect(near(pitch, 40)).toBe(true);
  });

  test("under reduced motion the turn is instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, "light");
    await openMap(page);
    await page.evaluate(() => (window as unknown as { __map: maplibregl.Map }).__map.setBearing(250));
    await expect.poll(() => bearingOf(page)).toBeCloseTo(-110, 0);
    await compass(page).click();
    await page.waitForTimeout(100);
    expect(Math.abs(await bearingOf(page))).toBeLessThanOrEqual(0.5);
  });

  test("a page outside the console's skin (the HUD demo) gets none either: its styles are not there", async ({ page }) => {
    await seed(page, "light", null);
    await page.goto("/demo-hud");
    await expect(page.locator(".maplibregl-ctrl-attrib-button")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".tn-compass")).toHaveCount(0);
  });

  test("God's eye view has no compass of its own: it has its Turn controls", async ({ page }) => {
    await seed(page, "light", null);
    await page.goto("/eye?place=westminster");
    // Ready: the map is mounted and its controls are in (eye.spec.ts waits on the same state).
    await page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(1);
    await expect(page.locator(".tn-compass")).toHaveCount(0);
  });
});

// ── the Marks key ───────────────────────────────────────────────────────────────

test.describe("the Marks key folds to a chip", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("open on a fresh browser, folds to one line, is remembered, and opens again", async ({ page }) => {
    await seed(page, "light");
    await openMap(page);
    const key = page.getByTestId("mark-legend");
    const toggle = key.getByRole("button", { name: "Marks" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(key.locator("li").first()).toBeVisible();
    // Looking at the key is not a choice: nothing is stored yet.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), LEGEND_KEY)).toBeNull();

    const open = await box(key);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(key.locator("li").first()).toBeHidden();
    const chip = await box(key);
    expect(chip.height).toBeLessThanOrEqual(32);
    // The chip's right edge does not move, folded or open.
    expect(near(chip.x + chip.width, open.x + open.width)).toBe(true);
    expect(near(chip.y, open.y)).toBe(true);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), LEGEND_KEY)).toBe('{"v":1,"d":true}');

    await page.reload();
    await expect(page.getByTestId("mark-legend")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("mark-legend").getByRole("button", { name: "Marks" })).toHaveAttribute("aria-expanded", "false");

    await page.getByTestId("mark-legend").getByRole("button", { name: "Marks" }).click();
    await expect(page.getByTestId("mark-legend").getByRole("button", { name: "Marks" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("mark-legend").locator("li").first()).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the chip below the HUD has a 44px tap area, and so do the compass and the i", async ({ page }) => {
    await seed(page, "light");
    await openMap(page);
    const key = page.getByTestId("mark-legend");
    const toggle = key.getByRole("button", { name: "Marks" });
    const t = await box(toggle);
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    for (const dy of [-20, 20]) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.className, [cx, cy + dy]);
      expect(hit, `${dy}px from the title's centre`).toBe("tn-markkey-toggle");
    }

    const [c, i] = [await box(compass(page)), await box(iButton(page))];
    const mid = (c.y + c.height / 2 + i.y + i.height / 2) / 2;
    const x = c.x + c.width / 2;
    // The i is MapLibre's <summary>, the compass our <button>.
    const at = (y: number) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("button, summary")?.className, [x, y]);
    expect(await at(mid - 1)).toBe("tn-compass");
    expect(await at(mid + 1)).toContain("maplibregl-ctrl-attrib-button");
    expect(await at(c.y + c.height / 2 - 20)).toBe("tn-compass");
    expect(await at(i.y + i.height / 2 + 20)).toContain("maplibregl-ctrl-attrib-button");
  });
});

// ── Streets ─────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`Streets with no tiles, ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the map takes Globe's frame, nothing runs off the screen, and the stage is never remounted", async ({ page }) => {
      await seed(page, "light");
      await page.goto("/app");
      await expect(page.locator(".tn-compass")).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "GLOBE board" }).click();
      await expect(stage(page)).toBeVisible();
      const globe = await box(stage(page));
      const mounts = () => page.evaluate(() => (window as unknown as { __tnStageMounts?: number }).__tnStageMounts);
      // One mount in a build; `next dev` runs every effect twice (StrictMode), so the count
      // is read here and must not move from now on.
      const mounted = await mounts();
      expect([1, 2]).toContain(mounted);

      await page.getByRole("button", { name: "STREETS board" }).click();
      await expect
        .poll(async () => (await box(stage(page))).width, { timeout: 15_000 })
        .toBeGreaterThan(300);
      // Settle: the grid moves the stage between columns, with no animation on its size.
      await page.waitForTimeout(800);
      const streets = await box(stage(page));
      for (const k of ["x", "y", "width", "height"] as const) expect(near(streets[k], globe[k], 1), `stage ${k}`).toBe(true);
      expect(streets.x + streets.width).toBeLessThanOrEqual(vp.width);
      if (!vp.phone) expect([Math.round(streets.x), Math.round(streets.width)]).toEqual([50, 1366]);
      else expect([Math.round(streets.x), Math.round(streets.width)]).toEqual([10, 370]);

      // The compass and the i are fully inside the window, and nothing scrolls sideways.
      for (const b of [await box(compass(page)), await box(iButton(page))]) {
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
        expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
      expect(await mounts()).toBe(mounted);

      await page.getByRole("button", { name: "GLOBE board" }).click();
      await page.waitForTimeout(500);
      expect(await mounts()).toBe(mounted);
    });
  });
}
