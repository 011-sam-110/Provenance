import { expect, test, type Page } from "@playwright/test";

// THE MAP CLOCK (components/console/WorldClock.tsx, ClockPicker.tsx, lib/console/clockZones.ts):
// a 26px pill of local times over the console map, a gear that appears on hover and focus and
// opens a picker upward, labels that shorten as the map narrows, and every clock a button that
// flies the map to its airport.
//
// Run with the keyless dev server or a production build; this spec reads no feed. Each test gets
// a fresh browser context, so `tn.clocks.v1` starts empty without being cleared. The last test
// writes persona-shots/map-time-strip-*.png (UI evidence, per CLAUDE.md).

const CLOCKS_KEY = "tn.clocks.v1";
const PILL = ".tnx-stage-foot .tn-worldclock:not(.tn-wc-measure)";
const GO = `${PILL} .tn-wc-go`;
const GEAR = `${PILL} .tn-wc-gear`;
const DEFAULT_NAMES = [
  "Go to LAX, Los Angeles International",
  "Go to JFK, John F. Kennedy International",
  "Go to LHR, London Heathrow",
  "Go to DXB, Dubai International",
  "Go to SIN, Singapore Changi",
  "Go to HND, Tokyo Haneda",
  "Go to SYD, Sydney Kingsford Smith",
];

test.beforeEach(async ({ page }) => {
  // Keep the boot overlay away, like every other console spec.
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

async function open(page: Page, width = 1440, height = 900, sources = false) {
  await page.setViewportSize({ width, height });
  await page.goto(sources ? "/app?sources=open" : "/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  if (sources) await expect(page.locator(".tn-cw-shell > .tn-rail")).toBeVisible();
  // The pill stays hidden (visibility) until its first measure.
  await expect(page.locator(PILL)).toBeVisible();
}

const urlView = (page: Page) => {
  const u = new URL(page.url());
  return {
    lat: Number(u.searchParams.get("lat")),
    lon: Number(u.searchParams.get("lon")),
    z: Number(u.searchParams.get("z")),
  };
};
const stored = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), CLOCKS_KEY);
const opacity = (page: Page, sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).opacity);

async function openPicker(page: Page) {
  await page.locator(GEAR).click();
  await expect(page.locator(".tn-wc-picker")).toBeVisible();
}

test("seven clocks in west to east order, the first reading its country", async ({ page }) => {
  await open(page);
  const buttons = page.locator(GO);
  await expect(buttons).toHaveCount(7);
  for (let i = 0; i < 7; i++) await expect(buttons.nth(i)).toHaveAttribute("aria-label", DEFAULT_NAMES[i]);

  await expect(buttons.first().locator(".tn-wc-city")).toHaveText("LAX");
  await expect(buttons.first().locator(".tn-wc-country")).toHaveText("United States");

  // The bar keeps its height and its 10px offset from the stage floor, whatever the tier.
  const geo = await page.evaluate((sel) => {
    const pill = document.querySelector(sel)!.getBoundingClientRect();
    const stage = document.querySelector(".tn-cw-stage")!.getBoundingClientRect();
    return { h: pill.height, gap: Math.round(stage.bottom - pill.bottom), clear: getComputedStyle(document.querySelector(".tn-cw-stage")!).getPropertyValue("--tnx-stage-foot-clear").trim() };
  }, PILL);
  expect(geo.h).toBe(26);
  expect(geo.gap).toBe(10);
  expect(geo.clear).toBe("46px");

  // Each clock says who it is for a screen reader: city, country and the time.
  const describedBy = await buttons.nth(2).getAttribute("aria-describedby");
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/^London, United Kingdom, \d\d:\d\d$/);
  // London's time keeps the accent, keyed on the zone.
  await expect(page.locator(`${GO}[data-zone="Europe/London"]`)).toHaveCount(1);
});

