import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * God's eye view on a phone held sideways (eye-landscape, 30 Oct 2026; the frame since HUD v2).
 * Under 500 px of height the frame takes the phone's compact sizes and splits in two halves: the
 * menu, the search and the place on the left; the clock and what opens (the hint, the Sources
 * tray, a details panel) on the right. The compass stays low in the middle, and the credits wrap
 * in the room to its right. Portrait phones and desktops are their own cases (the last tests).
 *
 * Each case runs in a touch phone context (hasTouch + isMobile), so the hint is the finger
 * version, as on a real phone. /api/near is answered from a fixture so the title does not depend
 * on TfL; the vessel feeds come from tests/fixtures (as eye-details).
 *
 * THE HOOKS: main[data-eye-state="ready"], `header h1`, the hint (the <aside> "How to move the
 * view"), [data-rail="eye"], [data-eye-search], [data-eye-compass], [data-eye-tray], the dialog,
 * and window.__map (WorldMap's debug handle).
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");
const THAMES = fixture("eye-ais-thames.json");

const SPOT = "/eye?lat=51.5072&lon=-0.1268&z=16&tilt=50&heading=320";
const A406_ID = "tfl:JamCams_00001.09060";
const A406 = "A406 North Circular Rd/Telford Rd/Bounds Green Rd";
const CAM = `/eye?cam=${A406_ID}&lat=51.6112&lon=-0.13544`;

/** The landscape sizes: the task's five, then two real browser viewports (Safari on an
 *  iPhone 15 Pro, Chrome on a Pixel 9), which are shorter than the screens. */
const SIZES = [
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 734, height: 343 },
  { width: 756, height: 308 },
];

type Box = { x: number; y: number; width: number; height: number };
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
/** Area two boxes share, in px². */
const shared = (a: Box, b: Box) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const near = (cams: { id: string; name: string; lat: number; lon: number }[]) =>
  JSON.stringify({
    cameras: cams.map((c) => ({ ...c, available: true, live: false, clip: false, refreshSeconds: 300, attribution: "TfL", km: 0.1 })),
  });

async function phone(browser: Browser, size: { width: number; height: number }, opts: { pins?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route(
    (url) => url.pathname === "/api/near",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: near([
          { id: A406_ID, name: A406, lat: 51.6112, lon: -0.13544 },
          { id: "tfl:JamCams_00001.06514", name: "Trafalgar Square", lat: 51.5077, lon: -0.1277 },
        ]),
      }),
  );
  if (opts.pins) {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tn.eye.sources.v1",
        JSON.stringify({ v: 1, d: { ownOff: [], consoleOn: [], pins: ["ais", "planes", "road-works", "livecams", "road-closures"] } }),
      );
    });
  }
  return { ctx, page };
}

/** The boxes of the frame's parts. Text boxes are the ink (Range rects), not the block. */
async function frame(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el || el.getClientRects().length === 0) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const ink = (el: Element | null) => {
      if (!el || el.getClientRects().length === 0) return [];
      const rg = document.createRange();
      rg.selectNodeContents(el);
      return [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    };
    return {
      menu: box(document.querySelector('[data-rail="eye"] [data-rail-menu]')),
      search: box(document.querySelector("[data-eye-search]")),
      clock: box(document.querySelector('[aria-label="Time now, UTC"]')),
      title: ink(document.querySelector("header h1")),
      compass: box(document.querySelector("[data-eye-compass]")),
      hint: box(document.querySelector('aside[aria-label="How to move the view"]')),
      footer: box(document.querySelector("footer")),
      tray: box(document.querySelector("[data-eye-tray]")),
      dialog: box(document.querySelector('[role="dialog"]:not([data-eye-tray])')),
    };
  });
}

const sumShared = (as: Box[], bs: Box[]) => as.reduce((s, a) => s + bs.reduce((t, b) => t + shared(a, b), 0), 0);

