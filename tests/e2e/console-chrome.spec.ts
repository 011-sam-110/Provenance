import { expect, test, type Locator, type Page } from "@playwright/test";

// Console chrome polish (Leon, 2026-10-30): the Video and Stills counts as a mark and a
// number on one line, the close mark inside a shaded tool strip, and a Sources pane that
// slides. These are the things a unit test cannot see: sizes read from a real layout, the
// strip's geometry in both skins, and the map's width through a slide.
//
// Run against the keyless dev server or a production build. Writes
// persona-shots/console-chrome-{1440,390}-{light,dark}.png and
// persona-shots/console-chrome-1240-light.png (UI evidence, per CLAUDE.md).

test.beforeEach(async ({ page }) => {
  // Keep the boot overlay away, like every other console spec.
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

const FAB = ".tn-rail-fab";
const PANE = ".tn-cw-shell > .tn-rail";
const STATS_LABEL = /^Road and public operator cameras: [\d,]+ video, [\d,]+ stills/;

async function loaded(page: Page): Promise<Locator> {
  const strip = page.getByTestId("camera-stats");
  await expect(strip).toBeVisible({ timeout: 60_000 });
  await expect(strip).toHaveAttribute("aria-label", STATS_LABEL, { timeout: 120_000 });
  return strip;
}

/** Wait until the pane (if any) has no transition or animation left to run. */
async function settled(page: Page) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !el || el.getAnimations().length === 0;
    },
    PANE,
  );
}

async function openRail(page: Page) {
  if ((await page.locator(PANE).count()) === 0) await page.locator(FAB).click();
  await expect(page.locator(PANE)).toBeVisible();
  await settled(page);
}

const setSkin = (page: Page, skin: "light" | "dark") =>
  page.evaluate((s) => {
    if (s === "dark") document.documentElement.setAttribute("data-tnx-skin", "dark");
    else document.documentElement.removeAttribute("data-tnx-skin");
  }, skin);

const px = (v: string) => Number.parseFloat(v);

