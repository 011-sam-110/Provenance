import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The shared sidebar in a real browser, on /admin/side-rail. That page exists only on a dev
 * server (see app/admin/side-rail/page.tsx), so this spec runs against `next dev`:
 *
 *   TN_DIST_DIR=.next-x npx next dev -p 3117
 *   npx playwright test tests/e2e/side-rail.spec.ts   (with baseURL on that port)
 *
 * Not in the gate, like every e2e spec here. RAIL_SHOTS=1 also writes the review pictures to
 * persona-shots/hud-v2/hud-rail/.
 */

const PAGE = "/admin/side-rail";
const KEY = "tn.rail.open.v1";

const rail = (page: Page) => page.locator("nav[data-rail]");
const menu = (page: Page) => page.locator("[data-rail-menu]");
const row = (page: Page, id: string) => page.locator(`[data-rail-entry="${id}"]`);
const tip = (page: Page, id: string) => page.locator(`[data-rail-tip="${id}"]`);
const scrim = (page: Page) => page.locator("[data-rail-scrim]");
const neighbour = (page: Page) => page.getByTestId("neighbour");
/** A row's label and icon are the second and first child of its one inner span. */
const labelOf = (r: Locator) => r.locator("> span > span").nth(1);
const iconOf = (r: Locator) => r.locator("> span > span").nth(0);
const trackOf = (r: Locator) => r.locator("> span > span").nth(2);

const railW = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--rail-w"));
const css = (l: Locator, prop: string) =>
  l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

/** Load the fixture and wait for the first effect, which is what proves hydration is done. */
async function load(page: Page, query = "") {
  await page.goto(`${PAGE}${query}`);
  await expect.poll(() => railW(page)).not.toBe("");
}

async function expectWidth(page: Page, width: number) {
  await expect.poll(async () => (await box(rail(page))).width).toBe(width);
}

// ── Contrast ──────────────────────────────────────────────────────────────────────────

type Rgba = [number, number, number, number];