test.describe("a phone held sideways", () => {
  for (const size of SIZES) {
    test(`${size.width} x ${size.height}: a spot, with the hint up, keeps every part clear of the others`, async ({ browser }) => {
      const { ctx, page } = await phone(browser, size);
      try {
        await page.goto(SPOT);
        await ready(page);
        await page.waitForTimeout(2500);
        const f = await frame(page);
        const half = size.width / 2;
        // The menu, up to 900 px wide, is a 44 px button at x 10-54, y 12-56, with the search to its right.
        if (size.width <= 900) {
          expect(f.menu).toMatchObject({ x: 10, y: 12, width: 44, height: 44 });
          expect(f.search!.x).toBeGreaterThanOrEqual(54);
        }
        // The left half: the title ends before the middle, under the search.
        for (const t of f.title) expect(right(t)).toBeLessThanOrEqual(half);
        for (const t of f.title) expect(t.y).toBeGreaterThanOrEqual(bottom(f.search!) - 0.5);
        // The right half: the clock at the far right, the hint under it.
        expect(right(f.clock!)).toBeLessThanOrEqual(size.width);
        expect(f.clock!.x).toBeGreaterThanOrEqual(right(f.search!));
        expect(f.hint, "the hint is up").not.toBeNull();
        expect(f.hint!.y).toBeGreaterThanOrEqual(bottom(f.clock!));
        expect(f.hint!.x).toBeGreaterThanOrEqual(half - 16);
        // Nothing on anything: the title, the hint, the compass and the credits.
        expect(sumShared(f.title, [f.hint!, f.compass!, f.footer!])).toBe(0);
        expect(sumShared([f.compass!], [f.footer!, f.search!, f.clock!])).toBe(0);
        // The compass and the credits stay on the screen.
        expect(f.compass!.x).toBeGreaterThanOrEqual(0);
        expect(right(f.compass!)).toBeLessThanOrEqual(size.width);
        expect(bottom(f.footer!)).toBeLessThanOrEqual(size.height);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      } finally {
        await ctx.close();
      }
    });
  }

  test("the longest camera name wraps in the left half, clear of what is on the right", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[3], SIZES[4]]) {
      const { ctx, page } = await phone(browser, size);
      try {
        await page.goto(CAM);
        await ready(page);
        await expect(page.locator("header h1")).toHaveText(A406);
        const f = await frame(page);
        for (const t of f.title) expect(right(t)).toBeLessThanOrEqual(size.width / 2);
        expect(sumShared(f.title, [f.hint!, f.clock!]), `${size.width}`).toBe(0);
        // 22 px on a phone, as Leon chose.
        expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("22px");
      } finally {
        await ctx.close();
      }
    }
  });

  test("five pins are switch rows behind the menu, and the sheet scrolls to the last row", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
      const { ctx, page } = await phone(browser, size, { pins: true });
      try {
        await page.goto(SPOT);
        await ready(page);
        await page.locator('[data-rail="eye"] [data-rail-menu]').tap();
        const nav = page.getByRole("navigation", { name: "Map tools" });
        for (const name of ["Ships", "Planes", "Roadworks", "Live cams", "Road closures"]) {
          await expect(nav.getByRole("switch", { name: new RegExp(`^${name}`) })).toHaveCount(1);
        }
        const controls = page.locator('[data-rail="eye"] [data-rail-entry="controls"]');
        await controls.scrollIntoViewIfNeeded();
        const c = (await controls.boundingBox())!;
        expect(bottom(c), `${size.width}`).toBeLessThanOrEqual(size.height);
        expect(c.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      } finally {
        await ctx.close();
      }
    }
  });

  test("the Sources tray stands in the right half and runs to the bottom edge", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
      const { ctx, page } = await phone(browser, size);
      try {
        await page.goto(SPOT);
        await ready(page);
        await page.locator('[data-rail="eye"] [data-rail-menu]').tap();
        await page.locator('[data-rail="eye"] [data-rail-entry="sources"]').tap();
        const tray = page.locator("[data-eye-tray]");
        await expect(tray).toBeVisible();
        const f = await frame(page);
        expect(f.tray!.y).toBeGreaterThanOrEqual(bottom(f.clock!));
        expect(f.tray!.x).toBeGreaterThanOrEqual(size.width / 2 - 16);
        expect(bottom(f.tray!)).toBeLessThanOrEqual(size.height - 9.5);
        // At least one whole source row shows, even at 320 px tall, and the whole tray scrolls
        // under its header (as the console's rail does).
        const row = (await tray.locator(".tn-src-row").first().boundingBox())!;
        expect(bottom(row)).toBeLessThanOrEqual(bottom(f.tray!));
        const head = (await tray.getByRole("tablist", { name: "Sources views" }).boundingBox())!;
        if (size.height <= 320) {
          expect(await tray.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
          await tray.evaluate((el) => el.scrollBy(0, 120));
          const headAfter = (await tray.getByRole("tablist", { name: "Sources views" }).boundingBox())!;
          expect(Math.round(headAfter.y)).toBe(Math.round(head.y));
        }
      } finally {
        await ctx.close();
      }
    }
  });

  test("the search lists the places under the pill, 44 px each", async ({ browser }) => {
    const { ctx, page } = await phone(browser, SIZES[3]);
    try {
      await page.goto("/eye?place=westminster");
      await ready(page);
      const box = page.getByRole("combobox", { name: "Search places, cameras and vessels" });
      await box.tap();
      const link = page.getByRole("option", { name: /Tower Bridge/ });
      await expect(link).toBeVisible();
      const l = (await link.boundingBox())!;
      expect(l.height).toBeGreaterThanOrEqual(44);
      const f = await frame(page);
      expect(l.y).toBeGreaterThanOrEqual(bottom(f.search!) - 48);
      expect(bottom(l)).toBeLessThanOrEqual(390);
    } finally {
      await ctx.close();
    }
  });

  test("a details panel stands under the clock, to the bottom edge, clear of the title", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[3]]) {
      const { ctx, page } = await phone(browser, size);
      try {
        const json = (body: string) => ({ status: 200, contentType: "application/json", body });
        await page.route((url) => url.pathname === "/api/signals/ais", (route) => route.fulfill(json(THAMES)));
        await page.route(
          (url) => url.pathname === "/api/eye/vessels",
          (route) => route.fulfill(json(JSON.stringify({ ok: true, stream: "live", features: JSON.parse(THAMES).features }))),
        );
        await page.goto("/eye?place=westminster");
        await ready(page);
        // MILLENNIUM DIAMOND, a little left of the middle so the panel does not land on it.
        const at = await page.evaluate(() => {
          type P = { x: number; y: number };
          const m = (window as unknown as {
            __map: { project(l: [number, number]): P; unproject(p: [number, number]): { lng: number; lat: number }; jumpTo(o: { center: { lng: number; lat: number } }): void };
          }).__map;
          const c = m.project([-0.12, 51.50532]);
          m.jumpTo({ center: m.unproject([c.x + innerWidth * 0.18, c.y]) });
          const p = m.project([-0.12, 51.50532]);
          return { x: p.x, y: p.y };
        });
        await page.waitForTimeout(1500);
        await page.touchscreen.tap(at.x, at.y);
        const panel = page.getByRole("dialog", { name: "MILLENNIUM DIAMOND" });
        await expect(panel).toBeVisible();
        const f = await frame(page);
        expect(f.dialog!.y).toBeGreaterThanOrEqual(bottom(f.clock!));
        expect(bottom(f.dialog!)).toBeLessThanOrEqual(size.height - 9.5);
        expect(sumShared(f.title, [f.dialog!])).toBe(0);
      } finally {
        await ctx.close();
      }
    }
  });
});