test("desktop: VIDEO and STILLS are a mark and a number on one line, the other four keep their word", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const strip = await loaded(page);

  for (const k of ["video", "stills"]) {
    const seg = strip.locator(`[data-k="${k}"]`);
    const glyph = seg.locator(`[data-glyph="${k}"]`);
    const num = seg.locator(".cs-num");
    await expect(glyph, `${k} mark`).toBeVisible();
    await expect(seg.locator(".cs-word"), `${k} word`).toBeHidden();
    const style = await num.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight };
    });
    expect(style, `${k} number`).toEqual({ size: "14px", weight: "700" });
    const g = (await glyph.boundingBox())!;
    const n = (await num.boundingBox())!;
    expect(Math.abs(g.y + g.height / 2 - (n.y + n.height / 2)), `${k}: mark and number share a centre line`).toBeLessThanOrEqual(1);
    expect(g.x + g.width, `${k}: the mark comes first`).toBeLessThanOrEqual(n.x + 0.5);
    // The word is gone from the bar, so the spoken name and the tip carry it.
    await seg.hover();
    await expect(page.locator("#cs-tip"), `${k} tip`).toContainText(k === "video" ? "Video" : "Stills");
  }

  // COUNTED shows the time of the count, not a number, so it keeps its own 12px / 600 line.
  for (const k of ["countries", "operators", "counted", "webcams"]) {
    const seg = strip.locator(`[data-k="${k}"]`);
    const word = seg.locator(".cs-word");
    const num = seg.locator(k === "counted" ? ".cs-ftime" : ".cs-num");
    await expect(word, `${k} word`).toBeVisible();
    if (k !== "counted") {
      const style = await num.evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, weight: s.fontWeight };
      });
      expect(style, `${k} number`).toEqual({ size: "14px", weight: "700" });
    }
    const w = (await word.boundingBox())!;
    const n = (await num.boundingBox())!;
    expect(w.y + w.height, `${k}: the word sits above its number`).toBeLessThanOrEqual(n.y + 1);
  }

  // The spoken name of the strip did not change.
  await expect(strip).toHaveAttribute("aria-label", STATS_LABEL);
  // Nothing in the bar is cut off.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("1240 and 900: nothing is cut off, and the second row at 900 shows the pair's marks", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.goto("/app");
  const strip = await loaded(page);
  for (const k of ["video", "stills"]) {
    await expect(strip.locator(`[data-k="${k}"] [data-glyph="${k}"]`)).toBeVisible();
    await expect(strip.locator(`[data-k="${k}"] .cs-word`)).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "persona-shots/console-chrome-1240-light.png", clip: { x: 0, y: 0, width: 1240, height: 120 } });

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(strip.locator('[data-k="video"] [data-glyph="video"]')).toBeVisible();
  await expect(strip.locator('[data-k="video"] .cs-word')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("phone: the line is 13px / 700 with 12px between the pair, and nothing overflows", async ({ page }) => {
  test.setTimeout(240_000);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app");
    const strip = await loaded(page);
    const nums = strip.locator(".cs-pline .cs-num");
    await expect(nums).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const style = await nums.nth(i).evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, weight: s.fontWeight };
      });
      expect(style, `${width}: number ${i}`).toEqual({ size: "13px", weight: "700" });
    }
    const gap = (await strip.locator(".cs-pline .cs-gap").boundingBox())!;
    expect(gap.width, `${width}: the gap`).toBeCloseTo(12, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no sideways scroll`).toBe(true);
  }
});

for (const vp of [
  { name: "1440", width: 1440, height: 900, phone: false },
  { name: "390", width: 390, height: 844, phone: true },
]) {
  for (const skin of ["light", "dark"] as const) {
    test(`${vp.name} ${skin}: the close tile is the top of one shaded strip, on both tabs`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/app");
      await expect(page.locator(".map-canvas")).toHaveCount(1);
      await setSkin(page, skin);
      await openRail(page);

      for (const tab of ["sources", "inspector"]) {
        await page.locator(`#tn-rail-tab-${tab}`).click();
        await expect(page.locator(`#tn-rail-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
        const g = await page.evaluate(() => {
          const rect = (sel: string) => {
            const r = document.querySelector(sel)!.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom };
          };
          const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
          const pos = (a: string, b: string) =>
            !!(document.querySelector(a)!.compareDocumentPosition(document.querySelector(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);
          return {
            pane: rect(".tn-cw-shell > .tn-rail"),
            cell: rect(".tn-rail-close-cell"),
            tile: rect(".tn-rail-close-cell .tn-rail-collapse"),
            tools: rect("#inspector-rail"),
            tabs: rect(".tn-rail-tabs"),
            paneBg: bg(".tn-cw-shell > .tn-rail"),
            cellBg: bg(".tn-rail-close-cell"),
            toolsBg: bg("#inspector-rail"),
            order: {
              tabsBeforeClose: pos(".tn-rail-tabs", ".tn-rail-close-cell"),
              closeBeforeContent: pos(".tn-rail-close-cell", ".tn-rail-panes"),
              contentBeforeTools: pos(".tn-rail-panes", "#inspector-rail"),
            },
          };
        });
        const where = `${vp.name} ${skin} ${tab}`;
        expect(Math.abs(g.cell.x - g.tools.x), `${where}: same x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(g.cell.w - g.tools.w), `${where}: same width`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(g.cell.b - g.tools.y), `${where}: the cell meets the toolbar`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(g.cell.y - g.pane.y), `${where}: the strip starts at the pane's top`).toBeLessThanOrEqual(1);
        expect(Math.abs(g.tools.b - g.pane.b), `${where}: and ends at its bottom`).toBeLessThanOrEqual(1);
        expect(
          Math.abs(g.tile.y + g.tile.h / 2 - (g.tabs.y + g.tabs.h / 2)),
          `${where}: the tile is level with the tabs`,
        ).toBeLessThanOrEqual(0.5);
        expect(g.cellBg, `${where}: one shade down the strip`).toBe(g.toolsBg);
        expect(g.toolsBg, `${where}: the strip differs from the pane`).not.toBe(g.paneBg);
        expect(g.order, `${where}: tab order`).toEqual({
          tabsBeforeClose: true,
          closeBeforeContent: true,
          contentBeforeTools: true,
        });
      }

      const close = page.locator(".tn-rail-close-cell").getByRole("button", { name: "Close sources" });
      await expect(close).toBeVisible();
      const word = page.locator(".tn-rail-close-cell .tn-insp-rail-name");
      if (vp.phone) {
        await expect(word).toBeVisible();
        await expect(word).toHaveText("Close");
        // The Sources list still scrolls inside the sheet.
        await page.locator("#tn-rail-tab-sources").click();
        const sc = await page.locator(".tn-rail-panes").evaluate((el) => ({
          can: el.scrollHeight > el.clientHeight,
          overflowY: getComputedStyle(el).overflowY,
          paneH: document.querySelector(".tn-cw-shell > .tn-rail")!.getBoundingClientRect().height,
        }));
        expect(sc.overflowY).toBe("auto");
        expect(sc.can).toBe(true);
        expect(sc.paneH).toBeLessThanOrEqual(vp.height * 0.67);
      } else {
        await expect(word).toBeHidden();
      }
      await page.locator("#tn-rail-tab-sources").click();
      // The shot shows the counts, so wait for them rather than their skeletons.
      await loaded(page);
      await page.screenshot({ path: `persona-shots/console-chrome-${vp.name}-${skin}.png` });
    });
  }
}

type Sample = { t: number; w: number; x: number | null; y: number | null; opacity: number | null; leaving: boolean; tab: boolean };

