// Browser evidence for the Streets camera wall — the four checks the design spec
// commits to, run against a live console rather than reasoned about.
//
//   1. the map does not REMOUNT when the dock opens or closes;
//   2. `map.resize()` on reveal gives a correctly sized canvas, not a stretched one;
//   3. a drag and a resize both land WHERE THE GHOST SAID they would;
//   4. a reload restores the wall as a wall (hazard 5.1 caught in the act).
//
// Every check prints a measured PASS/FAIL line and the run exits non-zero if any
// fails, so this is a gate and not a slideshow. Screenshots are the by-product.
//
//   node scripts/verify-wall.mjs [baseUrl] [outDir]

import { chromium } from "playwright";
import { mkdir, readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const baseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3411";
const outDir = process.argv[3] ?? "persona-shots/wall";

// 1440x900 is the size the spec names. Sam browses at ~80% zoom, but every claim
// here is about GEOMETRY (which cell a tile landed in), not legibility, and the
// grid is fluid — so the nominal size is the honest one to assert at.
const VIEWPORT = { width: 1440, height: 900 };

// The launch plate owns the screen on a first visit, and a boot veil eats clicks.
const SUPPRESS = () => {
  window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
};

/** A chromium this machine actually has — the worktree's node_modules is a junction
 *  to the parent tree, so the pinned headless-shell revision was never downloaded
 *  here while several full builds sit in the same cache. */
async function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  let entries = [];
  try { entries = await readdir(root); } catch { return undefined; }
  const builds = entries
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const b of builds) {
    const exe = join(root, b, "chrome-win64", "chrome.exe");
    try { await access(exe); console.log(`using chromium build ${b}`); return exe; } catch { /* next */ }
  }
  return undefined;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

/** An element's inline `grid-column`/`grid-row` back to a zero-based rect.
 *
 *  SELF-CONTAINED ON PURPOSE. This runs inside the page, and a `$eval` callback is
 *  serialised to source — it does NOT close over anything in this module. Calling a
 *  helper defined out here throws a ReferenceError in the browser, which the
 *  `.catch(() => null)` at each call site then reports as a perfectly plausible
 *  "no ghost". */
const rectOfEl = (el) => {
  const track = (v) => {
    const m = /^(\d+)\s*\/\s*span\s*(\d+)$/.exec((v || "").trim());
    return m ? { start: Number(m[1]) - 1, span: Number(m[2]) } : null;
  };
  const c = track(el.style.gridColumn);
  const r = track(el.style.gridRow);
  return c && r ? { x: c.start, y: r.start, w: c.span, h: r.span } : null;
};

const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const show = (r) => (r ? `x${r.x} y${r.y} ${r.w}x${r.h}` : "none");

/** What the STORE thinks, read out of the same localStorage slot a reload restores
 *  through — so a drag that only moved pixels cannot pass this. */
async function storedRects(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("tn.console.v1");
    if (!raw) return null;
    const d = JSON.parse(raw).d;
    return { mode: d.mode, rects: Object.fromEntries(d.widgets.map((w) => [w.id, w.rect ?? null])) };
  });
}

/**
 * Toggle the map dock, tolerating a renderer that has stopped answering.
 *
 * Chromium is software-rendering a MapLibre globe here (SwiftShader, because
 * `--disable-gpu`), and a CDP screenshot of that forces a full composite. Measured
 * across eight runs of this script: three wedged immediately after a screenshot,
 * far enough that even resolving a locator timed out — while a 30-second poll of
 * the same page with no screenshots in it never stalled once. So the wedge is the
 * harness's compositor, not the app; the app-side checks below are unaffected by
 * it and the mitigations all live here.
 *
 * Three of them: a plain CSS selector rather than a role query (a role query builds
 * the accessibility tree of the whole console on a page that is already
 * struggling), the button's own `aria-pressed` as the definition of "it landed",
 * and an in-page `.click()` only when that attribute did not move. The fallback
 * ANNOUNCES itself, so it can never be mistaken for a clean press.
 */
