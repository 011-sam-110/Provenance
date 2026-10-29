import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's control hint (/eye), held to what the plan promised.
 *
 *   - A mouse desktop gets the mouse plate under the controls at top right, with Ctrl
 *     (never the Command key), and the plate never takes a press meant for the map.
 *   - It fades about 5 s after the first move the person makes; the x closes it at once;
 *     Turn's orbit does not count as a move.
 *   - A phone gets the finger words just above the bar, never over it, and the Places
 *     sheet closes it.
 *   - The first touch on a mouse desktop swaps it for "It appears you're using touch
 *     controls." and the finger words, once per visit.
 *   - Nothing on a recording; with reduced motion the plate still shows and still goes.
 *   - The "?" beside the clock (left of it on a wide screen, under it on a phone) hides the
 *     plate and brings it back: a mouse or the keyboard gets the mouse words, a finger the
 *     finger words without Leon's line. A plate brought back fades 5 s after the next move.
 *   - The plate reserves no room: it costs the view no camera card, on a phone or a desktop.
 *
 * THE TOUCH-ON-A-DESKTOP CASE uses CDP touch input in a PLAIN desktop context.
 * Playwright's `hasTouch: true` makes Chromium report (pointer: coarse) and (hover: none)
 * even at 1440 x 900, so that context is a tablet, not a touchscreen laptop. A plain
 * context keeps the fine pointer (so the page picks the mouse plate) and still accepts
 * Input.dispatchTouchEvent, which arrives as pointerType "touch".
 *
 * THE HOOKS: `main[data-eye-state="ready"]` and `window.__map`, as in eye.spec.ts.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const plateOf = (page: Page) => page.getByRole("complementary", { name: "How to move the view" });
const barOf = (page: Page) => page.getByRole("navigation", { name: "View controls" });
const toggleOf = (page: Page) => page.getByRole("button", { name: "How to move the view" });
const clockOf = (page: Page) => page.getByLabel("Time now, UTC");
/** The ledger's camera figure: the cards placed. */
const camsOf = async (page: Page) =>
  Number(await page.locator('section[aria-label="What this view shows"] p[data-k="cam"] b').textContent());
const PLACE = "/eye?place=westminster";
const TOUCH_LINE = "It appears you're using touch controls.";

async function open(page: Page, width: number, height: number, url = PLACE) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await ready(page);
}

/** A drag on the map with the mouse. */
async function dragMap(page: Page) {
  await page.mouse.move(800, 600);
  await page.mouse.down();
  await page.mouse.move(650, 520, { steps: 12 });
  await page.mouse.up();
}

