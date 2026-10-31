import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's Sources tray (/eye): the console's rows as the design's pop-over beside
 * the sidebar, with "Show all", and pins that are switch rows in the sidebar.
 *
 *   1  the tray: This view's seven rows, in one column, each a name and a detail line with no
 *      count; Ships off leaves no ship tags, and on brings them back
 *   2  Show all, search, a console layer on: its credit, no Marks key
 *   3  the ＋ pins a row as a switch in the sidebar, which switches the source
 *   4  the same from the keyboard, in the order pressed; the state holds six
 *   5  what is on and pinned is remembered, apart from the console's board
 *   6  Escape closes the tray and focus goes back to its row
 *   7  a phone: a pop-up under the search, 44 px hit boxes, pins behind the menu
 *   8  outside London the three road switches are off and say why, and a road pin waits
 *   9  the HUD's own dark look while the console is light, and /app keeps its own setting
 *   10 the console's own rail is unchanged
 *   (and the control hint steps aside for the tray, and Controls closes the tray)
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

const sourcesButton = (page: Page) => page.locator('[data-rail="eye"] [data-rail-entry="sources"]');
const tray = (page: Page) => page.locator("aside#eye-sources");
const railPin = (page: Page, id: string) => page.locator(`[data-rail="eye"] [data-rail-entry="pin-${id}"]`);
const railPins = (page: Page) => page.locator('[data-rail="eye"] [data-rail-entry^="pin-"]');
const row = (page: Page, id: string) => tray(page).locator(`.tn-src-row[data-source-row="${id}"]`);
const menu = (page: Page) => page.locator('[data-rail="eye"] [data-rail-menu]');

