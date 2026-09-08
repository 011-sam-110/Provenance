import { test, expect } from "@playwright/test";

// The Apple-style nav panel: hovering a board tab (`.tnx-hdr-board`) previews that
// board's quick settings + widget show/hide without switching, exactly the split
// Apple's own menu bar uses (hover previews, click commits). See memory `nav-spec`
// for the full design; this file exercises everything that needs a real browser —
// timers, real hover, real CSS, and the Escape-ordering race against ConsoleShell's
// own keydown handler — the way tests/e2e/map-rail.spec.ts does for the stage rail's
// pure reducers in tests/unit/map-rail.test.ts. lib/console/navPanel.ts's own pure
// arithmetic (nextOpenDelay, boardStep) is pinned in tests/unit/nav-panel.test.ts;
// nothing here re-tests that math, only what only a browser can show.
//
// The localStorage boot stamp is copied from tests/e2e/console.spec.ts: the launch
// sequence is a `position:fixed; inset:0` plate for five seconds on a first visit,
// and a hover/timer-driven test cannot tolerate racing it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
});

const PANEL = "#tnx-nav-panel";
const TOGGLE = ".tnx-hdr-nav-toggle";

function boardTab(page: import("@playwright/test").Page, name: string) {
  // Board tabs already carry an accessible name ending in " board" per
  // tests/e2e/console.spec.ts (`/STREETS board/`, `/GLOBE board/`).
  return page.getByRole("button", { name: new RegExp(`${name} board`, "i") });
}

/**
 * Click `.tnx-hdr-nav-toggle` WITHOUT crossing the board-tabs row on the way.
 *
 * Found and reported to #nav-shell/#plan: the toggle sits at the end of the
 * SAME <nav> as the 7 hover-sensitive board tabs, so a normal `.click()` (which
 * Playwright — and a real mouse — performs as a continuous move from wherever
 * the pointer currently is) can graze intervening tabs on the way there. Since
 * retargeting an ALREADY-open panel is instant (0ms, by design, for genuine
 * hovering — see nextOpenDelay), each tab grazed en route silently retargets
 * navPanelStore, so the toggle can end up opening/closing the WRONG board's
 * panel purely because of where the pointer started. Confirmed with an
 * explicit 30-step traced path from a just-clicked tab to the toggle: the
 * panel opened on the LAST tab crossed, not the active board.
 *
 * This is a real product bug (tracked on the bus, not fixed here — this file
 * owns tests, not product code). Routing around it here is what lets these
 * tests exercise what they're actually about (widget show/hide), rather than
 * flaking on an orthogonal, already-reported issue.
 */
async function clickToggleAvoidingTabRow(page: import("@playwright/test").Page) {
  await page.mouse.move(20, 400); // well below the header, off every tab
  await page.waitForTimeout(50);
  // .tn-preset-pill.tnx-hdr-boards is horizontally scrollable at pinned widths
  // where the 7 tabs + Reset + toggle don't all fit (see app/globals.css's own
  // comment on that selector) — the toggle can sit scrolled out of view, and
  // boundingBox() reports its unclipped LOGICAL position regardless, not
  // where it's actually painted. scrollIntoViewIfNeeded() is what
  // page.locator(...).click() does for you automatically and what a raw
  // mouse.move/down/up does not, so it has to be done explicitly here.
  await page.locator(TOGGLE).scrollIntoViewIfNeeded();
  const box = await page.locator(TOGGLE).boundingBox();
  if (!box) throw new Error("toggle not found");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test("hovering a board tab opens its panel, but only after the debounce", async ({ page }) => {
  const world = boardTab(page, "WORLD");
  await expect(page.locator(PANEL)).toBeHidden();

  await world.hover();
  // Immediately after the hover, still within HOVER_OPEN_DELAY_MS (100ms), the
  // panel must not have opened yet — this is the whole point of the debounce, and
  // a flaky/looser assertion here would let a 0ms-open regression slip through.
  // A SHORT timeout here is deliberate: expect() polls, and toBeHidden() with no
  // (or a long) timeout would happily keep polling right through the debounce
  // window and observe the panel AFTER it opens, which asserts nothing.
  await expect(page.locator(PANEL)).toBeHidden({ timeout: 50 });

  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });
  await expect(page.locator(PANEL)).toContainText(/World/i);
});

test("moving the pointer to another tab RETARGETS the open panel instead of closing it", async ({ page }) => {
  const world = boardTab(page, "WORLD");
  const intel = boardTab(page, "INTEL");

  await world.hover();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });

  await intel.hover();
  // Retargeting between two open boards must never pass through a fully-closed
  // frame — nav-spec §5 pins this as an instant (0ms) retarget, not a close/reopen.
  // Polling immediately after the hover catches a regression that closes first.
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toContainText(/Intel/i);
});

