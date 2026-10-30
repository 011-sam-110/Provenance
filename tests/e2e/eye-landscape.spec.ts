import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * God's eye view on a phone held sideways (eye-landscape, 30 Oct 2026). Under 500 px of
 * height the frame takes the phone's compact words and splits in two halves: the place,
 * heading/tilt and the counts on the left, in flow; the clock, the bar and what the bar
 * opens (the hint, the tray, Places, a details panel) on the right, 8 px under the bar.
 * Five pins scroll sideways in the bar's strip instead of pushing Previews and Turn off the
 * screen. Portrait phones and desktops are unchanged (the last two tests).
 *
 * Each case runs in a touch phone context (hasTouch + isMobile), so the hint is the finger
 * version, as on a real phone. /api/near is answered from a fixture so the title and the
 * ledger do not depend on TfL; the vessel feeds come from tests/fixtures (as eye-details).
 *
 * THE HOOKS: main[data-eye-state="ready"], `header h1`, the first `header p` (heading and
 * tilt), section[aria-label="What this view shows"], nav[aria-label="View controls"], the
 * hint (the <aside> "How to move the view"), [data-eye-tray], [data-eye-exit] (the way out
 * to the console), the dialog, and window.__map (WorldMap's debug handle).
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
    const bar = document.querySelector('nav[aria-label="View controls"]');
    const ledger = document.querySelector('section[aria-label="What this view shows"]');
    const hint = document.querySelector('aside[aria-label="How to move the view"]');
    const footer = document.querySelector("footer");
    const credits = footer ? [...footer.querySelectorAll("a")].map((a) => a.closest("span")?.parentElement ?? null)[0] : null;
    return {
      header: box(document.querySelector("header")),
      title: ink(document.querySelector("header h1")),
      sub: ink(document.querySelector("header p")),
      bar: box(bar),
      buttons: bar
        ? [...bar.querySelectorAll("button")].filter((b) => b.getClientRects().length > 0).map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent!.trim(), ...box(b)! }))
        : [],
      ledger: box(ledger),
      ledgerInk: ledger ? [...ledger.children].flatMap((p) => ink(p)) : [],
      hint: box(hint),
      footer: box(footer),
      credits: ink(credits),
      exit: box(document.querySelector("[data-eye-exit]")),
      tray: box(document.querySelector("[data-eye-tray]")),
      dialog: box(document.querySelector('[role="dialog"]')),
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
        // The left half: the header's words and the counts end before the middle.
        for (const t of [...f.title, ...f.sub, ...f.ledgerInk]) expect(right(t)).toBeLessThanOrEqual(half);
        // The counts follow the header (0 to 8 px under it) and end above the bottom line.
        expect(f.ledger!.y - bottom(f.header!)).toBeGreaterThanOrEqual(-0.5);
        expect(f.ledger!.y - bottom(f.header!)).toBeLessThanOrEqual(8);
        expect(bottom(f.ledger!)).toBeLessThanOrEqual(f.footer!.y);
        // The right half: the bar from the middle to 22 px from the edge, the hint under it.
        expect(f.bar!.x).toBeGreaterThanOrEqual(half - 0.5);
        expect(right(f.bar!)).toBeLessThanOrEqual(size.width - 21.5);
        expect(f.hint, "the hint is up").not.toBeNull();
        expect(f.hint!.y).toBeGreaterThanOrEqual(bottom(f.bar!) + 7.5);
        expect(f.hint!.x).toBeGreaterThanOrEqual(half - 16);
        // The way out stays on the screen, in the left half: beside the name, or under it when
        // the half is too narrow for both.
        expect(f.exit, "the way out is drawn").not.toBeNull();
        expect(f.exit!.x).toBeGreaterThanOrEqual(0);
        expect(right(f.exit!)).toBeLessThanOrEqual(half);
        expect(sumShared([f.exit!], [...f.title, ...f.sub, ...f.buttons, f.hint!, ...f.ledgerInk])).toBe(0);
        // Nothing on anything.
        expect(sumShared([...f.title, ...f.sub], f.buttons)).toBe(0);
        expect(sumShared(f.ledgerInk, [f.hint!, f.footer!, ...f.buttons])).toBe(0);
        expect(sumShared([f.hint!], f.credits)).toBe(0);
        // Every button of the bar is on the screen.
        for (const b of f.buttons) {
          expect(b.x, b.name).toBeGreaterThanOrEqual(0);
          expect(right(b), b.name).toBeLessThanOrEqual(size.width);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      } finally {
        await ctx.close();
      }
    });
  }

  test("the longest camera name wraps in the left half, clear of the bar", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[3], SIZES[4]]) {
      const { ctx, page } = await phone(browser, size);
      try {
        await page.goto(CAM);
        await ready(page);
        await expect(page.locator("header h1")).toHaveText(A406);
        const f = await frame(page);
        expect(sumShared(f.title, f.buttons), `${size.width}`).toBe(0);
        for (const t of f.title) expect(right(t)).toBeLessThanOrEqual(size.width / 2);
        expect(bottom(f.ledger!)).toBeLessThanOrEqual(f.footer!.y);
        // 22 px on a phone, as Leon chose.
        expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("22px");
      } finally {
        await ctx.close();
      }
    }
  });

  test("five pins scroll in the bar's strip; Previews, Turn and Sources stay on the screen", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
      const { ctx, page } = await phone(browser, size, { pins: true });
      try {
        await page.goto(SPOT);
        await ready(page);
        const bar = page.getByRole("navigation", { name: "View controls" });
        for (const name of ["Ships", "Planes", "Roadworks", "Live cams", "Road closures"]) {
          await expect(bar.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(1);
        }
        const f = await frame(page);
        expect(f.bar!.x, `${size.width}`).toBeGreaterThanOrEqual(size.width / 2 - 0.5);
        for (const name of ["Previews", "Turn"]) {
          const target = name === "Previews" ? bar.getByRole("switch", { name: "Cameras previews", exact: true }) : bar.getByRole("button", { name, exact: true });
          const b = (await target.boundingBox())!;
          expect(b.x, `${name} at ${size.width}`).toBeGreaterThanOrEqual(f.bar!.x - 0.5);
        }
        const sources = (await page.locator("[data-sources-button]").boundingBox())!;
        expect(right(sources)).toBeLessThanOrEqual(size.width - 21.5);
        expect(sumShared([...f.title, ...f.sub], [f.bar!])).toBe(0);
        // The strip scrolls to the last pin.
        const strip = page.locator("[data-sources-button] ~ div").first();
        const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(scrolls).toBe(true);
      } finally {
        await ctx.close();
      }
    }
  });

  test("the Sources tray hangs under the bar and runs to the bottom edge", async ({ browser }) => {
    for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
      const { ctx, page } = await phone(browser, size);
      try {
        await page.goto(SPOT);
        await ready(page);
        await page.locator("[data-sources-button]").tap();
        const tray = page.locator("[data-eye-tray]");
        await expect(tray).toBeVisible();
        const f = await frame(page);
        expect(f.tray!.y).toBeGreaterThanOrEqual(bottom(f.bar!) + 7.5);
        expect(bottom(f.tray!)).toBeLessThanOrEqual(size.height - 9.5);
        expect(bottom(f.tray!)).toBeGreaterThanOrEqual(size.height - 12);
        // At least one whole source row shows, even at 320 px tall, and the whole tray scrolls
        // under its header (as the console's rail does).
        const row = (await tray.locator(".tn-src-row").first().boundingBox())!;
        expect(bottom(row)).toBeLessThanOrEqual(bottom(f.tray!));
        const head = (await tray.locator(".tn-rail-header").boundingBox())!;
        if (size.height <= 320) {
          expect(await tray.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
          await tray.evaluate((el) => el.scrollBy(0, 120));
          const headAfter = (await tray.locator(".tn-rail-header").boundingBox())!;
          expect(Math.round(headAfter.y)).toBe(Math.round(head.y));
        }
      } finally {
        await ctx.close();
      }
    }
  });

  test("Places opens the phone's list under the bar", async ({ browser }) => {
    const { ctx, page } = await phone(browser, SIZES[3]);
    try {
      await page.goto("/eye?place=westminster");
      await ready(page);
      await expect(page.locator("header nav")).toBeHidden(); // the chips give way to Places
      await page.getByRole("button", { name: "Places", exact: true }).tap();
      const sheet = page.getByRole("navigation", { name: "Places" });
      await expect(sheet).toBeVisible();
      const s = (await sheet.boundingBox())!;
      const f = await frame(page);
      expect(s.y).toBeGreaterThanOrEqual(bottom(f.bar!) + 7.5);
      expect(s.x).toBeGreaterThanOrEqual(844 / 2 - 16);
      const link = (await sheet.getByRole("link", { name: /Tower Bridge/ }).boundingBox())!;
      expect(link.height).toBeGreaterThanOrEqual(44);
    } finally {
      await ctx.close();
    }
  });

  test("a details panel hangs under the bar, to the bottom edge, clear of the counts", async ({ browser }) => {
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
        expect(f.dialog!.y).toBeGreaterThanOrEqual(bottom(f.bar!) + 7.5);
        expect(bottom(f.dialog!)).toBeLessThanOrEqual(size.height - 9.5);
        expect(sumShared(f.ledgerInk, [f.dialog!])).toBe(0);
      } finally {
        await ctx.close();
      }
    }
  });
});

