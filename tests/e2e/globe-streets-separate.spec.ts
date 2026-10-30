import { expect, test, type Page } from "@playwright/test";

// GLOBE AND STREETS HAVE SEPARATE SOURCES AND INSPECTORS.
//
// Each view (board) keeps its own whole-map sources in tn.variant.v1 `views`, its own
// Inspector state and its own map position for the visit, and the Sources pane offers
// "Use same sources from <view>" once after a switch. Unit tests hold the logic
// (view-sources, view-memory, view-switch); this file holds what only a browser shows:
// the button where it belongs, the click that copies, the Undo, a reload, an old
// browser's saved state, a shared link opened in a fresh context, and the phone sheet.
//
// THE FEEDS ARE ROUTED, so no upstream is needed and every source is "on" without
// anything arriving; the assertions read the rail's own switches, not the map.

test.setTimeout(120_000);

const EMPTY_SIGNAL = JSON.stringify({ ok: true, observedAt: 0, count: 0, features: [] });

async function quiet(page: Page) {
  await page.addInitScript(() => {
    // The first-visit boot plate sits over the map and takes the first clicks.
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.route((url) => url.pathname.startsWith("/api/signals/"), (route) =>
    route.fulfill({ contentType: "application/json", body: EMPTY_SIGNAL }),
  );
  await page.route((url) => url.pathname === "/api/cameras", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ cameras: [] }) }),
  );
}

const row = (page: Page, id: string) => page.locator(`.tn-src-row[data-source-row="${id}"]`);
const toggle = (page: Page, id: string) => row(page, id).locator(".tn-src-toggle");
const board = (page: Page, title: string) => page.locator(".tnx-hdr-board", { hasText: title });

async function on(page: Page, id: string, want: boolean) {
  await expect(row(page, id)).toHaveAttribute("data-on", String(want));
}
async function switchOn(page: Page, id: string) {
  await toggle(page, id).click();
  await on(page, id, true);
}
async function open(page: Page, url = "/app?sources=open") {
  await page.goto(url);
  await expect(page.locator(".tn-rail")).toBeVisible();
  await expect(page.locator(".tn-ctxbar-name")).toHaveText("Globe");
}
/** Click a board tab; it is the open board when its tab is pressed. */
async function go(page: Page, title: string) {
  await board(page, title).click();
  await expect(board(page, title)).toHaveAttribute("aria-pressed", "true");
}
/** tn.variant.v1 as the app saved it. */
const saved = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("tn.variant.v1");
    return raw ? (JSON.parse(raw) as { d: { views?: Record<string, { layers: Record<string, boolean>; signals: string[] }>; overrides?: Record<string, unknown> } }).d : null;
  });

async function shot(page: Page, name: string) {
  // Let the map finish painting its tiles, so the frame is not caught half-drawn.
  await page
    .waitForFunction(() => (window as unknown as { __map?: { loaded(): boolean } }).__map?.loaded() === true, undefined, { timeout: 8_000 })
    .catch(() => {});
  await page.screenshot({ path: `persona-shots/globe-streets-separate-${name}.png` });
}
/** The dark skin, then a moment for its colour transition to finish and the pointer off the tabs. */
async function dark(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute("data-tnx-skin", "dark"));
  await page.mouse.move(900, 500);
  await page.waitForTimeout(600);
}

// ── desktop ───────────────────────────────────────────────────────────────────