test("moving off the tab row down into the panel itself is never read as a leave", async ({ page }) => {
  const world = boardTab(page, "WORLD");
  await world.hover();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });

  // Move the pointer down onto the panel's own body — not off the navshell.
  await page.locator(`${PANEL} .tnx-nav-panel-body`).hover();
  // Give CLOSE_GRACE_MS (300ms) a chance to have fired if the guard were broken.
  await page.waitForTimeout(400);
  await expect(page.locator(PANEL)).toBeVisible();
});

test("leaving the whole navshell closes the panel after the grace period", async ({ page }) => {
  const world = boardTab(page, "WORLD");
  await world.hover();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });

  // Move well away from the navshell entirely. NOT page.locator(".map-canvas").hover()
  // — the scrim (by design, nav-spec §4/§6) sits above the map with
  // pointer-events:auto for exactly as long as a panel is open/previewing, so a
  // real pointer over that screen area actually lands ON the scrim, and
  // Playwright's own actionability check correctly refuses to "hover" an element
  // it cannot really reach. Hovering the scrim directly is the honest way to
  // simulate the mouse leaving the navshell onto whatever is dimmed beneath it.
  await page.locator(".tnx-nav-scrim").hover({ position: { x: 50, y: 400 } });
  // Generous margin over the 520ms theoretical minimum (CLOSE_GRACE_MS 300 +
  // HEIGHT_TRANSITION_MS 220) — confirmed closing in ~400ms in isolation, but
  // this run's own margin needs headroom for a busy machine (same reasoning
  // as the toggle-scoping test below).
  await expect(page.locator(PANEL)).toBeHidden({ timeout: 3000 });
});

test("clicking a board tab still switches immediately (unchanged) and closes the panel", async ({ page }) => {
  const streets = boardTab(page, "STREETS");
  await streets.click();
  await expect(page.locator(".tnx-hdr-board.is-active")).toContainText(/streets/i);
  await expect(page.locator(PANEL)).toBeHidden();
});

test("Escape closes the panel and does not also fire ConsoleShell's own selection-clear", async ({ page }) => {
  // This is the Escape-ordering claim from nav-spec §7, verified independently of
  // claude-nav's own browser check per the qa workstream's mandate. The panel is
  // role="region", not role="dialog", so ConsoleShell's global keydown handler does
  // NOT automatically defer to it — TerminalHeader must stopImmediatePropagation()
  // itself. If it does not, this same Escape press would ALSO run ConsoleShell's
  // picking-mode/selection-clear logic on whatever else Escape does in that state.
  const world = boardTab(page, "WORLD");
  await world.hover();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });

  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();

  // A second Escape with nothing open must be a plain no-op — proof the first
  // Escape did not leave some OTHER piece of ConsoleShell's Escape ladder mid-way
  // (e.g. if it had also started closing a selection, a second Escape here would
  // behave differently than a fresh page's first Escape does).
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();
});

test(".tnx-hdr-nav-toggle opens and closes the ACTIVE board's panel with no hover involved", async ({ page }) => {
  await expect(page.locator(PANEL)).toBeHidden();
  const toggle = page.locator(TOGGLE);

  await toggle.click();
  await expect(page.locator(PANEL)).toBeVisible();
  // GLOBE is the landing board (see console.spec.ts) and is deliberately empty of
  // widgets, but it still has a quick-settings section.
  await expect(page.locator(PANEL)).toContainText(/Globe/i);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("the toggle always scopes to the ACTIVE board, even if a different board's panel was last previewed by hover", async ({ page }) => {
  const intel = boardTab(page, "INTEL");
  await intel.hover();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 1000 });
  await expect(page.locator(PANEL)).toContainText(/Intel/i);

  // Move away so the hover-preview closes, then use the toggle — active board is
  // still GLOBE (nothing was clicked), so the toggle must show GLOBE, not INTEL.
  // See the scrim note in the "leaving the whole navshell" test above.
  await page.locator(".tnx-nav-scrim").hover({ position: { x: 50, y: 400 } });
  // CLOSE_GRACE_MS (300) + HEIGHT_TRANSITION_MS (220) = 520ms is the theoretical
  // minimum; a more generous budget than that avoids a false failure under a
  // busier test run (confirmed closing in ~400ms in isolation).
  await expect(page.locator(PANEL)).toBeHidden({ timeout: 3000 });

  await clickToggleAvoidingTabRow(page);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toContainText(/Globe/i);
});

