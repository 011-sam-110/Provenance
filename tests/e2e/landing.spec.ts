import { expect, test, type Page } from "@playwright/test";
import { BRAND } from "@/lib/brand";

/**
 * The landing page, held to the things the rest of the repo says about it.
 *
 * WHAT THIS FILE USED TO BE. Five tests about `.pv-hero-strip` and `.pv-stage-status`, the
 * hero's bottom band and the boot ticker: that they did not overlap, and that both were gone
 * 400px down. The 2026-10-05 rebuild removed both elements with the MapLibre hero they
 * belonged to, so those tests had nothing left to find and are deleted, not skipped.
 *
 * WHAT IT ASSERTS NOW. The page is one continuous scroll in which one globe changes state,
 * and almost everything a reviewer would check by eye is choreography. None of that is
 * asserted here, because a pixel position is a design decision and this file would have to
 * be edited every time one moved. What IS asserted is what other files depend on:
 *
 *   - the eight sections exist, in order, each under its id;
 *   - nothing scrolls sideways, at either width, in either motion mode;
 *   - with reduced motion the page is a complete document that needs no scrolling to read;
 *   - the page asks this site's API for nothing, and a visit contacts no third party except
 *     the visit counter. `CLAUDE.md` states the first, and `/privacy` tells the public which
 *     hosts a visitor's browser reaches, so each is a factual claim with nothing else
 *     checking it;
 *   - the links the licence and the camera directory depend on are still there;
 *   - the dots and lines are drawn by the WebGL painter, and by the 2D painter when WebGL is
 *     refused, lost, or not wanted (reduced motion). `lib/marketing/landingGlobeGL.ts` says
 *     the page still draws when WebGL fails, and nothing else checks that it does.
 *
 * THE HOOKS. Section ids `hero inset split plates layers flat street close`, the two globe
 * canvases `[data-testid="landing-globe"]` (2D) and `[data-testid="landing-globe-gl"]`
 * (WebGL), and `window.__pvLanding` (`ready`, `renderer`, `draws`, `go`), which
 * `LandingStage` sets. If one is renamed, rename it here in the same change; do not loosen a
 * selector to make a rename pass.
 *
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 */

const SECTIONS = ["hero", "inset", "split", "plates", "layers", "flat", "street", "close"] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const MOTION = ["no-preference", "reduce"] as const;

/**
 * Wait until the stage is running and has its data.
 *
 * The canvas is in the server HTML, so "the canvas is attached" says nothing about
 * hydration. `LandingStage` publishes `window.__pvLanding` when its effect runs, for the
 * review screenshots and for this file, and `ready` turns true once the snapshot and the
 * stills have arrived. Before that the pinned sections have not been given their heights,
 * and a test that scrolls is measuring the server layout and not the page.
 *
 * If this times out, the snapshot or an image failed to load, or the handle was renamed.
 */
const stageReady = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { __pvLanding?: { ready: boolean } }).__pvLanding?.ready === true,
    null,
    { timeout: 30_000 },
  );

/**
 * Scroll from the top to the bottom the way a reader does, most of a screen at a time.
 *
 * "instant", because a smooth scroll would still be travelling when the next line reads.
 * Two animation frames after each step: the stage smooths one scroll value inside its own
 * loop, and anything a section starts when it comes into view starts on a frame.
 */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; ; y += step) {
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      await frame();
      await frame();
      // Read the height on every pass. A pinned section can change it after hydration.
      if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
    }
  });
}

test("the eight sections are on the page, in order", async ({ page }) => {
  await page.goto("/");
  // One selector for all eight, so the result comes back in DOCUMENT order. A missing id, a
  // duplicated id and two sections swapped all show up as a different array.
  const found = await page.evaluate(
    (ids) => Array.from(document.querySelectorAll(ids.map((id) => `#${id}`).join(","))).map((el) => el.id),
    [...SECTIONS],
  );
  expect(found).toEqual([...SECTIONS]);
});

/**
 * Sideways scroll is measured all the way down the page, most of a screen at a time, not once
 * at load. The page pins stages and slides a row of cards across one of them, so the document
 * can be exactly as wide as the window at scroll 0 and wider 9,000px down.
 *
 * A sweep of the document and not "the top of each section": two of the sections are scenes
 * inside one pinned stage, so a section's own box does not say where in the scroll it plays.
 *
 * Both motion modes, because they are two layouts. Reduced motion un-pins everything and
 * lays the stills out in normal flow, and an image that was clipped by its pinned stage is
 * not clipped there.
 */
