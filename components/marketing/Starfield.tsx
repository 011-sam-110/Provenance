"use client";

import { useEffect, useRef } from "react";
import {
  gmstDegrees,
  equatorialToVector,
  precessFromJ2000,
  skyBasis,
  stereographicScale,
  projectSkyInto,
  type Vec3,
  type SkyBasis,
} from "@/lib/sky/astro";
import { getHeroView } from "@/lib/marketing/heroView";
import { loadSkyCatalogue, type SkyCatalogue } from "@/lib/sky/catalog";
import { ASTERISMS, resolveStarRef } from "@/lib/sky/constellations.data";

/**
 * The real sky behind the hero globe, and again behind the closing section —
 * the page opens and closes on the same sky.
 *
 * This used to be ~500 stars at `Math.random()` pixel positions: the one element
 * on a page whose whole argument is "our data is traceable to a real source"
 * that could not itself be checked. It is now the actual naked-eye sky
 * (`lib/sky/catalog.ts`, HYG v4.4, 8,920 stars to mag 6.5), oriented by real
 * geometry (`lib/sky/astro.ts`) at the real current time — reload this page in
 * six months and the stars will have rotated with the seasons, because GMST is
 * read from `new Date()` on every frame, never frozen at a build-time epoch.
 *
 * THE CAMERA. The globe is viewed from outside, looking at Earth's centre, and
 * stars sit at effectively infinite distance behind it — so the sky visible
 * "through" the globe is not an artistic choice, it is a computable fact: the
 * sky at the ZENITH OF THE ANTIPODAL POINT of whatever the globe is centred on,
 * at the current sidereal time. `skyBasis()` in `lib/sky/astro.ts` derives that
 * basis; this file only asks it for one and projects points through it.
 *
 * THE DELIBERATE DEPARTURE FROM PHYSICAL EXACTNESS — `SKY_DEGREES_PER_GLOBE_
 * RADIUS = 60` below. MapLibre's globe camera really subtends only about 17.5
 * degrees of angular radius. Rendered at that true scale, a mere 4-8 degree
 * ring of sky would show around the globe's limb, and no constellation would
 * ever fit in frame — Orion alone stands 20 degrees tall. So this maps 60
 * degrees of real sky onto the sphere's screen radius instead, roughly 3.5x
 * wider than a physically exact camera. Direction, orientation and rotation
 * are exactly right; only the zoom is wider, the same trade every wide-angle
 * astrophoto makes. This is a wide-angle lens on a real sky, not a fake one —
 * but it is not a physically exact one either, and nothing below should be
 * read as claiming that it is.
 *
 * DEGRADATION. `loadSkyCatalogue()` resolves to `null` on any failure (bad
 * fetch, malformed JSON — see its own header). When it does, this draws
 * NOTHING and leaves the canvas black. Substituting `Math.random()` stars for
 * the real ones when the real ones fail to load would be exactly the failure
 * this rewrite exists to remove, wearing a disguise.
 *
 * PERFORMANCE. `precessFromJ2000` is real trigonometry (a rotation built from
 * three Meeus angles, each several `sin`/`cos`/`atan2`/`asin` calls) and
 * precession moves a star 0.36 degrees per 26 YEARS — recomputing it for 8,920
 * stars on every one of ~30 frames a second would be a few million transcendental
 * calls a second for a correction invisible for weeks. So it runs ONCE when the
 * catalogue loads, and at most once an HOUR after that (`ONE_HOUR_MS` below);
 * the per-frame path only ever reads the cached unit vectors and does the cheap
 * dot products inside `projectSky`. The constellation line endpoints are just
 * ordinal indices into the same star catalogue, so they ride the same cache —
 * there is no separate precession path for them to fall out of sync with.
 *
 * STILL TRUE OF THIS FILE, same as before the rewrite: procedural canvas, not
 * an image (a few hundred bytes instead of a texture, crisp at any size and
 * DPR); a HiDPI-aware backing store rebuilt on `ResizeObserver`; a 30fps
 * throttle rather than redrawing at full rate; `aria-hidden`, decoration only;
 * `rAF` cancelled and the observer disconnected on unmount.
 *
 * NOT IN SCOPE HERE (left for other work, not omitted by accident): hover or
 * any pointer interaction with the sky; `satellite.js` for the sidereal-time
 * math (`lib/sky/astro.ts` already explains why GMST is five lines here
 * instead of a bundle import); a photographically accurate Milky Way (its
 * position below is real geometry, its brightness is a hand-built approximation,
 * not a photograph — see the comment at `buildGalacticEquatorJ2000`).
 */