async function pressMap(page) {
  const sel = '.tn-wall-btn[aria-pressed]';
  const was = await page.$eval(sel, (el) => el.getAttribute("aria-pressed"));
  const flipped = () =>
    page.waitForFunction(
      ([s, w]) => document.querySelector(s)?.getAttribute("aria-pressed") !== w,
      [sel, was],
      { timeout: 4000 },
    ).then(() => true, () => false);

  try {
    await page.click(sel, { timeout: 8000 });
  } catch { /* the input pipeline did not answer; fall through to the state check */ }

  // THE STATE, NOT THE CALL, is what says whether the press landed. A click that
  // reaches the button and then times out inside Playwright's own post-click wait
  // is indistinguishable from one that never landed — and re-pressing "just in
  // case" toggles the dock straight back, which is how three consecutive runs
  // reported an open dock as 0px wide.
  if (await flipped()) return "pointer";
  await page.$$eval(sel, (els) => els.forEach((e) => e.click()));
  console.log("      (note: the map toggle was activated in-page — the CDP click did not land)");
  return "in-page";
}

/** A screenshot of a software-rendered WebGL page is the expensive frame in this
 *  run. Give the compositor a breath afterwards rather than pressing a button into
 *  a renderer that is still catching up. */
async function shoot(page, path) {
  await page.screenshot({ path });
  await page.waitForTimeout(600);
}

/** Press, move in a few steps so pointermove actually fires, and read the ghost
 *  BEFORE releasing — the whole point is comparing the promise to the outcome. */
async function dragBy(page, handle, dx, dy, shotPath) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("handle has no box");
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x0 + (dx * i) / 6, y0 + (dy * i) / 6);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(120);
  const ghost = await page.$eval(".tn-grid-ghost", rectOfEl).catch(() => null);
  if (shotPath) await page.screenshot({ path: shotPath });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return ghost;
}

