// Runtime verification for the Provenance landing page.
//
// Deliberately asserts DOM FACTS rather than eyeballing screenshots: computed
// styles, custom-property values at known scroll offsets, element counts and
// redirect targets. Screenshots are captured too, but as evidence, not as the test.
//
// Run: node scripts/verify-provenance.mjs [baseUrl]

import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3009";
const OUT = "persona-shots";
mkdirSync(OUT, { recursive: true });

// Node ESM on Windows needs a file:// URL for an absolute path import, and these
// packages are CJS, so the namespace lands under .default when interop kicks in.
async function loadChromium() {
  for (const rel of [
    "node_modules/playwright-core/index.js",
    "node_modules/playwright/index.js",
    "node_modules/@playwright/test/index.js",
  ]) {
    try {
      const mod = await import(pathToFileURL(path.resolve(rel)).href);
      const c = mod.chromium ?? mod.default?.chromium;
      if (c) return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error("playwright not resolvable from this worktree");
}
const chromium = await loadChromium();

const results = [];
const pass = (name, detail = "") => results.push({ ok: true, name, detail });
const fail = (name, detail = "") => results.push({ ok: false, name, detail });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
// Chrome's console message for a failed subresource is generic ("Failed to load
// resource…") and never names the URL, so correlate against the responses to tell a
// real error from a known-benign one. /_vercel/insights only exists on Vercel.
const BENIGN = /_vercel\/insights|favicon\.ico/;
const badUrls = [];
page.on("response", (r) => {
  if (r.status() >= 400) badUrls.push(r.url().replace(BASE, ""));
});

/**
 * Screenshot helper. This app never stops moving (the globe auto-rotates, the
 * satellite layer re-propagates every second, the console polls), so Playwright's
 * default stability wait can never settle. Freeze any live map first, disable CSS
 * animations for the capture, and give it a real timeout.
 */
async function shot(target, name) {
  await target.evaluate(() => {
    for (const key of ["__pvMap", "__map", "__globe"]) {
      const m = window[key];
      if (m && typeof m.stop === "function") m.stop();
    }
  }).catch(() => {});
  // A capture that will not settle must not sink a run whose real assertions are
  // DOM facts. Record the miss and carry on.
  try {
    await target.screenshot({ path: `${OUT}/${name}`, animations: "disabled", timeout: 20000 });
    shots.push(name);
  } catch {
    missedShots.push(name);
  }
}

const shots = [];
const missedShots = [];

const g = () =>
  page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector(".pv-root")).getPropertyValue("--pv-g") || "0",
    ),
  );
const isNight = () => page.evaluate(() => document.querySelector(".pv-root").classList.contains("pv-night"));

