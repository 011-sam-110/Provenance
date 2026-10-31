import { expect, test, type Page } from "@playwright/test";
import { BRAND } from "../../lib/brand";

// THE SHORT NAVBAR, AND THE DARK DEFAULT (HUD v2, M4).
//
// Sam's words: "i want the 'videwo, stills, countries, operators, counted, webcams' removed
// from the navbar. I want discord, support source, shortcuts, dark mode, all hidden into
// settings and put into appropriate, easy places." Then: "lets keep source and support
// outside of settings then", and "set dark mode as the new default. It can be switched back
// to light in settings".
//
// So the bar holds the brand, Globe, Streets, the presence count, Support, Source, Settings
// and Account. Discord sits at the foot of the drawer's tab column, the palette's door at the
// top of its Shortcuts tab, and Theme is the first row of Display. tests/unit/console-topbar.test.ts
// holds the wiring; this file presses the real controls.
//
// Run with the keyless dev server or a production build. This spec reads no feed.

const SKIN_KEY = "tn.terminal.skin.v2";
const envelope = (d: string) => JSON.stringify({ v: 1, d });
const DARK_BG = "rgb(15, 17, 11)";

/** Keep the boot overlay away, like every other console spec. */
async function stampSeen(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
}

async function openDrawer(page: Page) {
  await page.locator(".tn-settings-trigger").click();
  await expect(page.locator(".tn-settings")).toBeVisible();
}

/**
 * What <html> looked like on every animation frame from the first one with a <body>, up to
 * the `load` event. A frame callback runs just before that frame paints, and the console is
 * server-rendered, so this is the page before hydration: it proves the before-paint script
 * set the attribute, not React afterwards.
 */
async function recordFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: { skin: string | null; bg: string; hasConsole: boolean }[] };
    w.__frames = [];
    let done = false;
    addEventListener("load", () => setTimeout(() => { done = true; }, 250));
    const tick = () => {
      if (document.body) {
        w.__frames.push({
          skin: document.documentElement.getAttribute("data-tnx-skin"),
          bg: getComputedStyle(document.body).backgroundColor,
          hasConsole: !!document.querySelector(".tn-terminal"),
        });
      }
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __frames: { skin: string | null; bg: string; hasConsole: boolean }[] }).__frames);

const skinAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-tnx-skin"));
const stored = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SKIN_KEY);

