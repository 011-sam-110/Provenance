import { expect, test, type Page } from "@playwright/test";
import { BRAND } from "@/lib/brand";

/**
 * The God's eye view (/eye), held to what the PR and /privacy say about it.
 *
 *   - It opens at a preset on a wide screen, a phone and a 9:16 recording, draws, and
 *     throws nothing.
 *   - Its frame names the place, credits every source it draws (the imagery, the map
 *     data, TfL), behind © Credits, and offers the source code with them closed (AGPL-3.0,
 *     section 13). A recording's frame draws them all in full.
 *   - No card says "Live" unless a stream is playing in it.
 *   - The browser reaches no third party but the ones /privacy names for this page:
 *     Esri's imagery and OpenFreeMap's building shapes (and the visit counter, when the
 *     build has a key for it).
 *   - "Auto-turn" turns the view, the first touch stops it, and with reduced motion there is
 *     no "Auto-turn" at all.
 *   - While the view turns, at most one card's clip plays; at rest every clip plays
 *     (the frame-time rule, clipsToPlay in lib/eye/cameras.ts).
 *   - In a film (clock=manual) the view runs on the film's clock: the HUD's time and
 *     every clip move on only with the film's steps, so a film drawn slowly still
 *     shows its own time, and each clip at its own speed.
 *
 * THE HOOKS: `main[data-eye-state="ready"]` (EyeApp sets it once the map is drawn and the
 * overlay has placed its cards), and `window.__map`, WorldMap's debug handle.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const SHAPES = [
  { name: "desktop", width: 1440, height: 900, query: "" },
  { name: "phone", width: 390, height: 693, query: "" },
  { name: "reel", width: 540, height: 960, query: "&record=1" },
] as const;

/** The hosts /privacy names for /eye, and the visit counter's. */
const ALLOWED_THIRD_PARTIES = [/(^|\.)arcgisonline\.com$/, /(^|\.)openfreemap\.org$/, /(^|\.)posthog\.com$/];

const ready = (page: Page) => page.waitForSelector('main[data-eye-state="ready"]', { timeout: 90_000 });
const turnSwitch = (page: Page) => page.getByRole("switch", { name: "Auto-turn" });
const menu = (page: Page) => page.locator('[data-rail="eye"] [data-rail-menu]');

for (const shape of SHAPES) {
  test(`opens Westminster on a ${shape.name} screen, credited and clean`, async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const hosts = new Set<string>();
    page.on("request", (r) => {
      // A card's picture is a blob: URL of what this site's proxy answered, not a host.
      const u = new URL(r.url());
      if (u.protocol === "http:" || u.protocol === "https:") hosts.add(u.hostname);
    });

    await page.setViewportSize({ width: shape.width, height: shape.height });
    await page.goto(`/eye?place=westminster${shape.query}`);
    await ready(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Westminster");
    const credits = page.locator("footer");
    await expect(page.locator(`footer a[href="${BRAND.repoUrl}"]`)).toHaveCount(1);
    if (shape.query.includes("record=1")) {
      // A recording is a frame, not a tool: every credit in full, and no button.
      await expect(page.getByRole("button", { name: "© Credits" })).toHaveCount(0);
      await expect(page.locator("[data-eye-exit]")).toHaveCount(0);
    } else {
      // The way to the console, at the spot on screen, its Sources rail as the visitor left it.
      // The href is filled in as the link is used, so read it after a focus.
      if (shape.width <= 900) await menu(page).click();
      const exit = page.locator("[data-eye-exit]");
      await exit.focus();
      await expect(exit).toHaveAttribute("href", /^\/app\?lat=[-\d.]+&lon=[-\d.]+&z=[\d.]+/);
      await expect(exit).not.toHaveAttribute("href", /sources=open/);
      if (shape.width <= 900) await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "© Credits" }).click();
      // Who this is, for a visitor who arrived from a reel.
      await expect(page.locator('main a[href="/"]').first()).toHaveText(/Provenance/);
    }
    await expect(credits).toContainText("Imagery © Esri");
    await expect(credits).toContainText("OpenStreetMap");
    // Westminster's cameras and road notices are TfL's.
    await expect(credits).toContainText("Powered by TfL Open Data");

    // "Live" only where a stream is playing.
    const chips = await page.locator("[data-media]").evaluateAll((els) =>
      els.map((el) => ({ media: el.getAttribute("data-media"), text: el.textContent ?? "" })),
    );
    for (const c of chips) if (/\bLive\b/.test(c.text)) expect(c.media).toBe("stream");

    // Nothing scrolls sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const own = new URL(baseURL!).hostname;
    const third = [...hosts].filter((h) => h !== own && h !== "localhost" && h !== "127.0.0.1");
    for (const h of third) expect(ALLOWED_THIRD_PARTIES.some((re) => re.test(h)), `unexpected host ${h}`).toBe(true);

    expect(errors).toEqual([]);
  });
}