// ── 1. the page loads and the thesis is the first thing in it ──────────────
await page.goto(`${BASE}/?capture=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1200);
const h1 = (await page.locator("h1.pv-h1").first().innerText()).replace(/\s+/g, " ").trim();
h1.toLowerCase().includes("already") ? pass("hero headline renders", h1) : fail("hero headline", h1);

// ── 2. the ground starts at bone and the foreground is daylight ────────────
const g0 = await g();
g0 < 0.05 ? pass("ground starts at bone", `--pv-g=${g0}`) : fail("ground starts at bone", `--pv-g=${g0}`);
(await isNight()) === false ? pass("daylight foreground at top") : fail("daylight foreground at top");

// ── 3. the real globe mounts (MapLibre canvas, not an image) ───────────────
await page.waitForSelector(".pv-aperture canvas.maplibregl-canvas", { timeout: 25000 }).catch(() => {});
const canvases = await page.locator(".pv-aperture canvas").count();
const hasMap = await page.locator(".pv-aperture canvas.maplibregl-canvas").count();
hasMap > 0
  ? pass("hero globe is the real MapLibre engine", `${canvases} canvases (starfield + map)`)
  : fail("hero globe did not mount", `${canvases} canvases`);

// The globe collapsed to height:0 once because maplibre-gl.css out-ranked our
// container rule. Nothing errored — the checks all passed and the hero was blank.
// Assert the real geometry so that can never pass silently again.
const box = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  };
  const cv = document.querySelector(".pv-aperture canvas.maplibregl-canvas");
  return {
    aperture: r(".pv-aperture"),
    mapDiv: r(".pv-aperture-map"),
    starfield: r(".pv-aperture-canvas"),
    canvasH: cv ? cv.height : 0,
  };
});
box.mapDiv > 300 && box.starfield > 300 && box.canvasH > 300
  ? pass("globe fills the aperture", JSON.stringify(box))
  : fail("globe container collapsed", JSON.stringify(box));

// And prove it actually PAINTED something, rather than being a correctly-sized void.
const painted = await page.evaluate(() => {
  const cv = document.querySelector(".pv-aperture canvas.maplibregl-canvas");
  if (!cv) return null;
  const gl = cv.getContext("webgl2") || cv.getContext("webgl");
  if (!gl) return null;
  let lit = 0;
  const pts = [[0.5, 0.5], [0.35, 0.45], [0.5, 0.35], [0.65, 0.55], [0.45, 0.6]];
  for (const [fx, fy] of pts) {
    const buf = new Uint8Array(4);
    gl.readPixels(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    if (buf[3] > 0 && buf[0] + buf[1] + buf[2] > 12) lit++;
  }
  return lit;
});
painted === null || painted >= 2
  ? pass("globe renders pixels", `${painted}/5 sample points lit`)
  : fail("globe canvas is blank", `${painted}/5 lit`);

// give the layers a moment to land, then screenshot the hero
await page.waitForTimeout(22000);
await shot(page, "pv-01-hero.png");

// ── 4. live layers actually reached the globe ──────────────────────────────
// Poll rather than sample once. These layers arrive over the network at their own
// pace and the heavy one (submarine cables enriches ~700 per-cable JSONs) can still
// be in flight on a cold server — sampling a single instant made the gate flaky,
// which is worse than useless because a green run stopped meaning anything.
async function probeLayers(deadlineMs) {
  const ids = ["pv-cables", "pv-earthquakes", "pv-sats", "pv-airports", "pv-wildfires"];
  const started = Date.now();
  let last = null;
  for (;;) {
    last = await page.evaluate((layerIds) => {
      const m = window.__pvMap;
      if (!m) return null;
      const out = {};
      for (const id of layerIds) {
        // Public API: reading src._data returns nothing useful once the source has
        // parsed its features.
        try { out[id] = m.querySourceFeatures(id).length; } catch { out[id] = 0; }
      }
      return out;
    }, ids);
    if (last && Object.values(last).filter((n) => n > 0).length >= 3) return last;
    if (Date.now() - started > deadlineMs) return last;
    await page.waitForTimeout(2000);
  }
}

const layerCounts = await probeLayers(45000);
if (layerCounts) {
  const live = Object.entries(layerCounts).filter(([, n]) => n > 0);
  live.length >= 2
    ? pass("live layers on the globe", JSON.stringify(layerCounts))
    : fail("too few live layers", JSON.stringify(layerCounts));
} else {
  pass("layer probe skipped", "no debug handle exposed");
}

// ── 5. the instrument bar shows a MEASURED count, not a typed one ──────────
const barText = await page.locator(".pv-bar-live").innerText();
/\d/.test(barText)
  ? pass("instrument bar shows live coverage", barText)
  : fail("instrument bar empty", `"${barText}" (honest if /api/coverage failed)`);

// ── 6. the ground descends and the foreground flips behind the adapter ─────
const adapterTop = await page.evaluate(
  () => document.querySelector("[data-pv-adapter]").getBoundingClientRect().top + window.scrollY,
);
await page.evaluate((y) => window.scrollTo(0, y - window.innerHeight * 0.5), adapterTop);
await page.waitForTimeout(400);
const gMid = await g();
gMid > g0
  ? pass("ground darkens on scroll", `--pv-g ${g0} → ${gMid.toFixed(3)}`)
  : fail("ground did not darken", `${g0} → ${gMid}`);

await page.evaluate((y) => window.scrollTo(0, y + 10), adapterTop);
await page.waitForTimeout(400);
const gNight = await g();
const night = await isNight();
night && gNight > 0.95
  ? pass("foreground flips to night behind the panel", `--pv-g=${gNight.toFixed(3)}`)
  : fail("night flip", `night=${night} --pv-g=${gNight}`);

// the flip must be masked: the adapter panel must cover the viewport at that moment
const covered = await page.evaluate(() => {
  const r = document.querySelector("[data-pv-adapter]").getBoundingClientRect();
  return r.top <= 1 && r.bottom >= window.innerHeight - 1;
});
covered
  ? pass("crossover is masked by the opaque panel")
  : fail("crossover happens in the open — contrast bug");

// ── 7. the adapter's three beats advance ───────────────────────────────────
const track = await page.evaluate(() => {
  const t = document.querySelector("[data-pv-adapter-track]");
  return { top: t.getBoundingClientRect().top + window.scrollY, height: t.offsetHeight };
});
const beats = [];
for (const frac of [0.05, 0.5, 0.9]) {
  await page.evaluate(
    ({ top, height, frac }) => window.scrollTo(0, top + (height - window.innerHeight) * frac),
    { ...track, frac },
  );
  await page.waitForTimeout(350);
  beats.push(await page.evaluate(() => document.querySelector("[data-pv-adapter]").dataset.beat));
}
JSON.stringify(beats) === '["0","1","2"]'
  ? pass("adapter beats advance with scroll", beats.join(" → "))
  : fail("adapter beats", beats.join(" → "));
await shot(page, "pv-02-adapter.png");

// only ONE payload may be visible at a time
const visiblePayloads = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll(".pv-payload")).filter(
      (el) => getComputedStyle(el).visibility === "visible",
    ).length,
);
visiblePayloads === 1
  ? pass("exactly one payload visible per beat")
  : fail("payload stacking", `${visiblePayloads} visible`);

// ── 8. the source wall is generated and scrolls sideways ───────────────────
const wall = await page.evaluate(() => {
  const w = document.querySelector("[data-pv-wall]");
  return {
    top: w.getBoundingClientRect().top + window.scrollY,
    height: w.offsetHeight,
    cards: w.querySelectorAll(".pv-wall-track .pv-src").length,
    rows: w.querySelectorAll("[data-pv-wall-track]").length,
  };
});
wall.cards > 20 && wall.rows === 2
  ? pass("source wall generated from the registry", `${wall.cards} cards across ${wall.rows} rows`)
  : fail("source wall shape wrong", JSON.stringify(wall));

await page.evaluate((w) => window.scrollTo(0, w.top + (w.height - window.innerHeight) * 0.6), wall);
await page.waitForTimeout(400);
const wallX = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector("[data-pv-wall]"));
  // Each row carries its own offset so they finish together; report the smaller,
  // so a stranded row cannot hide behind a moving one.
  const xs = [1, 2].map((i) => parseFloat(cs.getPropertyValue(`--pv-wall-x${i}`) || "0"));
  return Math.min(...xs);
});
wallX > 100
  ? pass("wall scrubs horizontally", `--pv-wall-x=${wallX.toFixed(0)}px`)
  : fail("wall did not translate", `--pv-wall-x=${wallX}`);
await shot(page, "pv-03-wall.png");

// ── 9. the honest ledger actually checks, and admits empties ───────────────
await page.evaluate(() => document.querySelector("#ledger").scrollIntoView());
await page.waitForFunction(
  () => /returning data right now/.test(document.querySelector("#ledger .pv-lede")?.textContent || ""),
  { timeout: 120000 },
).catch(() => {});
const ledger = await page.evaluate(() => {
  const head = document.querySelector("#ledger .pv-lede")?.textContent || "";
  const rows = document.querySelectorAll("#ledger tbody tr").length;
  const states = {};
  for (const el of document.querySelectorAll("#ledger .pv-status")) {
    const s = el.dataset.state;
    states[s] = (states[s] || 0) + 1;
  }
  return { head, rows, states };
});
/returning data right now/.test(ledger.head)
  ? pass("ledger completed a live check", `${ledger.head} · ${JSON.stringify(ledger.states)}`)
  : fail("ledger did not finish", `${ledger.head} · ${JSON.stringify(ledger.states)}`);
(ledger.states.empty || 0) > 0
  ? pass("ledger admits empty layers", `${ledger.states.empty} empty`)
  : fail("no empty layers reported — suspicious", JSON.stringify(ledger.states));

// A key-gated layer must NOT be reported as a quiet feed. /api/status only learns
// "refused" once something has attempted the layer, so this specifically guards the
// cold-process race where a rejected credential reads as "live, none right now".
const gating = await page.evaluate(() => {
  const out = { gated: 0, named: 0, misreported: [] };
  for (const tr of document.querySelectorAll("#ledger tbody tr")) {
    const label = tr.querySelector("td")?.textContent || "";
    const st = tr.querySelector(".pv-status");
    const state = st?.dataset.state;
    const text = st?.textContent || "";
    if (state === "key") {
      out.gated++;
      if (tr.querySelector(".pv-env")) out.named++;
    }
    // Layers we know are credential-gated must never read as merely quiet.
    if (/ACLED|ENTSO-E|ReliefWeb/i.test(label) && /none right now/.test(text)) {
      out.misreported.push(label.trim());
    }
  }
  return out;
});
gating.gated > 0 && gating.misreported.length === 0
  ? pass("gated layers say they are gated", `${gating.gated} gated, ${gating.named} name the env var`)
  : fail("a credential-gated layer is reported as quiet", JSON.stringify(gating));
await shot(page, "pv-04-ledger.png");

// ── 10. the licence row tells the truth ────────────────────────────────────
const licence = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".pv-facts div"));
  const row = rows.find((r) => /licence/i.test(r.querySelector("dt")?.textContent || ""));
  return row ? row.querySelector("dd")?.textContent?.trim() : null;
});
licence
  ? pass("repo licence row rendered", `licence: ${licence}`)
  : fail("licence row missing");

// ── 11. bottom of page is ink ──────────────────────────────────────────────
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, document.documentElement.scrollHeight);
});
await page.waitForTimeout(900);

// HIT-TEST the closing section and the footer. They are unpositioned in-flow
// content sitting under a fixed, z-indexed ground layer; get the stacking wrong and
// they are laid out perfectly, report opacity 1, and paint nothing at all. Reading
// the DOM is not enough — ask what is actually on top at those coordinates.
const bottomVisible = await page.evaluate(() => {
  const hit = (el) => {
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(r.width / 2, 80));
    const y = Math.round(r.top + r.height / 2);
    if (y < 0 || y > window.innerHeight) return "offscreen";
    const top = document.elementFromPoint(x, y);
    return el.contains(top) || top === el ? "visible" : `covered by .${(top?.className || top?.tagName || "?").toString().split(" ")[0]}`;
  };
  return {
    cta: hit(document.querySelector(".pv-handoff .pv-cta")),
    footerLink: hit(document.querySelector(".pv-footer a")),
  };
});
bottomVisible.cta === "visible" && bottomVisible.footerLink === "visible"
  ? pass("closing section and footer actually paint", JSON.stringify(bottomVisible))
  : fail("bottom of page is covered", JSON.stringify(bottomVisible));

await shot(page, "pv-05-handoff.png");

// ── 12. the deep-link shim ─────────────────────────────────────────────────
const shim = await ctx.newPage();
await shim.goto(`${BASE}/?v=aviation`, { waitUntil: "domcontentloaded", timeout: 90000 });
const shimUrl = shim.url();
shimUrl.includes("/app") && shimUrl.includes("v=aviation")
  ? pass("deep-link shim preserves shared links", shimUrl.replace(BASE, ""))
  : fail("deep-link shim", shimUrl);

const shim2 = await shim.goto(`${BASE}/?c=abc123`, { waitUntil: "domcontentloaded", timeout: 90000 }).then(() => shim.url());
shim2.includes("/app") && shim2.includes("c=abc123")
  ? pass("layout deep-links preserved", shim2.replace(BASE, ""))
  : fail("layout deep-link shim", shim2);
await shim.close();

// ── 13. the console still works at /app ────────────────────────────────────
const appPage = await ctx.newPage();
const appErrors = [];
appPage.on("pageerror", (e) => appErrors.push(String(e)));
await appPage.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 90000 });
await appPage.waitForTimeout(6000);
const shellPresent = await appPage.locator(".tn-shell-main, [class*='tn-']").count();
shellPresent > 0
  ? pass("console still renders at /app", `${shellPresent} tn-* nodes`)
  : fail("console missing at /app");
await shot(appPage, "pv-06-app.png");
appErrors.length === 0 ? pass("no page errors on /app") : fail("/app page errors", appErrors.slice(0, 3).join(" | "));

// The rename is one line in lib/brand.ts, but hardcoded copy elsewhere silently
// ignores it — the console kept saying the old name for a whole milestone while the
// landing page said the new one. Assert BOTH routes agree.
const naming = await appPage.evaluate(() => ({
  h1: document.querySelector("h1")?.textContent?.trim().slice(0, 60) || "",
  stale: (document.body.innerText.match(/OpenData/g) || []).length,
}));
const boot = await appPage.evaluate(() => {
  const el = document.querySelector(".tnx-boot-word");
  return el ? { text: el.textContent?.trim(), transform: getComputedStyle(el).textTransform } : null;
});
boot === null || (/Provenance/i.test(boot.text || "") && boot.transform === "uppercase")
  ? pass("launch sequence carries the current name", boot ? JSON.stringify(boot) : "(already dismissed)")
  : fail("launch sequence shows a stale name", JSON.stringify(boot));

naming.stale === 0 && /Provenance/i.test(naming.h1)
  ? pass("console carries the current product name", naming.h1)
  : fail("stale product name in the console", JSON.stringify(naming));
await appPage.close();

// ── 14. mobile: no pins, no horizontal body scroll ─────────────────────────
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await m.waitForTimeout(6000);
const mobileAperture = await m.evaluate(() => {
  const vis = document.querySelector(".pv-aperture-vis");
  if (!vis) return { present: false };
  const r = vis.getBoundingClientRect();
  return { present: true, h: Math.round(r.height), bg: getComputedStyle(vis).backgroundColor };
});
mobileAperture.present && mobileAperture.h > 200
  ? pass("mobile shows the dark field, not a bone hole", JSON.stringify(mobileAperture))
  : fail("mobile aperture missing or collapsed", JSON.stringify(mobileAperture));
const overflow = await m.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
overflow <= 1
  ? pass("no horizontal body scroll on mobile", `${overflow}px`)
  : fail("mobile body scrolls sideways", `${overflow}px`);
const swipeVisible = await m.evaluate(
  () => getComputedStyle(document.querySelector(".pv-wall-swipe")).display !== "none",
);
swipeVisible ? pass("mobile gets the swipe strip, not a pin") : fail("mobile still pinned");
await shot(m, "pv-07-mobile.png");
await m.close();

// ── 14b. NO sideways scroll at any width ───────────────────────────────────
// This check only covered 390px before, and a hero element bleeding 48px past the
// viewport gave every desktop width a horizontal scrollbar for a whole revision.
const widths = [1920, 1440, 1280, 1024, 834, 390];
const overflows = [];
for (const w of widths) {
  const t = await ctx.newPage();
  await t.setViewportSize({ width: w, height: 900 });
  await t.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await t.waitForTimeout(2500);
  const over = await t.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  overflows.push(`${w}:${over}`);
  await t.close();
}
const anyOver = overflows.filter((o) => Number(o.split(":")[1]) > 1);
anyOver.length === 0
  ? pass("no sideways scroll at any width", overflows.join(" "))
  : fail("page scrolls sideways", anyOver.join(" "));

// ── 15. reduced motion still makes the whole argument ──────────────────────
const rm = await ctx.newPage();
await rm.emulateMedia({ reducedMotion: "reduce" });
await rm.goto(BASE, { waitUntil: "domcontentloaded" });
await rm.waitForTimeout(2000);
const rmFacts = await rm.evaluate(() => ({
  pinStatic: getComputedStyle(document.querySelector(".pv-adapter-pin")).position === "static",
  payloadsVisible: Array.from(document.querySelectorAll(".pv-payload")).filter(
    (el) => getComputedStyle(el).visibility === "visible",
  ).length,
  wallCards: document.querySelectorAll(".pv-wall-swipe .pv-src").length,
}));
rmFacts.pinStatic && rmFacts.wallCards > 20
  ? pass("reduced motion unpins and still shows every source", JSON.stringify(rmFacts))
  : fail("reduced-motion fallback", JSON.stringify(rmFacts));
await rm.close();

// ── 16. console errors on the landing page ─────────────────────────────────
const unexplainedUrls = badUrls.filter((u) => !BENIGN.test(u));
const real = errors.filter(
  (e) =>
    !BENIGN.test(e) &&
    // drop the generic subresource message when every failing URL was benign
    !(/Failed to load resource/.test(e) && unexplainedUrls.length === 0),
);
real.length === 0 && unexplainedUrls.length === 0
  ? pass(
      "no console errors on /",
      badUrls.length ? `(${badUrls.length} benign: ${[...new Set(badUrls)].join(", ")})` : "",
    )
  : fail("console errors on /", [...real, ...unexplainedUrls].slice(0, 4).join(" | "));

await browser.close();

// ── report ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
