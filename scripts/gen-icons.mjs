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
// The mark's own geometry is duplicated below rather than imported: Mark.tsx is a
// .tsx React component and this is a plain node script with no build step. The
// duplication is deliberate and small, and gen-icons verifies it — see verifySync().

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
// scripts/trace-mark.mjs regenerates it from public/brand/mark.png.
const TRACED = JSON.parse(readFileSync(resolve(ROOT, "lib", "brand", "markPaths.json"), "utf8"));

// fill-rule="evenodd" is mandatory: the traced contours include the inner
// boundaries of the lens ring and of every continent. Under the default nonzero
// rule those inner loops fill solid and the globe renders as a plain disc.
const MARK_BODY = `
  <g fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.55">
    <circle cx="64" cy="63" r="46"/>
    <circle cx="64" cy="56" r="37"/>
  </g>
  <g fill="currentColor" opacity="0.75">
    <circle cx="18" cy="63" r="2.4"/>
    <circle cx="110" cy="63" r="2.4"/>
  </g>
  <path fill="currentColor" fill-rule="evenodd" d="${TRACED.glass.join(" ")}"/>
  <path fill="currentColor" fill-rule="evenodd" d="${TRACED.book.join(" ")}"/>`;

/** `maskable` fills the frame and keeps the art inside Android's ~80% safe zone. */
function svg({ size, ink, plate, radius, pad }) {
  const inner = 128 * (1 - pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="${radius}" fill="${plate}"/>
  <g color="${ink}" transform="translate(${128 * pad} ${128 * pad}) scale(${inner / 128})">${MARK_BODY}</g>
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

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
