// Evidence for the camera-wall conditions overlay: the road/ground claim, the weather
// chip and the local clock, burned into the bottom-right of every tile on Streets.
//
// WHY TWO WIDTHS THAT LOOK LIKE THE SAME LAYOUT. Sam browses at about 80% zoom, so a
// 1440x900 window gives him 1800x1125 CSS pixels and renders 10.5px type at roughly
// 8.4 device pixels. The overlay's whole legibility argument lives at that size, not at
// the nominal one, so shooting only 1440x900 would test a screen nobody is using.
//
// VIEWPORT SHOTS, NEVER fullPage. A fullPage capture of this console re-lays-out the
// stage and catches camera images mid-load; the viewport shot is what a person sees.
//
//   node scripts/shoot-conditions.mjs [baseUrl] [outDir]

import { chromium } from "playwright";
import { mkdir, readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const baseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3210";
const outDir = process.argv[3] ?? "persona-shots/conditions";
// One viewport per process, by name, because this box runs several agents at once and
// three 2x contexts in one node heap OOMs it. Omit to do all three.
const only = process.argv[4] ?? "";
// Chromium does not reliably grant a requested deviceScaleFactor anyway (it caps),
// and a 2x shot of an 1800px viewport is a 3600x2250 bitmap held in memory. 1 is the
// default here and the run REPORTS what it actually got, so the type-size claim is
// measured in CSS pixels rather than inferred from the image.
const dpr = Number(process.env.TN_DSF ?? 1) || 1;

// Both overlays that own the screen on a first visit. Same envelope shape, different
// keys; see tests/e2e/console.spec.ts for why the tour version is seeded far above the
// current one rather than at it.
const SUPPRESS = () => {
  window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
  window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
};

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900, note: "nominal desktop" },
  { name: "1800x1125-at-80pct", width: 1800, height: 1125, note: "what Sam actually sees at 80% zoom" },
  { name: "390x844", width: 390, height: 844, note: "mobile; stage falls back to 16:9" },
];

/**
 * A chromium this machine actually has, rather than the exact build this checkout's
 * playwright pins.
 *
 * The worktree shares node_modules with the parent tree by junction, so its
 * playwright asks for a headless-shell revision that was never downloaded here,
 * while three full chromium builds sit in the same cache. Downloading a fourth to
 * satisfy a pin is not worth ~150 MB for a screenshot run. Returning undefined
 * falls back to playwright's own resolution, so this degrades to the normal
 * behaviour on a machine where the pinned build IS present.
 */
async function findChromium() {
  const root = join(homedir(), "AppData", "Local", "ms-playwright");
  let entries = [];
  try {
    entries = await readdir(root);
  } catch {
    return undefined;
  }
  const builds = entries
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const b of builds) {
    const exe = join(root, b, "chrome-win64", "chrome.exe");
    try {
      await access(exe);
      console.log(`using chromium build ${b}`);
      return exe;
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

async function openStreets(page) {
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
  // The board tabs are the console's top nav. Match on the accessible name rather than
  // a nth-child, so a reordered nav fails loudly instead of shooting the wrong board.
  const tab = page.getByRole("button", { name: /streets/i }).first();
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await tab.click();
  // Camera tiles are remote images on 60-600s cadences. Give them a real chance to
  // paint, or the evidence shows empty stages and proves nothing about an overlay that
  // sits on top of them.
  await page.waitForTimeout(Number(process.env.TN_SETTLE_MS ?? 9000));
}

const run = async () => {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await findChromium(),
    // MEMORY, NOT SPEED, and it is the binding constraint here rather than a
    // precaution. Measured on this box mid-run: 32.6 GB committed against a 34.3 GB
    // limit, so a browser that reserves generously does not fail slowly, it fails
    // instantly with a V8 fatal. One renderer, a capped old-space, and none of the
    // subsystems a screenshot does not use.
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=512",
      "--disable-background-networking",
      "--disable-software-rasterizer",
      "--no-zygote",
    ],
  });
  const results = [];

  for (const vp of VIEWPORTS.filter((v) => !only || v.name === only)) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: dpr,
    });
    await ctx.addInitScript(SUPPRESS);
    const page = await ctx.newPage();
    try {
      await openStreets(page);

      // Report what the overlay actually claims, per tile, so the run is checkable
      // without opening the pictures — and so a silently-absent overlay cannot pass as
      // a successful screenshot.
      const claims = await page.$$eval(".tn-cscond", (nodes) =>
        nodes.map((n) => {
          const row1 = n.querySelector(".tn-cscond-row");
          const claim = n.querySelector(".tn-cscond-claim");
          return {
            tier: n.getAttribute("data-tier"),
            density: n.getAttribute("data-density"),
            text: (n.textContent || "").replace(/\s+/g, " ").trim(),
            // The type floor is the whole legibility argument, so MEASURE it in the
            // browser rather than trusting the stylesheet to have been applied.
            cssPx: row1 ? getComputedStyle(row1).fontSize : null,
            // And what the reading explains on hover, which is where a refusal has
            // to state its reason.
            title: claim ? claim.getAttribute("title") : null,
          };
        }),
      );
      // Chromium does not always honour the requested deviceScaleFactor. Report what
      // it actually granted, so "10.5px at 80% zoom is 8.4 device px" is a measured
      // claim in this run rather than arithmetic done in a comment.
      const dsf = await page.evaluate(() => window.devicePixelRatio);
      // When the count is zero the run has to say WHY, or a failed capture is
      // indistinguishable from a feature that does not render. Report the page's own
      // view of itself rather than guessing from a picture.
      const diag = claims.length
        ? null
        : await page.evaluate(() => ({
            stages: document.querySelectorAll(".tn-cs-stage").length,
            slots: document.querySelectorAll(".tn-cs-bar").length,
            veil: !!document.querySelector("[class*='boot'], [class*='veil']"),
            activeTab:
              document.querySelector("[aria-pressed='true'],[aria-current='page']")?.textContent?.trim() ?? null,
            title: document.title,
            bodyStart: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 240),
          }));
      const path = `${outDir}/streets-${vp.name}.png`;
      await page.screenshot({ path });
      results.push({ viewport: vp.name, note: vp.note, overlays: claims.length, claims, path });
      console.log(`\n=== ${vp.name} (${vp.note}) ===`);
      console.log(`devicePixelRatio actually granted: ${dsf}`);
      console.log(`overlays found: ${claims.length}`);
      if (diag) console.log("  diagnostics:", JSON.stringify(diag, null, 2));
      for (const c of claims) {
        console.log(`  [${c.tier}/${c.density}] ${c.cssPx} ${c.text}`);
        if (c.title) console.log(`        hover: ${c.title}`);
      }
      console.log(`shot: ${path}`);
    } catch (err) {
      console.error(`FAILED at ${vp.name}:`, err.message);
      results.push({ viewport: vp.name, error: err.message });
    } finally {
      await ctx.close();
    }
  }

  await browser.close();

  const total = results.reduce((n, r) => n + (r.overlays ?? 0), 0);
  if (total === 0) {
    console.error("\nNO OVERLAYS FOUND IN ANY VIEWPORT. The shots are not evidence of anything.");
    process.exit(1);
  }
  console.log(`\nOK: ${total} overlay instances across ${VIEWPORTS.length} viewports.`);
};

run();