test("a mouse desktop gets the mouse plate under the controls, with Ctrl and never the Command key", async ({ page }) => {
  await open(page, 1440, 900);
  const plate = plateOf(page);
  await expect(plate).toBeVisible();
  await expect(plate).toContainText("Right-click and drag sideways");
  await expect(plate).toContainText("Ctrl");
  await expect(plate).not.toContainText("⌘");
  await expect(plate).not.toContainText("It appears");

  const box = (await plate.boundingBox())!;
  const bar = (await barOf(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(Math.abs(box.x + box.width - (1440 - 26))).toBeLessThanOrEqual(30);
});

test("the plate never takes a press meant for the map", async ({ page }) => {
  await open(page, 1440, 900);
  const plate = plateOf(page);
  await expect(plate).toBeVisible();
  const box = (await plate.boundingBox())!;
  const inside = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('aside[aria-label="How to move the view"]'),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(inside).toBe(false);
});

test("a move of the view fades it about 5 s later", async ({ page }) => {
  await open(page, 1440, 900);
  const plate = plateOf(page);
  await expect(plate).toBeVisible();
  await dragMap(page);
  await page.waitForTimeout(1000);
  await expect(plate).toBeVisible();
  await expect(plate).toHaveCount(0, { timeout: 7000 });
});

test("Turn's orbit does not count as a move", async ({ page }) => {
  await open(page, 1440, 900);
  const plate = plateOf(page);
  const bearing = () => page.evaluate(() => (window as unknown as { __map: { getBearing(): number } }).__map.getBearing());
  const before = await bearing();
  await page.getByRole("button", { name: "Turn" }).click();
  await page.waitForTimeout(6500);
  // The view really turned, and the plate is still there.
  expect(Math.abs((await bearing()) - before)).toBeGreaterThan(3);
  await expect(plate).toBeVisible();
});

test("the x closes it at once", async ({ page }) => {
  await open(page, 1440, 900);
  await expect(plateOf(page)).toBeVisible();
  await page.getByRole("button", { name: "Close this hint" }).click();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
});

test("a phone gets the finger words just above the bar, and Places closes them", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await page.goto(PLACE);
    await ready(page);
    const plate = plateOf(page);
    await expect(plate).toBeVisible();
    await expect(plate).toContainText("Pinch");
    await expect(plate).toContainText("Twist with two fingers");
    await expect(plate).not.toContainText("It appears");
    await expect(plate).not.toContainText("Ctrl");

    const box = (await plate.boundingBox())!;
    const bar = (await barOf(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    expect(bar.y).toBeGreaterThan((844 * 2) / 3);

    await page.getByRole("button", { name: "Places" }).tap();
    await expect(plate).toHaveCount(0, { timeout: 2000 });
  } finally {
    await ctx.close();
  }
});

test("the first touch on a desktop says so and gives the finger words, once", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(PLACE);
    await ready(page);
    const plate = plateOf(page);
    await expect(plate).toContainText("Right-click and drag sideways");

    const cdp = await ctx.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: [number, number][]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

    await touch("touchStart", [[800, 600]]);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", [[800 - 10 * i, 600 - 5 * i]]);
      await page.waitForTimeout(16);
    }
    await expect(plate).toContainText(TOUCH_LINE);
    await expect(plate).toContainText("Pinch");
    await expect(plate).not.toContainText("Ctrl");
    await touch("touchEnd", []);
    await expect(plate).toHaveCount(0, { timeout: 7000 });

    // Once per visit: a second touch does not bring it back.
    await touch("touchStart", [[700, 500]]);
    await touch("touchEnd", []);
    await page.waitForTimeout(1500);
    await expect(plate).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("there is nothing in a recording", async ({ page }) => {
  await open(page, 540, 960, `${PLACE}&record=1`);
  await page.waitForTimeout(500);
  await expect(plateOf(page)).toHaveCount(0);
  await expect(toggleOf(page)).toHaveCount(0);
});

test("desktop: the ? sits left of the clock and opens and closes the plate", async ({ page }) => {
  await open(page, 1440, 900);
  const toggle = toggleOf(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const t = (await toggle.boundingBox())!;
  const c = (await clockOf(page).boundingBox())!;
  expect(t.x + t.width).toBeLessThanOrEqual(c.x);
  expect(Math.abs(t.y + t.height / 2 - (c.y + c.height / 2))).toBeLessThanOrEqual(6);
  expect(Math.abs(t.width - 32)).toBeLessThanOrEqual(1);
  expect(Math.abs(t.height - 32)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Close this hint" }).click();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(plateOf(page)).toBeVisible();
  await expect(plateOf(page)).toContainText("Right-click and drag sideways");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("desktop: a plate brought back fades about 5 s after the next move", async ({ page }) => {
  await open(page, 1440, 900);
  await page.getByRole("button", { name: "Close this hint" }).click();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
  await toggleOf(page).click();
  await expect(plateOf(page)).toBeVisible();
  await dragMap(page);
  await page.waitForTimeout(1000);
  await expect(plateOf(page)).toBeVisible();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 7000 });
});

test("desktop: the keyboard brings it back with the mouse words", async ({ page }) => {
  await open(page, 1440, 900);
  await page.getByRole("button", { name: "Close this hint" }).click();
  await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
  const toggle = toggleOf(page);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(plateOf(page)).toBeVisible();
  await expect(plateOf(page)).toContainText("Ctrl");
  await expect(plateOf(page)).not.toContainText("It appears");
  await expect(toggle).toBeFocused();
});

test("phone: the ? is under the clock, in the header, and brings the finger words back", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await page.goto(PLACE);
    await ready(page);
    const toggle = toggleOf(page);
    await expect(toggle).toBeVisible();
    const t = (await toggle.boundingBox())!;
    const c = (await clockOf(page).boundingBox())!;
    const h = (await page.locator("header").first().boundingBox())!;
    expect(t.width).toBeGreaterThanOrEqual(44);
    expect(t.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(t.x + t.width - (c.x + c.width))).toBeLessThanOrEqual(1);
    expect(t.y).toBeGreaterThanOrEqual(c.y + c.height - 1);
    expect(t.y + t.height).toBeLessThanOrEqual(h.y + h.height + 0.5);

    await page.getByRole("button", { name: "Close this hint" }).tap();
    await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
    await toggle.tap();
    const plate = plateOf(page);
    await expect(plate).toBeVisible();
    await expect(plate).toContainText("Pinch");
    await expect(plate).not.toContainText("It appears");
    const box = (await plate.boundingBox())!;
    const bar = (await barOf(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  } finally {
    await ctx.close();
  }
});

test("phone: the ? closes the Places sheet", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await page.goto(PLACE);
    await ready(page);
    const places = page.getByRole("button", { name: "Places" });
    await places.tap();
    await expect(plateOf(page)).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByRole("link", { name: "Tower Bridge" })).toBeVisible();
    await toggleOf(page).tap();
    await expect(plateOf(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Places" })).toHaveCount(0);
    await expect(places).toHaveAttribute("aria-expanded", "false");
  } finally {
    await ctx.close();
  }
});

test("the plate costs the view no camera card, on a phone or a desktop", async ({ browser }) => {
  const cases = [
    { name: "phone", viewport: { width: 360, height: 740 }, touch: true, url: PLACE },
    { name: "desktop", viewport: { width: 1440, height: 900 }, touch: false, url: "/eye?place=tower-bridge" },
  ];
  for (const k of cases) {
    const ctx = await browser.newContext({
      viewport: k.viewport,
      ...(k.touch ? { hasTouch: true, isMobile: true } : {}),
    });
    const page = await ctx.newPage();
    try {
      await page.goto(k.url);
      await ready(page);
      await page.waitForTimeout(2500);
      // The plate holds no room: nothing for the cards to keep out of.
      await expect(plateOf(page)).toBeVisible();
      expect(await plateOf(page).getAttribute("data-eye-keep"), k.name).toBeNull();
      const footerHeight = () => page.locator("footer").first().evaluate((el) => el.getBoundingClientRect().height);
      const up = await camsOf(page);
      const footerUp = await footerHeight();
      await page.getByRole("button", { name: "Close this hint" }).click();
      await page.waitForTimeout(600);
      // The footer's own box does not grow with the plate.
      if (k.touch) expect(Math.abs((await footerHeight()) - footerUp), k.name).toBeLessThanOrEqual(0.5);
      await page.evaluate(() => (window as unknown as { __map: { panBy(o: [number, number], e: { duration: number }): void } }).__map.panBy([1, 0], { duration: 0 }));
      await page.waitForTimeout(1500);
      const next = await camsOf(page);
      // On main the hint cost a card: 0 with it up, 1 once it was gone and the view moved.
      expect(up, `${k.name}: ${up} cards with the plate up, ${next} after it went`).toBeGreaterThanOrEqual(next);
    } finally {
      await ctx.close();
    }
  }
});

test("a first touch that lands on the ? gives the finger words, not Leon's line", async ({ browser }) => {
  // A plain desktop context, as the touch-on-a-desktop case above: it keeps the fine pointer
  // and still accepts CDP touch input, which arrives as pointerType "touch".
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(PLACE);
    await ready(page);
    await page.getByRole("button", { name: "Close this hint" }).click();
    await expect(plateOf(page)).toHaveCount(0, { timeout: 1000 });
    const t = (await toggleOf(page).boundingBox())!;
    const cdp = await ctx.newCDPSession(page);
    const point = { x: t.x + t.width / 2, y: t.y + t.height / 2, id: 0 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const plate = plateOf(page);
    await expect(plate).toBeVisible();
    await expect(plate).toContainText("Pinch");
    await expect(plate).not.toContainText(TOUCH_LINE);
  } finally {
    await ctx.close();
  }
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the plate still shows, and still goes", async ({ page }) => {
    await open(page, 1440, 900);
    const plate = plateOf(page);
    await expect(plate).toBeVisible();
    await dragMap(page);
    await expect(plate).toHaveCount(0, { timeout: 7000 });
  });
});