test("toggling a widget's checkbox actually removes and restores it from the render, not just the store", async ({ page }) => {
  // WORLD, not STREETS: STREETS is a `mode: "wall"` board that deliberately
  // SHIPS EMPTY (composeWall("map2d", shell, [], STREETS_DEFAULT_AREA) in
  // presets.ts — an empty wall inviting "pick cameras on the map"), so it has
  // nothing to hide by default. WORLD ships with real widgets. WidgetFrame's
  // own root class is `.tn-cw` in BOTH rails and wall mode (there is no
  // separate "wall tile" class) — see components/console/WidgetFrame.tsx.
  await boardTab(page, "WORLD").click();
  // Wait for the board's widgets to actually mount before counting — matches
  // tests/e2e/console.spec.ts's own pattern for this exact board switch,
  // rather than counting on the same tick as the click.
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  const before = await page.locator(".tn-cw").count();
  expect(before).toBeGreaterThan(0);

  await clickToggleAvoidingTabRow(page);
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();

  const firstWidgetRow = panel.locator(".tnx-nav-widget-row").first();
  await expect(firstWidgetRow).toBeVisible();
  const checkbox = firstWidgetRow.locator('input[type="checkbox"]');
  await expect(checkbox).toBeChecked();

  await checkbox.uncheck();
  await expect(page.locator(".tn-cw")).toHaveCount(before - 1);

  await checkbox.check();
  await expect(page.locator(".tn-cw")).toHaveCount(before);
});

test("hiding a widget on one board does not hide it on another — the end-to-end version of the headline case", async ({ page }) => {
  // tests/unit/scene-chrome.test.ts holds the store-level version of this
  // (hide on WORLD, reload, open INTEL, back to WORLD — still hidden, never
  // hidden on INTEL). This is the same guarantee through the real rendered DOM:
  // hiding a widget type on WORLD must not remove that type's widgets on INTEL.
  await boardTab(page, "WORLD").click();
  await expect(page.locator(".tn-cw").first()).toBeVisible();
  const worldBefore = await page.locator(".tn-cw").count();
  expect(worldBefore).toBeGreaterThan(0);

  await clickToggleAvoidingTabRow(page);
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  const row = panel.locator(".tnx-nav-widget-row").first();
  await row.locator('input[type="checkbox"]').uncheck();
  await expect(page.locator(".tn-cw")).toHaveCount(worldBefore - 1);

  await boardTab(page, "INTEL").click();
  const intelCount = await page.locator(".tn-cw").count();
  expect(intelCount).toBeGreaterThan(0); // INTEL renders its own widgets untouched

  await boardTab(page, "WORLD").click();
  // Still hidden on WORLD after navigating away and back.
  await expect(page.locator(".tn-cw")).toHaveCount(worldBefore - 1);
});

// ── The header must FIT at 1280, not merely contain its overflow ─────────────
//
// Both regressions below were live in the tree after the first pass and are the
// reason these two tests exist rather than being folded into the cases above.
//
// The seven tabs + Reset + the toggle wanted 681px in a 616px box at 1280x720 —
// one of this app's own pinned widths (CLAUDE.md's card-rail table). The first
// fix gave `.tnx-hdr-boards` `overflow-x: auto`, which correctly stopped the
// tabs painting over `.tnx-hdr-right`… by clipping the toggle out of view
// instead: it was laid out at x825 while the box's visible edge ended at x789,
// and `document.elementFromPoint()` at the toggle's own centre returned the
// DISCORD label behind it. A control that is the panel's only touch-reliable
// entry point had become unreachable without horizontally scrolling a bar
// nobody would think to scroll. The row is now made to FIT at these widths
// (tab padding 13px -> 8px between 901px and 1439px).
//
// Neither test may use `force: true` or `scrollIntoViewIfNeeded()` — routing
// around the hit test is precisely what would hide a return of this bug.
test.describe("at 1280, a pinned width", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the toggle is genuinely clickable — nothing intercepts its hit test", async ({ page }) => {
    const toggle = page.locator(TOGGLE);
    await toggle.click({ timeout: 5000 }); // used to time out after 30s of retries
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("walking the pointer across the tab row to the toggle lands on the ACTIVE board", async ({ page }) => {
    // Retargeting an already-open panel is instant by design (nextOpenDelay -> 0),
    // so every tab the pointer grazes en route to the toggle retargets it. The
    // toggle answers by treating its own mouseenter as a hover on the ACTIVE
    // board, which corrects openId before any click can read a stale value.
    // clickToggleAvoidingTabRow() deliberately avoids this path, so without this
    // test nothing covers it.
    const globe = boardTab(page, "GLOBE");
    const toggle = page.locator(TOGGLE);
    const gb = (await globe.boundingBox())!;
    const tb = (await toggle.boundingBox())!;

    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.waitForTimeout(250);
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(gb.x + ((tb.x + tb.width / 2 - gb.x) * i) / 30, tb.y + tb.height / 2);
    }
    await page.waitForTimeout(300);

    // GLOBE is the default active board; STREETS is the last tab crossed.
    await expect(page.locator(".tnx-nav-panel-title")).toHaveText("Globe");
  });
});
