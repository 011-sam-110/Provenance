// Browser evidence for the Streets area board — the ten checks Task 11's brief
// commits to, run against a live console rather than reasoned about. The unit
// suite cannot see a WebGL remount, a tile narrower than its own overlay, a mark
// that does not follow a rotation, or nine video decodes — this script is the
// gate that can.
//
// Modelled on scripts/verify-wall.mjs: every check prints a measured PASS/FAIL
// line, and the run exits non-zero if any real check fails. Check 9 (the
// nine-decode cost) is the one exception the brief itself calls for: it measures
// and only ASSERTS once scripts/streets-area-baseline.json holds a calibrated
// threshold (see --calibrate below) — before that it prints numbers and passes
// no judgment, because a check that can never fail is worse than no check.
//
//   node scripts/verify-streets-area.mjs [baseUrl] [outDir] [--calibrate]
//
// Defaults to http://localhost:3010 — 3000/3001 belong to other sessions on this
// box and must never be touched (see the task brief). Start your own dev server
// first: `npx next dev -p 3010`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadPlaywright } from "./playwright.mjs";

const argv = process.argv.slice(2);
const CALIBRATE = argv.includes("--calibrate");
const positional = argv.filter((a) => !a.startsWith("--"));
const baseUrl = positional[0]?.startsWith("http") ? positional[0] : "http://localhost:3010";
const outDir = positional[1] ?? "persona-shots/streets-area";
const BASELINE_PATH = resolve("scripts/streets-area-baseline.json");

const VIEWPORT = { width: 1440, height: 900 };

// ── Constants read OUT OF THE SOURCE, not retyped ────────────────────────────
// Every one of these is a real product constant this check has to agree with.
// Hand-copying them is how a check silently stops measuring the thing it names
// the moment someone tunes the constant — reading them out of the file that owns
// them means a future change updates this script's expectations for free.
function readConst(filePath, name) {
  const src = readFileSync(filePath, "utf8");
  const m = src.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
  if (!m) throw new Error(`could not find ${name} in ${filePath}`);
  return Number(m[1].replace(/_/g, ""));
}
function readStreetsDefaultArea(filePath) {
  const src = readFileSync(filePath, "utf8");
  const m = src.match(
    /STREETS_DEFAULT_AREA[^=]*=\s*\{\s*lat:\s*([\d.-]+),\s*lon:\s*([\d.-]+),\s*radiusKm:\s*([\d.-]+)\s*\}/,
  );
  if (!m) throw new Error(`could not find STREETS_DEFAULT_AREA in ${filePath}`);
  return { lat: Number(m[1]), lon: Number(m[2]), radiusKm: Number(m[3]) };
}

const VIDEO_DWELL_MS = readConst("lib/console/widgets/camslot.apply.ts", "VIDEO_DWELL_MS");
const WALL_TILES = readConst("lib/console/widgets/camslot.fanout.ts", "WALL_TILES");
const FULL_MIN_W = readConst("lib/console/widgets/camslot.conditions.ts", "FULL_MIN_W");
const DEFAULT_AREA = readStreetsDefaultArea("lib/console/presets.ts");
// Suppressed below so a run that clears storage does not get a modal "preview
// build" notice (DevNotice.tsx) parked over the Streets prompt with pointer
// events intercepted by its veil — measured live: it appears ~BOOT_MS after
// load and blocks every click behind it, "Draw an area" included.
const DEV_NOTICE_VERSION = readConst("lib/shell/devnotice.ts", "DEV_NOTICE_VERSION");
const NOTICE_REVISION = readConst("lib/shell/devnotice.ts", "NOTICE_REVISION");
const COMMUNITY_VERSION = readConst("lib/shell/community.ts", "COMMUNITY_VERSION");
// FeedbackPrompt (components/shell/FeedbackPrompt.tsx) qualifies on EITHER 15
// minutes of visible time OR a second "visit" — and check 7's page.reload() IS
// a second visit, recordVisit() runs on every mount. Measured live: a run that
// reaches check 10 has a ~1-in-3 chance per reload of the roll landing true,
// and when it does its "tn-fb-veil" is a real modal that eats every click
// behind it — including check 10's "Next camera" button — and hangs the run on
// a 30s Playwright click timeout with no relation to anything this script is
// meant to measure. Pre-resolved for the same reason DevNotice/CommunityNote
// are below.
const FEEDBACK_VERSION = readConst("lib/shell/feedback.ts", "FEEDBACK_VERSION");

// Debug-only speed-ups for iterating on THIS script. The real gate never passes
// these — Step 2/3a/3 all run with defaults, which are the numbers the brief
// specifies (a 30s CPU window, a 5-minute heap window). Overriding them changes
// what is being measured, not how fast the same thing is measured, so these are
// for developing the script, never for reporting a result.
const CPU_WINDOW_MS = Number(process.env.TN_CPU_WINDOW_MS ?? 30_000);
const HEAP_WINDOW_MS = Number(process.env.TN_HEAP_WINDOW_MS ?? 5 * 60_000);
const PAN_WINDOW_MS = Number(process.env.TN_PAN_WINDOW_MS ?? 3_000);