test("Auto-turn turns the view, and the first touch stops it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  const bearing = () => page.evaluate(() => (window as unknown as { __map: { getBearing(): number } }).__map.getBearing());

  const clips = page.locator('[data-media="clip"] video');
  const playing = () => clips.evaluateAll((vs) => vs.filter((v) => !(v as HTMLVideoElement).paused).length);

  const turn = turnSwitch(page);
  const before = await bearing();
  await turn.click();
  await expect(turn).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(1500);
  expect(Math.abs((await bearing()) - before)).toBeGreaterThan(3);
  expect(await playing()).toBeLessThanOrEqual(1);

  await page.mouse.click(720, 640);
  await expect(turn).toHaveAttribute("aria-checked", "false");
  const stopped = await bearing();
  await page.waitForTimeout(800);
  expect(await bearing()).toBeCloseTo(stopped, 3);
  // At rest, every clip on screen plays again.
  await expect.poll(playing, { timeout: 5000 }).toBe(await clips.count());
});

type Film = { step(ms: number): void; idle(): Promise<void>; now(): number };

test("in a film, the HUD's clock moves only with the film's steps", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 960 });
  await page.goto("/eye?place=westminster&record=1&clock=manual");
  await ready(page);
  const filmNow = () => page.evaluate(() => (window as unknown as { __eye: Film }).__eye.now());

  const t0 = await filmNow();
  await page.waitForTimeout(1200);
  expect(await filmNow()).toBe(t0);

  await page.evaluate(async () => {
    const eye = (window as unknown as { __eye: Film }).__eye;
    eye.step(10 * 60_000);
    await eye.idle();
  });
  expect(await filmNow()).toBe(t0 + 10 * 60_000);
  // A recording shows the clock to the minute.
  await expect(page.getByLabel("Time now, UTC")).toContainText(new Date(t0 + 10 * 60_000).toISOString().slice(11, 16));
});

test("in a film, a clip moves on only with the film's steps", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 960 });
  await page.goto("/eye?place=westminster&record=1&clock=manual");
  await ready(page);
  const clip = page.locator('[data-media="clip"] video').first();
  // The clips come from TfL through the proxy; with none on screen there is nothing to step.
  const loaded = await clip
    .waitFor({ state: "attached", timeout: 15_000 })
    .then(() => clip.evaluate((v: HTMLVideoElement) => new Promise<boolean>((r) => (v.readyState >= 2 ? r(true) : v.addEventListener("loadeddata", () => r(true), { once: true })))))
    .catch(() => false);
  test.skip(!loaded, "no clip on screen to step");

  const time = () => clip.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, d: v.duration, paused: v.paused }));
  const t0 = await time();
  await page.waitForTimeout(1200);
  const t1 = await time();
  expect(t1.paused).toBe(true);
  expect(t1.t).toBeCloseTo(t0.t, 3);

  await page.evaluate(async () => {
    const eye = (window as unknown as { __eye: Film }).__eye;
    eye.step(500);
    await eye.idle();
  });
  const t2 = await time();
  expect(t2.t).toBeCloseTo((t0.t + 0.5) % t0.d, 1);
});

test.describe("with reduced motion", () => {
  test("there is no Auto-turn, and a motion link does not move", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/eye?place=westminster&motion=orbit");
    await ready(page);
    await expect(turnSwitch(page)).toHaveCount(0);
    const bearing = () => page.evaluate(() => (window as unknown as { __map: { getBearing(): number } }).__map.getBearing());
    const a = await bearing();
    await page.waitForTimeout(1000);
    expect(await bearing()).toBeCloseTo(a, 3);
  });
});

test("Exit to dashboard keeps the scene's layers on a first visit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  const exit = page.locator("[data-eye-exit]");
  await exit.focus();
  const href = await exit.getAttribute("href");
  expect(href).toContain("layers=livecams%2Cstaticcams%2Cplanes");
  await exit.click();
  await page.waitForURL(/\/app/);
  // The arrival flag has left the address.
  await expect.poll(() => new URL(page.url()).searchParams.has("eye"), { timeout: 30_000 }).toBe(false);
});

test("a phone holds the tools behind the menu at the top left, within thumb reach of nothing else", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/eye?place=westminster");
  await ready(page);
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await menu(page).click();
  await expect(page.getByRole("button", { name: "Sources & layers" })).toBeVisible();
  // The places are in the search box.
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Search places, cameras and vessels" }).click();
  await expect(page.getByRole("option", { name: /Tower Bridge/ })).toBeVisible();
});
