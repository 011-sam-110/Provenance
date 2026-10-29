import { expect, test, type Page } from "@playwright/test";

// The console's opt-in dark skin (lib/terminal/skin.ts, the DARK SKIN block in
// app/globals.css): a 30px moon button right of SETTINGS, an Appearance row at the top of
// Settings > Display, light for a fresh browser, dark remembered per browser, and no flash
// of light on a reload.
//
// Run with the keyless dev server or a production build; this spec reads no feed.
// Writes persona-shots/dark-mode-console-desktop.png, dark-mode-console-phone.png and
// dark-mode-toggle-header.png (UI evidence, per CLAUDE.md).

const SKIN_KEY = "tn.terminal.skin.v2";
const DARK_BG = "#0f110b";
const DARK_ENVELOPE = JSON.stringify({ v: 1, d: "dark" });

test.beforeEach(async ({ page }) => {
  // Keep the boot overlay away, like every other console spec.
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

const skinAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-tnx-skin"));
const stored = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SKIN_KEY);

test("a fresh browser is light, and the toggle sits right after SETTINGS at 30px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const toggle = page.locator(".tnx-hdr-skin");
  await expect(toggle).toBeVisible();

  expect(await skinAttr(page)).toBeNull();
  expect(await stored(page)).toBeNull(); // looking at the page is not a choice
  // The very next sibling of the Settings button.
  await expect(page.locator(".tn-settings-trigger + .tnx-hdr-skin")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-label", "Dark mode");
  const box = await toggle.boundingBox();
  expect(box?.width ?? 99).toBeLessThanOrEqual(30);
});

test("pressing it turns the console dark and remembers it; pressing again undoes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const toggle = page.locator(".tnx-hdr-skin");
  await toggle.click();

  expect(await skinAttr(page)).toBe("dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".tn-terminal").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--tnx-bg").trim())).toBe(DARK_BG);
  expect(await stored(page)).toBe(DARK_ENVELOPE);

  await toggle.click();
  expect(await skinAttr(page)).toBeNull();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("a saved dark choice is on <html> before the console paints: no flash of light", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ([key, envelope]) => {
      window.localStorage.setItem(key, envelope);
      const w = window as unknown as { __firstConsole?: { skin: string | null; bg: string } };
      // The first time a .tn-terminal element exists in the document, what does <html> look
      // like? The console is server-rendered, so this is before hydration: it proves the
      // attribute was set by the inline script, not by React afterwards.
      const obs = new MutationObserver(() => {
        if (w.__firstConsole || !document.querySelector(".tn-terminal")) return;
        w.__firstConsole = {
          skin: document.documentElement.getAttribute("data-tnx-skin"),
          bg: getComputedStyle(document.documentElement).backgroundColor,
        };
        obs.disconnect();
      });
      obs.observe(document, { childList: true, subtree: true });
    },
    [SKIN_KEY, DARK_ENVELOPE],
  );
  await page.goto("/app");
  await expect(page.locator(".tnx-hdr-skin")).toBeVisible();

  const first = await page.evaluate(() => (window as unknown as { __firstConsole?: { skin: string | null; bg: string } }).__firstConsole);
  expect(first, "no .tn-terminal was ever observed").toBeTruthy();
  expect(first?.skin).toBe("dark");
  expect(first?.bg).toBe("rgb(15, 17, 11)");

  // And React agrees once it has hydrated: sun icon state, pressed.
  await expect(page.locator(".tnx-hdr-skin")).toHaveAttribute("aria-pressed", "true");
  expect(await skinAttr(page)).toBe("dark");
});

test("Settings > Display has the Appearance row, in step with the header toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [SKIN_KEY, DARK_ENVELOPE]);
  await page.goto("/app");
  await page.locator(".tn-settings-trigger").click();
  await page.getByRole("tab", { name: "Display" }).click();

  const group = page.getByRole("group", { name: "Theme" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");

  await group.getByRole("button", { name: "Light" }).click();
  expect(await skinAttr(page)).toBeNull();
  await expect(page.locator(".tnx-hdr-skin")).toHaveAttribute("aria-pressed", "false");
  await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

  await group.getByRole("button", { name: "Dark" }).click();
  expect(await skinAttr(page)).toBe("dark");
  await expect(page.locator(".tnx-hdr-skin")).toHaveAttribute("aria-pressed", "true");
});

test("dark survives a board switch (the variant trap)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await page.locator(".tnx-hdr-skin").click();
  expect(await skinAttr(page)).toBe("dark");

  // lib/variants/store.ts rewrites data-theme on every board switch; the skin attribute is
  // not a theme, so nothing should touch it. Wait on the tab, not on a widget: Streets ships
  // no cards, so a .tn-cw wait would time out for a reason that has nothing to do with this.
  const streets = page.getByRole("button", { name: /STREETS board/ });
  await streets.click();
  await expect(streets).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  expect(await skinAttr(page)).toBe("dark");

  const globe = page.getByRole("button", { name: /GLOBE board/ });
  await globe.click();
  await expect(globe).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  expect(await skinAttr(page)).toBe("dark");
  expect(await stored(page)).toBe(DARK_ENVELOPE);
});

test("phone: the toggle is in the header row at 44px, and the evidence shots are written", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const toggle = page.locator(".tnx-hdr-skin");
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(44);
  const hdr = await page.locator(".tnx-hdr").boundingBox();
  expect(box && hdr && box.y >= hdr.y && box.y + box.height <= hdr.y + hdr.height + 1).toBeTruthy();

  await toggle.click();
  expect(await skinAttr(page)).toBe("dark");
  // The Sources sheet open, so the shot shows the switches and dots as well as the header.
  await page.locator(".tn-rail-fab").click();
  await expect(page.locator(".tn-rail")).toBeVisible();
  // Wait for the camera counts to land (no skeletons in the evidence), and park the pointer
  // on the header so no row's tooltip is open over the sheet.
  await expect(page.getByTestId("camera-stats")).toHaveAttribute("aria-label", /^Road and public operator cameras/, { timeout: 120_000 });
  await page.mouse.move(200, 18);
  await page.waitForTimeout(1500); // let the dark map and the header settle
  await page.screenshot({ path: "persona-shots/dark-mode-console-phone.png" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(1000, 450);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "persona-shots/dark-mode-console-desktop.png" });
  // The right-hand cluster, so a reviewer can see the moon beside SETTINGS.
  const hdrBox = await page.locator(".tnx-hdr").boundingBox();
  if (hdrBox) {
    await page.screenshot({
      path: "persona-shots/dark-mode-toggle-header.png",
      clip: { x: Math.max(0, hdrBox.width - 520), y: hdrBox.y, width: Math.min(520, hdrBox.width), height: hdrBox.height },
    });
  }
});