for (const vp of VIEWPORTS) {
  for (const motion of MOTION) {
    test(`nothing scrolls sideways (${vp.name}, motion ${motion})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/");
      // Both modes publish the handle. In reduced motion it means the in-flow globes have
      // been drawn, which is when that layout has its final boxes.
      await stageReady(page);

      const wider = await page.evaluate(async () => {
        const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
        const out: string[] = [];
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        let samples = 0;
        for (let y = 0; ; y += step) {
          window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
          await frame();
          await frame();
          samples += 1;
          const width = document.documentElement.scrollWidth;
          if (width > window.innerWidth) {
            out.push(`at scrollY ${Math.round(window.scrollY)}: scrollWidth ${width} > innerWidth ${window.innerWidth}`);
          }
          if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
        }
        // The precondition. A page one screen tall has nothing to sweep, and "no overflow
        // found" would then be a statement about the hero alone.
        if (samples < 5) out.push(`only ${samples} scroll positions: the page is not the long document this test expects`);
        return out;
      });

      expect(wider).toEqual([]);
    });
  }
}

/**
 * `prefers-reduced-motion: reduce` is not "the same page with the easing removed". The fixed
 * canvas is hidden and every section shows a still, so the page has to read from top to
 * bottom with no scroll position driving anything.
 *
 * So this test NEVER SCROLLS, and that is the assertion. A heading whose opacity or position
 * waits on a scroll-driven custom property is still waiting when the checks run.
 *
 * Opacity is multiplied up the ancestors by hand: Playwright's `toBeVisible` counts an
 * opacity-0 box as visible, and a faded-out heading is the likely way for this to break.
 * The poll allows a load-in transition to finish. It does not allow a scroll to happen.
 *
 * LIMIT. A heading hidden by an ancestor's `clip-path` passes every check here. Nothing
 * short of a screenshot sees that.
 */
test("with reduced motion every section's heading reads without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  for (const id of SECTIONS) {
    const heading = page.locator(`#${id}`).locator("h1, h2, h3").first();
    await expect(heading, `#${id} has no h1, h2 or h3`).toBeAttached();
    await expect(heading, `the heading of #${id} is not visible`).toBeVisible();
  }

  const hiddenHeadings = () =>
    page.evaluate((ids) => {
      const out: string[] = [];
      for (const id of ids) {
        const heading = document.getElementById(id)?.querySelector("h1, h2, h3");
        if (!heading) {
          out.push(`#${id}: no heading`);
          continue;
        }
        let opacity = 1;
        for (let el: Element | null = heading; el; el = el.parentElement) {
          opacity *= Number(getComputedStyle(el).opacity);
        }
        if (opacity < 0.99) out.push(`#${id}: heading opacity ${opacity.toFixed(2)}`);
        if (heading.textContent?.trim() === "") out.push(`#${id}: heading is empty`);
      }
      return out;
    }, [...SECTIONS]);

  await expect.poll(hiddenHeadings, { timeout: 10_000 }).toEqual([]);
  expect(await page.evaluate(() => window.scrollY), "this test must not scroll").toBe(0);
});

/**
 * `CLAUDE.md` says the landing page makes no `/api` call: its globe draws one committed
 * snapshot and its figures are imported at build time. That is why `/` costs no function
 * invocation per visitor, and it is one `fetch("/api/...")` in a client component away from
 * being false with nothing else to notice.
 *
 * Requests are collected from before navigation until after a scroll to the bottom, since a
 * section that fetched when it came into view would not have fetched yet at load.
 */
test("the page asks this site's API for nothing, from load to the bottom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));

  await page.goto("/");
  await stageReady(page);
  await scrollThrough(page);
  // A request is recorded when it is sent, so this only has to outlast the frame or two
  // between a section coming into view and whatever it starts.
  await page.waitForTimeout(1_500);

  const origin = new URL(page.url()).origin;
  const apiCalls = requested.filter((url) => {
    const u = new URL(url);
    return u.origin === origin && u.pathname.startsWith("/api/");
  });
  expect(apiCalls).toEqual([]);
  // The precondition, or an empty list proves nothing: the page did load things.
  expect(requested.length).toBeGreaterThan(0);
});

/**
 * `/privacy` lists who sees a visitor's IP address, and since 2026-10-05 it says the front
 * page loads no map tiles from anyone and that every typeface is served from this domain.
 * Before that the hero globe was MapLibre on OpenFreeMap tiles, so a landing visit reached a
 * tile host without the visitor opening anything.
 *
 * This is an allow-list on purpose. A deny-list of the map and font hosts would pass the day
 * a new third party arrived, which is exactly the day `/privacy` needs an edit. The one
 * third party allowed is the visit counter, which has its own card on that page; it is not
 * loaded at all unless NEXT_PUBLIC_POSTHOG_KEY is set, so most local runs see none.
 *
 * A red here means: either remove the request, or add the host to `/privacy` and then here.
 */
