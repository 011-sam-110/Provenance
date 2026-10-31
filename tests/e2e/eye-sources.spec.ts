import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The God's eye view's Sources tray (/eye): the console's own rail as a tray, with
 * "Show all", pins on the bar, and a drag to pin. Always the console's dark mode.
 *
 *   1  the tray is the console's rail: This view's seven rows, in two columns; Ships off
 *      leaves no vessels row and no ship tags, and on brings them back
 *   2  Show all, search, a console layer on: its ledger row, its credit, no Marks key
 *   3  a mouse drag pins a row onto the bar, between Turn and Sources
 *   4  the same without dragging: the ＋, Alt+Left, Delete
 *   5  a pin dragged off the bar is unpinned
 *   6  what is on and pinned is remembered, apart from the console's board
 *   7  Escape closes the tray and focus goes back to Sources
 *   8  a phone: a pop-up above the bar, a grip that carries a row, 44 px hit boxes
 *   9  outside London the three road switches are off and say why
 *   10 dark while the console is light, and /app keeps its own setting
 *   11 the console's own rail is unchanged
 *   (and the control hint steps aside for the tray, and its ? closes the tray)
 *
 * THE FEEDS ARE ANSWERED FROM CAPTURES (tests/fixtures/eye-*.json), routed by pathname on
 * both vessel routes, so a keyless dev server still has boats. UK street crime is answered
 * with three marks near Westminster, so the console layer has something to count and name.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map`, WorldMap's debug handle.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");
const THAMES = fixture("eye-ais-thames.json");
const PLANES = fixture("eye-planes-uk.json");

const CRIME = JSON.stringify({
  ok: true,
  features: [
    { id: "ukpolice:t1", signalId: "crime", lat: 51.5008, lon: -0.1246, title: "Theft from the person", color: "#f97316", props: {} },
    { id: "ukpolice:t2", signalId: "crime", lat: 51.5019, lon: -0.1262, title: "Public order", color: "#ca8a04", props: {} },
    { id: "ukpolice:t3", signalId: "crime", lat: 51.4994, lon: -0.1271, title: "Shoplifting", color: "#f97316", props: {} },
  ],
});

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });

/** Answer the feeds from captures; collect what the page throws. */
async function feeds(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const json = (body: string) => ({ status: 200, contentType: "application/json", body });
  await page.route((url) => url.pathname === "/api/signals/ais", (route) => route.fulfill(json(THAMES)));
  await page.route(
    (url) => url.pathname === "/api/eye/vessels",
    (route) => route.fulfill(json(JSON.stringify({ ok: true, stream: "live", features: JSON.parse(THAMES).features }))),
  );
  await page.route((url) => url.pathname === "/api/planes", (route) => route.fulfill(json(PLANES)));
  await page.route((url) => url.pathname === "/api/signals/crime", (route) => route.fulfill(json(CRIME)));
  return errors;
}

const sourcesButton = (page: Page) => page.getByRole("button", { name: /^Sources/ });
const tray = (page: Page) => page.locator("aside#eye-sources");
const bar = (page: Page) => page.getByRole("navigation", { name: "View controls" });
const row = (page: Page, id: string) => tray(page).locator(`.tn-src-row[data-source-row="${id}"]`);
const pin = (page: Page, id: string) => bar(page).locator(`[data-pin="${id}"]`);
const ledger = (page: Page) => page.locator('section[aria-label="What this view shows"]');

async function openTray(page: Page) {
  await sourcesButton(page).click();
  await expect(tray(page)).toBeVisible();
}

/** The centre of an element, in page pixels. */
async function centre(el: Locator): Promise<{ x: number; y: number }> {
  const b = (await el.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A mouse drag in small steps, so the pointer is seen on its way. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

/** The gap between Turn and Sources: where a drop lands before Sources. */
async function gapBeforeSources(page: Page) {
  const turn = (await bar(page).getByRole("button", { name: "Turn" }).boundingBox())!;
  const src = (await sourcesButton(page).boundingBox())!;
  return { x: (turn.x + turn.width + src.x) / 2, y: src.y + src.height / 2 };
}

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the tray is the console's rail: this view's seven rows, in two columns, and Ships switches off and on", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);

    await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "false");
    await openTray(page);
    await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "true");
    // The console's own panel, in the console's token scope.
    await expect(page.locator(".tn-terminal aside.tn-rail#eye-sources")).toHaveCount(1);
    await expect(tray(page)).toHaveAttribute("role", "dialog");
    await expect(page.locator("aside#eye-sources .tn-src-sec-head .tn-src-sec-name")).toHaveText("This view");

    const rows = tray(page).locator(".tn-src-row");
    await expect(rows).toHaveCount(7);
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-source-row")));
    expect(ids).toEqual(["livecams", "staticcams", "ais", "planes", "road-works", "road-incidents", "road-closures"]);
    // Two columns: two distinct left edges.
    const lefts = new Set(await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left))));
    expect(lefts.size).toBe(2);

    // Ships: on at first, with its words in the ledger and tags on the water.
    const ships = tray(page).getByRole("switch", { name: /^Show Ships/ });
    await expect(ships).toHaveAttribute("aria-checked", "true");
    await expect(ledger(page).locator('p[data-k="ship"]')).toHaveCount(1);
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached();

    await ships.click();
    await expect(ships).toHaveAttribute("aria-checked", "false");
    await expect(ledger(page).locator('p[data-k="ship"]')).toHaveCount(0);
    await expect(page.locator('[data-kind="ship"]')).toHaveCount(0);

    await ships.click();
    await expect(ledger(page).locator('p[data-k="ship"]')).toHaveCount(1);
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("Show all: search, a console layer on has its ledger row and credit, and there is no Marks key", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Show all" }).click();
    const search = tray(page).getByRole("searchbox", { name: "Search sources" });
    await expect(search).toBeFocused();
    await search.fill("UK street");
    await expect(tray(page).locator(".tn-src-row")).toHaveCount(1);
    await tray(page).getByRole("switch", { name: "Show UK street crime in this view" }).click();

    const crimeRow = ledger(page).locator('p[data-k="signal"]', { hasText: "UK street crime" });
    await expect(crimeRow).toHaveCount(1);
    await expect(crimeRow).toContainText("data.police.uk");
    await expect(page.locator("footer")).toContainText("data.police.uk");
    await expect(page.locator('[data-testid="mark-legend"]')).toHaveCount(0);

    // A row that is a map LAYER (the borders), not a signal, switches the layer the console's
    // own switch does. It is told apart on the server, from the row's kind.
    const borders = (v: string) =>
      page.evaluate(
        (id) => (window as unknown as { __map: { getLayoutProperty(l: string, p: string): string | undefined } }).__map.getLayoutProperty(id, "visibility"),
        v,
      );
    expect(await borders("country-borders")).toBe("none");
    await search.fill("borders");
    await tray(page).getByRole("switch", { name: "Show Borders & names in this view" }).click();
    await expect.poll(() => borders("country-borders")).toBe("visible");
    await tray(page).getByRole("switch", { name: "Show Borders & names in this view" }).click();
    await expect.poll(() => borders("country-borders")).toBe("none");

    // Nothing matches: it says so, and says where the rest is.
    await search.fill("zzzz");
    await expect(tray(page)).toContainText("No source here is called “zzzz”. Open the full map for all");
    expect(errors).toEqual([]);
  });

  test("a mouse drag pins a row onto the bar, between Turn and Sources", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Security" }).click();
    const protests = row(page, "protests");
    await expect(protests).toBeVisible();
    await drag(page, await centre(protests.locator(".tn-src-label")), await gapBeforeSources(page));

    const pinned = bar(page).getByRole("button", { name: /^Protests/ });
    await expect(pinned).toHaveCount(1);
    const turn = (await bar(page).getByRole("button", { name: "Turn" }).boundingBox())!;
    const at = (await pinned.boundingBox())!;
    const src = (await sourcesButton(page).boundingBox())!;
    expect(at.x).toBeGreaterThan(turn.x);
    expect(at.x).toBeLessThan(src.x);
    await expect(row(page, "protests").locator(".tn-src-add")).toHaveAttribute("aria-pressed", "true");
    // Dropped elsewhere, nothing is pinned.
    await drag(page, await centre(row(page, "conflict").locator(".tn-src-label")), { x: 300, y: 500 });
    await expect(bar(page).locator("[data-pin]")).toHaveCount(1);
  });

  test("without dragging: the plus pins, Alt+Left moves, Delete unpins", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Show all" }).click();

    const gliders = row(page, "gliders").locator(".tn-src-add");
    await gliders.focus();
    await page.keyboard.press("Enter");
    await expect(gliders).toHaveAttribute("aria-pressed", "true");
    await expect(gliders).toHaveAttribute("aria-label", /^Unpin Gliders/);
    await row(page, "crime").locator(".tn-src-add").click();
    const order = () => bar(page).locator("[data-pin]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pin")));
    expect(await order()).toEqual(["gliders", "crime"]);

    await pin(page, "crime").focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(order).toEqual(["crime", "gliders"]);
    await expect(pin(page, "crime")).toBeFocused();

    await page.keyboard.press("Delete");
    await expect.poll(order).toEqual(["gliders"]);

    // The right-click menu does the same three things.
    await pin(page, "gliders").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Move left", "Move right", "Unpin"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(tray(page)).toBeVisible();
    await pin(page, "gliders").click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Unpin" }).click();
    await expect(bar(page).locator("[data-pin]")).toHaveCount(0);
  });

  test("a pin dragged off the bar is unpinned, and the bar holds five", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Show all" }).click();
    for (const id of ["gliders", "crime", "protests", "conflict", "earthquakes"]) {
      await row(page, id).locator(".tn-src-add").click();
    }
    await expect(bar(page).locator("[data-pin]")).toHaveCount(5);
    // Full: the sixth is refused, in words.
    await row(page, "wildfires").locator(".tn-src-add").click();
    await expect(page.getByRole("status").filter({ hasText: "The bar holds 5. Unpin one first." })).toHaveCount(1);
    await expect(bar(page).locator("[data-pin]")).toHaveCount(5);

    await drag(page, await centre(pin(page, "crime")), { x: 300, y: 560 });
    await expect(pin(page, "crime")).toHaveCount(0);
    await expect(bar(page).locator("[data-pin]")).toHaveCount(4);
  });

  test("what is on and pinned is remembered, and the console's own board is not touched", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("switch", { name: /^Show Planes/ }).click();
    await tray(page).getByRole("tab", { name: "Show all" }).click();
    await row(page, "crime").locator(".tn-src-add").click();
    await tray(page).getByRole("switch", { name: "Show UK street crime in this view" }).click();

    await page.reload();
    await ready(page);
    await expect(pin(page, "crime")).toHaveAttribute("aria-pressed", "true");
    await openTray(page);
    await expect(tray(page).getByRole("switch", { name: /^Show Planes/ })).toHaveAttribute("aria-checked", "false");
    await expect(ledger(page).locator('p[data-k="plane"]')).toHaveCount(0);

    const stored = await page.evaluate(() => ({
      mine: localStorage.getItem("tn.eye.sources.v1"),
      variant: localStorage.getItem("tn.variant.v1"),
      inspector: localStorage.getItem("tn.inspector.v1"),
    }));
    expect(JSON.parse(stored.mine!)).toEqual({ v: 1, d: { ownOff: ["planes"], consoleOn: ["crime"], pins: ["crime"] } });
    expect(stored.variant).toBeNull();
    expect(stored.inspector).toBeNull();
  });

  test("Escape closes the tray and focus goes back to Sources", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await page.keyboard.press("Escape");
    await expect(tray(page)).toHaveCount(0);
    await expect(sourcesButton(page)).toBeFocused();
    // The button opens and closes it too.
    await sourcesButton(page).click();
    await expect(tray(page)).toBeVisible();
    await sourcesButton(page).click();
    await expect(tray(page)).toHaveCount(0);
  });

  test("the hint stays out of the tray's way, and its ? closes the tray", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const plate = page.locator('aside[aria-label="How to move the view"]');
    await expect(plate).toBeVisible();
    await openTray(page);
    await expect(plate).toHaveCount(0);
    // The ? beside the clock brings the hint back, and the tray gives way to it.
    await page.locator("[data-hint-toggle]").click();
    await expect(tray(page)).toHaveCount(0);
    await expect(plate).toBeVisible();
  });

  test("outside London the three road switches are off and say why", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?lat=60.17&lon=24.94");
    await ready(page);
    await openTray(page);
    for (const [id, name] of [
      ["road-works", /^Show Roadworks/],
      ["road-incidents", /^Show Road incidents/],
      ["road-closures", /^Show Road closures/],
    ] as const) {
      await expect(tray(page).getByRole("switch", { name })).toBeDisabled();
      await row(page, id).locator(".tn-src-label").hover();
      await expect(row(page, id).locator(".tn-src-pop")).toContainText("London only in this view");
    }
    // Only the road rows are held back: the others still work here.
    await expect(tray(page).getByRole("switch", { name: /^Show Planes/ })).toBeEnabled();
  });

  test("always the console's dark mode, while the console is set to light; /app keeps its own", async ({ page }) => {
    // Three fresh browser contexts, each loading /eye and then /app.
    test.setTimeout(150_000);
    await feeds(page);
    // Light saved, then nothing saved: /eye is dark either way and writes nothing, and /app
    // then does what that browser's saved choice says: a saved light stays light, and nothing
    // saved opens dark, the console's own default.
    for (const saved of ["light", null] as const) {
      const ctx = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await ctx.newPage();
      await feeds(p);
      await p.addInitScript((value) => {
        if (value) localStorage.setItem("tn.terminal.skin.v2", JSON.stringify({ v: 1, d: value }));
      }, saved);
      await p.goto("/eye?place=westminster");
      await ready(p);
      await expect(p.locator("html")).toHaveAttribute("data-tnx-skin", "dark");
      const headerInk = await p.locator("h1").evaluate((el) => getComputedStyle(el).color);
      await openTray(p);
      const trayBg = await tray(p).evaluate((el) => getComputedStyle(el).backgroundColor);
      const btnBg = await sourcesButton(p).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(trayBg).toBe("rgb(21, 23, 15)");
      expect(btnBg).toBe("rgb(21, 23, 15)");
      // This view's own frame is its own: the same light-on-dark ink as before.
      expect(headerInk).toBe("rgb(238, 243, 241)");
      await p.goto("/app");
      if (saved) await expect(p.locator("html")).not.toHaveAttribute("data-tnx-skin", "dark");
      else await expect(p.locator("html")).toHaveAttribute("data-tnx-skin", "dark");
      const kept = await p.evaluate(() => localStorage.getItem("tn.terminal.skin.v2"));
      expect(kept).toBe(saved ? JSON.stringify({ v: 1, d: saved }) : null);
      await ctx.close();
    }

    // Dark saved: the same dark tray, and /app is dark.
    const ctx = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await feeds(p);
    await p.addInitScript(() => localStorage.setItem("tn.terminal.skin.v2", JSON.stringify({ v: 1, d: "dark" })));
    await p.goto("/eye?place=westminster");
    await ready(p);
    await openTray(p);
    expect(await tray(p).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(21, 23, 15)");
    await p.goto("/app");
    await expect(p.locator("html")).toHaveAttribute("data-tnx-skin", "dark");
    await ctx.close();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a pop-up above the bar, a grip that carries a row, and a hit box of 44 px on every control", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const src = (await sourcesButton(page).boundingBox())!;
    expect(src.height).toBeGreaterThanOrEqual(44);
    await sourcesButton(page).tap();
    await expect(tray(page)).toBeVisible();
    const t = (await tray(page).boundingBox())!;
    const barBox = (await bar(page).boundingBox())!;
    // 10 px inside the screen edges, its bottom 8 px above the bar.
    expect(Math.round(t.x)).toBe(10);
    expect(Math.round(390 - (t.x + t.width))).toBe(10);
    expect(Math.round(barBox.y - (t.y + t.height))).toBe(8);
    expect(t.height).toBeLessThanOrEqual(470);
    for (const r of await tray(page).locator(".tn-src-row").all()) {
      expect(Math.round((await r.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    }

    // Show all grows it.
    await tray(page).getByRole("tab", { name: "Show all" }).tap();
    const all = (await tray(page).boundingBox())!;
    expect(all.height).toBeGreaterThan(t.height + 40);
    expect(all.y).toBeLessThan(120);
    // Every ＋ and switch in view has a hit box of 44 x 44: a point 18 px off the painted
    // centre still lands on it.
    const misses = await tray(page).evaluate((el) => {
      const out: string[] = [];
      const box = el.getBoundingClientRect();
      for (const c of el.querySelectorAll<HTMLElement>(".tn-src-add, .tn-src-toggle")) {
        const r = c.getBoundingClientRect();
        if (r.bottom < box.top + 120 || r.top > box.bottom - 60) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (const [dx, dy] of [[18, 0], [-18, 0], [0, 18], [0, -18]]) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (hit !== c) out.push(`${c.className}@${Math.round(cx)},${Math.round(cy)} ${dx},${dy} -> ${hit?.className}`);
        }
      }
      return out;
    });
    expect(misses).toEqual([]);

    // A row's grip carries it, by touch, onto the bar.
    const client = await page.context().newCDPSession(page);
    const gripEl = tray(page).locator('.tn-src-row[data-source-row="gliders"] .tn-src-grip');
    await gripEl.scrollIntoViewIfNeeded();
    const grip = await centre(gripEl);
    const bar2 = (await bar(page).boundingBox())!;
    const to = { x: bar2.x + bar2.width / 2, y: bar2.y + bar2.height / 2 };
    const touch = (type: string, x: number, y: number) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", grip.x, grip.y);
    for (let i = 1; i <= 14; i++) await touch("touchMove", grip.x + ((to.x - grip.x) * i) / 14, grip.y + ((to.y - grip.y) * i) / 14);
    await touch("touchEnd", to.x, to.y);
    await expect(bar(page).locator('[data-pin="gliders"]')).toHaveCount(1);

    // The bar scrolls sideways once it holds more than it shows; the page never does.
    await tray(page).getByRole("tab", { name: "Sections" }).tap();
    for (const id of ["crime", "protests", "conflict", "earthquakes", "wildfires"]) {
      await tray(page).getByRole("tab", { name: "Show all" }).tap();
      await row(page, id).locator(".tn-src-add").scrollIntoViewIfNeeded();
      await row(page, id).locator(".tn-src-add").tap();
    }
    expect(await bar(page).locator("[data-pin]").count()).toBe(6);
    const scrolls = await page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>('nav[aria-label="View controls"] > div');
      return strip ? strip.scrollWidth > strip.clientWidth : false;
    });
    expect(scrolls).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // A tap on the scene outside closes the pop-up.
    await page.touchscreen.tap(195, 56);
    await expect(tray(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("nothing scrolls sideways at 360 wide with the tray open", async ({ page }) => {
    await feeds(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/eye?place=westminster");
    await ready(page);
    await sourcesButton(page).tap();
    await expect(tray(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const t = (await tray(page).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(360);
  });
});

test("the console's own rail is unchanged: a row's plus asks where, and the switch toggles the layer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sources=open");
  const rail = page.locator('aside.tn-rail[aria-label="Sources"]');
  await expect(rail).toBeVisible({ timeout: 30_000 });
  const first = rail.locator(".tn-src-row").first();
  await expect(first.locator(".tn-src-grip")).toHaveCount(0);
  await expect(first.locator(".tn-src-add")).not.toHaveAttribute("aria-pressed", /.*/);
  await first.locator(".tn-src-add").click();
  await expect(page.getByRole("dialog").filter({ has: page.locator("#tn-place-h") })).toBeVisible();
  await page.keyboard.press("Escape");
  const toggle = rail.locator('.tn-src-row[data-source-row="satellites"] .tn-src-toggle');
  const was = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-checked", was!);
});
