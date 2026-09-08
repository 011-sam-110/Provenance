// Render the star catalogue to an EQUIRECTANGULAR sky texture.
//
// Run with `node scripts/gen-sky-texture.mjs`. Like gen-sky.mjs and gen-icons.mjs
// this is a hand-run generator whose committed output — `public/sky/sky-equirect.jpg`
// — is the actual asset. Nothing regenerates during `next build`.
//
// WHY EQUIRECTANGULAR AND NOT A SCREEN CAPTURE. A capture of the old canvas is one
// PROJECTED view: it can be panned but it cannot be rotated, because the perspective
// is baked in. An equirectangular map is the whole celestial sphere in texture space
// — x is right ascension 0..360, y is declination +90..-90 — so a shader can sample
// it by view DIRECTION and the sky becomes a real photo sphere that turns with the
// globe on drag. That is the difference between a moving backdrop and a sky.
//
// The magnitude->size/alpha curve and the B-V->RGB table are lifted verbatim from the
// canvas renderer this replaces (see git history for components/marketing/Starfield.tsx
// and the long comment there about why the exponents are gentle and why the faint end
// carries the sky). They are reproduced rather than imported because that component is
// now a shader and holds none of this.
//
// SOURCE + LICENCE: public/sky/naked-eye.json, itself derived from the HYG database
// v4.4 (David Nash / astronexus), CC BY-SA 4.0. The rendered texture is a DERIVATIVE
// of that data — rasterising it does not launder the licence, so the landing page's
// credit stays and this file records the provenance.

import { readFileSync, writeFileSync } from "node:fs";
import { loadPlaywright } from "./playwright.mjs";

// 8192x4096, and the size is DERIVED rather than picked.
//
// An equirectangular map is 2:1 by construction. What sets the resolution is the
// angular density the shader samples it at: the hero shows FOV_DEG 78 down a canvas
// that is 856 CSS px tall, which on a Retina panel at dpr 2 is 1,712 device px —
// 21.9 px per degree. A 4096x2048 map gives 2048/180 = 11.4 px/deg, so it was being
// MAGNIFIED 1.9x and the sky looked soft. That was the "low quality", not the JPEG:
// 8192x4096 gives 22.8 px/deg, which is ~1:1 against a Retina hero.
//
// GOING FURTHER WOULD MAKE IT WORSE, not better. Past ~1:1 the texture is minified,
// and minifying a field of 1px dots without mipmaps makes stars flicker in and out as
// the sphere turns — and mipmaps cannot be used here, because the atan2 seam gives a
// one-pixel stripe of enormous derivatives and the sampler drops to the coarsest level
// down it, drawing a grey line across the sky.
//
// 8192 is above the 4096 floor the WebGL spec guarantees, so Starfield.tsx reads
// MAX_TEXTURE_SIZE at runtime and keeps the CSS fallback if the GPU cannot take it.
const W = 8192;
const H = 4096;

const cat = JSON.parse(readFileSync("public/sky/naked-eye.json", "utf8"));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");

const dataUrl = await page.evaluate(
  ({ stars, faintest, W, H }) => {
    const RADIUS_MIN_PX = 0.9, RADIUS_MAX_PX = 2.9, RADIUS_POWER = 1.5;
    const ALPHA_MIN = 0.45, ALPHA_MAX = 1, ALPHA_POWER = 1.15;
    const MAG_BRIGHTEST = -1.44;
    const GLOW_FROM_MAG = 2.2, GLOW_RADIUS_MULTIPLE = 5;
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const BV = [
      [-0.3, [190, 206, 255]], [0.0, [205, 216, 250]], [0.6, [255, 244, 220]],
      [1.4, [255, 198, 155]], [2.0, [255, 172, 130]],
    ];
    const bvToRgb = (ci) => {
      if (ci <= BV[0][0]) return BV[0][1];
      for (let i = 1; i < BV.length; i++) {
        const [hi, hiRgb] = BV[i];
        if (ci <= hi) {
          const [lo, loRgb] = BV[i - 1];
          const t = (ci - lo) / (hi - lo);
          return [loRgb[0] + (hiRgb[0] - loRgb[0]) * t, loRgb[1] + (hiRgb[1] - loRgb[1]) * t,
                  loRgb[2] + (hiRgb[2] - loRgb[2]) * t];
        }
      }
      return BV[BV.length - 1][1];
    };

    const c = document.getElementById("c");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    // The night ground the page itself uses. JPEG has no alpha, so the texture must
    // carry its own background or the encoder picks black and it shows as a seam.
    x.fillStyle = "#06080b";
    x.fillRect(0, 0, W, H);

    // The dot radii below are in CANVAS pixels from the old renderer, so they scale
    // with the map's resolution or the stars change apparent size. At 8192x4096 a
    // degree is 22.8px against the old canvas's ~11, hence 2.
    //
    // This was got wrong twice and both failures are worth recording: 2.2 against a
    // 4096-wide map drew 13px blurry blobs, and 1 against the same map drew stars
    // that were the right size but soft, because the map itself was being magnified.
    // The number is a RATIO between two resolutions, not a taste setting.
    const SCALE = 2;
    const span = faintest - MAG_BRIGHTEST;

    for (const [raDeg, decDeg, mag, ci] of stars) {
      // Equirectangular: RA runs 0..360 across x, declination +90..-90 down y.
      const px = (raDeg / 360) * W;
      const py = ((90 - decDeg) / 180) * H;
      const norm = span > 0 ? clamp01((faintest - mag) / span) : 1;
      const r = (RADIUS_MIN_PX + Math.pow(norm, RADIUS_POWER) * (RADIUS_MAX_PX - RADIUS_MIN_PX)) * SCALE;
      const a = ALPHA_MIN + Math.pow(norm, ALPHA_POWER) * (ALPHA_MAX - ALPHA_MIN);
      const [cr, cg, cb] = bvToRgb(ci).map(Math.round);

      const glow = mag <= GLOW_FROM_MAG
        ? clamp01((GLOW_FROM_MAG - mag) / (GLOW_FROM_MAG - MAG_BRIGHTEST)) : 0;

      // Stars near RA 0/360 must be drawn TWICE, once past each edge, or the seam
      // where the texture wraps clips half of every dot that straddles it.
      for (const dx of [0, px < W / 2 ? W : -W]) {
        const sx = px + dx;
        if (sx < -10 || sx > W + 10) continue;
        if (glow > 0) {
          const hr = r * GLOW_RADIUS_MULTIPLE;
          const g = x.createRadialGradient(sx, py, 0, sx, py, hr);
          const peak = 0.3 * glow;
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${peak})`);
          g.addColorStop(0.45, `rgba(${cr},${cg},${cb},${peak * 0.25})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          x.globalAlpha = 1; x.fillStyle = g;
          x.beginPath(); x.arc(sx, py, hr, 0, Math.PI * 2); x.fill();
        }
        x.globalAlpha = a;
        x.fillStyle = `rgb(${cr},${cg},${cb})`;
        x.beginPath(); x.arc(sx, py, r, 0, Math.PI * 2); x.fill();
      }
    }
    x.globalAlpha = 1;
    return c.toDataURL("image/jpeg", 0.94);
  },
  { stars: cat.stars, faintest: cat._provenance.magnitudeLimit, W, H },
);

await browser.close();
const buf = Buffer.from(dataUrl.split(",")[1], "base64");
writeFileSync("public/sky/sky-equirect.jpg", buf);
console.log(`wrote public/sky/sky-equirect.jpg — ${W}x${H}, ${(buf.length / 1024).toFixed(0)} KB, ${cat.stars.length} stars`);