async function openTray(page: Page) {
  if ((page.viewportSize()?.width ?? 0) <= 900) await menu(page).click();
  await sourcesButton(page).click();
  await expect(tray(page)).toBeVisible();
}

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the tray: this view's seven rows, in one column, a detail line under each, and Ships switches off and on", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);

    await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "false");
    await openTray(page);
    await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "true");
    // The HUD's own look, out of the console's token scope.
    await expect(page.locator(".tn-terminal aside#eye-sources")).toHaveCount(0);
    await expect(tray(page)).toHaveAttribute("role", "dialog");
    await expect(tray(page)).toHaveAttribute("data-eye-keep", "");

    const rows = tray(page).locator(".tn-src-row");
    await expect(rows).toHaveCount(7);
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-source-row")));
    expect(ids).toEqual(["livecams", "staticcams", "ais", "planes", "road-works", "road-incidents", "road-closures"]);
    // One column: one left edge.
    const lefts = new Set(await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left))));
    expect(lefts.size).toBe(1);
    // Each row has its detail line, and nothing says how many.
    for (const r of await rows.all()) {
      const lines = (await r.innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
      expect(lines.length, await r.getAttribute("data-source-row") ?? "").toBeGreaterThanOrEqual(2);
    }
    expect(await tray(page).innerText()).not.toMatch(/\b\d+\s+(here|named|nearby|moving|in view)\b/);
    await expect(row(page, "ais")).toContainText("AIS heard in the last 20 min");

    // Ships: on at first, with tags on the water.
    const ships = tray(page).getByRole("switch", { name: /^Show Ships/ });
    await expect(ships).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached();

    await ships.click();
    await expect(ships).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-kind="ship"]')).toHaveCount(0);

    await ships.click();
    await expect(page.locator('[data-kind="ship"]').first()).toBeAttached({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("Show all: search, a console layer on has its credit, and there is no Marks key", async ({ page }) => {
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

    await expect(row(page, "crime")).toContainText("data.police.uk");
    await page.getByRole("button", { name: "© Credits" }).click();
    await expect(page.locator("footer")).toContainText("data.police.uk");
    await page.getByRole("button", { name: "© Credits" }).click();
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

    // Nothing matches: it says so.
    await search.fill("zzzz");
    await expect(tray(page)).toContainText("No source here is called “zzzz”.");
    // The foot says what this view leaves out, with no count.
    await expect(tray(page)).toContainText("Not drawn here: country-wide layers");
    expect(errors).toEqual([]);
  });

  test("the plus pins a row as a switch in the sidebar, which switches the source", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Security" }).click();
    const plus = row(page, "protests").locator(".tn-src-add");
    await expect(plus).toHaveAttribute("aria-label", "Pin Protests to the sidebar");
    await plus.click();
    await expect(plus).toHaveAttribute("aria-pressed", "true");
    await expect(plus).toHaveAttribute("aria-label", "Unpin Protests from the sidebar");
    await expect(page.getByRole("status").filter({ hasText: "Pinned Protests to the sidebar." })).toHaveCount(1);

    // In the sidebar, under Sources & layers.
    const pinned = railPin(page, "protests");
    await expect(pinned).toHaveAttribute("role", "switch");
    await expect(pinned).toHaveAttribute("aria-checked", "false");
    const [a, b] = [(await sourcesButton(page).boundingBox())!, (await pinned.boundingBox())!];
    expect(b.y).toBeGreaterThan(a.y);
    // It and the tray's switch are one state.
    await pinned.click();
    await expect(pinned).toHaveAttribute("aria-checked", "true");
    await expect(tray(page).getByRole("switch", { name: "Show Protests in this view" })).toHaveAttribute("aria-checked", "true");

    await plus.click();
    await expect(railPins(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Unpinned Protests." })).toHaveCount(1);
  });

  test("the keyboard pins in the order pressed, and the sidebar holds six", async ({ page }) => {
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
    const order = () => railPins(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-rail-entry")));
    expect(await order()).toEqual(["pin-gliders", "pin-crime"]);

    for (const id of ["protests", "conflict", "earthquakes", "wildfires"]) await row(page, id).locator(".tn-src-add").click();
    await expect(railPins(page)).toHaveCount(6);
    // Full: the seventh is refused, in words.
    await row(page, "military-air").locator(".tn-src-add").click();
    await expect(page.getByRole("status").filter({ hasText: "The sidebar holds 6. Unpin one first." })).toHaveCount(1);
    await expect(railPins(page)).toHaveCount(6);
    await expect(row(page, "military-air").locator(".tn-src-add")).toHaveAttribute("aria-pressed", "false");
  });

  test("a short window keeps the sidebar's foot on screen, and the rest stay pinned in the tray", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("tn.eye.sources.v1", JSON.stringify({ v: 1, d: { ownOff: [], consoleOn: [], pins: ["ais", "planes", "livecams", "staticcams", "gliders", "crime"] } })),
    );
    await feeds(page);
    await page.setViewportSize({ width: 1440, height: 560 });
    await page.goto("/eye?place=westminster");
    await ready(page);
    expect(await railPins(page).count()).toBeLessThan(6);
    const controls = (await page.locator('[data-rail="eye"] [data-rail-entry="controls"]').boundingBox())!;
    expect(controls.y + controls.height).toBeLessThanOrEqual(560);
    await openTray(page);
    await tray(page).getByRole("tab", { name: "Show all" }).click();
    await expect(row(page, "crime").locator(".tn-src-add")).toHaveAttribute("aria-pressed", "true");
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
    await expect(railPin(page, "crime")).toHaveAttribute("aria-checked", "true");
    await openTray(page);
    await expect(tray(page).getByRole("switch", { name: /^Show Planes/ })).toHaveAttribute("aria-checked", "false");

    const stored = await page.evaluate(() => ({
      mine: localStorage.getItem("tn.eye.sources.v1"),
      variant: localStorage.getItem("tn.variant.v1"),
      inspector: localStorage.getItem("tn.inspector.v1"),
    }));
    expect(JSON.parse(stored.mine!)).toEqual({ v: 1, d: { ownOff: ["planes"], consoleOn: ["crime"], pins: ["crime"] } });
    expect(stored.variant).toBeNull();
    expect(stored.inspector).toBeNull();
  });

  test("Escape closes the tray and focus goes back to its row", async ({ page }) => {
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

  test("the hint stays out of the tray's way, and Controls closes the tray", async ({ page }) => {
    await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    const plate = page.locator('aside[aria-label="How to move the view"]');
    await expect(plate).toBeVisible();
    await openTray(page);
    await expect(plate).toHaveCount(0);
    // The sidebar's Controls row brings the hint back, and the tray gives way to it.
    await page.locator('[data-rail="eye"] [data-rail-entry="controls"]').click();
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

  test("outside London a road pin waits in the tray, with no switch that does nothing", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("tn.eye.sources.v1", JSON.stringify({ v: 1, d: { ownOff: [], consoleOn: [], pins: ["road-works", "ais"] } })),
    );
    await feeds(page);
    await page.goto("/eye?lat=60.17&lon=24.94");
    await ready(page);
    await expect(railPin(page, "ais")).toHaveCount(1);
    await expect(railPin(page, "road-works")).toHaveCount(0);
    await openTray(page);
    await expect(row(page, "road-works").locator(".tn-src-add")).toHaveAttribute("aria-pressed", "true");
  });

  test("the HUD's own dark look, while the console is set to light; /app keeps its own", async ({ page }) => {
    // Three fresh browser contexts, each loading /eye and then /app.
    test.setTimeout(150_000);
    await feeds(page);
    // Light saved, then nothing saved: /eye is dark either way, and the console is untouched.
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
      expect(trayBg).toBe("rgb(12, 15, 19)");
      // This view's own frame is its own: the design's light-on-dark ink.
      expect(headerInk).toBe("rgb(232, 236, 240)");
      await p.goto("/app");
      await expect(p.locator("html")).not.toHaveAttribute("data-tnx-skin", "dark");
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
    expect(await tray(p).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(12, 15, 19)");
    await p.goto("/app");
    await expect(p.locator("html")).toHaveAttribute("data-tnx-skin", "dark");
    await ctx.close();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a pop-up under the search, a hit box of 44 px on every control, and pins behind the menu", async ({ page }) => {
    const errors = await feeds(page);
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
    const t = (await tray(page).boundingBox())!;
    // 10 px inside the screen edges, under the pill.
    expect(Math.round(t.x)).toBe(10);
    expect(Math.round(390 - (t.x + t.width))).toBe(10);
    expect(t.y).toBeGreaterThanOrEqual(58);
    for (const r of await tray(page).locator(".tn-src-row").all()) {
      expect(Math.round((await r.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    }

    // Show all grows it.
    await tray(page).getByRole("tab", { name: "Show all" }).tap();
    const all = (await tray(page).boundingBox())!;
    expect(all.height).toBeGreaterThan(t.height + 40);
    // Every ＋ and switch in view has a hit box of 44 x 44: a point 18 px off the painted
    // centre still lands on it.
    const misses = await tray(page).evaluate((el) => {
      const out: string[] = [];
      // Only rows whose hit box is whole inside the part that scrolls.
      const box = el.querySelector('[role="tabpanel"]')!.getBoundingClientRect();
      for (const c of el.querySelectorAll<HTMLElement>(".tn-src-add, .tn-src-toggle")) {
        const r = c.getBoundingClientRect();
        if (r.top - 22 < box.top || r.bottom + 22 > box.bottom) continue;
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

    // The ＋ pins, and the pin is a switch in the sheet behind the menu.
    const plus = row(page, "gliders").locator(".tn-src-add");
    await plus.scrollIntoViewIfNeeded();
    await plus.tap();
    await expect(plus).toHaveAttribute("aria-pressed", "true");
    await menu(page).tap();
    await expect(railPin(page, "gliders")).toBeVisible();
    expect((await railPin(page, "gliders").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await railPin(page, "gliders").tap();
    await expect(railPin(page, "gliders")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // A tap outside closes the pop-up.
    await page.touchscreen.tap(195, 30);
    await expect(tray(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("nothing scrolls sideways at 360 wide with the tray open", async ({ page }) => {
    await feeds(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/eye?place=westminster");
    await ready(page);
    await openTray(page);
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