/**
 * Degrees of real sky mapped onto the globe's own screen radius — the one
 * number that encodes the wide-angle choice explained above. Exported so a
 * future check can pin it the way `GLOBE_FIT_PX` is pinned in `HeroGlobe.tsx`.
 */
export const SKY_DEGREES_PER_GLOBE_RADIUS = 60;

// MapLibre's globe fills 0.948 of its square box (`GLOBE_FIT_PX` in
// HeroGlobe.tsx), so the sphere's visible edge sits at half of that — 0.474 of
// the box width — out from the box centre. Measured there, reused here rather
// than re-derived, so the two files cannot quietly disagree about the globe's
// own size.
const GLOBE_FILL_RADIUS_FRAC = 0.474;

// The closing `.pv-handoff` section has no globe: `getHeroView()` returns null
// because no `HeroGlobe` is mounted to publish one. Falling back to the globe's
// OWN starting centre (lng 8, lat 8, bearing 0) — see HeroGlobe's initial
// camera — means "the page closes under the same sky it opened on" is literally
// true of the viewpoint, not just of the fact that both use real time.
const FALLBACK_LNG_DEG = 8;
const FALLBACK_LAT_DEG = 8;
const FALLBACK_BEARING_DEG = 0;
const FALLBACK_RADIUS_FRAC = 0.42;

const ONE_HOUR_MS = 60 * 60 * 1000;

// Sirius, mag -1.44 in the shipped catalogue, is the practical ceiling for
// "biggest, brightest dot" — nothing in a naked-eye catalogue is brighter.
const MAG_BRIGHTEST = -1.44;

// Magnitude -> dot size and opacity.
//
// These were MEASURED against the rendered canvas, not chosen by eye from the
// source. The first pass used a squared radius and a CUBED alpha, which is the
// instinct the old procedural field encoded and it is wrong for a real
// catalogue: a magnitude 3 star — one anybody can see from a city street —
// came out as a 0.65px dot at 22% opacity, and the whole sky read as empty
// black. Sampling the canvas gave a mean alpha of 12/255 across every lit
// pixel. Nothing was broken; the curve simply put almost the entire catalogue
// under the floor of what a screen can show.
//
// Cubing is wrong because it compounds a scale that is ALREADY logarithmic.
// Magnitude is a log scale by construction: five magnitudes is a hundredfold
// change in flux. Star charts have always drawn dot size roughly LINEAR in
// magnitude for exactly this reason, so the exponents here are gentle.
//
// THE FAINT END CARRIES THE SKY, which is the thing that is easy to get wrong
// here and was got wrong twice. Counted against the live page at 1440x900: of
// 8,920 catalogue stars, 1,467 project onto the canvas and only 297 fall
// OUTSIDE the globe's limb where they can actually be seen — and 244 of those
// 297 are magnitude 5 or 6. Just 15 are brighter than magnitude 4. So the
// visible sky is overwhelmingly faint stars, and tuning that made the bright
// end handsome while leaving the faint end under a pixel produced a hero that
// measured as "drawing 55,000 lit pixels" and looked like empty black.
//
// Hence a floor, not a taper: RADIUS_MIN is nearly a whole pixel and ALPHA_MIN
// is high enough to survive antialiasing. A sub-pixel circle spreads its alpha
// across the four pixels it touches, so a 0.5px dot at 30% opacity lands at
// roughly 15/255 per pixel — under the floor of what a screen shows at all.
const RADIUS_MIN_PX = 0.9;
const RADIUS_MAX_PX = 2.9;
const RADIUS_POWER = 1.5;
const ALPHA_MIN = 0.45;
const ALPHA_MAX = 1;
const ALPHA_POWER = 1.15;