test.describe("the other shapes", () => {
  test("a portrait phone (390 x 844): the search at the top, the compass low, the hint above it", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    try {
      await page.goto("/eye?place=westminster");
      await ready(page);
      const f = await frame(page);
      expect(f.search!.y).toBeLessThan(844 / 4);
      expect(f.compass!.y).toBeGreaterThan(844 / 2);
      expect(bottom(f.hint!)).toBeLessThanOrEqual(f.compass!.y);
      expect(bottom(f.compass!)).toBeLessThanOrEqual(f.footer!.y);
      expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("22px");
    } finally {
      await ctx.close();
    }
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    test(`a desktop (${viewport.width} x ${viewport.height}): the design's places`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      try {
        await page.goto("/eye?place=westminster");
        await ready(page);
        const f = await frame(page);
        expect(Math.round(f.search!.x)).toBe(88);
        expect(Math.round(f.search!.y)).toBe(16);
        expect(Math.round(f.search!.height)).toBe(48);
        expect(Math.round(viewport.width - right(f.clock!))).toBe(24);
        expect(Math.round(viewport.height - bottom(f.compass!))).toBe(20);
        expect(Math.round(viewport.height - bottom(f.footer!))).toBe(24);
        expect(Math.round(f.hint!.x)).toBe(88);
        expect(sumShared([f.hint!], [f.compass!])).toBe(0);
        expect(sumShared([f.footer!], [f.compass!])).toBe(0);
        expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("28px");
      } finally {
        await ctx.close();
      }
    });
  }
});

/**
 * The switches on a phone are rows of the sheet behind the menu: 44 px tall, named in full, and
 * their state is the design's track and knob. Upright (320, 360, 390) and sideways (568x320,
 * 667x375, 844x390), with no pins and with five: the sheet scrolls and the page does not.
 */
const SHEET_SIZES = [
  { width: 320, height: 568 },
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];

test.describe("the sheet on a phone", () => {
  for (const size of SHEET_SIZES) {
    test(`${size.width} x ${size.height}: Camera previews switches, and nothing overflows`, async ({ browser }) => {
      for (const pins of [false, true]) {
        const { ctx, page } = await phone(browser, size, { pins });
        try {
          await page.goto(SPOT);
          await ready(page);
          await page.locator('[data-rail="eye"] [data-rail-menu]').tap();
          const sw = page.getByRole("switch", { name: "Camera previews", exact: true });
          await expect(sw).toBeVisible();
          expect((await sw.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await expect(sw).toHaveAttribute("aria-checked", "true");
          await sw.tap();
          await expect(sw).toHaveAttribute("aria-checked", "false");
          await sw.tap();
          await expect(sw).toHaveAttribute("aria-checked", "true");
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        } finally {
          await ctx.close();
        }
      }
    });
  }
});