test("each view keeps its own sources, and the button copies the other view's once, with Undo", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);

  // Globe: three sources on.
  for (const id of ["planes", "earthquakes", "wildfires"]) await switchOn(page, id);

  // → Streets: its OWN set (the camera tiers), Globe's three off.
  await go(page, "Streets");
  for (const id of ["planes", "earthquakes", "wildfires"]) await on(page, id, false);
  await on(page, "livecams", true);
  await on(page, "staticcams", true);

  // The button, above the EDITING bar, naming the view just left and what it holds.
  const same = page.locator(".tn-same");
  await expect(same).toBeVisible();
  await expect(page.locator(".tn-same-title")).toHaveText("Use same sources from Globe");
  await expect(page.locator(".tn-same-sub")).toHaveText("Planes, Earthquakes, Wildfires");
  const [sameBox, barBox] = await Promise.all([same.boundingBox(), page.locator(".tn-ctxbar").boundingBox()]);
  expect(sameBox!.y + sameBox!.height).toBeLessThanOrEqual(barBox!.y);
  await shot(page, "1440-light");

  // Press it: Streets becomes an exact copy, and the Undo note takes its place.
  await same.click();
  for (const id of ["planes", "earthquakes", "wildfires"]) await on(page, id, true);
  await on(page, "livecams", false);
  await on(page, "staticcams", false);
  const note = page.locator(".tn-same-slot .tn-undo");
  await expect(note).toContainText("Now using Globe's sources.");
  await expect(page.locator(".tn-same")).toHaveCount(0);
  // The time line is on the note, and it is the length the component set.
  await expect(note.locator(".tn-undo-time")).toHaveCount(1);
  expect(await note.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--tn-undo-ms"))).toBe("6000ms");
  await shot(page, "undo");

  // Undo: Streets' own switches AND the button come back.
  await note.getByRole("button", { name: "Undo" }).click();
  await on(page, "livecams", true);
  await on(page, "staticcams", true);
  await on(page, "planes", false);
  await expect(page.locator(".tn-same-title")).toHaveText("Use same sources from Globe");

  // × keeps this view's own sources and hides the button.
  await page.getByRole("button", { name: "Keep this view's own sources" }).click();
  await expect(page.locator(".tn-same")).toHaveCount(0);

  // → Globe: its three are back, and it is offered Streets' set (the sets differ).
  await go(page, "Globe");
  for (const id of ["planes", "earthquakes", "wildfires"]) await on(page, id, true);
  await on(page, "livecams", false);
  await expect(page.locator(".tn-same-title")).toHaveText("Use same sources from Streets");
  await expect(page.locator(".tn-same-sub")).toHaveText("Live cams, Static cams");

  // Any source change in this view takes the button away.
  await toggle(page, "wildfires").click();
  await expect(page.locator(".tn-same")).toHaveCount(0);
});

test("a fresh browser: Globe has only borders, so Streets is offered nothing", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await go(page, "Streets");
  await expect(page.locator(".tn-same")).toHaveCount(0);
  await expect(page.locator(".tn-same-slot")).toHaveCount(0);
});

test("the note waits while the pointer is on it, and a mouse copy does not take focus", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await switchOn(page, "planes");
  await go(page, "Streets");
  await page.locator(".tn-same").click();
  const note = page.locator(".tn-same-slot .tn-undo");
  await expect(note).toBeVisible();
  // A mouse click must not hand focus to the note, or it would be paused for good.
  expect(await page.evaluate(() => document.activeElement?.closest(".tn-undo") !== null)).toBe(false);
  // Hover pauses it: the line is marked paused.
  await note.hover();
  await expect(note).toHaveAttribute("data-paused", "");
  await page.mouse.move(5, 5);
  await expect(note).not.toHaveAttribute("data-paused", "");
  // And with nothing pointing at it, it goes by itself.
  await expect(note).toHaveCount(0, { timeout: 12_000 });
});

test("a keyboard copy puts focus on Undo, and Esc closes the note and returns to the bar", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await switchOn(page, "planes");
  await go(page, "Streets");
  await page.locator(".tn-same").focus();
  await page.keyboard.press("Enter");
  const undo = page.locator(".tn-same-slot .tn-undo-act");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-same-slot")).toHaveCount(0);
  await expect(page.locator(".tn-ctxbar")).toBeFocused();
  // Copy happened and stays done.
  await on(page, "planes", true);
});

test("the EDITING bar is named after the view; areas keep their names", async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("tn.test.seeded")) return;
    window.localStorage.setItem("tn.test.seeded", "1");
    window.localStorage.setItem(
      "tn.inspector.v1",
      JSON.stringify({
        v: 1,
        d: {
          world: {},
          editing: null,
          areas: [
            { id: "area:1", label: "West Pacific", polygon: [[90, -60], [180, -60], [180, 70], [90, 70]], bbox: [90, -60, 180, 70], createdAt: 1, sources: {} },
          ],
        },
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.locator(".tn-ctxbar-lead")).toHaveText(/editing/i);
  await expect(page.locator(".tn-ctxbar")).toHaveAttribute("aria-label", /^Editing Globe\./);

  await page.locator(".tn-ctxbar").click();
  const firstRow = page.locator(".tn-ctxbar-opt").first();
  await expect(firstRow.locator(".tn-insp-label")).toHaveText("Globe");
  await expect(firstRow.locator(".tn-insp-sub")).toHaveText("Whole map");
  await expect(page.locator(".tn-ctxbar-foot")).toContainText("on every view");
  await page.locator(".tn-ctxbar-opt", { hasText: "West Pacific" }).click();
  await expect(page.locator(".tn-ctxbar-name")).toHaveText("West Pacific");
  await expect(page.locator(".tn-ctxbar-clear")).toHaveAttribute("aria-label", "Clear West Pacific and go back to Globe");

  // The area is shared: it is still there, with its name, on the other view.
  await board(page, "Streets").click();
  await page.locator(".tn-ctxbar").click();
  await expect(page.locator(".tn-ctxbar-opt", { hasText: "West Pacific" })).toBeVisible();
  await expect(page.locator(".tn-ctxbar-opt").first().locator(".tn-insp-label")).toHaveText("Streets");
});