function parseColor(c: string): Rgba {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (!m || m.length < 3) throw new Error(`cannot read colour ${c}`);
  return [m[0], m[1], m[2], m[3] ?? 1];
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The lowest contrast of a text colour on a row, over a map of any brightness. The column is
 * see-through, so the ground under it is taken as pure black and as pure white, which are
 * the two ends of what a map can put there.
 */
function worstContrast(text: string, railBg: string, rowBg: string): number {
  const grounds: Rgba[] = [
    [0, 0, 0, 1],
    [255, 255, 255, 1],
  ];
  const ratios = grounds.map((ground) =>
    contrast(parseColor(text), over(parseColor(rowBg), over(parseColor(railBg), ground))),
  );
  return Math.min(...ratios);
}

// ── A wide screen ─────────────────────────────────────────────────────────────────────

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("it starts closed, with the design's geometry", async ({ page }) => {
    await load(page);
    const nav = rail(page);

    expect((await box(nav)).width).toBe(64);
    expect((await box(nav)).x).toBe(0);
    expect((await box(nav)).height).toBe(900);
    expect(await railW(page)).toBe("64px");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");

    expect(await css(nav, "background-color")).toBe("rgba(10, 13, 16, 0.94)");
    expect(await css(nav, "border-right-color")).toBe("rgba(255, 255, 255, 0.08)");
    expect(await css(nav, "padding-top")).toBe("12px");
    expect(await css(nav, "padding-left")).toBe("10px");
    expect(await css(nav, "backdrop-filter")).toBe("blur(12px)");
    expect(await css(nav, "transition-duration")).toBe("0.18s");
    expect(await css(nav, "font-family")).toContain("Inter");

    const r = row(page, "alerts");
    expect((await box(r)).height).toBe(44);
    expect(await css(r, "border-radius")).toBe("10px");
    expect(await css(r, "padding-left")).toBe("13px");
    expect((await box(iconOf(r))).width).toBe(18);
    expect(await css(iconOf(r), "color")).toBe("rgb(196, 204, 212)");
    expect(await css(labelOf(r), "font-size")).toBe("13px");
    expect(await css(labelOf(r), "font-weight")).toBe("600");
    expect(await css(labelOf(r), "color")).toBe("rgb(232, 236, 240)");
    expect(await css(labelOf(menu(page)), "font-size")).toBe("14px");
    expect(await css(labelOf(menu(page)), "font-weight")).toBe("700");

    // Each label is in the DOM and fully outside the row's clip.
    for (const id of ["previews", "turn", "sources", "alerts", "exit", "controls"]) {
      const rowBox = await box(row(page, id));
      expect((await box(labelOf(row(page, id)))).x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width);
    }
  });

  test("the menu button opens and closes it, and the neighbours make room", async ({ page }) => {
    await load(page);
    const before = await box(neighbour(page));
    expect(before.x).toBe(88);

    await menu(page).click();
    await expectWidth(page, 232);
    expect(await railW(page)).toBe("232px");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    await expect(rail(page)).toHaveAttribute("data-expanded", "true");

    // The open column never covers its neighbour.
    await expect.poll(async () => (await box(neighbour(page))).x).toBe(256);
    expect((await box(rail(page))).width).toBeLessThanOrEqual((await box(neighbour(page))).x);
    expect(await css(neighbour(page), "transition-duration")).toBe("0.18s");

    // Labels show, whole, inside their rows.
    const rowBox = await box(row(page, "sources"));
    const labelBox = await box(labelOf(row(page, "sources")));
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(rowBox.width).toBe(211);

    await menu(page).click();
    await expectWidth(page, 64);
    expect(await railW(page)).toBe("64px");
    await expect.poll(async () => (await box(neighbour(page))).x).toBe(88);
  });

  test("the choice is still there after a reload, per surface, with no hydration mismatch", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (/hydrat/i.test(e.message)) errors.push(e.message);
    });

    await load(page);
    await menu(page).click();
    await expectWidth(page, 232);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(
      JSON.stringify({ v: 1, d: { eye: true, console: false } }),
    );

    await page.reload();
    await expectWidth(page, 232);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => railW(page)).toBe("232px");

    // The other surface keeps its own state.
    await load(page, "?surface=console");
    await expectWidth(page, 64);
    await menu(page).click();
    await expectWidth(page, 232);
    await menu(page).click();
    await expectWidth(page, 64);

    await load(page);
    await expectWidth(page, 232);
    expect(errors).toEqual([]);
  });

  test("the server's HTML is closed, whatever was saved", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(PAGE);
    await expect(rail(page)).toHaveAttribute("data-expanded", "false");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    expect((await box(rail(page))).width).toBe(64);
    await context.close();
  });

  test("a corrupt saved value reads as closed", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, "{not json"), KEY);
    await load(page);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    expect(await railW(page)).toBe("64px");
  });

  test("every row has an accessible name, closed and open", async ({ page }) => {
    await load(page);
    const check = async () => {
      await expect(page.getByRole("navigation", { name: "Map tools" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Provenance menu" })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Camera previews" })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Auto-turn" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sources & layers" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Exit to dashboard" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Controls" })).toBeVisible();
    };
    await check();
    await menu(page).click();
    await expectWidth(page, 232);
    await check();
  });

  test("the keyboard reaches and works every row, with a ring and a tooltip", async ({ page }) => {
    await load(page);

    // From the top of the page, past the admin bar's links.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await menu(page).evaluate((el) => el === document.activeElement)) break;
    }
    await expect(menu(page)).toBeFocused();
    expect(await css(menu(page), "outline-style")).toBe("solid");
    expect(await css(menu(page), "outline-width")).toBe("2px");
    await expect(tip(page, "menu")).toBeVisible();

    // Closed, focus shows each row's label.
    await page.keyboard.press("Tab");
    await expect(row(page, "previews")).toBeFocused();
    await expect(tip(page, "previews")).toBeVisible();
    await expect(tip(page, "menu")).toBeHidden();
    expect(await css(row(page, "previews"), "outline-style")).toBe("solid");

    await page.keyboard.press("Shift+Tab");
    await expect(menu(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expectWidth(page, 232);
    await expect(menu(page)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(row(page, "previews")).toBeFocused();
    await expect(tip(page, "previews")).toBeHidden();
    await page.keyboard.press("Space");
    await expect(row(page, "previews")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("previews-state")).toHaveText("false");

    await page.keyboard.press("Tab");
    await expect(row(page, "turn")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(row(page, "turn")).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("Tab");
    await expect(row(page, "sources")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(row(page, "sources")).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Tab");
    await expect(row(page, "alerts")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row(page, "host-close")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row(page, "exit")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row(page, "controls")).toBeFocused();

    // On a wide screen Escape is not the rail's: nothing here is modal.
    await page.keyboard.press("Escape");
    await expectWidth(page, 232);
    await expect(page.getByTestId("ladder")).toHaveText("1");
  });

  test("a switch is a switch: role, aria-checked, and the design's track and knob", async ({ page }) => {
    await load(page);
    await menu(page).click();
    await expectWidth(page, 232);

    const on = row(page, "previews");
    await expect(on).toHaveRole("switch");
    await expect(on).toHaveAttribute("aria-checked", "true");

    const track = trackOf(on);
    const knob = track.locator("> span");
    expect((await box(track)).width).toBe(26);
    expect((await box(track)).height).toBe(14);
    expect(await css(track, "border-radius")).toBe("7px");
    expect((await box(knob)).width).toBe(10);
    expect((await box(knob)).height).toBe(10);
    expect(await css(track, "background-color")).toBe("rgb(232, 236, 240)");
    expect(await css(knob, "background-color")).toBe("rgb(11, 13, 16)");
    expect(await css(knob, "left")).toBe("14px");

    await on.click();
    await expect(on).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("previews-state")).toHaveText("false");
    await expect.poll(() => css(track, "background-color")).toBe("rgb(58, 68, 78)");
    await expect.poll(() => css(knob, "left")).toBe("2px");
  });

  test("an action with `controls` reports its panel", async ({ page }) => {
    await load(page);
    const sources = row(page, "sources");
    const panelId = await sources.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await expect(sources).toHaveAttribute("aria-expanded", "false");
    await expect(sources).not.toHaveAttribute("data-active", "true");

    await sources.click();
    await expect(sources).toHaveAttribute("aria-expanded", "true");
    await expect(sources).toHaveAttribute("data-active", "true");
    await expect(page.locator(`#${panelId}`)).toBeVisible();
    await page.mouse.move(800, 800);
    await expect.poll(() => css(sources, "background-color")).toBe("rgba(255, 255, 255, 0.1)");
    // Only the active row carries a ground: every other row rests clear.
    await expect.poll(() => css(menu(page), "background-color")).toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => css(row(page, "alerts"), "background-color")).toBe("rgba(0, 0, 0, 0)");

    // The pop-over sits at the sidebar's width + 12px, and moves with it.
    expect((await box(page.locator(`#${panelId}`))).x).toBe(76);
    await menu(page).click();
    await expect.poll(async () => (await box(page.locator(`#${panelId}`))).x).toBe(244);

    // An action with no `controls` claims nothing about a panel.
    await expect(row(page, "alerts")).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(row(page, "alerts")).not.toHaveAttribute("aria-controls", /.*/);
  });

  test("closed rows show their label on hover, outside the column, and open rows do not", async ({ page }) => {
    await load(page);
    const body = page.locator("nav[data-rail] > div").nth(2);
    expect(await css(body, "overflow-y")).toBe("visible");

    await row(page, "sources").hover();
    await expect(tip(page, "sources")).toBeVisible();
    await expect.poll(() => css(tip(page, "sources"), "opacity")).toBe("1");
    await expect(tip(page, "sources")).toHaveText("Sources & layers");
    // The sidebar's width + 12px, the same left edge as a pop-over.
    expect((await box(tip(page, "sources"))).x).toBe(76);
    await expect(tip(page, "turn")).toBeHidden();

    // Hover shows on the row too.
    expect(await css(row(page, "sources"), "background-color")).toBe("rgba(255, 255, 255, 0.07)");

    await menu(page).hover();
    await expect(tip(page, "menu")).toHaveText("Menu");
    await expect(tip(page, "menu")).toBeVisible();

    await menu(page).click();
    await expectWidth(page, 232);
    await row(page, "sources").hover();
    await expect(tip(page, "sources")).toBeHidden();
  });

  test("a link reads its address when it is focused, pressed and clicked", async ({ page }) => {
    await load(page);
    const exit = row(page, "exit");
    const read = async () => Number(new URL((await exit.getAttribute("href")) ?? "", "http://x").searchParams.get("read"));

    expect(await exit.getAttribute("href")).toBe("/admin");

    await exit.focus();
    const afterFocus = await read();
    expect(afterFocus).toBeGreaterThan(0);

    await exit.hover();
    await page.mouse.down();
    const afterPress = await read();
    expect(afterPress).toBeGreaterThan(afterFocus);

    await page.mouse.up();
    await page.waitForURL(/\/admin\?read=\d+/);
    expect(Number(new URL(page.url()).searchParams.get("read"))).toBeGreaterThan(afterPress);
  });

  test("it removes --rail-w when it unmounts, and neighbours fall back to 64px", async ({ page }) => {
    await load(page);
    await menu(page).click();
    await expect.poll(() => railW(page)).toBe("232px");

    await page.getByTestId("unmount").click();
    await expect(rail(page)).toHaveCount(0);
    expect(await railW(page)).toBe("");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rail-w"))).toBe("");
    await expect.poll(async () => (await box(neighbour(page))).x).toBe(88);

    await page.getByTestId("unmount").click();
    await expect.poll(() => railW(page)).toBe("232px");
  });

  test("reduced motion turns the movement off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await load(page);
    expect(await css(rail(page), "transition-duration")).toBe("0s");
    await menu(page).click();
    expect((await box(rail(page))).width).toBe(232);
    expect(await css(rail(page), "transition-duration")).toBe("0s");
  });

  test("tone=dark stays dark while the console's skin is light", async ({ page }) => {
    await load(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-tnx-skin"))).toBeNull();
    expect(await css(rail(page), "background-color")).toBe("rgba(10, 13, 16, 0.94)");
    expect(await css(labelOf(row(page, "alerts")), "color")).toBe("rgb(232, 236, 240)");
  });

  test("tone=skin follows the console's skin, with no reload, and keeps the geometry", async ({ page }) => {
    await load(page, "?tone=skin");
    const nav = rail(page);

    // Light: the console's own tokens.
    expect(await css(nav, "background-color")).toBe("rgba(255, 255, 255, 0.94)");
    expect(await css(labelOf(row(page, "alerts")), "color")).toBe("rgb(38, 43, 21)");
    expect((await box(nav)).width).toBe(64);
    expect((await box(row(page, "alerts"))).height).toBe(44);

    // Dark: the same values tone=dark paints.
    await page.evaluate(() => document.documentElement.setAttribute("data-tnx-skin", "dark"));
    expect(await css(nav, "background-color")).toBe("rgba(10, 13, 16, 0.94)");
    expect(await css(labelOf(row(page, "alerts")), "color")).toBe("rgb(232, 236, 240)");
    expect(await css(iconOf(row(page, "alerts")), "color")).toBe("rgb(196, 204, 212)");

    // And back.
    await page.evaluate(() => document.documentElement.removeAttribute("data-tnx-skin"));
    expect(await css(nav, "background-color")).toBe("rgba(255, 255, 255, 0.94)");
  });

  test("the light skin's text clears 4.5:1 over any map, on every row state", async ({ page }) => {
    await load(page, "?tone=skin");
    await menu(page).click();
    await expectWidth(page, 232);
    await row(page, "sources").click();
    await page.mouse.move(800, 800);

    const railBg = await css(rail(page), "background-color");
    const results: Record<string, number> = {};

    const measure = async (name: string, r: Locator) => {
      const rowBg = await css(r, "background-color");
      results[`${name} label`] = worstContrast(await css(labelOf(r), "color"), railBg, rowBg);
      results[`${name} icon`] = worstContrast(await css(iconOf(r), "color"), railBg, rowBg);
    };

    await measure("rest", row(page, "alerts"));
    await measure("menu", menu(page));
    await expect.poll(() => css(row(page, "sources"), "background-color")).toBe("rgba(38, 43, 21, 0.13)");
    await measure("active", row(page, "sources"));
    await row(page, "alerts").hover();
    await expect.poll(() => css(row(page, "alerts"), "background-color")).toBe("rgba(16, 22, 29, 0.05)");
    await measure("hover", row(page, "alerts"));

    // The switch's knob against its track, off and on. Both must read as a state.
    const on = trackOf(row(page, "previews"));
    const off = trackOf(row(page, "turn"));
    const knobOn = await css(on.locator("> span"), "background-color");
    const knobOff = await css(off.locator("> span"), "background-color");
    results["switch on"] = contrast(parseColor(knobOn), parseColor(await css(on, "background-color")));
    results["switch off"] = contrast(parseColor(knobOff), parseColor(await css(off, "background-color")));

    // The tooltip, closed.
    await menu(page).click();
    await expectWidth(page, 64);
    const t = tip(page, "alerts");
    results["tooltip"] = contrast(parseColor(await css(t, "color")), parseColor(await css(t, "background-color")));

    console.log("light skin contrast", JSON.stringify(results));
    for (const [name, ratio] of Object.entries(results)) {
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ── A phone ───────────────────────────────────────────────────────────────────────────

test.describe("on a phone at 360 px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("there is no column: one 44 px button, --rail-w 0px, and the map takes every other touch", async ({ page }) => {
    await load(page);
    expect(await railW(page)).toBe("0px");

    const b = await box(menu(page));
    expect(b.width).toBe(44);
    expect(b.height).toBe(44);
    expect(b.x).toBe(10);
    expect(b.y).toBe(12);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");

    await expect(row(page, "previews")).toBeHidden();
    await expect(row(page, "exit")).toBeHidden();
    await expect(page.locator('nav[data-rail] > [role="separator"]')).toBeHidden();
    expect(await css(rail(page), "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect((await box(neighbour(page))).x).toBe(24);

    // A point on the strip's own area belongs to the page behind it.
    const inNav = await page.evaluate(() => !!document.elementFromPoint(30, 400)?.closest("nav[data-rail]"));
    expect(inNav).toBe(false);
  });

  test("it never makes the page wider than the phone, closed or open", async ({ page }) => {
    await load(page);
    const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await pageWidth()).toBe(360);
    await menu(page).tap();
    await expectWidth(page, 232);
    expect(await pageWidth()).toBe(360);
    expect(await page.evaluate(() => window.innerWidth)).toBe(360);
  });

  test("neighbours do not start 64 px across: --rail-w is 0px before any script runs", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto(PAGE);
    expect((await box(neighbour(page))).x).toBe(24);
    expect((await box(menu(page))).width).toBe(44);
    await context.close();
  });

  test("a saved choice from a wide screen does not open the sheet", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ v: 1, d: { eye: true, console: true } })), KEY);
    await load(page);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    expect(await railW(page)).toBe("0px");
    await expect(scrim(page)).toHaveCount(0);
    await expect(row(page, "previews")).toBeHidden();
  });

  test("a tap opens a 232 px sheet with a scrim and labels, and the neighbours stay", async ({ page }) => {
    await load(page);
    await menu(page).tap();

    await expectWidth(page, 232);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    await expect(scrim(page)).toBeVisible();
    expect((await box(rail(page))).height).toBe(740);
    expect(await railW(page)).toBe("0px");
    expect((await box(neighbour(page))).x).toBe(24);
    expect(await css(rail(page), "background-color")).toBe("rgba(10, 13, 16, 0.94)");

    const rowBox = await box(row(page, "sources"));
    const labelBox = await box(labelOf(row(page, "sources")));
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);

    // The tooltip does not exist on a phone.
    await expect(tip(page, "sources")).toBeHidden();

    // Every target is at least 44 px.
    const sizes = await rail(page).evaluate((nav) =>
      [...nav.querySelectorAll("a, button")].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    expect(sizes.length).toBe(8);
    for (const s of sizes) {
      expect(s.w).toBeGreaterThanOrEqual(44);
      expect(s.h).toBeGreaterThanOrEqual(44);
    }
  });

  test("a tap on the scrim closes it, focus returns, and nothing is saved", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);
    await row(page, "previews").focus();

    await page.touchscreen.tap(300, 400);
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(scrim(page)).toHaveCount(0);
    await expect(menu(page)).toBeFocused();
    await expect(row(page, "previews")).toBeHidden();
    expect((await box(menu(page))).width).toBe(44);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  });

  test("Escape closes it, and one press does nothing else", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("ladder")).toHaveText("0");

    // With the sheet shut the same key goes back to the page.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ladder")).toHaveText("1");
  });

  test("Escape stands down when something else took the press", async ({ page }) => {
    await load(page);
    await page.getByTestId("claim-escape").check();
    await menu(page).tap();
    await expectWidth(page, 232);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");
    await expect(scrim(page)).toBeVisible();
  });

  test("Escape stands down inside [data-owns-escape]", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);

    await page.getByTestId("owned-field").focus();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");

  });

  test("when a host closes the sheet, focus stays where the host put it", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);

    // A click from script moves no focus, which is how a host's own close arrives.
    await page.getByTestId("owned-field").focus();
    await row(page, "host-close").evaluate((el) => (el as HTMLElement).click());
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("owned-field")).toBeFocused();
  });

  test("a switch and an action leave it open, and closeRail closes it", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);

    await row(page, "previews").tap();
    await expect(row(page, "previews")).toHaveAttribute("aria-checked", "false");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");

    await row(page, "sources").tap();
    await expect(row(page, "sources")).toHaveAttribute("aria-expanded", "true");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "true");

    await row(page, "host-close").tap();
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(scrim(page)).toHaveCount(0);
    await expect(menu(page)).toBeFocused();
  });

  test("a link in the sheet navigates with its fresh address", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);
    await row(page, "exit").tap();
    await page.waitForURL(/\/admin\?read=\d+/);
  });

  test("Tab stays inside the sheet", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);
    await menu(page).focus();

    await page.keyboard.press("Shift+Tab");
    await expect(row(page, "controls")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menu(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row(page, "previews")).toBeFocused();
  });

  test("a closed phone's rows take no keyboard focus", async ({ page }) => {
    await load(page);
    await menu(page).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("owned-field")).toBeFocused();
  });

  test("a reload shows the map: the sheet is not remembered", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);
    await page.reload();
    await expect.poll(() => railW(page)).toBe("0px");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(scrim(page)).toHaveCount(0);
  });

  test("a window dragged wide drops the sheet, and it does not come back", async ({ page }) => {
    await load(page);
    await menu(page).tap();
    await expectWidth(page, 232);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => railW(page)).toBe("64px");
    await expect(scrim(page)).toHaveCount(0);
    await expectWidth(page, 64);

    await page.setViewportSize({ width: 360, height: 740 });
    await expect.poll(() => railW(page)).toBe("0px");
    await expect(menu(page)).toHaveAttribute("aria-expanded", "false");
    await expect(scrim(page)).toHaveCount(0);
  });

  test("tone=skin paints the phone's button and sheet light", async ({ page }) => {
    await load(page, "?tone=skin");
    expect(await css(menu(page), "background-color")).toBe("rgba(255, 255, 255, 0.94)");
    await menu(page).tap();
    await expectWidth(page, 232);
    expect(await css(rail(page), "background-color")).toBe("rgba(255, 255, 255, 0.94)");
    expect(await css(labelOf(row(page, "sources")), "color")).toBe("rgb(38, 43, 21)");
  });
});

