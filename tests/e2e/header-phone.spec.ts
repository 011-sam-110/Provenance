import { test, expect, type Page } from "@playwright/test";

// THE CONSOLE HEADER'S BUTTON ROW ON A PHONE.
//
// At 900px and below the header hides every button's word (globals.css, the
// `max-width: 900px` header pass), so each button must carry a mark of its own or it
// is an empty box. SHORTCUTS had none from #162 (2026-09-05), when its ⌘K cap left,
// until it got the magnifier (`.tnx-hdr-btn-mark`). Above 900px the mark takes no
// width, because the desktop bar has only a few pixels to spare.
//
// The boot stamp is the one map-rail.spec.ts and sources-rail.spec.ts use: without it
// the launch sequence covers the page and a click lands on the plate.

const NAME = "Shortcuts and command palette";

async function open(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
  await page.goto("/app");
  await expect(page.locator(".tn-palette-trigger")).toBeVisible();
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

    test("SHORTCUTS shows the magnifier, keeps its name and opens the palette", async ({ page }) => {
      await open(page);
      const btn = page.getByRole("button", { name: NAME });
      await expect(btn.locator(".tnx-hdr-btn-mark")).toBeVisible();
      await expect(btn.locator(".tnx-hdr-btn-label")).toBeHidden();
      const box = await btn.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(34);
      expect(box!.height).toBeGreaterThanOrEqual(34);
      await btn.click();
      await expect(page.locator(".tn-palette-root")).toBeVisible();
    });

    test("the button row fits the screen", async ({ page }) => {
      await open(page);
      const row = await page.locator(".tnx-hdr-right").boundingBox();
      expect(row!.x + row!.width).toBeLessThanOrEqual(w);
    });
  });
}

test.describe("desktop keeps the word and its width", () => {
  for (const w of [1440, 901]) {
    test(`${w}px: SHORTCUTS, no mark`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await open(page);
      const btn = page.getByRole("button", { name: NAME });
      await expect(btn).toHaveText("SHORTCUTS");
      await expect(btn.locator(".tnx-hdr-btn-label")).toBeVisible();
      await expect(btn.locator(".tnx-hdr-btn-mark")).toBeHidden();
    });
  }

  test("900px is the widest width with the mark", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page);
    const btn = page.getByRole("button", { name: NAME });
    await expect(btn.locator(".tnx-hdr-btn-mark")).toBeVisible();
    await expect(btn.locator(".tnx-hdr-btn-label")).toBeHidden();
  });
});