test("the Inspector tab and open tool belong to the view", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await go(page, "Streets");

  // Streets: open Map settings (which also points the rail at the Inspector tab).
  await page.click("#inspector-rail .tn-insp-rail-btn-settings");
  await expect(page.locator("#tn-rail-tab-inspector")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspector-rail .tn-insp-rail-btn-settings")).toHaveAttribute("aria-pressed", "true");

  // Globe: its own, which is the fresh one.
  await go(page, "Globe");
  await expect(page.locator("#tn-rail-tab-sources")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspector-rail .tn-insp-rail-btn-settings")).toHaveAttribute("aria-pressed", "false");

  // Back on Streets: the tool and the tab are as it was left.
  await go(page, "Streets");
  await expect(page.locator("#tn-rail-tab-inspector")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspector-rail .tn-insp-rail-btn-settings")).toHaveAttribute("aria-pressed", "true");
});

test("each view remembers where the map was for this visit", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const centre = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __map: { getCenter(): { lng: number; lat: number }; getZoom(): number } }).__map;
      const c = m.getCenter();
      return { lng: Math.round(c.lng * 100) / 100, lat: Math.round(c.lat * 100) / 100, zoom: Math.round(m.getZoom() * 10) / 10 };
    });
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map));
  // Globe: move the camera somewhere recognisable.
  await page.evaluate(() => {
    (window as unknown as { __map: { jumpTo(o: object): void } }).__map.jumpTo({ center: [12.5, 41.9], zoom: 6 });
  });
  await expect.poll(centre).toMatchObject({ lng: 12.5, lat: 41.9, zoom: 6 });

  await go(page, "Streets");
  await page.evaluate(() => {
    (window as unknown as { __map: { jumpTo(o: object): void } }).__map.jumpTo({ center: [-0.12, 51.5], zoom: 10 });
  });
  await expect.poll(centre).toMatchObject({ lng: -0.12, lat: 51.5, zoom: 10 });

  await go(page, "Globe");
  await expect.poll(centre).toMatchObject({ lng: 12.5, lat: 41.9, zoom: 6 });
  await go(page, "Streets");
  await expect.poll(centre).toMatchObject({ lng: -0.12, lat: 51.5, zoom: 10 });
});

// ── persistence ───────────────────────────────────────────────────────────────

test("a reload keeps both views' own sets, and the old overrides field is still written", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await switchOn(page, "earthquakes");
  await go(page, "Streets");
  await switchOn(page, "volcanoes");

  const s = await saved(page);
  expect(Object.keys(s!.views ?? {}).sort()).toEqual(["overview", "streets"]);
  expect(s!.views!.overview.signals).toEqual(["earthquakes"]);
  expect(s!.views!.streets.signals).toEqual(["volcanoes"]);
  expect(s!.overrides).toBeTruthy(); // older builds read this

  // A reload: a new page load (the rail starts closed, so ask for it open).
  await page.goto("/app?sources=open");
  await expect(board(page, "Streets")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tn-ctxbar-name")).toHaveText("Streets");
  await on(page, "volcanoes", true);
  await on(page, "earthquakes", false);
  await go(page, "Globe");
  await on(page, "earthquakes", true);
  await on(page, "volcanoes", false);
});