test.describe("unchanged", () => {
  test("a portrait phone keeps its layout (390 x 844)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    try {
      await page.goto("/eye?place=westminster");
      await ready(page);
      const f = await frame(page);
      // The bar sits in the footer's flow at the bottom; the hint above it.
      expect(f.bar!.y).toBeGreaterThan(844 / 2);
      expect(bottom(f.hint!)).toBeLessThanOrEqual(f.bar!.y);
      expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("22px");
    } finally {
      await ctx.close();
    }
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    test(`a desktop keeps its layout (${viewport.width} x ${viewport.height})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      try {
        await page.goto("/eye?place=westminster");
        await ready(page);
        const f = await frame(page);
        expect(Math.round(f.bar!.y)).toBe(60);
        expect(Math.round(viewport.width - right(f.bar!))).toBe(26);
        expect(Math.round(viewport.height - bottom(f.ledger!))).toBe(76);
        expect(Math.round(f.hint!.y)).toBe(120);
        expect(Math.round(f.header!.y)).toBe(22);
        await expect(page.locator("header nav")).toBeVisible(); // the place chips
        expect(await page.locator("header h1").evaluate((h) => getComputedStyle(h).fontSize)).toBe("28px");
        // The switch keeps its camera icon, the word "Previews" and its track; "Cameras" is the phone's.
        const sw = page.getByRole("switch", { name: "Previews", exact: true });
        await expect(sw).toBeVisible();
        expect(await sw.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("Previews");
        const marks = sw.locator("span[aria-hidden]");
        expect(await marks.count()).toBe(2);
        for (let i = 0; i < 2; i++) await expect(marks.nth(i)).toBeVisible();
      } finally {
        await ctx.close();
      }
    });
  }
});

/**
 * The switch on a phone says "Cameras" instead of drawing a camera (Leon, 30 Oct 2026). It is
 * a switch with the bar's own type and height, its name is built from the word drawn ("Cameras
 * previews"), it says off with the word alone (dimmed and struck through), and the bar stays on
 * ONE row with Sources in its place and every button reachable, with no pins and with five,
 * upright (320, 360, 390) and sideways (568x320, 667x375, 844x390).
 */
const BAR_SIZES = [
  { width: 320, height: 568, upright: true },
  { width: 360, height: 780, upright: true },
  { width: 390, height: 844, upright: true },
  { width: 568, height: 320, upright: false },
  { width: 667, height: 375, upright: false },
  { width: 844, height: 390, upright: false },
];

test.describe("the Cameras switch on a phone", () => {
  for (const size of BAR_SIZES) {
    test(`${size.width} x ${size.height}: the word, the state, and a bar of one row`, async ({ browser }) => {
      for (const pins of [false, true]) {
        const { ctx, page } = await phone(browser, size, { pins });
        try {
          await page.goto(size.upright ? "/eye?place=westminster" : SPOT);
          await ready(page);
          const bar = page.getByRole("navigation", { name: "View controls" });
          const sw = bar.getByRole("switch", { name: "Cameras previews", exact: true });
          await expect(sw).toBeVisible();
          // What is drawn is the word alone, in the type of Places and Turn.
          // ("previews" is in the name only: a visually hidden 1 px box, not part of what is drawn.)
          const drawn = await sw.evaluate((el) => {
            const hidden = el.querySelector(".tn-sr-only")!;
            const box = hidden.getBoundingClientRect();
            const word = [...hidden.parentElement!.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
            return { word, hiddenWidth: box.width, hiddenHeight: box.height };
          });
          expect(drawn.word).toBe("Cameras");
          expect(drawn.hiddenWidth).toBeLessThanOrEqual(1);
          expect(drawn.hiddenHeight).toBeLessThanOrEqual(1);
          expect(await sw.locator("span[aria-hidden]").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length)).toBe(0);
          const type = (loc: ReturnType<typeof bar.getByRole>) => loc.evaluate((el) => { const c = getComputedStyle(el); return `${c.fontSize} ${c.fontWeight} ${c.fontFamily}`; });
          const places = bar.getByRole("button", { name: "Places", exact: true });
          const turn = bar.getByRole("button", { name: "Turn", exact: true });
          expect(await type(sw)).toBe(await type(places));
          // 44 px tall upright; sideways it is as tall as Places and Turn (the bar's compact height).
          const h = (await sw.boundingBox())!.height;
          if (size.upright) expect(h).toBeGreaterThanOrEqual(44);
          else expect(Math.abs(h - (await turn.boundingBox())!.height)).toBeLessThanOrEqual(0.5);
          // One row, and Sources keeps the bar's end (its right edge upright is the bar's own).
          const tops = await bar.locator("button").evaluateAll((els) =>
            els.filter((e) => e.getClientRects().length > 0).map((e) => Math.round(e.getBoundingClientRect().top)),
          );
          expect(new Set(tops).size, `one row (${pins ? "five pins" : "no pins"})`).toBe(1);
          const sources = (await page.locator("[data-sources-button]").boundingBox())!;
          if (size.upright) expect(Math.round(sources.x)).toBe(18);
          else expect(Math.round(size.width - right(sources))).toBe(22);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
          // Every button of the strip can be scrolled into the strip: the first at rest, the last at the end.
          const reach = await page.evaluate(() => {
            const src = document.querySelector("[data-sources-button]")!;
            const strip = [...src.parentElement!.children].find((c) => c !== src && getComputedStyle(c).overflowX === "auto") as HTMLElement;
            const kids = [...strip.children].filter((c) => c.getClientRects().length > 0);
            const pad = parseFloat(getComputedStyle(strip).paddingRight);
            strip.scrollLeft = 0;
            const first = kids[0].getBoundingClientRect().left - strip.getBoundingClientRect().left;
            strip.scrollLeft = strip.scrollWidth;
            const last = strip.getBoundingClientRect().right - pad - kids[kids.length - 1].getBoundingClientRect().right;
            return { first, last, scrolls: strip.scrollWidth > strip.clientWidth + 1 };
          });
          expect(reach.first, "the first button starts inside the strip").toBeGreaterThanOrEqual(-0.5);
          expect(reach.last, "the last button can be scrolled into view").toBeGreaterThanOrEqual(-0.5);
          if (pins) expect(reach.scrolls, "five pins scroll").toBe(true);
          // Off says so with the word alone; pressing again brings it back.
          const word = sw.locator("span").filter({ hasText: "Cameras" }).first();
          const line = () => word.evaluate((el) => getComputedStyle(el).textDecorationLine);
          await expect(sw).toHaveAttribute("aria-checked", "true");
          expect(await line()).toBe("none");
          await sw.scrollIntoViewIfNeeded();
          await sw.tap();
          await expect(sw).toHaveAttribute("aria-checked", "false");
          expect(await line()).toContain("line-through");
          await sw.tap();
          await expect(sw).toHaveAttribute("aria-checked", "true");
          expect(await line()).toBe("none");
        } finally {
          await ctx.close();
        }
      }
    });
  }
});