/** Click `what` inside the page and sample the pane and the map's width on every frame for `ms`. */
function slide(page: Page, what: "open" | "close", ms = 800): Promise<Sample[]> {
  return page.evaluate(
    async ([mode, span]) => {
      const canvas = document.querySelector(".maplibregl-canvas") as HTMLElement;
      const samples: Sample[] = [];
      const t0 = performance.now();
      let stop = false;
      const tick = () => {
        const pane = document.querySelector(".tn-cw-shell > .tn-rail");
        const m = pane ? new DOMMatrix(getComputedStyle(pane).transform) : null;
        samples.push({
          t: performance.now() - t0,
          w: canvas.getBoundingClientRect().width,
          x: m ? m.m41 : null,
          y: m ? m.m42 : null,
          opacity: pane ? Number(getComputedStyle(pane).opacity) : null,
          leaving: !!pane?.hasAttribute("data-leaving"),
          tab: !!document.querySelector(".tn-rail-fab"),
        });
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const target = document.querySelector(mode === "open" ? ".tn-rail-fab" : ".tn-rail-collapse") as HTMLElement;
      target.click();
      await new Promise((r) => setTimeout(r, span));
      stop = true;
      return samples;
    },
    [what, ms] as const,
  );
}

const widths = (s: Sample[]) => [...new Set(s.map((x) => Math.round(x.w)))];
const changes = (s: Sample[]) => s.reduce((n, x, i) => (i > 0 && Math.round(x.w) !== Math.round(s[i - 1].w) ? n + 1 : n), 0);

test("desktop: the pane slides in over 300 ms and out over 200 ms, and the map resizes once", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await page.waitForTimeout(800);

  const open = await slide(page, "open");
  expect(widths(open), "open: two widths, before and after").toHaveLength(2);
  expect(changes(open), "open: the map changed width once").toBe(1);
  const mid = open.filter((s) => s.x !== null && s.x < -2 && s.x > -440);
  expect(mid.length, "open: the pane was caught mid-slide").toBeGreaterThan(0);
  expect(open.at(-1)!.x).toBe(0);
  await settled(page);

  const close = await slide(page, "close");
  expect(widths(close), "close: two widths").toHaveLength(2);
  expect(changes(close), "close: the map changed width once").toBe(1);
  const first = close.find((s) => s.leaving);
  expect(first, "close: the pane is marked leaving at once").toBeTruthy();
  expect(close.find((s) => s.leaving)!.tab, "close: the Sources tab is there at once").toBe(true);
  expect(close.some((s) => s.leaving && s.x !== null && s.x < -2), "close: the pane was caught sliding out").toBe(true);
  const gone = close.find((s) => s.x === null);
  expect(gone, "close: the pane left the page").toBeTruthy();
  expect(gone!.t, "close: within about 300 ms").toBeLessThan(500);
  // The map took its room back at the click, not at the end of the slide.
  const bigAt = close.find((s) => Math.round(s.w) === Math.max(...widths(close)))!;
  expect(bigAt.t).toBeLessThan(150);
});

test("desktop: opening again 50 ms into a close leaves one open pane, at rest", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await openRail(page);
  await page.evaluate(async () => {
    (document.querySelector(".tn-rail-collapse") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    (document.querySelector(".tn-rail-fab") as HTMLElement).click();
  });
  await expect(page.locator(".tn-rail")).toHaveCount(1);
  await expect(page.locator(PANE)).not.toHaveAttribute("data-leaving", /.*/);
  await settled(page);
  expect(await page.locator(PANE).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)).toBe(0);
  await expect(page.locator(".tn-rail-fab")).toHaveCount(0);
  // A leaving pane is out of reach of the keyboard and the pointer.
  await page.locator(".tn-rail-collapse").click();
  await expect(page.locator(PANE)).toHaveAttribute("data-leaving", "");
  await expect(page.locator(PANE)).toHaveAttribute("inert", "");
  await expect(page.locator(PANE)).toHaveCount(0);
});

test("reduced motion: nothing travels, the pane fades", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await page.waitForTimeout(800);

  const open = await slide(page, "open");
  const during = open.filter((s) => s.x !== null);
  expect(during.length).toBeGreaterThan(0);
  expect(during.every((s) => s.x === 0), "open: no frame moved sideways").toBe(true);
  expect(Math.min(...during.map((s) => s.opacity ?? 1)), "open: it rose from transparent").toBeLessThan(0.95);
  expect(open.at(-1)!.opacity).toBe(1);
  await settled(page);

  const close = await slide(page, "close");
  const out = close.filter((s) => s.x !== null);
  expect(out.every((s) => s.x === 0), "close: no frame moved sideways").toBe(true);
  expect(out.some((s) => s.leaving && (s.opacity ?? 1) < 1), "close: it faded").toBe(true);
  expect(close.find((s) => s.x === null), "close: and left").toBeTruthy();
});

test("phone: the sheet slides up on open and down on close", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await page.waitForTimeout(800);

  const open = await slide(page, "open");
  const up = open.filter((s) => s.y !== null && s.y > 2);
  expect(up.length, "open: caught below its resting place").toBeGreaterThan(0);
  expect(up.every((s) => s.x === 0)).toBe(true);
  expect(open.at(-1)!.y).toBe(0);
  await settled(page);

  const close = await slide(page, "close");
  expect(close.some((s) => s.leaving && s.y !== null && s.y > 2), "close: the sheet moved down").toBe(true);
  expect(close.find((s) => s.x === null), "close: and left").toBeTruthy();
  // The map does not resize for a sheet.
  expect(widths(close)).toHaveLength(1);
});
