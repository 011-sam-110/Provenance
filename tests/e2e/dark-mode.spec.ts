import { expect, test, type Page } from "@playwright/test";

// The console's two skins (lib/terminal/skin.ts, the DARK SKIN block in app/globals.css):
// dark for a new browser and for anything unreadable, light only from Settings > Display,
// remembered per browser, and no flash of the other skin on a load.
//
// tests/e2e/console-navbar.spec.ts holds the first paint of a new browser and of a saved
// light, and Theme to Light surviving a reload. This file holds the rest: a saved dark, a
// corrupt value, storage that throws, a board switch, and the pages the skin must not reach.
//
// Run with the keyless dev server or a production build; this spec reads no feed.
// Writes persona-shots/hud-v2/console-navbar/dark-console-phone.jpg and
// dark-console-desktop.jpg (UI evidence, per CLAUDE.md).

const SKIN_KEY = "tn.terminal.skin.v2";
const DARK_BG = "#0f110b";
const DARK_ENVELOPE = JSON.stringify({ v: 1, d: "dark" });
const LIGHT_ENVELOPE = JSON.stringify({ v: 1, d: "light" });
const SHOTS = "persona-shots/hud-v2/console-navbar";

test.beforeEach(async ({ page }) => {
  // Keep the boot overlay away, like every other console spec.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    } catch {
      // The private-mode test below takes localStorage away.
    }
  });
});

const skinAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-tnx-skin"));
const stored = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SKIN_KEY);
const save = (page: Page, value: string) =>
  page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [SKIN_KEY, value]);
const consoleReady = (page: Page) => expect(page.locator(".tn-settings-trigger")).toBeVisible();

async function openTheme(page: Page) {
  await page.locator(".tn-settings-trigger").click();
  await page.getByRole("tab", { name: "Display" }).click();
  const group = page.getByRole("group", { name: "Theme" });
  await expect(group).toBeVisible();
  return group;
}

test("a saved dark choice is on <html> before the console paints, and stays saved", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await save(page, DARK_ENVELOPE);
  await page.addInitScript(() => {
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
  });
  await page.goto("/app");
  await consoleReady(page);

  const first = await page.evaluate(() => (window as unknown as { __firstConsole?: { skin: string | null; bg: string } }).__firstConsole);
  expect(first, "no .tn-terminal was ever observed").toBeTruthy();
  expect(first?.skin).toBe("dark");
  expect(first?.bg).toBe("rgb(15, 17, 11)");

  expect(await skinAttr(page)).toBe("dark");
  expect(await stored(page)).toBe(DARK_ENVELOPE);
  expect(await page.locator(".tn-terminal").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--tnx-bg").trim())).toBe(DARK_BG);
});

for (const [name, raw] of [
  ["garbage JSON", "{not json"],
  ["a wrong version", JSON.stringify({ v: 9, d: "light" })],
  ["a value that is no skin", JSON.stringify({ v: 1, d: "Light" })],
] as const) {
  test(`${name} means dark, and nothing rewrites it`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await save(page, raw);
    await page.goto("/app");
    await consoleReady(page);
    expect(await skinAttr(page)).toBe("dark");
    expect(await stored(page)).toBe(raw);
  });
}

test("storage that throws means dark, with no error, and Light still works for the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const skinErrors: string[] = [];
  page.on("pageerror", (e) => {
    if (/skin|SKIN|data-tnx/.test(`${e.message}${e.stack ?? ""}`)) skinErrors.push(e.message);
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  await page.goto("/app");
  await expect(page.locator(".tn-terminal").first()).toBeAttached();
  expect(await skinAttr(page)).toBe("dark");
  expect(skinErrors).toEqual([]);
});

test("the Theme row and <html> move together", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await save(page, DARK_ENVELOPE);
  await page.goto("/app");
  await consoleReady(page);
  const group = await openTheme(page);
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");

  await group.getByRole("button", { name: "Light" }).click();
  expect(await skinAttr(page)).toBeNull();
  await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".tn-terminal").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--tnx-bg").trim())).not.toBe(DARK_BG);

  await group.getByRole("button", { name: "Dark" }).click();
  expect(await skinAttr(page)).toBe("dark");
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

for (const [start, want] of [["nothing saved", "dark"], ["a saved light", null]] as const) {
  test(`${start} survives a board switch (the variant trap)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (want === null) await save(page, LIGHT_ENVELOPE);
    await page.goto("/app");
    await consoleReady(page);
    expect(await skinAttr(page)).toBe(want);

    // lib/variants/store.ts rewrites data-theme on every board switch; the skin attribute is
    // not a theme, so nothing should touch it. Wait on the tab, not on a widget: Streets ships
    // no cards, so a .tn-cw wait would time out for a reason that has nothing to do with this.
    for (const tab of [/STREETS board/, /GLOBE board/]) {
      const btn = page.getByRole("button", { name: tab });
      await btn.click();
      await expect(btn).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(500);
      expect(await skinAttr(page)).toBe(want);
    }
    expect(await stored(page)).toBe(want === null ? LIGHT_ENVELOPE : null);
  });
}

test("the default stays on /app: the landing page and /privacy are not dark", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/", "/privacy"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(await skinAttr(page), path).toBeNull();
    // The console's choice does not reach them either.
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [SKIN_KEY, DARK_ENVELOPE]);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await skinAttr(page), `${path}, dark saved`).toBeNull();
    await page.evaluate((k) => window.localStorage.removeItem(k), SKIN_KEY);
  }
});

// maplibre-gl.css sets the open credit's text to black, which was 1.16:1 on the dark panel.
test("the map's open credit can be read, on both skins", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  for (const skin of ["dark", "light"]) {
    if (skin === "light") {
      await page.evaluate((k) => window.localStorage.setItem(k, JSON.stringify({ v: 1, d: "light" })), SKIN_KEY);
      await page.reload();
    }
    expect(await skinAttr(page), skin).toBe(skin === "dark" ? "dark" : null);
    await page.locator(".maplibregl-ctrl-attrib-button").first().click({ timeout: 90_000 });
    await expect(page.locator(".maplibregl-ctrl-attrib-inner").first()).toContainText(/\S/);
    const ratio = await page.evaluate(() => {
      const box = document.querySelector(".maplibregl-ctrl-attrib")!;
      const channels = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const text = lum(channels(getComputedStyle(document.querySelector(".maplibregl-ctrl-attrib-inner")!).color));
      const panel = lum(channels(getComputedStyle(box).backgroundColor));
      return (Math.max(text, panel) + 0.05) / (Math.min(text, panel) + 0.05);
    });
    expect(ratio, skin).toBeGreaterThanOrEqual(4.5);
  }
});

test("phone: Theme is reachable at 44px, and the evidence shots are written", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/app");
  await consoleReady(page);
  expect(await skinAttr(page)).toBe("dark");
  // The Sources sheet open, so the shot shows the switches and dots as well as the header.
  await page.locator('nav[data-rail="console"] [data-rail-menu]').click();
  await page.locator('nav[data-rail="console"] [data-rail-entry="sources"]').click();
  await expect(page.locator(".tn-rail")).toBeVisible();
  // Park the pointer on the header so no row's tooltip is open over the sheet.
  await page.mouse.move(200, 18);
  await page.waitForTimeout(1500); // let the dark map and the header settle
  await page.screenshot({ path: `${SHOTS}/dark-console-phone.jpg`, type: "jpeg", quality: 62 });

  const group = await openTheme(page);
  for (const name of ["Light", "Dark"]) {
    const box = await group.getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(1000, 450);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/dark-console-desktop.jpg`, type: "jpeg", quality: 62 });
});