// ── Review pictures ───────────────────────────────────────────────────────────────────

test.describe("review pictures", () => {
  test.skip(!process.env.RAIL_SHOTS, "set RAIL_SHOTS=1 to write them");
  const dir = "persona-shots/hud-v2/hud-rail";
  const shot = (page: Page, name: string, width: number, height: number) =>
    page.screenshot({
      path: `${dir}/${name}.jpg`,
      type: "jpeg",
      quality: 70,
      clip: { x: 0, y: 0, width, height },
    });

  for (const tone of ["dark", "skin"] as const) {
    test(`wide, ${tone}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await load(page, `?tone=${tone}`);
      await row(page, "sources").hover();
      await expect.poll(() => css(tip(page, "sources"), "opacity")).toBe("1");
      await shot(page, `wide-${tone}-closed`, 720, 620);

      await menu(page).click();
      await expectWidth(page, 232);
      await row(page, "sources").click();
      await page.mouse.move(800, 800);
      await expect.poll(() => css(menu(page), "background-color")).toBe("rgba(0, 0, 0, 0)");
      await shot(page, `wide-${tone}-open`, 720, 620);
    });

    test(`phone, ${tone}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await load(page, `?tone=${tone}`);
      await shot(page, `phone-${tone}-closed`, 360, 740);
      await menu(page).click();
      await expectWidth(page, 232);
      await page.mouse.move(340, 500);
      await expect.poll(() => css(menu(page), "background-color")).toBe("rgba(0, 0, 0, 0)");
      await shot(page, `phone-${tone}-sheet`, 360, 740);
    });
  }
});