// The launch plate owns the screen on a first visit, and a boot veil eats
// clicks (see BOOT_PERSIST_KEY / BOOT_VERSION in lib/terminal/boot.ts — both 1
// today). Clearing storage is guarded by a sessionStorage flag so it only fires
// on the FIRST navigation of the run: `page.addInitScript` re-runs on every
// reload, and clearing localStorage on the reload this script itself performs
// (check 7) would wipe the very board state that check exists to prove survives.
const INIT_SCRIPT = ({ devNoticeVersion, noticeRevision, communityVersion, feedbackVersion }) => {
  try {
    if (!window.sessionStorage.getItem("tn-verify-init")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("tn-verify-init", "1");
    }
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
    // DevNotice ("you are looking at a live build") is a MODAL with a veil that
    // intercepts pointer events over everything behind it, including the
    // Streets prompt's own "Draw an area" button — measured live, this is not
    // hypothetical. Pre-acknowledge it at the current text revision.
    window.localStorage.setItem(
      "tn.devnotice.v1",
      JSON.stringify({ v: devNoticeVersion, d: { acknowledged: noticeRevision } }),
    );
    // CommunityNote is a non-modal corner card, so it cannot eat a click the way
    // DevNotice can — but a multi-minute run comfortably clears its 40s
    // qualifying time, and there is no reason to let an unrelated card paint
    // over a screenshot. Marked permanently resolved.
    window.localStorage.setItem(
      "tn.community.v1",
      JSON.stringify({ v: communityVersion, d: { visits: 1, activeMs: 0, resolved: "dismissed" } }),
    );
    // FeedbackPrompt: see the note above this constant's read. A real modal
    // that can eat check 10's clicks, gated on a 1-in-3 roll this run does not
    // control — pre-resolved so the run's outcome does not depend on chance.
    window.localStorage.setItem(
      "tn.feedback.v1",
      JSON.stringify({ v: feedbackVersion, d: { visits: 1, activeMs: 0, resolved: "dismissed" } }),
    );
  } catch { /* private mode / quota — the app treats this as a no-op too */ }
  // rAF tick counter, installed before any app code runs so MapLibre's own
  // render loop (which calls window.requestAnimationFrame directly, not a
  // cached reference) is counted from the very first frame. Used for the
  // dropped-frames measurement in check 9.
  window.__tnRaf = 0;
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((t) => { window.__tnRaf++; cb(t); });
};

/** A chromium this machine actually has — same reasoning as verify-wall.mjs: the
 *  worktree's node_modules is a junction to the parent tree. */
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
/** Informational-only — a measurement with nowhere yet to compare itself
 *  against. Printed, never counted toward pass/fail: see check 9's own note on
 *  why a check that cannot fail must not pretend to be one. */
function measure(name, detail) {
  console.log(`MEASURED  ${name}\n      ${detail}`);
}

async function shoot(page, path) {
  // fullPage catches frame 0 on canvas content (MapLibre, the video tiles) — a
  // known trap in this codebase. Viewport-only, always.
  await page.screenshot({ path });
}

/** Haversine destination point — used to turn "radius in km" into a real
 *  lon/lat the map can .project() to a pixel, so the drag gesture below covers
 *  a genuine, geographically correct distance rather than an arbitrary pixel
 *  count that happens to look right at one zoom. */
function destPoint(lat, lon, bearingDeg, distKm) {
  const R = 6371;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distKm / R) + Math.cos(lat1) * Math.sin(distKm / R) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distKm / R) * Math.cos(lat1),
      Math.cos(distKm / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

// ── CDP performance helpers (check 9) ────────────────────────────────────────
// Same technique as scripts/idleprof.mjs: Performance.getMetrics()'s
// TaskDuration is cumulative main-thread busy time in seconds, so a delta over
// a wall-clock window gives a real "% busy" figure — the same one #158's
// 9.0%-at-rest measurement used.
async function metricsMap(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.reduce((o, m) => ((o[m.name] = m.value), o), {});
}
async function cpuBusyOverWindow(cdp, page, windowMs) {
  const m0 = await metricsMap(cdp);
  const t0 = Date.now();
  await page.waitForTimeout(windowMs);
  const elapsed = (Date.now() - t0) / 1000;
  const m1 = await metricsMap(cdp);
  return ((m1.TaskDuration - m0.TaskDuration) / elapsed) * 100;
}
async function heapMB(cdp) {
  const m = await metricsMap(cdp);
  return m.JSHeapUsedSize / 1_048_576;
}

/** Dropped frames while panning, MEASURED against this environment's own idle
 *  frame rate rather than an assumed 60Hz — device-scale-factor and headless
 *  refresh rate are both known-unreliable assumptions in this codebase; ask for
 *  2x DSF and Chromium may hand back 1.75, so nothing here is taken on faith. */
async function measureDroppedFrames(page) {
  await page.evaluate(() => { window.__tnRaf = 0; });
  await page.waitForTimeout(2000);
  const idleFrames = await page.evaluate(() => window.__tnRaf);
  const idleFps = idleFrames / 2;

  await page.evaluate((ms) => {
    window.__tnRaf = 0;
    const map = window.__map;
    map.panBy([320, 0], { duration: ms, essential: true });
  }, PAN_WINDOW_MS);
  await page.waitForTimeout(PAN_WINDOW_MS + 200);
  const panFrames = await page.evaluate(() => window.__tnRaf);
  const panSec = (PAN_WINDOW_MS + 200) / 1000;
  const panFps = panFrames / panSec;
  const dropped = Math.max(0, Math.round((idleFps - panFps) * panSec));
  return { idleFps, panFps, dropped };
}

function loadBaseline() {
  try { return JSON.parse(readFileSync(BASELINE_PATH, "utf8")); } catch { return null; }
}
function saveBaseline(b) { writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2) + "\n"); }
const round2 = (n) => Math.round(n * 100) / 100;