// The brightest stars get a soft halo. Real bright stars bloom, in the eye and
// in every camera, and without it Sirius is just a slightly larger dot instead
// of something you notice. Only a few dozen stars on screen ever qualify, so
// the extra gradient fills are cheap.
const GLOW_FROM_MAG = 2.2;
const GLOW_RADIUS_MULTIPLE = 5;

// North galactic pole and galactic centre, J2000 equatorial (IAU 1958
// definition). Fixed points on the sky like any star, so they go through the
// same `equatorialToVector` / precession path as the catalogue.
const GALACTIC_POLE_RA_DEG = 192.85948;
const GALACTIC_POLE_DEC_DEG = 27.12825;
const GALACTIC_CENTER_RA_DEG = 266.405;
const GALACTIC_CENTER_DEC_DEG = -28.936;
const MILKY_WAY_SAMPLES = 360;
const MILKY_WAY_FALLOFF_POWER = 3;
// A floor so the band reads as a ring all the way round rather than a single
// bright arc that vanishes to nothing past the galactic anticentre.
const MILKY_WAY_BASE = 0.12;
const MILKY_WAY_PASSES: readonly { width: number; alpha: number }[] = [
  { width: 42, alpha: 0.045 },
  { width: 20, alpha: 0.075 },
  { width: 8, alpha: 0.13 },
];

const CONSTELLATION_LINE_ALPHA = 0.16;
const CONSTELLATION_LINE_WIDTH = 0.7;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// `lib/sky/astro.ts` keeps `dot`/`cross`/`normalise` private — its only public
// job is "equatorial direction in, screen offset out". Building the galactic
// great circle needs a plane basis (pole + a zero-longitude reference), which
// is genuinely a different piece of maths from anything astro.ts exports, so
// it is three small pure functions here rather than a reason to widen that
// module's surface for one call site.
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize3(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (!(m > 0)) return [1, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * B-V colour index to an on-screen RGB triple.
 *
 * Anchored to the three points the brief for this file names: below ~0.0 is
 * blue-white (Rigel, Vega), ~0.6 is the Sun's yellow-white, above ~1.4 is the
 * orange-red of Betelgeuse and Antares. Linear interpolation between them.
 * Every anchor sits within about 50 of 255 across channels — real stars read
 * nearly white to the eye, and pushing these further apart than that turns the
 * field into a screensaver rather than a sky.
 */
const BV_STOPS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [-0.3, [190, 206, 255]],
  [0.0, [205, 216, 250]],
  [0.6, [255, 244, 220]],
  [1.4, [255, 198, 155]],
  [2.0, [255, 172, 130]],
];

function bvToRgb(ci: number): readonly [number, number, number] {
  if (ci <= BV_STOPS[0][0]) return BV_STOPS[0][1];
  for (let i = 1; i < BV_STOPS.length; i++) {
    const [hiCi, hiRgb] = BV_STOPS[i];
    if (ci <= hiCi) {
      const [loCi, loRgb] = BV_STOPS[i - 1];
      const t = (ci - loCi) / (hiCi - loCi);
      return [
        loRgb[0] + (hiRgb[0] - loRgb[0]) * t,
        loRgb[1] + (hiRgb[1] - loRgb[1]) * t,
        loRgb[2] + (hiRgb[2] - loRgb[2]) * t,
      ];
    }
  }
  return BV_STOPS[BV_STOPS.length - 1][1];
}

/**
 * Sample points around the galactic equator, in J2000 equatorial vectors, plus
 * a brightness weight per sample.
 *
 * The galactic plane is the great circle 90 degrees from the north galactic
 * pole. Projecting the galactic centre onto the plane perpendicular to the
 * pole gives the "longitude zero" direction; a second in-plane axis
 * (`pole x zero`) completes a basis, and walking `cos(theta)*zero +
 * sin(theta)*ninety` around a full turn traces the equator with `theta` as
 * galactic longitude relative to the centre.
 *
 * The brightness this returns is a HAND-BUILT APPROXIMATION, NOT A PHOTOGRAPH:
 * a smooth falloff peaked toward the galactic centre and dim toward the
 * anticentre, standing in for the real Milky Way's mottled, dust-lane-broken
 * surface brightness. The POSITION this traces is exact; the brightness is a
 * shape that reads as "a faint band, brighter one way" and nothing more
 * precise than that should be inferred from it.
 */
function buildGalacticEquatorJ2000(sampleCount: number): {
  dirs: Float64Array;
  brightness: Float32Array;
} {
  const pole = equatorialToVector(GALACTIC_POLE_RA_DEG, GALACTIC_POLE_DEC_DEG);
  const centre = equatorialToVector(GALACTIC_CENTER_RA_DEG, GALACTIC_CENTER_DEC_DEG);
  const alongPole = dot3(centre, pole);
  const zero = normalize3([
    centre[0] - alongPole * pole[0],
    centre[1] - alongPole * pole[1],
    centre[2] - alongPole * pole[2],
  ]);
  const ninety = normalize3(cross3(pole, zero));

  const dirs = new Float64Array(sampleCount * 3);
  const brightness = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const theta = (i / sampleCount) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    dirs[i * 3] = c * zero[0] + s * ninety[0];
    dirs[i * 3 + 1] = c * zero[1] + s * ninety[1];
    dirs[i * 3 + 2] = c * zero[2] + s * ninety[2];
    brightness[i] = MILKY_WAY_BASE + (1 - MILKY_WAY_BASE) * Math.pow((1 + c) / 2, MILKY_WAY_FALLOFF_POWER);
  }
  return { dirs, brightness };
}

