import { expect, test, type Page } from "@playwright/test";

/**
 * The God's eye view's Camera previews switch (lib/eye/previews.ts, EyeApp, EyeOverlay), in the
 * sidebar.
 *
 *   - Off, every camera is a small icon and no picture, clip or stream is fetched for it.
 *   - A tapped icon opens that one camera's card with a close button; Esc and the button
 *     close it, and a second icon replaces it. Focus follows.
 *   - The choice is kept in this browser (tn.eye.v1), and a recording ignores it.
 *   - On a phone every icon and the close button are at least 44 x 44, and nothing
 *     scrolls sideways.
 *   - A card opened from an icon says "Live" only while a stream plays in it.
 *
 * THE HOOKS: `main[data-eye-state="ready"]`, `main[data-previews="off"]`, `[data-cam-icon]`
 * (an icon), `a[href^="/camera/"]` (a card), and the switch, `role="switch"` named "Camera previews".
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

test.describe.configure({ timeout: 120_000 });

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const PICTURE = /\/api\/(proxy|hls)\b/;

/** Start with previews off: the same envelope lib/shell/persist.ts writes. */
const startOff = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("tn.eye.v1", JSON.stringify({ v: 1, d: { previews: false } })));

const pictureRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (PICTURE.test(r.url())) urls.push(r.url());
  });
  return urls;
};

const icons = (page: Page) => page.locator("[data-cam-icon]");
const cards = (page: Page) => page.locator('a[href^="/camera/"]');
// A card's close button, not the control hint's own "Close this hint".
const closeButton = (page: Page) => page.getByRole("button", { name: /^Close (?!this hint)/ });
const previewsSwitch = (page: Page) => page.getByRole("switch", { name: "Camera previews" });

test("off: icons stand where the cards did, and no picture is fetched", async ({ page }) => {
  const pictures = pictureRequests(page);
  await startOff(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);

  await expect(page.locator("main")).toHaveAttribute("data-previews", "off");
  await expect(previewsSwitch(page)).toHaveAttribute("aria-checked", "false");
  expect(await icons(page).count()).toBeGreaterThanOrEqual(1);
  await expect(cards(page)).toHaveCount(0);

  // Fifteen seconds at rest: still nothing asked for.
  await page.waitForTimeout(15_000);
  expect(pictures).toEqual([]);
  await expect(cards(page)).toHaveCount(0);
});

test("open, close, and one at a time", async ({ page }) => {
  const pictures = pictureRequests(page);
  await startOff(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  expect(await icons(page).count()).toBeGreaterThanOrEqual(2);

  // A tap opens that camera's card, and its picture is fetched only now.
  const first = icons(page).first();
  const firstLabel = await first.getAttribute("aria-label");
  expect(firstLabel).toMatch(/^Show /);
  expect(pictures).toEqual([]);
  await first.click();
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => pictures.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(closeButton(page)).toBeFocused();
  // The close button is a sibling of the link, never inside it.
  await expect(page.locator('a[href^="/camera/"] button')).toHaveCount(0);

  // Esc closes it, the icon comes back, and focus goes to it.
  await page.keyboard.press("Escape");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: firstLabel! })).toBeFocused();

  // Open one, then another: only the second card exists.
  await icons(page).first().click();
  await expect(cards(page)).toHaveCount(1);
  const hrefA = await cards(page).first().getAttribute("href");
  await icons(page).first().click();
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => cards(page).first().getAttribute("href")).not.toBe(hrefA);
  await expect(closeButton(page)).toHaveCount(1);

  // The close button closes it.
  await closeButton(page).click();
  await expect(cards(page)).toHaveCount(0);
});

test("the choice is remembered in this browser, and on brings the cards back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  await expect(previewsSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("main")).not.toHaveAttribute("data-previews", /.*/);

  await previewsSwitch(page).click();
  await expect(previewsSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(cards(page)).toHaveCount(0);
  await expect.poll(() => icons(page).count()).toBeGreaterThanOrEqual(1);

  await page.reload();
  await ready(page);
  await expect(previewsSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("main")).toHaveAttribute("data-previews", "off");
  await expect(cards(page)).toHaveCount(0);

  await previewsSwitch(page).click();
  await expect(previewsSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(icons(page)).toHaveCount(0);
  await expect.poll(() => cards(page).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
});

test("a recording ignores it: no icons, no switch", async ({ page }) => {
  await startOff(page);
  await page.setViewportSize({ width: 540, height: 960 });
  await page.goto("/eye?place=westminster&record=1");
  await ready(page);

  await expect(icons(page)).toHaveCount(0);
  await expect(previewsSwitch(page)).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveAttribute("data-previews", /.*/);
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test("every icon and the close button are 44 px, and nothing scrolls sideways", async ({ page }) => {
    await startOff(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/eye?place=westminster");
    await ready(page);

    const count = await icons(page).count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const box = await icons(page).nth(i).boundingBox();
      expect(box, `icon ${i}`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // The switch is a row of 44 px in the sheet behind the menu.
    const menu = page.locator('[data-rail="eye"] [data-rail-menu]');
    await expect(previewsSwitch(page)).toBeHidden();
    await menu.tap();
    // The sheet takes .18s to open: this reads the switch at rest, not on its way.
    await expect.poll(async () => (await previewsSwitch(page).boundingBox())!.width).toBeGreaterThanOrEqual(44);
    const sw = await previewsSwitch(page).boundingBox();
    expect(sw!.height).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(previewsSwitch(page)).toBeHidden();

    await icons(page).first().tap();
    await expect(cards(page)).toHaveCount(1);
    const x = await closeButton(page).boundingBox();
    expect(x!.width).toBeGreaterThanOrEqual(44);
    expect(x!.height).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await closeButton(page).tap();
    await expect(cards(page)).toHaveCount(0);

    // A narrower phone: nothing overflows.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.reload();
    await ready(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

test("a card opened from an icon says Live only while a stream plays in it", async ({ page }) => {
  await startOff(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  await icons(page).first().click();
  await expect(cards(page)).toHaveCount(1);
  // Let its picture arrive; with none on screen there is nothing to check but the rule's absence.
  await page.waitForSelector("[data-media]", { timeout: 20_000 }).catch(() => undefined);

  const chips = await page.locator("[data-media]").evaluateAll((els) =>
    els.map((el) => ({ media: el.getAttribute("data-media"), text: el.textContent ?? "" })),
  );
  for (const c of chips) if (/\bLive\b/.test(c.text)) expect(c.media).toBe("stream");
});