test("the gear shows on hover and on focus, and the bar is one tab stop", async ({ page }) => {
  await open(page);
  await page.mouse.move(700, 200);
  await expect(page.locator(GEAR)).toHaveCSS("opacity", "0");

  await page.locator(GO).nth(3).hover();
  await expect(page.locator(GEAR)).toHaveCSS("opacity", "1");

  await page.mouse.move(700, 200);
  await expect(page.locator(GEAR)).toHaveCSS("opacity", "0");
  // Focus alone shows it.
  await page.locator(GO).first().focus();
  await expect(page.locator(GEAR)).toHaveCSS("opacity", "1");

  // A roving tabindex: exactly one of the clocks and the gear is a tab stop.
  expect(await page.locator(`${PILL} button[tabindex="0"]`).count()).toBe(1);
  await page.keyboard.press("End");
  await expect(page.locator(GEAR)).toBeFocused();
  await page.keyboard.press("ArrowRight"); // wraps to the first clock
  await expect(page.locator(GO).first()).toBeFocused();
  await page.keyboard.press("ArrowLeft"); // and back to the gear
  await expect(page.locator(GEAR)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator(GO).first()).toBeFocused();
});

test("add a clock from the search, and it is third and remembered; eight is the most", async ({ page }) => {
  await open(page);
  await openPicker(page);
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();

  await search.fill("sao");
  await expect(page.getByRole("option", { name: /GRU/ })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.locator(GO)).toHaveCount(8);
  await expect(page.locator(GO).nth(2)).toHaveAttribute("aria-label", "Go to GRU, S\u00e3o Paulo Guarulhos");
  await expect(page.locator(".tn-wc-pk-count")).toHaveText("8 of 8");
  // The input cleared and kept focus.
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  expect(JSON.parse((await stored(page)) as string).d).toContain("GRU");

  // The ninth: the + is disabled and the line says why.
  await search.fill("madrid");
  await expect(page.getByRole("button", { name: "Add MAD, Adolfo Su\u00e1rez Madrid-Barajas" })).toBeDisabled();
  await expect(page.getByText("8 clocks is the most. Remove one to add another.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(GO)).toHaveCount(8);

  await page.reload();
  await expect(page.locator(PILL)).toBeVisible();
  await expect(page.locator(GO)).toHaveCount(8);
  await expect(page.locator(GO).nth(2)).toHaveAttribute("aria-label", /^Go to GRU/);
});

test("removing down to one leaves the last x disabled, and Reset to default forgets the choice", async ({ page }) => {
  await open(page);
  await openPicker(page);
  const reset = page.getByRole("button", { name: "Reset to default" });
  await expect(reset).toBeDisabled(); // already the defaults

  for (let n = 7; n > 1; n--) {
    await page.locator(".tn-wc-pk-x:not(:disabled)").first().click();
    await expect(page.locator(".tn-wc-pk-rows .tn-wc-pk-row")).toHaveCount(n - 1);
  }
  await expect(page.locator(GO)).toHaveCount(1);
  const last = page.locator(".tn-wc-pk-x");
  await expect(last).toBeDisabled();
  await expect(last).toHaveAttribute("title", "At least one clock stays");
  expect(await stored(page)).not.toBeNull();

  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator(GO)).toHaveCount(7);
  await expect(page.locator(GO).first()).toHaveAttribute("aria-label", DEFAULT_NAMES[0]);
  expect(await stored(page)).toBeNull();
  await expect(reset).toBeDisabled();
});

test("Escape closes the picker and gives focus back to the gear", async ({ page }) => {
  await open(page);
  await openPicker(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tn-wc-picker")).toHaveCount(0);
  await expect(page.locator(GEAR)).toBeFocused();
  await expect(page.locator(GEAR)).toHaveAttribute("aria-expanded", "false");

  // A press outside the bar and its panel closes it too.
  await openPicker(page);
  await page.mouse.click(300, 300);
  await expect(page.locator(".tn-wc-picker")).toHaveCount(0);
});

test("clicking a clock flies the map there at zoom 12", async ({ page }) => {
  await open(page);
  await page.locator(`${GO}[data-code="LHR"]`).click();
  await expect
    .poll(() => urlView(page), { timeout: 5000 })
    .toMatchObject({ z: 12 });
  const v = urlView(page);
  expect(v.lat).toBeCloseTo(51.47, 1);
  expect(v.lon).toBeCloseTo(-0.46, 1);
});

test("under reduced motion a click jumps there, with no flight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator(`${GO}[data-code="HND"]`).click();
  // A flight takes 1.6 s; the URL is written a beat after the move ends.
  await expect.poll(() => urlView(page).z, { timeout: 1500 }).toBe(12);
  const v = urlView(page);
  expect(v.lat).toBeCloseTo(35.55, 1);
  expect(v.lon).toBeCloseTo(139.79, 1);
});

test("with Sources open at 1240 the labels are the codes alone, and the tooltip carries the country", async ({ page }) => {
  await open(page, 1240, 900, true);
  await expect(page.locator(PILL)).toHaveAttribute("data-tier", "code");
  await expect(page.locator(`${GO} .tn-wc-country`)).toHaveCount(0);
  await expect(page.locator(GO)).toHaveCount(7);

  await page.locator(`${GO}[data-code="HND"]`).hover();
  const tip = page.locator(".tn-wc-tip");
  await expect(tip).toBeVisible(); // after the 250 ms hover delay
  await expect(tip).toContainText("Go to Tokyo Haneda");
  await expect(tip).toContainText("Tokyo, Japan");
  await expect(tip).toContainText("Japan");
  // It stays inside the stage.
  const inside = await page.evaluate(() => {
    const t = document.querySelector(".tn-wc-tip")!.getBoundingClientRect();
    const s = document.querySelector(".tn-cw-stage")!.getBoundingClientRect();
    return t.left >= s.left && t.right <= s.right;
  });
  expect(inside).toBe(true);
});

test("a keyboard focus shows the tooltip at once", async ({ page }) => {
  await open(page);
  await page.locator(GO).first().focus();
  await page.keyboard.press("ArrowRight"); // keyboard focus, so :focus-visible matches
  await expect(page.locator(".tn-wc-tip")).toContainText("Go to John F. Kennedy International");
});

test("where even the codes do not fit, the east-most clocks hide behind the gear's +N", async ({ page }) => {
  // Eight clocks, saved before the page loads (and only if absent, so a reload keeps what was saved).
  await page.addInitScript((k) => {
    if (window.localStorage.getItem(k)) return;
    window.localStorage.setItem(k, JSON.stringify({ v: 1, d: ["LAX", "JFK", "GRU", "LHR", "DXB", "SIN", "HND", "SYD"] }));
  }, CLOCKS_KEY);
  await open(page, 1100, 900, true);
  const gear = page.locator(GEAR);
  await expect(gear).toHaveAttribute("aria-label", /, \d+ hidden$/);
  await expect(gear).toHaveCSS("opacity", "1"); // visible without hover
  const hidden = Number(/(\d+) hidden/.exec((await gear.getAttribute("aria-label")) as string)![1]);
  await expect(page.locator(GO)).toHaveCount(8 - hidden);
  await expect(gear).toContainText(`+${hidden}`);
  // The west end is kept, the east end goes.
  await expect(page.locator(GO).first()).toHaveAttribute("aria-label", /^Go to LAX/);
  const geo = await page.evaluate((sel) => {
    const g = document.querySelector(sel)!.getBoundingClientRect();
    const s = document.querySelector(".tn-cw-stage")!.getBoundingClientRect();
    return { gearRight: g.right, stageRight: s.right, stageLeft: s.left };
  }, GEAR);
  expect(geo.gearRight).toBeLessThanOrEqual(geo.stageRight);
  const pillLeft = await page.locator(PILL).evaluate((el) => el.getBoundingClientRect().left);
  expect(pillLeft).toBeGreaterThanOrEqual(geo.stageLeft);
});

test("on a phone there is no clock bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await expect(page.locator(`${PILL} .tn-wc-go`).first()).toBeHidden();
  await expect(page.locator(`${PILL} .tn-wc-go:visible`)).toHaveCount(0);
  const clear = await page.evaluate(() => getComputedStyle(document.querySelector(".tn-cw-stage")!).getPropertyValue("--tnx-stage-foot-clear").trim());
  expect(clear).toBe("0px");
});