/** Fold one calibration run into the baseline file, keeping the worst of the
 *  last three. "Worst" is the direction that would trip a real regression:
 *  higher CPU, more dropped frames, more heap. */
function recordCalibration(existing, sample) {
  const measured = existing?.measured ?? { cpuOnPct: [], droppedFrames: [], heapAfter5minMB: [] };
  measured.cpuOnPct = [...measured.cpuOnPct, round2(sample.cpuOnPct)].slice(-3);
  measured.droppedFrames = [...measured.droppedFrames, sample.dropped].slice(-3);
  measured.heapAfter5minMB = [...measured.heapAfter5minMB, round2(sample.heapAfter5minMB)].slice(-3);
  const worst = {
    cpuOnPct: Math.max(...measured.cpuOnPct),
    droppedFrames: Math.max(...measured.droppedFrames),
    heapAfter5minMB: Math.max(...measured.heapAfter5minMB),
  };
  const thresholds = {
    cpuOnPct: round2(worst.cpuOnPct * 1.25),
    droppedFrames: Math.ceil(worst.droppedFrames * 2),
    heapAfter5minMB: round2(worst.heapAfter5minMB * 1.25),
  };
  return {
    measured,
    worst,
    thresholds,
    margin: { cpuOnPct: "25%", heapAfter5minMB: "25%", droppedFrames: "2x" },
    runsConsidered: measured.cpuOnPct.length,
    calibratedAt: new Date().toISOString(),
  };
}

