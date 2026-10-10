// Generate the app icons from the ONE source of truth: the SVG mark in
// components/brand/Mark.tsx. Run with `node scripts/gen-icons.mjs`; the committed
// outputs under public/icons/ and public/brand/ are the actual app assets and this
// script is their provenance.
//
// WHY THIS WAS REWRITTEN. The previous version hand-rasterised a teal globe to an
// RGBA buffer and encoded the PNG through node:zlib. That globe was the product's
// old identity, and it never got updated when the new mark landed — so the header
// showed one logo while the browser tab, the apple-touch-icon and the installed
// PWA showed a different one from June. Generating from the same SVG the app
// renders is what makes that class of drift impossible rather than merely fixed.
//
// It rasterises through Playwright, which is ALREADY a devDependency here (it runs
// the e2e suite), so this adds no packages. `sharp` and `resvg` would each have
// been a new native dependency for a script that runs by hand a few times a year.
//
// Mark.tsx is a .tsx React component and this is a plain node script with no build
// step, so this file cannot import it. Both read lib/brand/sphereMark.json instead,
// and the images it lists.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = resolve(ROOT, "public", "icons");
const BRAND = resolve(ROOT, "public", "brand");

// The mark, read from the SAME artefact components/brand/Mark.tsx renders.
// Not a copy with a drift check — one file, two consumers — because a copy is
// how the app and its favicon came to show different logos in the first place.
// Since 2026-10-10 that is the camera sphere, its screens filled: filtered
// screenshots of the ball at several sizes, listed in lib/brand/sphereMark.json by
// scripts/gen-sphere-mark.mjs.
const MARK = JSON.parse(readFileSync(resolve(ROOT, "lib", "brand", "sphereMark.json"), "utf8"));
const MARK_FILES = Object.entries(MARK.files)
  .map(([px, url]) => ({ px: Number(px), file: resolve(ROOT, "public", url.replace(/^\//, "")) }))
  .sort((a, b) => a.px - b.px);

// The mark is white with the screens in its alpha. Used as a mask over the ink,
// it takes the icon's ink as the app's mark takes currentColor. The smallest
// image at least as large as the space it fills keeps its gaps open; a large one
// shrunk to 32px would blur them shut.
function markBody(px) {
  const pick = MARK_FILES.find((f) => f.px >= px) ?? MARK_FILES[MARK_FILES.length - 1];
  const href = `data:image/png;base64,${readFileSync(pick.file).toString("base64")}`;
  return `
  <mask id="mk" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
    <image href="${href}" x="0" y="0" width="128" height="128"/>
  </mask>
  <rect width="128" height="128" fill="currentColor" mask="url(#mk)"/>`;
}

/** `maskable` fills the frame and keeps the art inside Android's ~80% safe zone. */
function svg({ size, ink, plate, radius, pad }) {
  const inner = 128 * (1 - pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="${radius}" fill="${plate}"/>
  <g color="${ink}" transform="translate(${128 * pad} ${128 * pad}) scale(${inner / 128})">${markBody((size * inner) / 128)}</g>
</svg>`;
}

// The plate. Near-black, matching --tnx-bg: the mark is a light figure on a dark
// ground in the design, and an OS icon has no theme to follow.
const PLATE = "#06080b";
const INK = "#e8ecf1";

const TARGETS = [
  { file: resolve(ICONS, "icon-192.png"), size: 192, radius: 28, pad: 0.06 },
  { file: resolve(ICONS, "icon-512.png"), size: 512, radius: 76, pad: 0.06 },
  { file: resolve(ICONS, "icon-maskable-512.png"), size: 512, radius: 0, pad: 0.12 },
  { file: resolve(ICONS, "apple-touch-icon.png"), size: 180, radius: 0, pad: 0.08 },
  // The brand marks the app itself references.
  { file: resolve(BRAND, "mark-32.png"), size: 32, radius: 0, pad: 0.02 },
  { file: resolve(BRAND, "mark-64.png"), size: 64, radius: 0, pad: 0.02 },
  { file: resolve(BRAND, "mark-128.png"), size: 128, radius: 0, pad: 0.02 },
  { file: resolve(BRAND, "mark-512.png"), size: 512, radius: 0, pad: 0.02 },
];

/**
 * The root-of-site icon names clients ask for WITHOUT being told to, and which this
 * deployment did not serve.
 *
 * MEASURED, 2026-09-07..11: `404 /favicon.ico` 6,146 times and the apple-touch-icon
 * family 1,080 more across four spellings — together a fifth of every 404 the site
 * produced, which is enough to bury a real broken link in the error panel.
 *
 * The metadata in app/layout.tsx was already correct and is not the problem. These are
 * requested by convention rather than from the document: a browser asks for
 * `/favicon.ico` when its preferred `<link rel="icon">` is one it will not use, and
 * crawlers and older iOS clients probe the `apple-touch-icon` spellings at the root
 * whatever the page declares. The only answer is to serve the files.
 *
 * `favicon.svg` already existed and does not cover it — the clients making these
 * requests are precisely the ones that will not take an SVG.
 *
 * WHY THE .ico IS A WRAPPED PNG: the ICO container has allowed a PNG payload since
 * Windows Vista and every browser in the 404 log reads one. It is 22 bytes of header
 * in front of a file we already generate, which is a much smaller thing to own than a
 * BMP encoder or a new native dependency — see the header of this file on why `sharp`
 * was refused once already.
 */
function writeRootFallbacks() {
  const png32 = readFileSync(resolve(BRAND, "mark-32.png"));

  // ICONDIR(6) + one ICONDIRENTRY(16) + the PNG. 32 fits in the single width/height
  // byte; 256 would have to be written as 0, which is why this is not a loop over
  // arbitrary sizes.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(32, 6); // width
  header.writeUInt8(32, 7); // height
  header.writeUInt8(0, 8); // palette size, 0 = truecolour
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png32.length, 14);
  header.writeUInt32LE(22, 18); // offset of the payload
  writeFileSync(resolve(ROOT, "public", "favicon.ico"), Buffer.concat([header, png32]));
  console.log("gen-icons: -> ./public/favicon.ico");

  // Byte-identical copies at the two names iOS and the crawlers actually ask for.
  // `-precomposed` means "already has the gloss applied"; modern iOS ignores the
  // distinction, and both are requested regardless.
  const apple = readFileSync(resolve(ICONS, "apple-touch-icon.png"));
  for (const name of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png"]) {
    writeFileSync(resolve(ROOT, "public", name), apple);
    console.log(`gen-icons: -> ./public/${name}`);
  }
}

async function main() {
  mkdirSync(ICONS, { recursive: true });
  mkdirSync(BRAND, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const t of TARGETS) {
    const markup = svg({ size: t.size, ink: INK, plate: PLATE, radius: t.radius, pad: t.pad });
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}</style>${markup}`,
      { waitUntil: "load" },
    );
    const buf = await page.locator("svg").screenshot({ omitBackground: true });
    writeFileSync(t.file, buf);
    console.log(`gen-icons: ${t.size}px -> ${t.file.replace(ROOT, ".")}`);
  }

  // The favicon the browser tab reads. 32px, plated, so it stays legible against
  // both a light and a dark tab strip.
  const ico = svg({ size: 32, ink: INK, plate: PLATE, radius: 0, pad: 0.02 });
  writeFileSync(resolve(ROOT, "public", "favicon.svg"), ico);
  console.log("gen-icons: -> ./public/favicon.svg");

  writeRootFallbacks();

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