test("on the Streets board a click moves the map and the empty wall stays as it was", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /STREETS board/ }).click();
  const prompt = page.getByText("Draw a circle round the area you want to monitor");
  await expect(prompt).toBeVisible();
  await expect(page.locator(PILL)).toBeVisible();

  await page.locator(`${GO}[data-code="LHR"]`).click();
  await expect.poll(() => urlView(page).z, { timeout: 5000 }).toBe(12);
  expect(urlView(page).lat).toBeCloseTo(51.47, 1);
  await expect(prompt).toBeVisible();
});

test("shots", async ({ page }) => {
  test.setTimeout(240_000);
  const shot = async (name: string, h = 110) => {
    const s = await page.evaluate(() => {
      const r = document.querySelector(".tn-cw-stage")!.getBoundingClientRect();
      return { x: r.left, b: r.bottom, w: r.width };
    });
    await page.screenshot({
      path: `persona-shots/map-time-strip-${name}.png`,
      clip: { x: Math.max(0, Math.round(s.x) - 6), y: Math.round(s.b - h), width: Math.round(s.w) + 12, height: h + 4 },
    });
  };
  const skin = async (s: "light" | "dark") => {
    await page.evaluate((v) => {
      if (v === "dark") document.documentElement.setAttribute("data-tnx-skin", "dark");
      else document.documentElement.removeAttribute("data-tnx-skin");
    }, s);
    await page.waitForTimeout(150);
  };
  const stageShot = async (name: string) => {
    await page.screenshot({ path: `persona-shots/map-time-strip-${name}.png` });
  };

  for (const [w, sources] of [[1440, false], [1440, true], [1240, false], [1240, true]] as const) {
    await open(page, w, 900, sources);
    const tag = `${w}-${sources ? "sources" : "closed"}`;
    for (const s of ["light", "dark"] as const) {
      await skin(s);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(250);
      await shot(`${tag}-${s}-rest`, 60);
      await page.locator(`${GO}[data-code="${sources ? "HND" : "LHR"}"]`).hover();
      await page.waitForTimeout(500);
      await shot(`${tag}-${s}-hover`, 120);
    }
  }

  // The picker, light and dark.
  await open(page, 1440, 900, false);
  await openPicker(page);
  await page.getByRole("combobox").fill("bra");
  await page.waitForTimeout(250);
  for (const s of ["light", "dark"] as const) {
    await skin(s);
    await stageShot(`picker-${s}`);
  }
  await page.keyboard.press("Escape");

  // Too narrow for the codes: the +N state.
  await page.evaluate((k) => window.localStorage.setItem(k, JSON.stringify({ v: 1, d: ["LAX", "JFK", "GRU", "LHR", "DXB", "SIN", "HND", "SYD"] })), CLOCKS_KEY);
  await open(page, 1100, 900, true);
  for (const s of ["light", "dark"] as const) {
    await skin(s);
    await page.mouse.move(8, 8);
    await shot(`1100-sources-${s}-overflow`, 60);
  }
  await page.evaluate((k) => window.localStorage.removeItem(k), CLOCKS_KEY);

  // The map after clicking LHR.
  await skin("light");
  await open(page, 1440, 900, false);
  await page.locator(`${GO}[data-code="LHR"]`).click();
  await expect.poll(() => urlView(page).z, { timeout: 5000 }).toBe(12);
  await page.waitForTimeout(2500); // tiles
  await stageShot("after-click-lhr");

  // A phone: no bar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await page.waitForTimeout(1500);
  await stageShot("390-no-bar");
});