const run = async () => {
  mkdirSync(outDir, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: await findChromium(),
    args: [
      "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions",
      "--renderer-process-limit=1", "--js-flags=--max-old-space-size=1536",
      "--disable-background-networking", "--enable-unsafe-swiftshader",
    ],
  });
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT_SCRIPT, {
    devNoticeVersion: DEV_NOTICE_VERSION,
    noticeRevision: NOTICE_REVISION,
    communityVersion: COMMUNITY_VERSION,
    feedbackVersion: FEEDBACK_VERSION,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  let phase = "load";
  page.on("pageerror", (e) =>
    pageErrors.push(`[${phase}] ${(e.stack || e.message).split("\n").slice(0, 4).join("\n")}`));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");

  try {
    // ── Navigate to the Streets board, fresh ──────────────────────────────────
    await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
    const tab = page.getByRole("button", { name: /streets/i }).first();
    await tab.waitFor({ state: "visible", timeout: 30_000 });
    // The tab is server-rendered and clickable before hydration; wait for the
    // client build's own canvas before pressing anything (verify-wall's fix).
    await page.waitForSelector(".tn-cw-stage canvas", { timeout: 30_000 });
    phase = "streets";
    await tab.click();
    await page.waitForSelector(".tn-streets-prompt, .tn-wall", { timeout: 20_000 });
    // Belt and braces on top of the localStorage suppression: wait out any veil
    // that appears anyway before the first click.
    await page.waitForFunction(() => !document.querySelector(".tnx-boot-veil"), { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const mountsAt = async () => page.evaluate(() => window.__tnStageMounts ?? 0);
    // React Strict Mode double-invokes the FIRST mount's effect in `next dev`
    // (measured: this counter reads 2 immediately after first paint, with no
    // draw, no reload, nothing) — that is Next's own dev-mode instrumentation,
    // not a remount this board caused. So the check is not "the count is
    // literally 1"; it is "the count never moves again once it has settled",
    // which is exactly the property a real remount would violate and Strict
    // Mode's one-time double-invoke does not.
    const mountsBaseline = await mountsAt();

    // ── Check 2: full-bleed prompt ─────────────────────────────────────────
    const promptState = await page.evaluate((FULL_MIN_W) => {
      const shell = document.querySelector(".tn-seg.tn-rails");
      const stage = document.querySelector(".tn-cw-stage");
      const promptEl = document.querySelector(".tn-streets-prompt-t");
      const sb = shell?.getBoundingClientRect();
      const tb = stage?.getBoundingClientRect();
      return {
        shellW: sb ? Math.round(sb.width) : null,
        stageW: tb ? Math.round(tb.width) : null,
        promptVisible: !!promptEl && promptEl.getBoundingClientRect().width > 0 && promptEl.offsetParent !== null,
        promptText: promptEl?.textContent ?? null,
        tiles: document.querySelectorAll(".tn-wall .tn-seg-slot[data-grid-id]").length,
        fullMinW: FULL_MIN_W,
      };
    }, FULL_MIN_W);
    check(
      "full-bleed prompt: stage width equals shell width, prompt visible",
      promptState.tiles === 0 &&
        promptState.shellW != null &&
        promptState.stageW != null &&
        Math.abs(promptState.stageW - promptState.shellW) <= 1 &&
        promptState.promptVisible,
      `shell=${promptState.shellW}px, stage=${promptState.stageW}px, tiles=${promptState.tiles}, ` +
        `prompt visible=${promptState.promptVisible} ("${promptState.promptText}")`,
    );
    await shoot(page, `${outDir}/1-prompt.png`);

    // ── Zoom to the measured area (San Diego, from STREETS_DEFAULT_AREA) so a
    //    real drawn circle finds real cameras — using the existing __map debug
    //    handle to position the camera, exactly as scripts/idleprof.mjs does. ──
    await page.evaluate(({ lat, lon }) => {
      window.__map.jumpTo({ center: [lon, lat], zoom: 12.5 });
    }, DEFAULT_AREA);
    // HARD GATE, not a best-effort settle. Measured directly with a dedicated
    // probe: planMonitor's onFinish handler reads loadedCamerasStore.get()
    // SYNCHRONOUSLY, and that store is populated by CamerasFeed's fetch effect
    // in the same tick it calls setPts — before React has re-rendered
    // filteredCameras into the "cameras" GeoJSON source. So if the draw below
    // fires before that fetch resolves, camerasInRing() sees an empty array and
    // EVERY tile silently falls back to webcam picks: no error, no empty board,
    // just nine tiles of refreshing stills instead of the live Caltrans feed
    // this area genuinely has. That is exactly what happened on early runs of
    // this script — 44 live cameras confirmed in range via a direct
    // /api/cameras probe, and 9/9 tiles built from webcams anyway, because the
    // drag gesture finished before the fetch did.
    //
    // querySourceFeatures() was tried first and rejected: it only answers for
    // tiles the CURRENT VIEWPORT has already rendered, which lags the fetch by
    // more again and does not correlate with whether loadedCamerasStore is
    // populated. getSource("cameras").serialize() is the public MapLibre API
    // and reflects the actual GeoJSON the source holds regardless of what is
    // in view — a strictly LATER (safer) signal than loadedCamerasStore's own
    // synchronous update, per the fetch-effect ordering above, so waiting on it
    // here can only under-promise, never over-promise, readiness. A Next.js dev
    // server compiles /api/cameras on its first hit — measured between ~100ms
    // (warm) and several seconds (cold) — so this allows up to 20s and, unlike
    // the check it replaces, actually BLOCKS: if it throws, the run stops
    // rather than silently measuring a webcam-only board and reporting it as
    // "video".
    await page.waitForFunction(
      () => {
        const src = window.__map?.getSource?.("cameras");
        if (!src) return false;
        try {
          const d = src.serialize();
          return Array.isArray(d?.data?.features) && d.data.features.length > 0;
        } catch { return false; }
      },
      { timeout: 20_000 },
    );
    const camerasReadyCount = await page.evaluate(
      () => window.__map.getSource("cameras").serialize().data.features.length,
    );

    // ── Check 3: the gesture draws ─────────────────────────────────────────
    phase = "draw";
    await page.getByRole("button", { name: "Draw an area" }).click();
    const centerPx = await page.evaluate(
      ({ lat, lon }) => window.__map.project([lon, lat]),
      DEFAULT_AREA,
    );
    const edge = destPoint(DEFAULT_AREA.lat, DEFAULT_AREA.lon, 90, DEFAULT_AREA.radiusKm);
    const edgePx = await page.evaluate(({ lat, lon }) => window.__map.project([lon, lat]), edge);

    const canvasBox = await page.locator(".tn-cw-stage canvas").first().boundingBox();
    const originX = canvasBox.x, originY = canvasBox.y;
    const x0 = originX + centerPx.x, y0 = originY + centerPx.y;
    const x1 = originX + edgePx.x, y1 = originY + edgePx.y;

    const radii = [];
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.waitForTimeout(50);
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
      await page.waitForTimeout(60);
      const txt = await page.locator(".tn-streets-prompt-s").textContent().catch(() => "");
      const m = /([\d.]+)\s*km/.exec(txt ?? "");
      radii.push(m ? Number(m[1]) : null);
    }
    await shoot(page, `${outDir}/2-drawing.png`);
    await page.mouse.up();

    const rising = radii.every((v) => v != null) && radii.every((v, i) => i === 0 || v >= radii[i - 1]);
    const grew = radii[0] != null && radii[radii.length - 1] != null && radii[radii.length - 1] > radii[0];

    const tilesAppeared = await page
      .waitForFunction(
        (n) => document.querySelectorAll(".tn-wall .tn-seg-slot[data-grid-id]").length === n,
        WALL_TILES,
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);
    const tileCountNow = await page.evaluate(() => document.querySelectorAll(".tn-wall .tn-seg-slot[data-grid-id]").length);

    check(
      "the gesture draws: radiusKm rose during the drag and tiles appeared",
      rising && grew && tilesAppeared,
      `radiusKm samples=[${radii.map((r) => r ?? "null").join(", ")}], monotonic non-decreasing=${rising}, ` +
        `grew=${grew}, tiles after release=${tileCountNow} (cameras source held ${camerasReadyCount} features before the draw)`,
    );
    await shoot(page, `${outDir}/3-tiles.png`);

    const mountsAfterDraw = await mountsAt();

    // ── Check 4: nine tiles, three across ────────────────────────────────────
    // grid-column/grid-row inline style back to a zero-based rect — same shape
    // gridArea() in lib/terminal/useGridDrag.ts writes, so a tile's DOM position
    // is read the same way it was placed. SELF-CONTAINED ON PURPOSE: this runs
    // inside the page via $$eval, which serialises the callback to source and
    // does not close over anything in this module (see verify-wall.mjs's own
    // note on the same trap).
    const rects = await page.$$eval(".tn-wall .tn-seg-slot[data-grid-id]", (els) =>
      els.map((el) => {
        const track = (v) => {
          const m = /^(\d+)\s*\/\s*span\s*(\d+)$/.exec((v || "").trim());
          return m ? { start: Number(m[1]) - 1, span: Number(m[2]) } : null;
        };
        const c = track(el.style.gridColumn);
        const r = track(el.style.gridRow);
        return c && r ? { x: c.start, y: r.start, w: c.span, h: r.span } : null;
      }),
    );
    const xs = new Set(rects.filter(Boolean).map((r) => r.x));
    const ys = new Set(rects.filter(Boolean).map((r) => r.y));
    check(
      "nine tiles, three across",
      rects.length === WALL_TILES && xs.size === 3 && ys.size === 3,
      `${rects.length} tiles, ${xs.size} distinct x, ${ys.size} distinct y (expected ${WALL_TILES}/3/3)`,
    );

    // ── Check 5: every tile clears 300px ─────────────────────────────────────
    const widths = await page.$$eval(".tn-wall .tn-seg-slot[data-grid-id]", (els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().width)),
    );
    const narrowest = Math.min(...widths);
    check(
      `every tile clears the ${FULL_MIN_W}px full-readout threshold`,
      widths.length > 0 && widths.every((w) => w >= FULL_MIN_W),
      `widths=[${widths.join(", ")}], narrowest=${narrowest}px`,
    );

    // ── Check 6: the marks track the rotation ───────────────────────────────
    await page.waitForTimeout(2000); // let the just-created tiles report to watchingStore
    const onAirNow = async () => {
      const visibleTiles = await page.evaluate(() => document.querySelectorAll(".tn-wall .tn-cs-stage").length);
      const feats = await page.evaluate(() => window.__map.querySourceFeatures("tn-watching-src"));
      const onAirKeys = [...new Set(feats.filter((f) => f.properties?.onair === 1).map((f) => f.properties.key))];
      return { visibleTiles, onAirKeys };
    };
    const sample1 = await onAirNow();
    const matchesTileCount = sample1.onAirKeys.length === sample1.visibleTiles;

    measure(
      "watching marks before the dwell",
      `${sample1.onAirKeys.length} onair=1 features vs ${sample1.visibleTiles} visible tiles`,
    );
    await page.waitForTimeout(VIDEO_DWELL_MS + 5000);
    const sample2 = await onAirNow();
    const changed =
      sample1.onAirKeys.length !== sample2.onAirKeys.length ||
      sample1.onAirKeys.some((k) => !sample2.onAirKeys.includes(k));
    check(
      "the marks track the rotation",
      matchesTileCount && changed,
      `onair count before=${sample1.onAirKeys.length} (tiles=${sample1.visibleTiles}), ` +
        `after one dwell (${Math.round((VIDEO_DWELL_MS + 5000) / 1000)}s)=${sample2.onAirKeys.length}, ` +
        `key set changed=${changed}`,
    );

    const mountsAfterMonitor = await mountsAt();
    check(
      "the map does not remount across prompt → draw → monitor",
      mountsBaseline === mountsAfterDraw && mountsAfterDraw === mountsAfterMonitor,
      `__tnStageMounts: baseline=${mountsBaseline} (React Strict Mode double-invokes the ` +
        `first mount in \`next dev\`, which is why this is not asserted to equal literally 1), ` +
        `after draw=${mountsAfterDraw}, after monitor=${mountsAfterMonitor}`,
    );

    // ── Check 8: video actually plays ────────────────────────────────────────
    const videoPlaying = await page
      .waitForFunction(
        () => {
          const vids = Array.from(document.querySelectorAll(".tn-wall video"));
          return vids.some((v) => v.readyState >= 2 && v.currentTime > 0);
        },
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    const videoDetail = await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll(".tn-wall video"));
      return {
        total: vids.length,
        playing: vids.filter((v) => v.readyState >= 2 && v.currentTime > 0).length,
        readyStates: vids.map((v) => v.readyState),
      };
    });
    check(
      "video actually plays",
      videoPlaying,
      `${videoDetail.playing}/${videoDetail.total} <video> elements have readyState>=2 and currentTime>0 ` +
        `(readyStates=[${videoDetail.readyStates.join(", ")}])`,
    );
    await shoot(page, `${outDir}/4-video-playing.png`);

    const boardReadyAt = Date.now();

    // ── Check 7: a reload restores it ────────────────────────────────────────
    const pre = await page.evaluate(() => {
      const raw = localStorage.getItem("tn.console.v1");
      const d = raw ? JSON.parse(raw).d : null;
      return { mode: d?.mode ?? null, tileCount: d?.widgets?.length ?? 0, ring: d?.watch?.ring ?? null };
    });
    phase = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tn-wall", { timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector(".tnx-boot-veil"), { timeout: 10_000 }).catch(() => {});
    // The marks cannot exist until the CAMERA CATALOGUE is back. watchingFeatures
    // looks every key up for a position and drops the ones it cannot place —
    // there is a unit test pinning exactly that — and a reload empties
    // loadedCamerasStore until /api/cameras answers again, which is 20,286
    // features over a dev server. Waiting on the marks alone therefore raced that
    // fetch and recorded marksAfterReload=0 for a board that was merely still
    // loading, which reads identically to the regression this check exists to
    // catch. Wait for the source the marks DEPEND ON first, so that a 0 below
    // means "did not come back" rather than "not back yet".
    const camerasBackAfterReload = await page
      .waitForFunction(
        () => {
          const src = window.__map?.getSource?.("cameras");
          if (!src) return false;
          try {
            const d = src.serialize();
            return Array.isArray(d?.data?.features) && d.data.features.length > 0;
          } catch { return false; }
        },
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    // A fixed sleep here was a flake waiting to happen: a reload replays the
    // full boot sequence (hydration, camslot's two watchingStore effects,
    // MapLibre's own style load) and none of that is bounded by a constant.
    // Poll for the thing the check actually asserts — on-air marks back in the
    // watching source — with a timeout generous enough to absorb a slow
    // reload, and fall through on timeout so a genuine regression still reads
    // as marksAfterReload=0 below rather than as a thrown error here.
    await page
      .waitForFunction(
        () => (window.__map?.querySourceFeatures("tn-watching-src") ?? []).length > 0,
        { timeout: 15_000 },
      )
      .catch(() => {});
    const post = await page.evaluate(() => {
      const raw = localStorage.getItem("tn.console.v1");
      const d = raw ? JSON.parse(raw).d : null;
      return {
        mode: d?.mode ?? null,
        tileCount: d?.widgets?.length ?? 0,
        ring: d?.watch?.ring ?? null,
        domTiles: document.querySelectorAll(".tn-wall .tn-seg-slot[data-grid-id]").length,
      };
    });
    const marksAfterReload = await page.evaluate(() => window.__map.querySourceFeatures("tn-watching-src").length);
    const mountsAfterReload = await mountsAt();
    // "the ring" here is `layout.watch.ring` — the board's persisted record of
    // the area that produced the wall (lib/console/types.ts). This branch does
    // not paint that ring back onto the map as a polygon (grepped: nothing in
    // components/WorldMap.tsx reads `.watch`), so the honest check is state
    // persistence through sanitizeLayout's `readWatch`, not a pixel comparison
    // of something the product does not draw.
    check(
      "a reload restores the ring, the nine tiles and the marks",
      post.mode === "wall" &&
        post.tileCount === WALL_TILES &&
        post.domTiles === WALL_TILES &&
        JSON.stringify(post.ring) === JSON.stringify(pre.ring) &&
        post.ring != null &&
        marksAfterReload > 0,
      `mode=${post.mode}, tiles(store/dom)=${post.tileCount}/${post.domTiles}, ` +
        `ring unchanged=${JSON.stringify(post.ring) === JSON.stringify(pre.ring)} ` +
        `(${pre.ring?.length ?? 0} vertices), marks after reload=${marksAfterReload} ` +
        `(camera catalogue back before measuring=${camerasBackAfterReload}), ` +
        `stage mounts after reload=${mountsAfterReload} (fresh page load — expected to match the ` +
        `pre-reload baseline of ${mountsBaseline}, not to have grown beyond it)`,
    );
    await shoot(page, `${outDir}/5-after-reload.png`);

    // Video was playing before the reload; let it re-establish before check 9
    // measures it as "at rest". Whether it came back is RECORDED, not swallowed:
    // "CPU at rest" taken on a board carrying no <video> is not the nine-decode
    // cost, it is the cost of nothing — and a --calibrate run would write that
    // nothing into scripts/streets-area-baseline.json as the threshold every
    // later run is then judged against.
    const videoBackAfterReload = await page
      .waitForFunction(
        () => Array.from(document.querySelectorAll(".tn-wall video")).some((v) => v.readyState >= 2),
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(2000);

    // ── Check 9: the nine-decode cost ────────────────────────────────────────
    phase = "perf";
    const cpuOnPct = await cpuBusyOverWindow(cdp, page, CPU_WINDOW_MS);

    const pausedCount = await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll(".tn-wall video"));
      vids.forEach((v) => v.pause());
      return vids.length;
    });
    const cpuOffPct = await cpuBusyOverWindow(cdp, page, CPU_WINDOW_MS);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll(".tn-wall video")).forEach((v) => v.play().catch(() => {}));
    });
    await page.waitForTimeout(2000);

    const { idleFps, panFps, dropped } = await measureDroppedFrames(page);

    const remainingToFiveMin = Math.max(0, HEAP_WINDOW_MS - (Date.now() - boardReadyAt));
    await page.waitForTimeout(remainingToFiveMin);
    const heapAfter5minMB = await heapMB(cdp);

    const sample = { cpuOnPct, cpuOffPct, idleFps, panFps, dropped, heapAfter5minMB };
    const priorBaseline = loadBaseline();
    // See videoBackAfterReload above. With no video on the board these numbers
    // describe an idle map, not nine decodes — so they must neither be WRITTEN
    // as a baseline nor allowed to SATISFY one. A low CPU reading is the shape a
    // pass takes here, which is exactly why an empty board must not reach the
    // assertion: it would score full marks for doing no work.
    const videoNote = videoBackAfterReload
      ? ""
      : " | WARNING: no <video> reached readyState>=2 after the reload, so this is NOT the nine-decode cost";

    if (CALIBRATE && !videoBackAfterReload) {
      measure(
        "nine-decode cost — NOT CALIBRATED (no video on the board)",
        `refusing to write scripts/streets-area-baseline.json from a board with no playing video: ` +
          `CPU ON=${round2(cpuOnPct)}%, OFF=${round2(cpuOffPct)}%, ${pausedCount} tiles paused. ` +
          `Re-run when the upstreams are serving.`,
      );
    } else if (CALIBRATE) {
      const next = recordCalibration(priorBaseline, sample);
      saveBaseline(next);
      measure(
        "nine-decode cost (--calibrate: measuring only, asserts nothing)",
        `CPU at rest: video ON=${round2(cpuOnPct)}%, video OFF=${round2(cpuOffPct)}% (${pausedCount} tiles paused), ` +
          `delta=${round2(cpuOnPct - cpuOffPct)}pp | dropped frames while panning=${dropped} ` +
          `(idle ${round2(idleFps)}fps → panning ${round2(panFps)}fps over ${PAN_WINDOW_MS}ms) | ` +
          `heap after 5min=${round2(heapAfter5minMB)}MB | runs considered so far=${next.runsConsidered}/3` +
          (next.runsConsidered >= 3
            ? ` | WORST-OF-3 THRESHOLDS WRITTEN: cpuOnPct<=${next.thresholds.cpuOnPct}%, ` +
              `droppedFrames<=${next.thresholds.droppedFrames}, heapAfter5minMB<=${next.thresholds.heapAfter5minMB}MB`
            : ""),
      );
    } else if (!priorBaseline || priorBaseline.runsConsidered < 3) {
      measure(
        "nine-decode cost (no calibrated baseline yet — run with --calibrate three times)",
        `CPU at rest: video ON=${round2(cpuOnPct)}%, video OFF=${round2(cpuOffPct)}% (${pausedCount} tiles paused), ` +
          `delta=${round2(cpuOnPct - cpuOffPct)}pp | dropped frames while panning=${dropped} ` +
          `(idle ${round2(idleFps)}fps → panning ${round2(panFps)}fps) | heap after 5min=${round2(heapAfter5minMB)}MB` +
          videoNote,
      );
    } else {
      const t = priorBaseline.thresholds;
      const okCpu = cpuOnPct <= t.cpuOnPct;
      const okDropped = dropped <= t.droppedFrames;
      const okHeap = heapAfter5minMB <= t.heapAfter5minMB;
      check(
        "nine-decode cost stays within the calibrated (worst-of-3 + margin) thresholds",
        okCpu && okDropped && okHeap && videoBackAfterReload,
        `CPU at rest=${round2(cpuOnPct)}% (threshold ${t.cpuOnPct}%, video OFF was ${round2(cpuOffPct)}%) ${okCpu ? "OK" : "OVER"} | ` +
          `dropped frames=${dropped} (threshold ${t.droppedFrames}) ${okDropped ? "OK" : "OVER"} | ` +
          `heap after 5min=${round2(heapAfter5minMB)}MB (threshold ${t.heapAfter5minMB}MB) ${okHeap ? "OK" : "OVER"}` +
          videoNote,
      );
    }

    // ── Check 10: rotation churn ─────────────────────────────────────────────
    // Manual "Next camera" clicks exercise the SAME effect-cleanup path a timed
    // rotation does (StreamView keeps its position in the tree; only `stream`
    // changes, so CameraVideo's `[src]`-keyed effect destroys the old hls.js
    // instance and builds a new one either way) — 20 clicks in well under a
    // minute rather than 20 real dwells at VIDEO_DWELL_MS (10 minutes).
    //
    // Fan-out deals live cameras first but ROUND-ROBIN across the whole ordered
    // list (camslot.fanout.ts), so a tile's playlist can still mix live cameras
    // with stills — landing on a still is a normal outcome of that dealing, not
    // a leak signal, so it is skipped rather than counted as a failed switch.
    phase = "rotation-churn";
    const candidateTiles = await page.$$(".tn-wall .tn-cs:has(button[aria-label='Next camera'])");
    let chosen = null;
    for (const h of candidateTiles) {
      if (await h.evaluate((el) => !!el.querySelector(".tn-cs-stage video"))) { chosen = h; break; }
    }
    const switchTimesMs = []; // one entry per raw click that landed on video: real ms, or null on timeout
    const heapSeriesMB = []; // one entry per PAINTED switch, in order — what monotonicGrowth reads
    let rawClicks = 0;
    let skippedStills = 0;
    let validCount = 0;
    // 15s, unwidened — a real run measured ~35% of switches missing it, and that
    // rate is itself the finding (see the paint-rate measurement below), not a
    // reason to loosen the clock it is measured against. The loop targets 20
    // SUCCESSFUL (painted) switches rather than 20 total attempts, so a run with
    // real-world timeouts spends the raw-click budget on retries instead of
    // silently truncating the sample the leak gate needs — but the per-switch
    // ceiling itself stays exactly what it was measured against.
    const SWITCH_TIMEOUT_MS = 15_000;
    const MAX_RAW_CLICKS = 60;
    // The leak gate needs enough consecutive pairs that a heap which only ever
    // climbs cannot hide in the noise. Left at 15, the figure the gate has always
    // used — what changed is that a switch which never painted no longer counts
    // against this budget, so a quiet upstream now starves the gate (reported as
    // inconclusive) instead of being scored as a leak.
    const MIN_LEAK_SAMPLES = 15;
    if (chosen) {
      while (validCount < 20 && rawClicks < MAX_RAW_CLICKS) {
        const btn = await chosen.$("button[aria-label='Next camera']");
        const t0 = Date.now();
        await btn.click();
        rawClicks++;
        const isVideo = await chosen.evaluate((el) => !!el.querySelector(".tn-cs-stage video"));
        if (!isVideo) { skippedStills++; await page.waitForTimeout(200); continue; }
        const painted = await page
          .waitForFunction(
            (el) => {
              const v = el.querySelector(".tn-cs-stage video");
              return !!v && v.readyState >= 2;
            },
            chosen,
            { timeout: SWITCH_TIMEOUT_MS },
          )
          .then(() => true)
          .catch(() => false);
        const t1 = Date.now();
        switchTimesMs.push(painted ? t1 - t0 : null);
        if (painted) { validCount++; heapSeriesMB.push(round2(await heapMB(cdp))); }
        await page.waitForTimeout(300);
      }
    }
    const validTimes = switchTimesMs.filter((t) => t != null);
    const timedOut = switchTimesMs.length - validTimes.length;

    // Reported, never gated. How often a switch reaches a painted frame is a
    // property of the UPSTREAMS, not of this branch: matching the HLS allowlist
    // means the host family is proxyable, NOT that the camera still carries a
    // live stream, and the size of that gap has never been measured. A low rate
    // here is a finding to take to the camera work — failing this script for it
    // would only be this branch carrying someone else's outage.
    measure(
      "rotation paint rate (upstream availability — not a verdict on this branch)",
      `${validCount} of ${switchTimesMs.length} switches reached readyState>=2 inside ` +
        `${SWITCH_TIMEOUT_MS / 1000}s (${timedOut} did not), from ${rawClicks} raw clicks ` +
        `(${skippedStills} landed on a still and were skipped) | ` +
        `switch→first-paint times(ms)=[${switchTimesMs.map((t) => t ?? "timeout").join(", ")}] | ` +
        `avg of the painted ones=${validTimes.length ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : "n/a"}ms`,
    );

    // "Does not grow monotonically" is the literal, blunt gate the brief asks
    // for: every consecutive sample non-decreasing with zero relief across every
    // successful switch is the signature of an hls.js instance never being
    // destroyed. The full series is printed regardless, because a leak that
    // happens to dip once (one lucky GC) would pass this narrow gate and a
    // human reading the series would still see the trend.
    const monotonicGrowth =
      heapSeriesMB.length > 1 && heapSeriesMB.every((v, i) => i === 0 || v >= heapSeriesMB[i - 1]);
    const GATE = "rotation churn: heap does not grow monotonically across video switches";
    const series = `heap series (MB)=[${heapSeriesMB.join(", ")}]`;
    if (chosen == null) {
      check(GATE, false,
        "no tile on this board currently shows video with more than one stream — the manual rotation churn probe found nothing to click");
    } else if (heapSeriesMB.length < MIN_LEAK_SAMPLES) {
      // Three outcomes, not two. Too few samples is INCONCLUSIVE: the gate never
      // ran, so it must not print as a leak — and must not print green either, or
      // an upstream outage would read back as a clean teardown. Red and explicit.
      check(GATE, false,
        `INCONCLUSIVE — the gate did not run. ${heapSeriesMB.length} of the ${MIN_LEAK_SAMPLES} heap ` +
          `readings it needs were gathered before the ${MAX_RAW_CLICKS}-click cap, because ${timedOut} ` +
          `switches never painted. This says NOTHING about hls.js teardown in either direction; the ` +
          `paint rate above is where that outage shows. ${series}`);
    } else {
      check(GATE, !monotonicGrowth,
        `${heapSeriesMB.length} heap readings across painted switches, monotonic ` +
          `non-decreasing=${monotonicGrowth}. ${series}`);
    }
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
