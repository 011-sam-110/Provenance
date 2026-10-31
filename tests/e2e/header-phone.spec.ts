import { test, expect, type Page } from "@playwright/test";

// THE CONSOLE HEADER'S BUTTON ROW ON A PHONE.
//
// At 900px and below the header hides every `.tnx-hdr-btn-label` (globals.css, the
// `max-width: 900px` header pass), so each button must keep a mark or a word of its own or it
// is an empty box. SHORTCUTS was that button from #162 (2026-09-05) until it left the bar for
// Settings on 2026-10-31; SETTINGS and ACCOUNT lose their words here and keep their glyphs,
// and SUPPORT and SOURCE keep their words.
//
// The boot stamp is the one map-rail.spec.ts and sources-rail.spec.ts use: without it
// the launch sequence covers the page and a click lands on the plate.

async function open(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.goto("/app");
  await expect(page.locator(".tn-settings-trigger")).toBeVisible();
}

for (const [w, h] of [[390, 844], [360, 780]] as const) {
  test.describe(`phone ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test("no header button is an empty box", async ({ page }) => {
      await open(page);
      const empty = await page.locator(".tnx-hdr-right .tnx-hdr-btn").evaluateAll((btns) =>
        btns
          .filter((b) => ![...b.children].some((c) => {
            const r = c.getBoundingClientRect();
            return getComputedStyle(c).display !== "none" && r.width > 0 && r.height > 0;
          }))
          .map((b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? b.className),
      );
      expect(empty).toEqual([]);
    });

    test("SETTINGS shows the gear, keeps its name and opens the drawer", async ({ page }) => {
      await open(page);
      const btn = page.getByRole("button", { name: "Settings", exact: true });
      await expect(btn.locator(".tnx-hdr-btn-label")).toBeHidden();
      await expect(btn).toContainText("⚙");
      await btn.click();
      await expect(page.locator(".tn-settings")).toBeVisible();
    });

    test("every control in the bar is a 44px target", async ({ page }) => {
      await open(page);
      const small = await page.locator(".tnx-hdr").locator("a, button").evaluateAll((els) =>
        els
          .map((el) => ({ name: el.textContent?.trim(), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
          .filter((c) => c.h < 44 || c.w < 44),
      );
      expect(small).toEqual([]);
    });

    test("the button row fits the screen", async ({ page }) => {
      await open(page);
      const row = await page.locator(".tnx-hdr-right").boundingBox();
      expect(row!.x).toBeGreaterThanOrEqual(0);
      expect(row!.x + row!.width).toBeLessThanOrEqual(w);
    });
  });
}

test.describe("desktop keeps the word", () => {
  for (const w of [1440, 901]) {
    test(`${w}px: SETTINGS has its word`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await open(page);
      await expect(page.locator(".tn-settings-trigger .tnx-hdr-btn-label")).toBeVisible();
    });
  }

  test("900px is the widest width without it", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page);
    await expect(page.locator(".tn-settings-trigger .tnx-hdr-btn-label")).toBeHidden();
  });
});