test("a visit contacts this site and the visit counter, and no other host", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));

  await page.goto("/");
  await stageReady(page);
  await scrollThrough(page);
  await page.waitForTimeout(1_500);

  const origin = new URL(page.url()).origin;
  const others = new Set<string>();
  for (const url of requested) {
    const u = new URL(url);
    // data: and blob: never leave the browser.
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.origin === origin) continue;
    if (/(^|\.)posthog\.com$/.test(u.hostname)) continue;
    others.add(u.hostname);
  }
  expect([...others].sort()).toEqual([]);
});

/**
 * Four links, each load-bearing somewhere else:
 *
 *   /app      the product. The first one in the document must be visible at load, without
 *             a scroll, or the page has no call to action on its first screen.
 *   /cameras  the home page takes nearly every search click, and this is its only link into
 *             the camera directory. Without it those pages are reachable through the
 *             sitemap alone. tests/unit/seo-share-cards.test.ts pins the source; this pins
 *             that it renders.
 *   /privacy  or the privacy page is orphaned.
 *   the repo  AGPL-3.0 section 13: a hosted AGPL program must offer its source to the people
 *             using it. Removing this link is a licence breach, not a styling decision.
 */
test("the calls to action and the footer links are on the page", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('a[href="/app"]').first()).toBeVisible();
  await expect(page.locator('a[href="/cameras"]').first()).toBeAttached();
  await expect(page.locator('a[href="/privacy"]').first()).toBeAttached();
  await expect(
    page.locator(`a[href="${BRAND.repoUrl}"], a[href="${BRAND.repoUrl}/"]`).first(),
    `no link to ${BRAND.repoUrl}`,
  ).toBeAttached();
});

/* ------------------------------------------------------------------ the two painters */

type Handle = { ready: boolean; renderer: "webgl" | "2d"; draws: number; go(name: string): number };
const handle = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __pvLanding?: Handle }).__pvLanding;
    return h ? { renderer: h.renderer, draws: h.draws } : null;
  });

/**
 * Go to the moment where the four layer globes stand in a row, and count the camera-blue
 * pixels on each canvas in the LAST frame the stage paints on its way there.
 *
 * WHY CAMERA BLUE. The first of the four globes shows the cameras alone, and nothing else
 * on either canvas is that colour at that moment: the ocean discs are dark and the rims are
 * faint. So "camera blue on a canvas" means "that canvas drew the dots".
 *
 * WHY THE LAST PAINTED FRAME. The stage eases its scroll value for a few hundred
 * milliseconds after a jump and paints on each of those frames, and on the way it passes
 * the hero, whose photograph of Earth has plenty of light blue in it. A count taken on those
 * frames is a count of ocean. `draws` moves once per paint, so the frame after which it
 * stops moving is the four globes at rest. The jump starts from another mark, because a
 * stage that is already there has nothing to paint.
 *
 * WHY INSIDE A FRAME, AND AFTER THE STAGE. The WebGL canvas does not keep its picture after
 * the browser has shown it, so it can only be read in the frame that drew it, after the
 * stage's own callback has run. Frame callbacks run in the order they were asked for, and
 * the stage asks for its next one from inside its current one. So this asks for each of its
 * frames from a timer, which runs after the stage has asked, and reads second. Ask for it
 * directly and it reads first, every frame, and sees a canvas that has already been cleared.
 * Each canvas is drawn over black before it is read, because a dot of light is colour with
 * no alpha and would read back as nothing.
 */
async function cameraBlue(page: Page): Promise<{ gl: number; flat: number; frames: number }> {
  return page.evaluate(async () => {
    const h = (window as unknown as { __pvLanding: Handle }).__pvLanding;
    const flat = document.querySelector<HTMLCanvasElement>('[data-testid="landing-globe"]')!;
    const gl = document.querySelector<HTMLCanvasElement>('[data-testid="landing-globe-gl"]')!;
    const probe = document.createElement("canvas");
    probe.width = flat.width;
    probe.height = flat.height;
    const px = probe.getContext("2d", { willReadFrequently: true })!;
    const count = (cv: HTMLCanvasElement) => {
      px.fillStyle = "#000";
      px.fillRect(0, 0, probe.width, probe.height);
      if (cv.width && cv.height) px.drawImage(cv, 0, 0);
      const d = px.getImageData(0, 0, probe.width, probe.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 160 && d[i + 1] > 150 && d[i + 2] > 200) n++;
      return n;
    };
    const frameAfterStage = () => new Promise<void>((done) => setTimeout(() => requestAnimationFrame(() => done()), 0));
    h.go("inset");
    for (let f = 0; f < 12; f++) await frameAfterStage();
    h.go("split");
    const out = { gl: 0, flat: 0, frames: 0 };
    let last = h.draws;
    for (let f = 0, quiet = 0; f < 400 && quiet < 15; f++) {
      await frameAfterStage();
      if (h.draws === last) {
        quiet++;
        continue;
      }
      last = h.draws;
      quiet = 0;
      out.gl = count(gl);
      out.flat = count(flat);
      out.frames++;
    }
    return out;
  });
}