test.describe("the navbar", () => {
  test("holds exactly the kept items, and none of the removed ones", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const asked: string[] = [];
    page.on("request", (r) => asked.push(new URL(r.url()).pathname));
    await stampSeen(page);
    await page.goto("/app");
    await expect(page.locator(".tn-settings-trigger")).toBeVisible();

    // Every control in the bar, in order. Account renders only when accounts are configured,
    // and the presence count is a readout, so neither is in this list.
    const controls = await page.locator(".tnx-hdr").locator("a, button").evaluateAll((els) =>
      els
        .filter((el) => !el.classList.contains("tn-account-trigger"))
        .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/[^A-Za-z ]/g, "").trim()),
    );
    expect(controls).toEqual(["GLOBE board", "STREETS board", "SUPPORT", "SOURCE", "Settings"]);

    // The words that left, read from what a sighted person sees: the hidden `stat-line`
    // keeps its own words on purpose, for screen readers and the smoke test.
    const visible = await page.locator(".tnx-hdr").evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".tn-sr-only").forEach((n) => n.remove());
      return copy.textContent ?? "";
    });
    expect(visible).not.toMatch(/video|stills|countries|operators|counted|webcams|discord|shortcuts/i);

    await expect(page.getByTestId("camera-stats")).toHaveCount(0);
    await expect(page.locator(".tnx-hdr .tnx-hdr-skin")).toHaveCount(0);
    await expect(page.locator(".tnx-hdr .tn-palette-trigger")).toHaveCount(0);

    // What stays for reasons nobody can see. See the header's own comments.
    await expect(page.getByTestId("stat-line")).toHaveCount(1);
    await expect(page.getByTestId("a11y-status-line")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);

    // The counts have no new home, so nothing asks for them.
    await page.waitForTimeout(1500);
    expect(asked.filter((p) => p.includes("camera-stats"))).toEqual([]);
  });

  test("Source stays in the bar (AGPL section 13), and so does Support", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stampSeen(page);
    await page.goto("/app");
    await expect(page.locator(".tnx-hdr a", { hasText: "SOURCE" })).toHaveAttribute("href", BRAND.repoUrl);
    await expect(page.locator(".tnx-hdr a", { hasText: "SUPPORT" })).toHaveAttribute("href", BRAND.kofiUrl);
  });

  // The camera strip's spec swept the widths to check that nothing was cut off. The bar is
  // shorter now and the guard stays. 900 and 901 are either side of the narrow header pass.
  for (const w of [1920, 1440, 1280, 1024, 901, 900, 720, 540, 441, 440, 390, 360, 320]) {
    test(`at ${w}px every control is on screen and nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await stampSeen(page);
      await page.goto("/app");
      await expect(page.locator(".tn-settings-trigger")).toBeVisible();
      const off = await page.locator(".tnx-hdr").locator("h1, a, button").evaluateAll(
        (els, vw) =>
          els
            .map((el) => ({ name: el.textContent?.trim().slice(0, 20), r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width === 0 || r.left < 0 || r.right > vw)
            .map(({ name }) => name),
        w,
      );
      expect(off).toEqual([]);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways).toBeLessThanOrEqual(0);
      const height = (await page.locator(".tnx-hdr").boundingBox())?.height ?? 0;
      // One row on a desktop: the 38px bar, as it was before the strip.
      if (w > 900) expect(height).toBeLessThanOrEqual(39);
      // Two rows of 44px on a phone, and never a third row of chrome.
      else expect(height).toBeLessThanOrEqual(91);
    });
  }
});

test.describe("Discord and the palette, from Settings", () => {
  for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 360, 780]] as const) {
    test(`${name}: Join the Discord is on every tab, and it opens the invite`, async ({ page, context }) => {
      await page.setViewportSize({ width, height });
      await context.route("https://discord.gg/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
      await stampSeen(page);
      await page.goto("/app");
      await openDrawer(page);

      for (const tab of await page.getByRole("tab").all()) {
        await tab.click();
        const link = page.getByRole("link", { name: "Join the Discord" });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", BRAND.discordUrl);
        await expect(link).toHaveAttribute("target", "_blank");
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
        if (name === "phone") expect(box.height).toBeGreaterThanOrEqual(44);
      }

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByRole("link", { name: "Join the Discord" }).click(),
      ]);
      await popup.waitForLoadState();
      expect(popup.url().replace(/\/$/, "")).toBe(BRAND.discordUrl);
      await popup.close();
    });

    test(`${name}: Open command palette closes the drawer and opens the palette`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stampSeen(page);
      await page.goto("/app");
      await openDrawer(page);
      await page.getByRole("tab", { name: "Shortcuts" }).click();

      const btn = page.getByRole("button", { name: "Open command palette" });
      // First in the tab's panel: the first control the panel offers.
      const first = await page.locator("#tn-settings-panel").locator("button, a, input").first().textContent();
      expect(first).toBe("Open command palette");
      if (name === "phone") expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await btn.click();

      await expect(page.locator(".tn-settings")).toHaveCount(0);
      await expect(page.locator(".tn-palette-root")).toBeVisible();
      await expect(page.getByPlaceholder(/Search actions/)).toBeFocused();

      // A palette that works: it reads the keyboard, and Escape closes it with nothing left over.
      await page.keyboard.type("Globe");
      await expect(page.getByPlaceholder(/Search actions/)).toHaveValue("Globe");
      await page.keyboard.press("Escape");
      await expect(page.locator(".tn-palette-root")).toHaveCount(0);
      await expect(page.locator(".tn-settings")).toHaveCount(0);
    });
  }
});

test.describe("dark by default", () => {
  test("a new browser opens dark at the first paint, and looking is not a choice", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await recordFrames(page);
    await stampSeen(page);
    await page.goto("/app");
    await expect(page.locator(".tn-settings-trigger")).toBeVisible();

    const seen = await frames(page);
    expect(seen.length, "no frame was recorded").toBeGreaterThan(0);
    expect(seen.filter((f) => f.skin !== "dark")).toEqual([]);
    expect(seen.filter((f) => f.bg !== DARK_BG)).toEqual([]);
    expect(seen.some((f) => f.hasConsole), "no frame held the console").toBe(true);

    expect(await skinAttr(page)).toBe("dark");
    expect(await stored(page)).toBeNull();

    await openDrawer(page);
    await page.getByRole("tab", { name: "Display" }).click();
    await expect(page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Theme is the first row of Display, and Light survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stampSeen(page);
    await page.goto("/app");
    await openDrawer(page);
    await page.getByRole("tab", { name: "Display" }).click();

    const firstRow = page.locator("#tn-settings-panel .tn-settings-row").first();
    await expect(firstRow.locator(".tn-settings-label")).toHaveText("Theme");

    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
    expect(await skinAttr(page)).toBeNull();
    expect(await stored(page)).toBe(envelope("light"));

    await page.reload();
    await expect(page.locator(".tn-settings-trigger")).toBeVisible();
    expect(await skinAttr(page)).toBeNull();
    expect(await stored(page)).toBe(envelope("light"));
    await openDrawer(page);
    await page.getByRole("tab", { name: "Display" }).click();
    const group = page.getByRole("group", { name: "Theme" });
    await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

    // And the way back.
    await group.getByRole("button", { name: "Dark" }).click();
    expect(await skinAttr(page)).toBe("dark");
    expect(await stored(page)).toBe(envelope("dark"));
    await page.reload();
    await expect(page.locator(".tn-settings-trigger")).toBeVisible();
    expect(await skinAttr(page)).toBe("dark");
  });

  test("a saved light stays light, with no dark frame on the way in", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await recordFrames(page);
    await stampSeen(page);
    await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [SKIN_KEY, envelope("light")]);
    await page.goto("/app");
    await expect(page.locator(".tn-settings-trigger")).toBeVisible();

    const seen = await frames(page);
    expect(seen.length, "no frame was recorded").toBeGreaterThan(0);
    expect(seen.filter((f) => f.skin !== null)).toEqual([]);
    expect(seen.filter((f) => f.bg === DARK_BG)).toEqual([]);
    expect(await skinAttr(page)).toBeNull();
    expect(await stored(page)).toBe(envelope("light"));
  });
});