export default function Starfield({ className = "pv-hero-stars" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let w = 0;
    let h = 0;

    // WHY THIS GATE EXISTS. `draw` projects all 8,920 catalogue stars and fills a
    // path (plus a radial-gradient halo for the bright ones) on every tick. That is
    // the single most expensive thing on the landing page, and none of it is worth
    // anything once the hero has scrolled away. Measured on prod before this gate,
    // at 4x CPU throttle: parked at the FOOT of the page — hero entirely off screen
    // — the main thread was still 98% busy, and this file was still the top frame at
    // 17.9% of self time. Every one of those pixels was painted into a canvas nobody
    // could see. The observer costs one callback per intersection change.
    //
    // `onScreen` starts false: the first IntersectionObserver callback fires before
    // paint and flips it, so a hero that IS in view loses nothing.
    let onScreen = false;
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) onScreen = e.isIntersecting; },
      // A whole viewport of margin: start drawing just before the hero scrolls back
      // in, so it is never caught mid-fade with an empty sky.
      { rootMargin: "100% 0px" },
    );
    io.observe(canvas);

    // rAF alone already throttles a background tab to ~1fps, but that still wakes the
    // whole projection loop once a second on a machine the user has walked away from.
    // HeroGlobe.tsx pauses on the same signal (see its `onVis`); this matches it.
    const onVis = () => { if (!document.hidden) last = 0; };
    document.addEventListener("visibilitychange", onVis);

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── catalogue-derived state. Populated once by `buildStarState` when the
    // fetch resolves; `starDirs` / `milkyDirs` are refreshed in place by
    // `refreshPrecession` at most once an hour after that. Nothing here is
    // reseeded on resize — a resize only changes the canvas backing store, the
    // sky itself is recomputed from real position data every frame regardless
    // of canvas size. ──
    let catalogue: SkyCatalogue | null = null;
    let count = 0;
    let rawStarDirs: Float64Array | null = null; // J2000, fixed
    let starDirs: Float64Array | null = null; // precessed to "now", refreshed hourly
    let radius: Float32Array | null = null;
    let alpha: Float32Array | null = null;
    let colR: Uint8Array | null = null;
    let colG: Uint8Array | null = null;
    let colB: Uint8Array | null = null;
    let phase: Float32Array | null = null;
    let speed: Float32Array | null = null;
    let glow: Float32Array | null = null;
    let lines: [number, number][] = [];

    let milkyRawDirs: Float64Array | null = null;
    let milkyDirs: Float64Array | null = null;
    let milkyBrightness: Float32Array | null = null;

    let lastPrecessionMs = 0;

    function refreshPrecession(now: Date) {
      if (!rawStarDirs || !starDirs || !milkyRawDirs || !milkyDirs) return;
      for (let i = 0; i < count; i++) {
        const v: Vec3 = [rawStarDirs[i * 3], rawStarDirs[i * 3 + 1], rawStarDirs[i * 3 + 2]];
        const p = precessFromJ2000(v, now);
        starDirs[i * 3] = p[0];
        starDirs[i * 3 + 1] = p[1];
        starDirs[i * 3 + 2] = p[2];
      }
      const mwCount = milkyRawDirs.length / 3;
      for (let i = 0; i < mwCount; i++) {
        const v: Vec3 = [milkyRawDirs[i * 3], milkyRawDirs[i * 3 + 1], milkyRawDirs[i * 3 + 2]];
        const p = precessFromJ2000(v, now);
        milkyDirs[i * 3] = p[0];
        milkyDirs[i * 3 + 1] = p[1];
        milkyDirs[i * 3 + 2] = p[2];
      }
      lastPrecessionMs = now.getTime();
    }

    function buildStarState(cat: SkyCatalogue) {
      count = cat.count;
      rawStarDirs = new Float64Array(count * 3);
      starDirs = new Float64Array(count * 3);
      radius = new Float32Array(count);
      alpha = new Float32Array(count);
      colR = new Uint8Array(count);
      colG = new Uint8Array(count);
      colB = new Uint8Array(count);
      phase = new Float32Array(count);
      speed = new Float32Array(count);
      glow = new Float32Array(count);

      // Real visual magnitude drives size and alpha; both are cubed/squared
      // off a linear brightness normalisation so the faint majority of the
      // catalogue stays faint and only a handful of stars stand out — a flat
      // mapping from magnitude reads as noise, not sky.
      const faintest = cat.provenance.magnitudeLimit;
      const span = faintest - MAG_BRIGHTEST;

      for (let i = 0; i < count; i++) {
        const v = equatorialToVector(cat.raDeg(i), cat.decDeg(i));
        rawStarDirs[i * 3] = v[0];
        rawStarDirs[i * 3 + 1] = v[1];
        rawStarDirs[i * 3 + 2] = v[2];

        const norm = span > 0 ? clamp01((faintest - cat.mag(i)) / span) : 1;
        radius[i] = RADIUS_MIN_PX + Math.pow(norm, RADIUS_POWER) * (RADIUS_MAX_PX - RADIUS_MIN_PX);
        alpha[i] = ALPHA_MIN + Math.pow(norm, ALPHA_POWER) * (ALPHA_MAX - ALPHA_MIN);
        // Halo strength ramps in below GLOW_FROM_MAG rather than switching on, so
        // there is no visible step between the faintest star that blooms and the
        // next one down that does not.
        const mag = cat.mag(i);
        glow[i] =
          mag <= GLOW_FROM_MAG
            ? clamp01((GLOW_FROM_MAG - mag) / (GLOW_FROM_MAG - MAG_BRIGHTEST))
            : 0;

        const [r, g, b] = bvToRgb(cat.colourIndex(i));
        colR[i] = r;
        colG[i] = g;
        colB[i] = b;

        phase[i] = Math.random() * Math.PI * 2;
        speed[i] = 0.4 + Math.random() * 0.9;
      }

      const magOf = (i: number) => cat.mag(i);
      const resolved: [number, number][] = [];
      for (const asterism of ASTERISMS) {
        for (const [a, b] of asterism.lines) {
          const ia = resolveStarRef(a, cat.names, magOf);
          const ib = resolveStarRef(b, cat.names, magOf);
          if (
            Number.isInteger(ia) &&
            Number.isInteger(ib) &&
            ia >= 0 &&
            ib >= 0 &&
            ia < count &&
            ib < count
          ) {
            resolved.push([ia, ib]);
          }
        }
      }
      lines = resolved;

      const mw = buildGalacticEquatorJ2000(MILKY_WAY_SAMPLES);
      milkyRawDirs = mw.dirs;
      milkyBrightness = mw.brightness;
      milkyDirs = new Float64Array(mw.dirs.length);

      refreshPrecession(new Date());
    }

    // Two scratch points, reused for the whole frame. The pair exists because the
    // Milky Way and the constellation lines each need two projected ends live at
    // once; the star loop only ever uses the first.
    const ptA = { x: 0, y: 0 };
    const ptB = { x: 0, y: 0 };

    // Reads the direction straight out of the flat Float64Array and writes the
    // result into `out`. The old form packed a `Vec3` tuple per call and returned a
    // fresh `SkyPoint`, which — across 8,920 stars at the 30fps cap below — was
    // roughly 800k short-lived objects a second of GC pressure on the main thread,
    // for the entire time the hero was on screen. `projectSkyInto` is the same
    // maths; `projectSky` is now a wrapper over it, so the astro tests cover both.
    function projectAt(
      dirs: Float64Array,
      i: number,
      basis: SkyBasis,
      scale: number,
      out: { x: number; y: number },
    ): boolean {
      return projectSkyInto(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2], basis, scale, out);
    }

    function drawMilkyWay(basis: SkyBasis, scale: number, cx: number, cy: number) {
      if (!milkyDirs || !milkyBrightness || !ctx) return;
      const mwCount = milkyDirs.length / 3;
      // Stereographic projection stretches without bound near the far cutoff
      // (see `projectSky`'s own doc); a segment whose two ends land wildly
      // apart is that stretch, not a real arc of sky, so it is dropped rather
      // than drawn as a stray spoke across the canvas.
      const maxJump = Math.max(w, h) * 2 + 400;
      for (let i = 0; i < mwCount; i++) {
        const j = (i + 1) % mwCount;
        if (!projectAt(milkyDirs, i, basis, scale, ptA)) continue;
        if (!projectAt(milkyDirs, j, basis, scale, ptB)) continue;
        const x0 = cx + ptA.x;
        const y0 = cy + ptA.y;
        const x1 = cx + ptB.x;
        const y1 = cy + ptB.y;
        if (Math.abs(x1 - x0) > maxJump || Math.abs(y1 - y0) > maxJump) continue;
        // Both ends off the same side, well past it — skip drawing a segment
        // that never touches the visible canvas at all.
        if (
          (x0 < -maxJump && x1 < -maxJump) ||
          (x0 > w + maxJump && x1 > w + maxJump) ||
          (y0 < -maxJump && y1 < -maxJump) ||
          (y0 > h + maxJump && y1 > h + maxJump)
        ) {
          continue;
        }

        const bAvg = (milkyBrightness[i] + milkyBrightness[j]) / 2;
        for (const pass of MILKY_WAY_PASSES) {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineWidth = pass.width;
          ctx.strokeStyle = `rgba(196, 202, 224, ${pass.alpha * bAvg})`;
          ctx.stroke();
        }
      }
    }

    function drawStars(basis: SkyBasis, scale: number, cx: number, cy: number, timeSec: number) {
      if (!starDirs || !radius || !alpha || !colR || !colG || !colB || !phase || !speed || !glow || !ctx)
        return;
      const reduceMotion = reduce.matches;
      const margin = 3;
      for (let i = 0; i < count; i++) {
        if (!projectAt(starDirs, i, basis, scale, ptA)) continue;
        const x = cx + ptA.x;
        const y = cy + ptA.y;
        if (x < -margin || x > w + margin || y < -margin || y > h + margin) continue;

        const twinkle = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(timeSec * speed[i] + phase[i]);

        // Bloom first, core on top, so the halo never washes out its own star.
        if (glow[i] > 0) {
          const haloR = radius[i] * GLOW_RADIUS_MULTIPLE;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, haloR);
          const peak = 0.3 * glow[i] * twinkle;
          grad.addColorStop(0, `rgba(${colR[i]},${colG[i]},${colB[i]},${peak})`);
          grad.addColorStop(0.45, `rgba(${colR[i]},${colG[i]},${colB[i]},${peak * 0.25})`);
          grad.addColorStop(1, `rgba(${colR[i]},${colG[i]},${colB[i]},0)`);
          ctx.globalAlpha = 1;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = alpha[i] * twinkle;
        ctx.fillStyle = `rgb(${colR[i]},${colG[i]},${colB[i]})`;
        ctx.beginPath();
        ctx.arc(x, y, radius[i], 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawConstellations(basis: SkyBasis, scale: number, cx: number, cy: number) {
      if (!starDirs || !ctx || lines.length === 0) return;
      const margin = Math.max(w, h) * 0.35;
      ctx.strokeStyle = `rgba(210, 224, 255, ${CONSTELLATION_LINE_ALPHA})`;
      ctx.lineWidth = CONSTELLATION_LINE_WIDTH;
      for (const [a, b] of lines) {
        if (!projectAt(starDirs, a, basis, scale, ptA)) continue;
        if (!projectAt(starDirs, b, basis, scale, ptB)) continue;
        const xa = cx + ptA.x;
        const ya = cy + ptA.y;
        const xb = cx + ptB.x;
        const yb = cy + ptB.y;
        const aOn = xa > -margin && xa < w + margin && ya > -margin && ya < h + margin;
        const bOn = xb > -margin && xb < w + margin && yb > -margin && yb < h + margin;
        if (!aOn || !bOn) continue;
        ctx.beginPath();
        ctx.moveTo(xa, ya);
        ctx.lineTo(xb, yb);
        ctx.stroke();
      }
    }

    let last = 0;
    /**
     * Paints one frame. Returns whether it drew a sky ALIGNED TO A REAL HERO GLOBE,
     * which is not the same question as "did it draw" — see `frame` below, where the
     * difference decides when the loop is allowed to stop.
     *
     * It no longer schedules the next frame. That used to be the first statement in
     * this function, above every gate, which meant the loop could not be stopped by
     * anything short of unmounting.
     */
    function draw(t: number): boolean {
      // Off screen or in a hidden tab: do no projection, no fill and — the expensive
      // part — no layout read.
      if (!onScreen || document.hidden) return false;
      if (t - last < 33) return false; // ~30fps is plenty for a twinkle
      last = t;
      if (!ctx || !canvas) return false;

      ctx.clearRect(0, 0, w, h);
      // No catalogue, no sky. See the DEGRADATION note in the file header.
      if (!catalogue || !starDirs || !milkyDirs || !milkyBrightness || !radius || !alpha) return false;

      const now = new Date();
      if (now.getTime() - lastPrecessionMs >= ONE_HOUR_MS) refreshPrecession(now);

      const view = getHeroView();
      const gmst = gmstDegrees(now);

      let lngDeg: number;
      let latDeg: number;
      let bearingDeg: number;
      let cx: number;
      let cy: number;
      let R: number;

      const globeEl = view ? document.querySelector<HTMLElement>(".pv-hero-globe") : null;
      if (view && globeEl) {
        // The globe box already carries ScrollGround's `--pv-globe-y` sink and
        // `--pv-globe-s` swell — reading its live rect means the sky tracks
        // that scroll transform for free, with no separate scroll listener of
        // this file's own (CLAUDE.md: only `ScrollGround` may subscribe to
        // scroll).
        const canvasRect = canvas.getBoundingClientRect();
        const globeRect = globeEl.getBoundingClientRect();
        cx = globeRect.left + globeRect.width / 2 - canvasRect.left;
        cy = globeRect.top + globeRect.height / 2 - canvasRect.top;
        R = GLOBE_FILL_RADIUS_FRAC * globeRect.width;
        lngDeg = view.lngDeg;
        latDeg = view.latDeg;
        bearingDeg = view.bearingDeg;
      } else {
        cx = w / 2;
        cy = h / 2;
        R = FALLBACK_RADIUS_FRAC * Math.min(w, h);
        lngDeg = FALLBACK_LNG_DEG;
        latDeg = FALLBACK_LAT_DEG;
        bearingDeg = FALLBACK_BEARING_DEG;
      }
      if (!(R > 0)) return false;

      const basis = skyBasis({ lngDeg, latDeg, gmstDeg: gmst, bearingDeg });
      const scale = stereographicScale(SKY_DEGREES_PER_GLOBE_RADIUS, R);

      // Milky Way, then stars, then constellation lines on top.
      drawMilkyWay(basis, scale, cx, cy);
      drawStars(basis, scale, cx, cy, t / 1000);
      drawConstellations(basis, scale, cx, cy);
      // True only on the globe-aligned branch. A frame drawn from the fallback
      // geometry is a real frame, but it is not the one worth freezing.
      return Boolean(view && globeEl);
    }

    /**
     * REDUCED MOTION: paint the settled sky, then stop for good.
     *
     * `reduce` was already read here, and it did one thing — flattened the twinkle to
     * a constant. Everything else carried on: the 30fps loop, ~1,080 Milky Way
     * strokes, 8,920 star projections, a radial gradient per glowing star per frame,
     * and two getBoundingClientRect calls. Measured over a 10 s idle window, that is
     * why the landing page still sat at 18.9% main-thread busy with motion off, where
     * the console reached 3.4%. A user who asks for less motion was getting all of
     * the cost and none of the movement.
     *
     * lib/terminal/boot.ts already states the contract this follows: under reduced
     * motion, one static final frame, then out.
     *
     * WHY IT IS NOT SIMPLY "DRAW ONCE AND STOP". Three things arrive late or change
     * afterwards, and each one would freeze the wrong picture:
     *
     *  1. The star catalogue is fetched. Until it resolves, draw() bails before it
     *     paints anything, so a single frame at mount paints a black canvas.
     *  2. The hero globe is a dynamic ssr:false import and publishes its camera only
     *     once MapLibre's style loads. The catalogue usually wins that race, so the
     *     first paintable frame takes the FALLBACK geometry — a sky centred on the
     *     canvas rather than on the globe — and under reduced motion nothing would
     *     ever repaint it. That is why `draw` reports which branch it took, and the
     *     loop keeps going until it gets a globe-aligned frame.
     *  3. There may legitimately be NO globe: the closing section of the landing page
     *     shows this same sky with nothing in front of it. So the wait for a globe is
     *     bounded — otherwise case 3 spins forever waiting for something that is
     *     never coming, which is the exact bug this change exists to remove.
     *
     * Resizing and dragging are handled below; both blank or invalidate the frozen
     * frame, and both wake the loop for as long as they need it.
     */
    const HERO_PUBLISH_GRACE_MS = 4000;
    let aligned = false;
    let paintedAt = 0;
    let dragging = false;

    function readyToFreeze(t: number): boolean {
      if (!reduce.matches || dragging) return false;
      if (aligned) return true;
      // No globe-aligned frame yet. Give the dynamically-imported globe a bounded
      // chance to publish, then accept the fallback sky rather than loop forever.
      return paintedAt > 0 && t - paintedAt > HERO_PUBLISH_GRACE_MS;
    }

    function frame(t: number) {
      raf = 0;
      if (disposed) return;
      if (draw(t)) aligned = true;
      if (!paintedAt && last) paintedAt = last;
      if (readyToFreeze(t)) return;
      raf = window.requestAnimationFrame(frame);
    }

    function schedule() {
      if (disposed || raf) return;
      raf = window.requestAnimationFrame(frame);
    }

    /** Wake for at least one more frame after something invalidated the sky. */
    function repaint() {
      if (disposed) return;
      last = 0; // bypass the 30fps throttle so the very next frame paints
      schedule();
    }

    // The globe stays hand-draggable under reduced motion (HeroGlobe keeps dragPan
    // and dragRotate on for non-touch), so a frozen sky would sit still while the
    // Earth turned under it. Wake for the drag and settle again on release.
    //
    // Deliberately NOT a subscription on lib/marketing/heroView.ts: that module's
    // docblock is explicit that it is a poll-only store with no listeners to leak,
    // and the camera it holds changes up to 60 times a second. A pointer gesture is
    // the honest signal here, and it is two listeners rather than a new API.
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".pv-hero-globe")) return;
      dragging = true;
      repaint();
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      repaint(); // one final frame at the resting orientation, then freeze
    };
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    resize();
    schedule();

    // resize() reassigns canvas.width, which BLANKS the backing store. Without a
    // repaint here a frozen sky would be erased permanently by any window resize.
    const ro = new ResizeObserver(() => {
      resize();
      aligned = false; // the geometry moved; re-confirm against the new box
      paintedAt = 0;
      repaint();
    });
    ro.observe(canvas);

    loadSkyCatalogue().then((cat) => {
      if (disposed) return;
      catalogue = cat;
      if (cat) buildStarState(cat);
      // The frame that can finally paint something. Under reduced motion the loop
      // may already have frozen on an empty canvas by now.
      repaint();
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
