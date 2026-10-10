// Take the screenshot the Provenance mark is filtered from: the landing intro's camera sphere,
// fully lit and centred, with every screen blank.
//
// Usage:  npm run dev   (in another terminal; any port)
//         node scripts/capture-sphere-source.mjs [http://localhost:3000]
//         node scripts/gen-sphere-mark.mjs && node scripts/gen-icons.mjs
//
// WHY THE SCREENS ARE BLANK. The mark is the shape of the ball's screens, and that is easiest
// to find, and only that is found, when every screen is the same flat grey: the
// pictures' own edges (roads, cars, horizons) never reach the filter, and the logo carries
// nothing from the TfL, DriveBC or Digitraffic stills, so it owes them no credit. The page is
// not changed to do it: the still requests are answered with a grey card on the way in. Grey,
// not white, because a white screen trips the bloom pass and its glow floods the gaps.
//
// It renders the real thing: the sphere module, its camera, its layout and its lighting, on the
// build that is running, through the intro's own tuner handle (`/?tune`): fill sped up so every
// screen is lit while the ball is still centred, and held there.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "scripts", "assets", "sphere-source.png");
const BASE = process.argv[2] ?? "http://localhost:3000";
const W = 1440;
const H = 900;
/** Room round the ball in the crop, px. */
const MARGIN = 14.5;

/** A 4:3 card of flat grey, as a PNG, built here so the script needs no image file. */
async function greyCard(page) {
  const url = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const g = c.getContext("2d");
    g.fillStyle = "rgb(128,128,128)";
    g.fillRect(0, 0, 640, 480);
    return c.toDataURL("image/png");
  });
  return Buffer.from(url.split(",")[1], "base64");
}

async function main() {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent("<!doctype html><title>card</title>");
  const card = await greyCard(page);
  await page.route(/\/marketing\/sphere\/cam-\d+\.webp/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: card }));
  await page.goto(`${BASE}/?tune&fs=2&ms=6`, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__pvIntro?.control?.screens ?? 0) > 0, null, { timeout: 180000 });
  const r0 = await page.evaluate(() => {
    document.querySelectorAll(".lp-tune-panel, .lp-tune-pill, .tn-note-live, nextjs-portal").forEach((n) => {
      n.style.display = "none";
    });
    const c = window.__pvIntro.control;
    c.seek(3.21);
    return (c.params.startDiameter * Math.min(innerWidth, innerHeight)) / 2;
  });
  await page.waitForTimeout(2500);
  const side = Math.round(2 * (r0 + MARGIN));
  const clip = { x: Math.round(W / 2 - side / 2), y: Math.round(H / 2 - side / 2), width: side, height: side };
  writeFileSync(OUT, await page.screenshot({ clip }));
  await browser.close();
  console.log(`capture-sphere-source: ball ${(2 * r0).toFixed(1)} px across in ${side} px -> ./scripts/assets/sphere-source.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