/** Everything the page logs as an error, and every exception it throws. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/**
 * The normal case. The WebGL canvas carries the dots, the 2D canvas under it does not draw
 * them a second time, and a page at rest draws nothing at all.
 *
 * If `renderer` reads "2d" here, the browser this test ran in gave the globe no usable
 * WebGL context. That is the fallback working, and it is also this test failing, because a
 * suite that cannot see the WebGL painter is not checking it.
 */
test("the WebGL canvas draws the dots, the 2D canvas does not draw them twice, and rest is rest", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = collectErrors(page);
  await page.goto("/");
  await stageReady(page);
  expect((await handle(page))?.renderer).toBe("webgl");

  const blue = await cameraBlue(page);
  // The precondition, or two zeros prove nothing: the stage painted while this watched.
  expect(blue.frames, "the stage did not paint on its way to the four globes").toBeGreaterThan(2);
  expect(blue.gl, "no camera dots on the WebGL canvas").toBeGreaterThan(200);
  expect(blue.flat, "the 2D canvas drew the camera dots as well").toBe(0);

  // Let the eased scroll settle, then nothing may paint.
  await page.waitForTimeout(1_500);
  const before = (await handle(page))!.draws;
  await page.waitForTimeout(1_000);
  expect((await handle(page))!.draws - before, "the stage painted while the page was at rest").toBe(0);
  expect(errors).toEqual([]);
});

/**
 * WebGL refused. Only the globe's own canvas is refused a context, so this is the fallback
 * and nothing else: the 2D painter must draw the dots, and nothing may be logged.
 */
test("with WebGL refused to the globe, the 2D painter draws the dots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (this.dataset.testid === "landing-globe-gl" && String(type).startsWith("webgl")) return null;
      return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof real;
  });
  const errors = collectErrors(page);
  await page.goto("/");
  await stageReady(page);
  expect((await handle(page))?.renderer).toBe("2d");
  await expect(page.getByTestId("landing-globe-gl")).toBeHidden();

  const blue = await cameraBlue(page);
  expect(blue.flat, "the 2D painter did not draw the camera dots").toBeGreaterThan(200);
  expect(blue.gl).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * A browser can take a WebGL context away at any time. The 2D painter must take over in
 * that moment, and the WebGL painter must come back when the context does.
 */
test("a lost WebGL context hands the dots to the 2D painter, and a restored one takes them back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = collectErrors(page);
  await page.goto("/");
  await stageReady(page);
  expect((await handle(page))?.renderer).toBe("webgl");

  const renderer = () => handle(page).then((h) => h?.renderer);
  // The extension is fetched ONCE and kept: a lost context answers every getExtension with null,
  // so the handle that restores it has to be in hand before it is lost.
  const lose = (how: "loseContext" | "restoreContext") =>
    page.evaluate((fn) => {
      const w = window as unknown as { __lose?: WEBGL_lose_context | null };
      if (w.__lose === undefined) {
        const cv = document.querySelector<HTMLCanvasElement>('[data-testid="landing-globe-gl"]')!;
        // The same context the stage holds: a canvas has one.
        w.__lose = cv.getContext("webgl")!.getExtension("WEBGL_lose_context");
      }
      if (!w.__lose) throw new Error("this browser has no WEBGL_lose_context, so the test cannot run");
      w.__lose[fn]();
    }, how);

  await lose("loseContext");
  await expect.poll(renderer, { timeout: 5_000 }).toBe("2d");
  expect((await cameraBlue(page)).flat, "the 2D painter did not take over").toBeGreaterThan(200);

  await lose("restoreContext");
  await expect.poll(renderer, { timeout: 5_000 }).toBe("webgl");
  const blue = await cameraBlue(page);
  expect(blue.gl, "the WebGL painter did not come back").toBeGreaterThan(200);
  expect(blue.flat).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * The reduced-motion page is painted in 2D only. It must not ask for a WebGL context for the
 * globe at all: that page starts no loop, and a context it never draws with is pure cost.
 */
test("with reduced motion the globe asks for no WebGL context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const asked: string[] = [];
    (window as unknown as { __asked: string[] }).__asked = asked;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      asked.push(`${this.dataset.testid ?? this.className}:${type}`);
      return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof real;
  });
  await page.goto("/");
  await stageReady(page);
  expect((await handle(page))?.renderer).toBe("2d");
  const asked = await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);
  expect(asked.filter((a) => a.startsWith("landing-globe-gl:"))).toEqual([]);
  // The precondition: the in-flow globes did ask for their 2D contexts, so the hook works.
  expect(asked.some((a) => a.endsWith(":2d"))).toBe(true);
});