test("a browser that saved before views existed gets its one set back on the board it was last on", async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => {
    if (window.localStorage.getItem("tn.test.seeded")) return;
    window.localStorage.setItem("tn.test.seeded", "1");
    window.localStorage.setItem(
      "tn.variant.v1",
      JSON.stringify({
        v: 1,
        d: {
          activeId: "explore",
          userVariants: [],
          layoutOverrides: {},
          overrides: { explore: { layers: { planes: false }, signals: { earthquakes: true, volcanoes: true } } },
        },
      }),
    );
    window.localStorage.setItem("tn.console.activePreset.v1", JSON.stringify({ v: 1, d: "streets" }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app?sources=open");
  await expect(page.locator(".tn-ctxbar-name")).toHaveText("Streets");
  await on(page, "earthquakes", true);
  await on(page, "volcanoes", true);
  await on(page, "planes", false);

  const s = await saved(page);
  expect(Object.keys(s!.views ?? {})).toEqual(["streets"]);
  expect(s!.views!.streets.signals.sort()).toEqual(["earthquakes", "volcanoes"]);

  // The other view starts from its default: borders only.
  await go(page, "Globe");
  await on(page, "earthquakes", false);
  await on(page, "volcanoes", false);
  await on(page, "livecams", false);
});

test("a shared link opens the view it was copied from, and its sources land there only", async ({ page, browser }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await go(page, "Streets");
  await switchOn(page, "volcanoes");
  // The writer is debounced and waits for the map.
  await expect.poll(() => page.url(), { timeout: 15_000 }).toContain("preset=streets");
  expect(page.url()).toContain("volcanoes");
  const link = page.url();

  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await other.newPage();
  await quiet(p2);
  await p2.goto(link + "&sources=open");
  await expect(p2.locator(".tn-ctxbar-name")).toHaveText("Streets");
  await on(p2, "volcanoes", true);
  await on(p2, "livecams", true);
  // That browser's Globe is untouched.
  await go(p2, "Globe");
  await on(p2, "volcanoes", false);
  const s2 = await saved(p2);
  expect(s2!.views!.overview.signals).toEqual([]);
  await other.close();
});

test("/eye never writes views", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.goto("/eye");
  await page.waitForTimeout(1500);
  expect(await saved(page)).toBeNull();
});

// ── dark and phone ────────────────────────────────────────────────────────────

test("1440 dark: the button and the note read in the dark skin", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await switchOn(page, "planes");
  await switchOn(page, "earthquakes");
  await go(page, "Streets");
  await dark(page);
  await expect(page.locator(".tn-same")).toBeVisible();
  const colours = await page.locator(".tn-same").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  expect(colours.bg).not.toBe(colours.fg);
  await shot(page, "1440-dark");
});

test("390 phone: the button is the first thing in the Sources sheet, one line, 44px targets, no sideways scroll", async ({ page }) => {
  await quiet(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app?sources=open");
  await expect(page.locator(".tn-rail")).toBeVisible();
  await switchOn(page, "planes");
  await switchOn(page, "earthquakes");
  await go(page, "Streets");
  // The sheet may close or stay on a switch; make sure it is open on Sources.
  if (!(await page.locator(".tn-same").isVisible())) await page.goto("/app?sources=open");
  await expect(page.locator(".tn-same")).toBeVisible();

  const title = page.locator(".tn-same-title");
  await expect(title).toHaveText("Use same sources from Globe");
  const lines = await title.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  });
  expect(lines).toBe(1);
  const [same, x] = await Promise.all([page.locator(".tn-same").boundingBox(), page.locator(".tn-same-x").boundingBox()]);
  expect(same!.height).toBeGreaterThanOrEqual(44);
  // In view, under the sheet's tab strip, even though two sources far down the list were
  // switched on first (the sheet keeps its scroll across a switch, so the button scrolls itself in).
  const tabs = await page.locator("#tn-rail-tab-sources").boundingBox();
  expect(same!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height);
  expect(same!.y + same!.height).toBeLessThanOrEqual(844);
  expect(x!.height).toBeGreaterThanOrEqual(44);
  expect(x!.width).toBeGreaterThanOrEqual(44);
  // First in the sheet: above the EDITING bar and nothing but the button's own slot before it.
  const first = await page.locator("#tn-rail-panel-sources").evaluate((el) => (el.firstElementChild as HTMLElement).className);
  expect(first).toContain("tn-same-slot");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "390-light");

  await page.locator(".tn-same").click();
  const undoBtn = page.locator(".tn-same-slot .tn-undo-act");
  await expect(undoBtn).toBeVisible();
  expect((await undoBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await dark(page);
  await shot(page, "390-dark");
});