const run = async () => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await findChromium(),
    // Memory, not speed: this box runs several agents at once, and a browser that
    // reserves generously fails instantly with a V8 fatal rather than slowly.
    // KEEP SwiftShader — without WebGL MapLibre's constructor THROWS and the whole
    // console falls back to Next's error card, which screenshots perfectly happily.
    args: [
      "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions",
      "--renderer-process-limit=1", "--js-flags=--max-old-space-size=512",
      "--disable-background-networking", "--enable-unsafe-swiftshader",
    ],
  });
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(SUPPRESS);
  const page = await ctx.newPage();
  const pageErrors = [];
  // Tagged with the phase, so an error printed at the end of the run can still be
  // attributed to the step that produced it.
  let phase = "load";
  page.on("pageerror", (e) =>
    pageErrors.push(`[${phase}] ${(e.stack || e.message).split("\n").slice(0, 4).join("\n")}`));

  try {
    await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
    // Match the board tab on its accessible name, so a reordered nav fails loudly
    // instead of verifying the wrong board.
    const tab = page.getByRole("button", { name: /streets/i }).first();
    await tab.waitFor({ state: "visible", timeout: 30_000 });
    // The tab is SERVER-RENDERED, so it is visible and clickable well before React
    // has hydrated its handler. Clicking it in that window does nothing at all and
    // the run then times out waiting for a board that was never opened. Wait for
    // hydration to have produced something only the client build makes — the map
    // canvas — before pressing anything.
    await page.waitForSelector(".tn-cw-stage canvas", { timeout: 30_000 });
    phase = "streets";
    await tab.click();
    await page.waitForSelector(".tn-wall", { timeout: 20_000 });
    // Camera tiles are remote images on long cadences. Let them paint or the
    // evidence shows empty stages.
    await page.waitForTimeout(Number(process.env.TN_SETTLE_MS ?? 8000));

    // ── The wall is a wall, and it opens with the map stowed ──────────────────
    const opening = await page.evaluate(() => ({
      wall: !!document.querySelector(".tn-wall"),
      tiles: document.querySelectorAll(".tn-grid > .tn-seg-slot[data-grid-id]").length,
      stowed: !!document.querySelector(".tn-cw-stage.is-stowed"),
      // The skip link's target moves to the wall when the map can be closed.
      skipOnWall: document.querySelector("#tn-map-stage")?.classList.contains("tn-grid") ?? false,
      handles: document.querySelectorAll(".tn-seg-slot .tn-rz").length,
    }));
    check(
      "Streets opens as a camera wall with the map stowed",
      opening.wall && opening.tiles > 0 && opening.stowed,
      `${opening.tiles} tiles, ${opening.handles} resize handles, stage stowed=${opening.stowed}, skip target on the wall=${opening.skipOnWall}`,
    );
    await shoot(page, `${outDir}/1-wall-map-stowed.png`);

    // ── The affordance is the thing you actually hit ─────────────────────────
    // A hit test, not a style assertion, because this failed as a LAYER order and
    // no stylesheet reading would have shown it: the north-west resize handle sits
    // on top of the grip, so aiming at the one element that looks draggable
    // resized the tile from its corner. Caught here on the first live drag.
    const aim = await page.evaluate(() => {
      const slot = document.querySelector(".tn-grid > .tn-seg-slot[data-grid-id]");
      const grip = slot?.querySelector(".tn-cw-grip");
      if (!grip) return null;
      const b = grip.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
      return { hit: hit?.className ?? null, isGrip: hit === grip, header: !!slot.querySelector(".tn-cw-head") };
    });
    check(
      "the grip is what a pointer aimed at the grip actually hits",
      aim?.isGrip === true,
      `elementFromPoint at the grip's centre returned "${aim?.hit}"`,
    );

    // ── 1 + 2. The map survives the dock, and resizes into it ─────────────────
    // Mark the live canvas. A remount would build a fresh MapLibre instance and a
    // fresh canvas, and the mark would be gone — which is the whole check.
    const marked = await page.evaluate(() => {
      const c = document.querySelector(".tn-cw-stage canvas");
      if (!c) return false;
      c.dataset.tnMark = "wall-verify";
      return true;
    });

    phase = "dock-open";
    await pressMap(page);
    await page.waitForTimeout(1200);
    const opened = await page.evaluate(() => {
      const c = document.querySelector(".tn-cw-stage canvas");
      const stage = document.querySelector(".tn-cw-stage");
      const cb = c?.getBoundingClientRect();
      const sb = stage?.getBoundingClientRect();
      return {
        marked: c?.dataset.tnMark === "wall-verify",
        canvases: document.querySelectorAll(".tn-cw-stage canvas").length,
        canvasW: cb ? Math.round(cb.width) : 0,
        canvasH: cb ? Math.round(cb.height) : 0,
        stageW: sb ? Math.round(sb.width) : 0,
        stageH: sb ? Math.round(sb.height) : 0,
        stowed: !!document.querySelector(".tn-cw-stage.is-stowed"),
      };
    });
    check(
      "the map does not remount when the dock opens",
      marked && opened.marked && opened.canvases === 1,
      `marked before=${marked}, same canvas after=${opened.marked}, canvases in the stage=${opened.canvases}`,
    );
    check(
      "map.resize() on reveal fills the dock rather than stretching",
      opened.stageW > 100 && Math.abs(opened.canvasW - opened.stageW) <= 2 && Math.abs(opened.canvasH - opened.stageH) <= 2,
      `canvas ${opened.canvasW}x${opened.canvasH} against a ${opened.stageW}x${opened.stageH} dock`,
    );
    // Nothing may paint outside the dock. The map's overlays were all written for
    // a stage that owns the middle of the screen; the dock is 400px, and the world
    // clock is a 567px unfoldable row that spilled 84px past each edge before the
    // container query that now hides it.
    const spill = await page.evaluate(() => {
      const stage = document.querySelector(".tn-cw-stage");
      const sb = stage.getBoundingClientRect();
      const out = [];
      for (const el of stage.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.left < sb.left - 1 || b.right > sb.right + 1) {
          const cls = typeof el.className === "string" ? el.className : el.tagName;
          out.push(`${cls} (${Math.round(b.width)}px)`);
        }
      }
      return [...new Set(out)].slice(0, 6);
    });
    check(
      "nothing paints outside the dock",
      spill.length === 0,
      spill.length ? `overflowing: ${spill.join(", ")}` : "every map overlay is inside the 400px dock",
    );
    await shoot(page, `${outDir}/2-map-dock-open.png`);

    // …and back, which is the direction that used to be free: closing the dock
    // takes the stage's track to zero width.
    await pressMap(page);
    await page.waitForTimeout(900);
    const closedAgain = await page.evaluate(() => ({
      marked: document.querySelector(".tn-cw-stage canvas")?.dataset.tnMark === "wall-verify",
      stowed: !!document.querySelector(".tn-cw-stage.is-stowed"),
    }));
    check(
      "the map does not remount when the dock closes again",
      closedAgain.marked && closedAgain.stowed,
      `same canvas=${closedAgain.marked}, stage stowed again=${closedAgain.stowed}`,
    );

    // ── 3a. A drag lands where the ghost said ─────────────────────────────────
    phase = "drag";
    const firstId = await page.$eval(".tn-grid > .tn-seg-slot[data-grid-id]", (el) => el.dataset.gridId);
    const before = await storedRects(page);
    const grip = page.locator(`.tn-seg-slot[data-grid-id="${firstId}"] .tn-cw-grip`).first();
    // Two columns right and four rows down. The move right is the load-bearing
    // half: settle() has VERTICAL gravity, so a tile dragged down with nothing
    // beneath it floats back up — and the ghost is what says so.
    const colStep = Math.round((VIEWPORT.width - 11) / 12) + 1;
    const dragGhost = await dragBy(page, grip, colStep * 2, 25 * 4, `${outDir}/3-drag-ghost.png`);
    const afterDrag = await storedRects(page);
    check(
      "a drag lands exactly where the ghost said",
      dragGhost && same(dragGhost, afterDrag?.rects[firstId]),
      `ghost promised ${show(dragGhost)}; the board stored ${show(afterDrag?.rects[firstId])} (was ${show(before?.rects[firstId])})`,
    );
    await shoot(page, `${outDir}/4-after-drag.png`);

    // ── 3b. So does a resize ─────────────────────────────────────────────────
    const se = page.locator(`.tn-seg-slot[data-grid-id="${firstId}"] .tn-rz-se`).first();
    const resizeGhost = await dragBy(page, se, colStep, 25 * 5, `${outDir}/5-resize-ghost.png`);
    const afterResize = await storedRects(page);
    check(
      "a resize lands exactly where the ghost said",
      resizeGhost && same(resizeGhost, afterResize?.rects[firstId]),
      `ghost promised ${show(resizeGhost)}; the board stored ${show(afterResize?.rects[firstId])}`,
    );
    await shoot(page, `${outDir}/6-after-resize.png`);

    // No tile may overlap another after two live gestures — the engine's own
    // invariant, asserted against what the browser actually produced.
    const boardRects = Object.values(afterResize?.rects ?? {}).filter(Boolean);
    let overlap = null;
    for (let i = 0; i < boardRects.length && !overlap; i++) {
      for (let j = i + 1; j < boardRects.length; j++) {
        const a = boardRects[i], b = boardRects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) { overlap = [a, b]; break; }
      }
    }
    check(
      "no two tiles overlap after a live drag and a live resize",
      !overlap && boardRects.length > 0,
      overlap ? `${show(overlap[0])} overlaps ${show(overlap[1])}` : `${boardRects.length} tiles, every one disjoint and inside 12 columns`,
    );

    // ── 4. A reload restores the wall AS A WALL ──────────────────────────────
    // This is hazard 5.1: `sanitizeLayout` does not ignore a stored rect, it
    // CONVERTS it, and an unguarded wall comes back as a stack with no error.
    phase = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tn-wall", { timeout: 20_000 });
    await page.waitForTimeout(3000);
    const reloaded = await storedRects(page);
    const drawnAfterReload = await page.$eval(
      `.tn-seg-slot[data-grid-id="${firstId}"]`, rectOfEl,
    ).catch(() => null);
    check(
      "a reload restores the wall as a wall, with the tile where it was left",
      reloaded?.mode === "wall" && same(afterResize?.rects[firstId], reloaded?.rects[firstId]) && same(drawnAfterReload, reloaded?.rects[firstId]),
      `mode=${reloaded?.mode}; stored ${show(reloaded?.rects[firstId])}; DRAWN at ${show(drawnAfterReload)}`,
    );
    await shoot(page, `${outDir}/7-after-reload.png`);
  } finally {
    if (pageErrors.length) {
      console.log(`\npage errors (${pageErrors.length}):`);
      for (const e of pageErrors.slice(0, 6)) console.log(`  ${e}`);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed · shots in ${outDir}`);
  if (failed.length) process.exitCode = 1;
};

run().catch((e) => { console.error(e); process.exitCode = 1; });
