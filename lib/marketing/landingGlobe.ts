/**
 * The landing page's globe: one Canvas 2D renderer and the scroll choreography that drives it.
 *
 * WHAT THIS IS. The page at `/` shows ONE globe from the hero to the footer. It starts as a
 * photograph of Earth (a Blender still), becomes the data, splits into four layer globes,
 * shrinks to a corner lens over three photographs, filters to one layer at a time, unrolls
 * into a flat map, zooms to London, and comes back as the whole Earth under the last call to
 * action. Every one of those states is a plain object (`GlobeSpec`) and this module turns
 * "scroll position" into those objects (`globeAt`) and those objects into pixels (`paint`).
 *
 * WHY IT IS NOT MAPLIBRE. The old landing page mounted the console's own map behind the
 * copy. That cost a style load, map tiles, a WebGL context and ~36 `/api/*` requests on a
 * page whose job is to be read once. This renderer draws one saved file and makes no API
 * call at all. The console at `/app` keeps MapLibre.
 *
 * THE DOTS ARE A SNAPSHOT, NOT LIVE DATA. `public/marketing/globe-snapshot.json` is written
 * by `scripts/gen-landing-snapshot.mjs` from one read of production. The page prints that
 * file's date beside the globe (`lib/marketing/globe-snapshot.meta.ts`). Do not "fix" the
 * globe by pointing it at `/api/*`: the landing page is static and must stay static, and a
 * globe that silently mixes a live layer with a dated one makes the printed date false.
 *
 * NOTHING IN THIS FILE TOUCHES THE DOM. The component (`components/marketing/LandingStage.tsx`)
 * measures the page, runs the one rAF loop and writes CSS custom properties. Everything here
 * is arithmetic on numbers and typed arrays, plus drawing calls on a context it is handed,
 * so the choreography and the projection can be unit tested in the repo's Node test
 * environment.
 */

const PI = Math.PI;
const TAU = PI * 2;
const D2R = PI / 180;

/* ------------------------------------------------------------------ small maths */

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Where `v` sits between `a` and `b`, clamped to 0..1. */
export const seg = (v: number, a: number, b: number): number => clamp((v - a) / (b - a));
export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
/** The shortest way round, in degrees: the result is in [-180, 180). */
export const arc = (d: number): number => d - 360 * Math.floor((d + 180) / 360);

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mixRGB = (A: RGB, B: RGB, t: number): string =>
  Math.round(lerp(A[0], B[0], t)) +
  "," +
  Math.round(lerp(A[1], B[1], t)) +
  "," +
  Math.round(lerp(A[2], B[2], t));

/* ------------------------------------------------------------------ layers and colours */

export type Family = "cam" | "air" | "haz" | "infra";

export interface LayerDef {
  /** The layer's key in the snapshot file. */
  readonly id: string;
  readonly fam: Family;
  /** Dot diameter in px at a 380 px globe radius. */
  readonly size: number;
  /** Strength of the soft halo pass, as a share of the core alpha. */
  readonly halo: number;
}

/**
 * The point layers, in draw order. The ids are the keys `scripts/gen-landing-snapshot.mjs`
 * writes. A layer that is missing from the file draws nothing, it does not throw.
 */
export const LAYERS: readonly LayerDef[] = [
  { id: "airports", fam: "infra", size: 1.7, halo: 0.08 },
  { id: "cameras", fam: "cam", size: 2.0, halo: 0.06 },
  { id: "planes", fam: "air", size: 2.2, halo: 0.09 },
  { id: "ports", fam: "infra", size: 4.0, halo: 0.2 },
  { id: "nuclear", fam: "infra", size: 2.8, halo: 0.16 },
  { id: "earthquakes", fam: "haz", size: 4.2, halo: 0.2 },
  { id: "wildfires", fam: "haz", size: 4.8, halo: 0.2 },
  { id: "volcanoes", fam: "haz", size: 5.4, halo: 0.22 },
  { id: "launches", fam: "air", size: 4.8, halo: 0.2 },
  { id: "gdacs", fam: "haz", size: 6.0, halo: 0.22 },
];
const NL = LAYERS.length;
/** The cables are lines, not points. They take the slot after the last point layer. */
const CABLES = NL;

/** Dark = on the night globe. Paper = on the frost field of the flat map. */
const FAM: Record<Family, { dark: RGB; paper: RGB }> = {
  cam: { dark: hex("#4cc9ff"), paper: hex("#1648c8") },
  air: { dark: hex("#f4f6fb"), paper: hex("#55607a") },
  haz: { dark: hex("#ff6b4a"), paper: hex("#cf4526") },
  infra: { dark: hex("#b79bff"), paper: hex("#6e58c9") },
};
const C_LAND = { dark: hex("#22345f"), paper: hex("#c9d2e4") };
const C_COAST = { dark: hex("#5672b4"), paper: hex("#93a3c2") };
const INK = "#0a1122";
const FROST = "#eef2f7";
/** Dots shrink a little toward the limb. */
const BUCKET = [0.5, 0.68, 0.85, 1];

/** One number per point layer, plus one for the cables. */
export type LayerArray = Float32Array;

const arr = (fn: (id: string, fam: Family) => number): LayerArray => {
  const a = new Float32Array(NL + 1);
  for (let i = 0; i <= NL; i++) {
    a[i] = i === NL ? fn("cables", "infra") : fn(LAYERS[i].id, LAYERS[i].fam);
  }
  return a;
};
export const mixArr = (A: LayerArray, B: LayerArray, t: number): LayerArray => {
  const o = new Float32Array(NL + 1);
  for (let i = 0; i <= NL; i++) o[i] = A[i] + (B[i] - A[i]) * t;
  return o;
};

/** Every layer on. The cables are kept quiet or they bury the dots. */
export const W_ALL = arr((id) => (id === "cables" ? 0.3 : 1));
export const B_ONE = arr(() => 1);
/** The four separations, in the order the page lists them. */
export const FAMILIES: readonly Family[] = ["cam", "air", "haz", "infra"];
const W_FAM = FAMILIES.map((f) => arr((_id, fam) => (fam === f ? 1 : 0)));
const B_FAM = [
  arr(() => 1.25),
  arr(() => 1.2),
  arr(() => 1.25),
  arr((id) => (id === "airports" ? 1.5 : 1.1)),
];
/** One layer strong, the rest a ghost. `layer === null` means all layers. */
const emph = (layer: string | null, boost = 1, ghost = 0.13): { w: LayerArray; b: LayerArray } => ({
  w: layer ? arr((id) => (id === layer ? 1 : id === "cables" ? ghost * 0.5 : ghost)) : W_ALL,
  b: layer ? arr((id) => (id === layer ? boost : 1)) : B_ONE,
});

export interface Focus {
  /** Where the globe looks: [lon, lat] in degrees. */
  readonly c: readonly [number, number];
  readonly w: LayerArray;
  readonly b: LayerArray;
}

const LONDON: readonly [number, number] = [-0.12, 51.5];

/** Where the globe looks, per place and per card. Real places from the snapshot. */
const F: Record<string, Focus> = {
  london: { c: LONDON, ...emph("cameras", 2.1) },
  volcano: { c: [-90.88, 14.47], ...emph("volcanoes", 1.7) },
  aircraft: { c: [2, 50], ...emph("planes", 1.9) },
  "band:cameras": { c: [-40, 42], ...emph("cameras", 1.5) },
  "band:planes": { c: [-45, 48], ...emph("planes", 1.5) },
  "band:earthquakes": { c: [-135, 30], ...emph("earthquakes", 1.6) },
  "band:wildfires": { c: [-100, 15], ...emph("wildfires", 1.6) },
  "band:gdacs": { c: [72, 8], ...emph("gdacs", 1.5) },
  "band:ports": { c: [48, 30], ...emph("ports", 1.6) },
  "band:cables": { c: [22, 18], ...emph("cables", 1.5) },
  "band:launches": { c: [-84, 24], ...emph("launches", 1.7) },
  "band:all": { c: [0, 24], ...emph(null) },
  street: { c: [-4, 38], ...emph("cameras", 1.6, 0.3) },
};
const focus = (k: string): { l0: number; lat: number; w: LayerArray; b: LayerArray } => {
  const f = F[k] ?? F["band:all"];
  return { l0: f.c[0], lat: f.c[1], w: f.w, b: f.b };
};

/** The three places the corner lens turns to, and the label it wears at each. */
export type LensPlace = "london" | "volcano" | "aircraft";
export const LENS_TAGS: Record<LensPlace, { label: string; fam: Family }> = {
  london: { label: "Traffic cameras", fam: "cam" },
  volcano: { label: "Volcanoes", fam: "haz" },
  aircraft: { label: "Aircraft", fam: "air" },
};

/**
 * THE RENDER-TO-DATA HANDOFF. These three numbers are the reason the data globe can fade in
 * exactly on top of the photograph, and they are measurements of the Blender scene, not
 * choices. The stills were rendered with a 50 mm camera 3.75 Earth radii from the centre, so:
 *
 *   - `PK0 = 1 / 3.75` is the perspective term of the vertical-perspective projection below.
 *     At 0 the globe is orthographic. At 1 / 3.75 its limb and its foreshortening match the
 *     camera, which is what keeps the coasts on the photographed coasts out to the edge.
 *   - `DISC0 = 0.769` is the Earth disc as a share of the still's frame. A still is drawn at
 *     `2 * R / DISC0`, so its disc has radius R, the same R the data globe is given.
 *   - `HERO_C` / `WHOLE_C` are the lon, lat at the centre of each still.
 *
 * Re-render a still with another camera and all three must be measured again, or the dots
 * slide off the continents during the crossfade. Nothing else on the page would look wrong.
 */
export const DISC0 = 0.769;
export const PK0 = 1 / 3.75;
export const HERO_C: readonly [number, number] = [-40, 22];
export const WHOLE_C: readonly [number, number] = [-15, 12];
/** Where the globe faces when it lands in the framed inset. */
export const INSET_C: readonly [number, number] = [-20, 22];
/** The lens shows the globe this many times larger than its bezel. */
const LENSZ = 2.55;
/** What each of the four separated globes faces. */
const SEP_ROT = [
  { l0: -95, lat: 30 },
  { l0: -42, lat: 36 },
  { l0: -168, lat: 18 },
  { l0: 14, lat: 30 },
];

/** "22.0° N, 20.0° W": the readout under the inset frame. */
export function formatCoord(lat: number, lon: number): string {
  const lo = arc(lon);
  return (
    Math.abs(lat).toFixed(1) +
    "° " +
    (lat >= 0 ? "N" : "S") +
    ", " +
    Math.abs(lo).toFixed(1) +
    "° " +
    (lo >= 0 ? "E" : "W")
  );
}

/* ------------------------------------------------------------------ data */

/** The shape `scripts/gen-landing-snapshot.mjs` writes. Only the coordinates are read. */
export interface GlobeSnapshot {
  layers: Record<
    string,
    { points?: ReadonlyArray<readonly [number, number]>; lines?: ReadonlyArray<ReadonlyArray<readonly [number, number]>> } | undefined
  >;
}
/** As much of a GeoJSON FeatureCollection as the land needs. */
export interface LandGeoJson {
  features: ReadonlyArray<{
    geometry: null | { type: string; coordinates: unknown };
  }>;
}

interface Poly {
  n: number;
  lam: Float32Array;
  phi: Float32Array;
  cph: Float32Array;
  sph: Float32Array;
  /** 1 where a new polyline starts. */
  brk: Uint8Array;
}
interface PointSet {
  n: number;
  lam: Float32Array;
  phi: Float32Array;
  cph: Float32Array;
  sph: Float32Array;
  /** Scratch: the last projected position and depth bucket of each point. */
  x: Float32Array;
  y: Float32Array;
  bk: Int8Array;
}
export interface GlobeData {
  pts: PointSet[];
  cables: Poly;
  coast: Poly;
  coastS: Poly;
  scan: Poly;
  scanS: Poly;
}

/** lines: [lon, lat, lon, lat, ...] in degrees. */
function poly(lines: number[][]): Poly {
  let n = 0;
  for (const l of lines) n += l.length / 2;
  const lam = new Float32Array(n);
  const phi = new Float32Array(n);
  const cph = new Float32Array(n);
  const sph = new Float32Array(n);
  const brk = new Uint8Array(n);
  let j = 0;
  for (const l of lines) {
    for (let i = 0; i < l.length; i += 2) {
      const la = l[i + 1] * D2R;
      lam[j] = l[i] * D2R;
      phi[j] = la;
      cph[j] = Math.cos(la);
      sph[j] = Math.sin(la);
      brk[j] = i === 0 ? 1 : 0;
      j++;
    }
  }
  return { n, lam, phi, cph, sph, brk };
}

/** [[lon, lat], ...] to a flat array with no step longer than `maxDeg`, so a line bends with the sphere. */
function densify(pts: ReadonlyArray<readonly [number, number]>, maxDeg: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (i) {
      const p = pts[i - 1];
      const dl = arc(a[0] - p[0]);
      const dp = a[1] - p[1];
      const k = Math.ceil(Math.max(Math.abs(dl), Math.abs(dp)) / maxDeg);
      for (let s = 1; s < k; s++) out.push(p[0] + (dl * s) / k, p[1] + (dp * s) / k);
    }
    out.push(a[0], a[1]);
  }
  return out;
}

type Ring = ReadonlyArray<readonly [number, number]>;

/**
 * Turn the snapshot and the country outlines into typed arrays the renderer can walk.
 *
 * `mob` thins the three dense layers and widens the scanline spacing. A phone draws the same
 * picture with about a third of the points, which is what keeps a paint inside one frame there.
 */
export function prepareGlobeData(snapshot: GlobeSnapshot, geo: LandGeoJson, mob: boolean): GlobeData {
  const every: Record<string, number> = mob ? { cameras: 3, planes: 2, airports: 2 } : {};
  const pts = LAYERS.map((ly): PointSet => {
    const src = snapshot.layers[ly.id]?.points ?? [];
    const step = every[ly.id] || 1;
    const n = Math.ceil(src.length / step);
    const o: PointSet = {
      n,
      lam: new Float32Array(n),
      phi: new Float32Array(n),
      cph: new Float32Array(n),
      sph: new Float32Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      bk: new Int8Array(n),
    };
    for (let j = 0, k = 0; k < src.length; k += step, j++) {
      const lo = src[k][0] * D2R;
      const la = src[k][1] * D2R;
      o.lam[j] = lo;
      o.phi[j] = la;
      o.cph[j] = Math.cos(la);
      o.sph[j] = Math.sin(la);
    }
    return o;
  });
  const cables = (snapshot.layers.cables?.lines ?? []).map((l) => densify(l, 4));

  /* Land: every ring of Natural Earth 110m. Coast and border lines, plus latitude scanlines
     as the land tone. */
  const rings: Ring[] = [];
  for (const f of geo.features) {
    const gm = f.geometry;
    if (!gm) continue;
    const polys =
      gm.type === "Polygon"
        ? [gm.coordinates as Ring[]]
        : gm.type === "MultiPolygon"
          ? (gm.coordinates as Ring[][])
          : [];
    for (const p of polys) for (const r of p) rings.push(r);
  }
  /* Antarctica (south of 60 S) is kept apart: it draws on the sphere and fades out of the
     flat map, where it would otherwise sit under the facts. */
  const coast: number[][] = [];
  const coastS: number[][] = [];
  for (const r of rings) {
    let run: Array<readonly [number, number]> = [];
    let top = -90;
    const flush = () => {
      if (run.length > 1) (top < -60 ? coastS : coast).push(densify(run, 3));
      run = [];
      top = -90;
    };
    for (const pt of r) {
      /* Lift the pen on the antimeridian cut, or a line is drawn down the edge of the map. */
      if (Math.abs(pt[0]) > 179.9 || pt[1] < -89) {
        flush();
        continue;
      }
      run.push(pt);
      if (pt[1] > top) top = pt[1];
    }
    flush();
  }
  const scan: number[][] = [];
  const scanS: number[][] = [];
  const ROW = mob ? 1.6 : 1.25;
  const STEP = 2;
  for (let lat = -85.013; lat < 84; lat += ROW) {
    const xs: number[] = [];
    for (const r of rings) {
      for (let i = 0, n = r.length - 1; i < n; i++) {
        const a = r[i];
        const b = r[i + 1];
        if ((a[1] > lat) !== (b[1] > lat)) xs.push(a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    let s0: number | null = null;
    let e0 = 0;
    const push = (from: number) => {
      if (e0 - from < 0.3) return;
      const line: number[] = [];
      for (let lo = from; lo < e0; lo += STEP) line.push(lo, lat);
      line.push(e0, lat);
      (lat < -60 ? scanS : scan).push(line);
    };
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (s0 !== null && xs[i] - e0 < 0.25) {
        e0 = xs[i + 1];
        continue;
      }
      if (s0 !== null) push(s0);
      s0 = xs[i];
      e0 = xs[i + 1];
    }
    if (s0 !== null) push(s0);
  }
  return {
    pts,
    cables: poly(cables),
    coast: poly(coast),
    coastS: poly(coastS),
    scan: poly(scan),
    scanS: poly(scanS),
  };
}

/* ------------------------------------------------------------------ the globe state */

/** One globe, fully described. `paint` draws any number of these in one pass. */
export interface GlobeSpec {
  /** Centre and radius of the disc, in CSS px. */
  cx: number;
  cy: number;
  R: number;
  /** Centre longitude and latitude, degrees. */
  l0: number;
  lat: number;
  /** 0 = sphere, 1 = fully unrolled into an equirectangular map. */
  u: number;
  /** Perspective term: 0 = orthographic, `PK0` = the Blender camera. */
  pk: number;
  /** Above 1 the content is magnified inside a disc of radius R (the lens). */
  zoom: number;
  /** Alpha of the whole globe. */
  a: number;
  /** Alpha of the ocean disc. */
  disc: number;
  /** 0 = night inks, 1 = paper inks. */
  pp: number;
  /** Camera highlight: the cameras come forward, the rest goes quiet. */
  hl: number;
  /** Atmosphere rim, lens bezel and orbit ring strengths. */
  rim: number;
  ring: number;
  bez: number;
  /** Weight and size boost per layer. */
  w: LayerArray;
  b: LayerArray;
}

export const G = (o: Partial<GlobeSpec>): GlobeSpec =>
  Object.assign(
    { cx: 0, cy: 0, R: 100, l0: 0, lat: 0, u: 0, pk: 0, zoom: 1, a: 1, disc: 1, pp: 0, hl: 0, rim: 1, ring: 0, bez: 0, w: W_ALL, b: B_ONE },
    o,
  );

type NumKey = "cx" | "cy" | "R" | "lat" | "u" | "pk" | "zoom" | "a" | "disc" | "pp" | "hl" | "rim" | "ring" | "bez";
const NUM: readonly NumKey[] = ["cx", "cy", "R", "lat", "u", "pk", "zoom", "a", "disc", "pp", "hl", "rim", "ring", "bez"];

function mixG(A: GlobeSpec, B: GlobeSpec, t: number): GlobeSpec {
  const o = G({});
  for (const k of NUM) o[k] = lerp(A[k], B[k], t);
  o.l0 = A.l0 + arc(B.l0 - A.l0) * t;
  o.w = mixArr(A.w, B.w, t);
  o.b = mixArr(A.b, B.b, t);
  return o;
}

/** A place the globe parks: a centre and a radius, in CSS px. */
export interface Dock {
  cx: number;
  cy: number;
  R: number;
}
const mixK = (A: Dock, B: Dock, t: number): Dock => ({
  cx: lerp(A.cx, B.cx, t),
  cy: lerp(A.cy, B.cy, t),
  R: lerp(A.R, B.R, t),
});

/** One of the two Blender stills, placed. `s` is the side of the square it is drawn into. */
export interface Still {
  img: CanvasImageSource | null;
  cx: number;
  cy: number;
  s: number;
  a: number;
}

/* ------------------------------------------------------------------ projection
   u = 0: a sphere seen from pk = 1 / distance (0 is orthographic), centred on l0 / lat.
   u > 0: the sphere unrolls into an equirectangular map. Arc length along each latitude is
   kept while the curvature relaxes to zero, so the same data reads as the same data. The
   unroll needs lat = 0. */

interface View {
  cx: number;
  cy: number;
  Rz: number;
  pk: number;
  sc: number;
  l0: number;
  cT: number;
  sT: number;
  u: number;
  a: number;
  k: number;
}

/* The last projected point. Module-level scratch, because `project` runs once per point per
   paint (about 20,000 times) and returning an object from it would allocate that many. */
let PX = 0;
let PY = 0;
let PZ = 0;

function view(g: GlobeSpec): View {
  const a = ease(clamp(g.u / 0.6));
  const b = ease(clamp((g.u - 0.2) / 0.8));
  const pk = g.u > 0 ? 0 : g.pk;
  const Rz = g.R * g.zoom;
  return {
    cx: g.cx,
    cy: g.cy,
    Rz,
    pk,
    sc: Rz * Math.sqrt((1 + pk) / (1 - pk)) * (1 - pk),
    l0: g.l0 * D2R,
    cT: Math.cos(g.lat * D2R),
    sT: Math.sin(g.lat * D2R),
    u: g.u,
    a,
    k: 1 - b,
  };
}

function project(lam: number, phi: number, cph: number, sph: number, v: View): boolean {
  let l = lam - v.l0;
  l -= TAU * Math.floor((l + PI) / TAU);
  if (v.u <= 0) {
    const cl = Math.cos(l);
    const z = v.sT * sph + v.cT * cph * cl;
    if (z <= v.pk) return false;
    const k = v.sc / (1 - v.pk * z);
    PX = v.cx + k * cph * Math.sin(l);
    PY = v.cy - k * (v.cT * sph - v.sT * cph * cl);
    PZ = (z - v.pk) / (1 - v.pk);
    return true;
  }
  const rho = cph + (1 - cph) * v.a;
  const Y = sph + (phi - sph) * v.a;
  const th = l * v.k;
  if (v.k < 1e-4) {
    PX = v.cx + v.Rz * rho * l;
    PY = v.cy - v.Rz * Y;
    PZ = 1;
    return true;
  }
  const Z = Math.cos(th);
  if (Z <= 0) return false;
  PX = v.cx + (v.Rz * rho * Math.sin(th)) / v.k;
  PY = v.cy - v.Rz * Y;
  PZ = Z * rho;
  return true;
}

/**
 * Where a lon, lat lands on screen for a globe state, or null when it is on the far side.
 * The renderer does not use this (it reads the scratch values directly). It exists so the
 * handoff alignment and the unroll can be asserted without a canvas.
 */
export function projectLonLat(
  lonDeg: number,
  latDeg: number,
  g: GlobeSpec,
): { x: number; y: number; depth: number } | null {
  const la = latDeg * D2R;
  if (!project(lonDeg * D2R, la, Math.cos(la), Math.sin(la), view(g))) return null;
  return { x: PX, y: PY, depth: PZ };
}

/* ------------------------------------------------------------------ drawing */

function strokeLines(c: CanvasRenderingContext2D, Gm: Poly, v: View): void {
  let pen = false;
  let px = 0;
  /* Never draw across the map seam: a segment that jumps most of the map is a wrap, not a line. */
  const lim = v.u > 0 ? v.Rz * 2.5 : 1e9;
  for (let i = 0; i < Gm.n; i++) {
    const vis = project(Gm.lam[i], Gm.phi[i], Gm.cph[i], Gm.sph[i], v);
    if (!vis || Gm.brk[i]) pen = false;
    if (!vis) continue;
    if (pen && Math.abs(PX - px) > lim) pen = false;
    if (pen) c.lineTo(PX, PY);
    else {
      c.moveTo(PX, PY);
      pen = true;
    }
    px = PX;
  }
}

function drawContent(c: CanvasRenderingContext2D, D: GlobeData, g: GlobeSpec, v: View, W: number, H: number): void {
  const Reff = g.R * g.zoom;
  const lens = g.zoom > 1.001;
  if (lens) {
    c.save();
    c.beginPath();
    c.arc(g.cx, g.cy, g.R, 0, TAU);
    c.clip();
  }
  c.lineCap = "round";
  c.lineJoin = "round";
  /* Land tone (scanlines), then coasts and borders, then cables. */
  const la = g.a * (1 - 0.3 * g.hl);
  const south = 1 - clamp(g.u * 1.6);
  const scanA = clamp(1.7 - Reff / 420, 0.16, 1);
  c.strokeStyle = "rgb(" + mixRGB(C_LAND.dark, C_LAND.paper, g.pp) + ")";
  c.lineWidth = clamp((1.05 * Reff) / 380, 0.55, 1.5) * (1 + 0.15 * g.u);
  c.globalAlpha = la * scanA;
  c.beginPath();
  strokeLines(c, D.scan, v);
  c.stroke();
  if (south > 0.01) {
    c.globalAlpha = la * scanA * south;
    c.beginPath();
    strokeLines(c, D.scanS, v);
    c.stroke();
  }
  c.strokeStyle = "rgb(" + mixRGB(C_COAST.dark, C_COAST.paper, g.pp) + ")";
  c.lineWidth = clamp((0.9 * Reff) / 380, 0.5, 1.2);
  c.globalAlpha = la;
  c.beginPath();
  strokeLines(c, D.coast, v);
  c.stroke();
  if (south > 0.01) {
    c.globalAlpha = la * south;
    c.beginPath();
    strokeLines(c, D.coastS, v);
    c.stroke();
  }
  const cw = g.w[CABLES] * (1 - 0.75 * g.hl);
  if (cw > 0.01) {
    c.globalAlpha = g.a * cw * lerp(0.62, 0.4, g.pp);
    c.strokeStyle = "rgb(" + mixRGB(FAM.infra.dark, FAM.infra.paper, g.pp) + ")";
    c.lineWidth = clamp((0.7 * Reff) / 380, 0.4, 0.9) * g.b[CABLES];
    c.beginPath();
    strokeLines(c, D.cables, v);
    c.stroke();
  }
  /* Dots: a soft halo pass and a core pass per layer, added as light on the dark globe.
     A dot is a zero-length round-capped stroke, so one path per depth bucket draws them all. */
  const paper = g.pp > 0.5;
  c.globalAlpha = 1;
  c.globalCompositeOperation = paper ? "source-over" : "lighter";
  const scale = clamp(Reff / 380 + 0.45 * g.u, 0.6, 1.3);
  const clipR2 = lens ? (g.R + 6) * (g.R + 6) : 0;
  for (let i = 0; i < NL; i++) {
    const ly = LAYERS[i];
    const P = D.pts[i];
    const cam = ly.id === "cameras";
    const alpha = g.a * g.w[i] * (cam ? 1 : 1 - 0.82 * g.hl);
    if (alpha < 0.012) continue;
    const size = ly.size * scale * g.b[i] * (cam ? 1 + 0.55 * g.hl : 1);
    let m = 0;
    for (let j = 0; j < P.n; j++) {
      if (!project(P.lam[j], P.phi[j], P.cph[j], P.sph[j], v) || PX < -8 || PY < -8 || PX > W + 8 || PY > H + 8) {
        P.bk[j] = -1;
        continue;
      }
      if (clipR2) {
        const dx = PX - g.cx;
        const dy = PY - g.cy;
        if (dx * dx + dy * dy > clipR2) {
          P.bk[j] = -1;
          continue;
        }
      }
      P.x[j] = PX;
      P.y[j] = PY;
      P.bk[j] = Math.min(3, (PZ * 4) | 0);
      m++;
    }
    if (!m) continue;
    const rgb = mixRGB(FAM[ly.fam].dark, FAM[ly.fam].paper, g.pp);
    for (let pass = paper ? 1 : 0; pass < 2; pass++) {
      c.strokeStyle = "rgba(" + rgb + "," + (pass ? alpha : alpha * ly.halo).toFixed(3) + ")";
      for (let b = 0; b < 4; b++) {
        c.lineWidth = size * BUCKET[b] * (pass ? 1 : 3.2);
        c.beginPath();
        for (let j = 0; j < P.n; j++) {
          if (P.bk[j] === b) {
            c.moveTo(P.x[j], P.y[j]);
            c.lineTo(P.x[j] + 0.01, P.y[j]);
          }
        }
        c.stroke();
      }
    }
  }
  c.globalCompositeOperation = "source-over";
  if (lens) c.restore();
}

/**
 * Draw one frame: the stills first, then every globe on top of them.
 *
 * `data` may be null. The discs, rims and stills still draw, so the page reads before the
 * snapshot has arrived and when it never does.
 */
export function paint(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  rend: readonly Still[],
  specs: readonly GlobeSpec[],
  data: GlobeData | null,
): void {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  for (const r of rend) {
    if (r.img && r.a > 0.003) {
      c.globalAlpha = r.a;
      c.drawImage(r.img, r.cx - r.s / 2, r.cy - r.s / 2, r.s, r.s);
    }
  }
  c.globalAlpha = 1;
  /* Under each disc: the atmosphere rim, or the lens shadow. */
  for (const g of specs) {
    const ra = g.a * g.rim * g.disc;
    if (ra > 0.01) {
      const gr = c.createRadialGradient(g.cx, g.cy, g.R * 0.97, g.cx, g.cy, g.R * 1.1);
      gr.addColorStop(0, "rgba(125,180,255," + (0.6 * ra).toFixed(3) + ")");
      gr.addColorStop(0.3, "rgba(80,140,255," + (0.26 * ra).toFixed(3) + ")");
      gr.addColorStop(1, "rgba(80,140,255,0)");
      c.fillStyle = gr;
      c.beginPath();
      c.arc(g.cx, g.cy, g.R * 1.1, 0, TAU);
      c.fill();
    }
    if (g.bez > 0.01 && g.a > 0.01) {
      c.save();
      c.globalAlpha = g.a * g.bez;
      c.shadowColor = "rgba(3,6,12,.55)";
      c.shadowBlur = 28 * dpr;
      c.shadowOffsetY = 10 * dpr;
      c.fillStyle = INK;
      c.beginPath();
      c.arc(g.cx, g.cy, g.R + 3, 0, TAU);
      c.fill();
      c.restore();
    }
  }
  /* The ocean discs. */
  for (const g of specs) {
    const da = g.a * g.disc;
    if (da < 0.004) continue;
    const gr = c.createRadialGradient(g.cx - g.R * 0.35, g.cy - g.R * 0.35, g.R * 0.1, g.cx, g.cy, g.R);
    gr.addColorStop(0, "#13203f");
    gr.addColorStop(0.6, "#0b1327");
    gr.addColorStop(1, "#070b17");
    c.globalAlpha = da;
    c.fillStyle = gr;
    c.beginPath();
    c.arc(g.cx, g.cy, g.R, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
  if (data) for (const g of specs) if (g.a > 0.004) drawContent(c, data, g, view(g), W, H);
  /* Over each disc: rim light, lens bezel, orbit ring. */
  for (const g of specs) {
    const ra = g.a * g.rim * g.disc;
    if (ra > 0.01) {
      c.globalAlpha = ra * 0.4;
      c.strokeStyle = "#9cc2ff";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(g.cx, g.cy, g.R - 0.5, 0, TAU);
      c.stroke();
    }
    if (g.bez > 0.01 && g.a > 0.01) {
      c.globalAlpha = g.a * g.bez;
      c.strokeStyle = FROST;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(g.cx, g.cy, g.R + 1.5, 0, TAU);
      c.stroke();
    }
    if (g.ring > 0.01) {
      const rr = g.R * 1.16;
      c.globalAlpha = g.a * g.ring * 0.45;
      c.strokeStyle = INK;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(g.cx, g.cy, rr, 0, TAU);
      c.stroke();
      c.globalAlpha = g.a * g.ring * 0.8;
      c.fillStyle = INK;
      c.beginPath();
      c.arc(g.cx - rr, g.cy, 3.5, 0, TAU);
      c.arc(g.cx + rr, g.cy, 3.5, 0, TAU);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

/**
 * Everything `paint` reads, as one string. The loop paints only when this changes, which is
 * what makes "nothing draws at rest" true rather than hoped for.
 */
export function stateKey(rend: readonly Still[], specs: readonly GlobeSpec[], hasData: boolean): string {
  let key = hasData ? "d" : "";
  for (const r of rend) {
    key += "|" + (r.img ? 1 : 0) + r.cx.toFixed(1) + "," + r.cy.toFixed(1) + "," + r.s.toFixed(1) + "," + r.a.toFixed(3);
  }
  for (const g of specs) {
    key += "|";
    for (const k of NUM) key += g[k].toFixed(k === "cx" || k === "cy" || k === "R" ? 1 : 3) + ",";
    key += g.l0.toFixed(2) + ",";
    for (let i = 0; i <= NL; i++) key += g.w[i].toFixed(2);
    for (let i = 0; i <= NL; i++) key += g.b[i].toFixed(2);
  }
  return key;
}

/* ------------------------------------------------------------------ layout: the scroll budget and the docks */

/**
 * How long each pinned section holds, in viewport heights. `app/landing.css` reserves the
 * same heights (310svh, 490svh, ...) so the page does not jump when the engine mounts: if a
 * number moves here, move it there.
 */
export const PIN = { split: 3.1, photos: 4.9, bandLead: 1.45, flat: 2.2, zoom: 0.9, street: 2.2 } as const;

export interface BandMetrics {
  /** Card width, the gap between cards and the inset of the first card, px. */
  cw: number;
  gap: number;
  start: number;
  /** Left edge of the window the track slides inside. */
  winL: number;
  /** How far the track travels, which is also the extra scroll the band needs. */
  travel: number;
  /** Centre of each card along the track. */
  cardC: number[];
  /** The x a card's centre must be nearest to count as the card in focus. */
  focusX: number;
}

export function bandMetrics(W: number, mob: boolean, n: number): BandMetrics {
  const cw = mob ? Math.round(W * 0.66) : Math.round(Math.max(300, W * 0.26));
  const gap = mob ? 16 : Math.round(W * 0.025);
  const winL = mob ? 0 : Math.round(W * 0.4);
  const winW = W - winL;
  const start = mob ? 16 : 64;
  const trackW = start + n * cw + (n - 1) * gap;
  const travel = Math.max(0, trackW - (winW - (mob ? 16 : Math.round(W * 0.05))));
  const cardC: number[] = [];
  for (let i = 0; i < n; i++) cardC.push(start + i * (cw + gap) + cw / 2);
  return { cw, gap, start, winL, travel, cardC, focusX: start + cw / 2 + (cw + gap) * 0.42 };
}

/** The height of each pinned section, px. */
export function pinHeights(H: number, travel: number): { split: number; photos: number; band: number; dive: number } {
  return {
    split: Math.round(H * PIN.split),
    photos: Math.round(H * PIN.photos),
    band: Math.round(H * PIN.bandLead + travel),
    dive: Math.round(H + H * (PIN.flat + PIN.zoom + PIN.street)),
  };
}

/** Scroll positions (px from the top of the document) where each act starts and ends. */
export interface Timeline {
  /** Split: top and pinned length. */
  T2: number;
  P2: number;
  /** Photographs: top, the three iris spans, and where the lens leaves. */
  T3: number;
  A1: number;
  B1: number;
  I2s: number;
  I2e: number;
  I3s: number;
  I3e: number;
  L1: number;
  /** Band: top, where the track starts to move, where the pin ends. */
  T4: number;
  tStart: number;
  bandEnd: number;
  /** Dive: top, and the lengths of the flat, zoom and street acts. */
  T5: number;
  Lf: number;
  Lz: number;
  Ls: number;
  P5: number;
  /** Close: top. `maxY` is the last scroll position of the page. */
  T6: number;
  maxY: number;
  /** Radius that covers the viewport from any centre inside it. */
  cover: number;
  band: BandMetrics;
}

export interface PageMeasure {
  W: number;
  H: number;
  /** Document-relative tops of the five pinned or anchored blocks. */
  splitTop: number;
  splitH: number;
  photosTop: number;
  bandTop: number;
  bandH: number;
  diveTop: number;
  closeTop: number;
  /** `document.documentElement.scrollHeight`. */
  scrollH: number;
}

export function timeline(m: PageMeasure, band: BandMetrics): Timeline {
  const { H } = m;
  const T3 = m.photosTop;
  const Lf = H * PIN.flat;
  const Lz = H * PIN.zoom;
  const Ls = H * PIN.street;
  return {
    T2: m.splitTop,
    P2: m.splitH - H,
    T3,
    A1: T3 + 0.35 * H,
    B1: T3 + 1.05 * H,
    I2s: T3 + 1.6 * H,
    I2e: T3 + 2.2 * H,
    I3s: T3 + 2.75 * H,
    I3e: T3 + 3.35 * H,
    L1: T3 + 3.9 * H,
    T4: m.bandTop,
    tStart: m.bandTop + 0.15 * H,
    bandEnd: m.bandTop + m.bandH - H,
    T5: m.diveTop,
    Lf,
    Lz,
    Ls,
    P5: Lf + Lz + Ls,
    T6: m.closeTop,
    maxY: Math.max(m.closeTop + 1, m.scrollH - H),
    cover: Math.hypot(m.W, H) + 4,
    band,
  };
}

/** A box measured relative to the pinned stage it sits in. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every place the globe parks. */
export interface Docks {
  hero: Dock;
  inset: Dock;
  seps: Dock[];
  centre: Dock;
  lens: Dock;
  band: Dock;
  flat0: Dock;
  /** Radius of the globe once it is the flat map: the map is 2 * PI * Rflat wide. */
  Rflat: number;
  /** Centre of the console screenshot, which London is moved onto. */
  screen: { cx: number; cy: number };
  small: Dock;
  whole: Dock;
  whole2: Dock;
}

/**
 * `frame` is the inset plate and `screen` the console screenshot, both measured in the page.
 * Everything else is a share of the viewport. The two measured boxes are what keep the globe
 * inside the drawn frame, and London under the screenshot, at any width.
 */
export function docks(W: number, H: number, mob: boolean, frame: Box, screen: Box, footerH: number): Docks {
  const pad = Math.max(10, frame.w * 0.06);
  const Dl = mob ? 84 : 128;
  const dW = mob ? W * 1.45 : Math.min(H * 1.2, W * 0.9);
  const sepGrid: Array<[number, number]> = [
    [0.27, 0.535],
    [0.73, 0.535],
    [0.27, 0.8],
    [0.73, 0.8],
  ];
  return {
    hero: mob ? { cx: W * 0.5, cy: H * 0.29, R: W * 0.54 } : { cx: W * 0.67, cy: H * 0.52, R: Math.min(H * 0.86, W * 0.5) / 2 },
    inset: { cx: frame.x + frame.w / 2, cy: frame.y + frame.h / 2, R: frame.w / 2 - pad },
    seps: mob
      ? sepGrid.map(([a, b]) => ({ cx: W * a, cy: H * b, R: W * 0.185 }))
      : [0.14, 0.38, 0.62, 0.86].map((a) => ({ cx: W * a, cy: H * 0.66, R: Math.min(W * 0.094, H * 0.17) })),
    centre: mob ? { cx: W / 2, cy: H * 0.44, R: W * 0.39 } : { cx: W / 2, cy: H / 2, R: H * 0.31 },
    lens: { cx: W - (mob ? 16 : 40) - Dl / 2, cy: (mob ? 70 : 92) + Dl / 2, R: Dl / 2 },
    band: mob ? { cx: W * 0.5, cy: H * 0.37, R: Math.min(W * 0.5, H * 0.26) / 2 } : { cx: W * 0.2, cy: H * 0.64, R: H * 0.2 },
    flat0: mob ? { cx: W * 0.5, cy: H * 0.53, R: W * 0.4 } : { cx: W * 0.5, cy: H * 0.58, R: Math.min(H * 0.33, W * 0.25) },
    Rflat: (mob ? W * 2.3 : W * 0.94) / TAU,
    screen: { cx: screen.x + screen.w / 2, cy: screen.y + screen.h / 2 },
    small: mob ? { cx: W - 58, cy: 126, R: 42 } : { cx: W - Math.max(130, W * 0.115), cy: H * 0.2, R: clamp(W * 0.1, 110, 160) / 2 },
    whole: { cx: W * 0.5, cy: mob ? H : H * 1.24, R: dW / 2 },
    whole2: { cx: W * 0.5, cy: H - (footerH - 150) + dW * 0.2, R: dW / 2 },
  };
}

/* ------------------------------------------------------------------ choreography: scroll position in, globe state out */

/** Everything `globeAt` needs. The component rebuilds it on resize and nowhere else. */
export interface Stage {
  H: number;
  mob: boolean;
  L: Timeline;
  K: Docks;
  /** `data-layer` of each card in the band, in DOM order. The last one is the end card. */
  cardLayers: readonly string[];
  /** The two Blender stills, null until they have loaded. */
  heroImg: CanvasImageSource | null;
  wholeImg: CanvasImageSource | null;
  /** 0..1 fade of the hero still after it loads. */
  heroIn: number;
}

/** How fast the globe's facing may follow its target: at once, in 80 ms, or in 240 ms. */
export type FocusMode = "snap" | "fast" | "slow";

export interface GlobeState {
  rend: Still[];
  specs: GlobeSpec[];
  mode: FocusMode;
}

const sepSpec = (K: Docks, base: GlobeSpec, i: number, s: number): GlobeSpec =>
  G({
    cx: lerp(base.cx, K.seps[i].cx, s),
    cy: lerp(base.cy, K.seps[i].cy, s),
    R: lerp(base.R, K.seps[i].R, s),
    l0: base.l0 + arc(SEP_ROT[i].l0 - base.l0) * s,
    lat: lerp(base.lat, SEP_ROT[i].lat, s),
    rim: i ? 0.8 * s : 0.8,
    w: W_FAM[i],
    b: mixArr(B_ONE, B_FAM[i], s),
  });

/** The unroll, then the camera highlight. `p` runs 0..1 over the flat act. */
function flatState(S: Stage, p: number): GlobeSpec {
  const { K, mob } = S;
  const u = ease(seg(p, 0.04, 0.5));
  const hl = ease(seg(p, 0.55, 0.78));
  const K0 = K.flat0;
  /* The phone's map is wider than its screen, so it pans from the Atlantic to the Americas. */
  const pan = mob ? lerp(0, -45, ease(seg(p, 0.5, 0.95))) : p * 14;
  return G({
    cx: K0.cx,
    cy: K0.cy,
    R: lerp(K0.R, K.Rflat, ease(clamp(u / 0.6))),
    l0: (mob ? -40 : -20) + pan,
    lat: 0,
    u,
    hl,
    pp: clamp(u / 0.35),
    disc: 1 - clamp(u / 0.3),
    rim: 0,
  });
}

/** Where the card track is, and which card is in focus, at scroll position `y`. */
export function bandAt(L: Timeline, y: number): { tx: number; best: number } {
  const { travel, cardC, focusX } = L.band;
  const tx = -seg(y, L.tStart, L.tStart + travel) * travel;
  let best = 0;
  let bd = 1e9;
  for (let i = 0; i < cardC.length; i++) {
    const d = Math.abs(cardC[i] + tx - focusX);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { tx, best };
}

/** Which place the lens shows at scroll position `y`. */
export function lensPlaceAt(L: Timeline, y: number): LensPlace {
  return y < L.I2s ? "london" : y < L.I3s ? "volcano" : "aircraft";
}

/**
 * THE WHOLE PAGE, AS ONE FUNCTION OF SCROLL. Give it a scroll position and it returns which
 * stills and which globes to draw. It keeps no state between calls, so any frame can be
 * produced from nothing: a reload half way down the page lands on the right picture.
 */
export function globeAt(S: Stage, y: number): GlobeState {
  const { H, mob, L, K } = S;
  const rend: Still[] = [];
  let specs: GlobeSpec[] = [];
  let mode: FocusMode = "snap";

  if (y < L.T2) {
    /* Hero to inset. The big Earth shrinks into the frame, and on the way the photograph
       becomes the data. THE ORDER MATTERS: coast lines and dots fade in ON the photograph,
       then the ocean disc closes over it, then the render fades, then the perspective
       relaxes to orthographic. Closing the disc first shows an empty dark circle for a
       moment. Position, size and framing are shared until the render is gone. */
    const t = ease(seg(y, H * 0.08, L.T2));
    const d = mixK(K.hero, K.inset, t);
    const ra = 1 - smooth(seg(t, 0.66, 0.8));
    if (ra > 0.003) rend.push({ img: S.heroImg, cx: d.cx, cy: d.cy, s: (2 * d.R) / DISC0, a: ra * S.heroIn });
    const la = smooth(seg(t, 0.14, 0.42));
    if (la > 0.003) {
      const k = smooth(seg(t, 0.8, 1));
      specs.push(
        G({
          cx: d.cx,
          cy: d.cy,
          R: d.R,
          l0: lerp(HERO_C[0], INSET_C[0], k),
          lat: lerp(HERO_C[1], INSET_C[1], k),
          pk: PK0 * (1 - k),
          a: la,
          disc: smooth(seg(t, 0.42, 0.66)),
          rim: (1 - ra) * 0.8,
        }),
      );
    }
  } else if (y < L.T2 + L.P2) {
    /* The inset globe comes apart into four layer globes. */
    const p = (y - L.T2) / L.P2;
    const base = G({ cx: K.inset.cx, cy: K.inset.cy, R: K.inset.R, l0: INSET_C[0] + 30 * smooth(seg(p, 0, 0.2)), lat: INSET_C[1], rim: 0.8 });
    const s = ease(seg(p, 0.17, 0.47));
    specs = s < 0.002 ? [base] : [0, 1, 2, 3].map((i) => sepSpec(K, base, i, s));
  } else if (y < L.T3) {
    /* The four merge again at the centre, on the way to the photographs. */
    const m = ease(seg(y, L.T2 + L.P2, L.T3 - H * 0.22));
    const C = G({ cx: K.centre.cx, cy: K.centre.cy, R: K.centre.R, l0: LONDON[0], lat: LONDON[1], rim: 0.8 });
    if (m < 0.999) {
      const base = G({ cx: K.inset.cx, cy: K.inset.cy, R: K.inset.R, l0: INSET_C[0] + 30, lat: INSET_C[1] });
      specs = [0, 1, 2, 3].map((i) => {
        const A = sepSpec(K, base, i, 1);
        const g = mixG(A, Object.assign({}, C, { w: A.w, b: A.b }), m);
        g.rim = i ? 0.8 * (1 - m) : 0.8;
        return g;
      });
    } else {
      const k = smooth(seg(y, L.T3 - H * 0.22, L.T3 - H * 0.03));
      specs = [Object.assign(C, { w: mixArr(W_ALL, F.london.w, k), b: mixArr(B_ONE, F.london.b, k) })];
    }
  } else if (y < L.T4) {
    /* The globe fades over a photo disc, the iris opens, the globe returns as a corner lens. */
    const c = K.centre;
    const l = K.lens;
    let g: GlobeSpec;
    let fk: string;
    if (y <= L.A1) {
      g = G({ cx: c.cx, cy: c.cy, R: c.R, rim: 0.8, a: 1 - easeOut(seg(y, L.T3, L.A1)) });
      fk = "london";
    } else if (y <= L.B1) {
      const t = seg(y, L.A1, L.B1);
      const d = mixK(c, l, ease(t));
      g = G({ cx: d.cx, cy: d.cy, R: d.R, a: clamp((t - 0.55) / 0.4), bez: clamp((t - 0.6) / 0.35), zoom: t < 0.5 ? 1 : LENSZ, rim: 0 });
      fk = "london";
    } else if (y <= L.L1) {
      g = G({ cx: l.cx, cy: l.cy, R: l.R, zoom: LENSZ, bez: 1, rim: 0 });
      fk = lensPlaceAt(L, y);
      mode = "slow";
    } else {
      const t = seg(y, L.L1, L.T4);
      const e = ease(t);
      const d = mixK(l, K.band, e);
      g = G({ cx: d.cx, cy: d.cy, R: d.R, zoom: lerp(LENSZ, 1, e), bez: 1 - clamp((t - 0.2) / 0.4), ring: clamp((t - 0.6) / 0.4), rim: 0 });
      fk = y < L.L1 + 0.35 * H ? "aircraft" : "band:cameras";
      mode = "slow";
    }
    specs = [Object.assign(g, focus(fk))];
  } else if (y < L.T5) {
    /* The band: the globe filters and turns to the card in focus, then leaves for the frost field. */
    const B = { cx: K.band.cx, cy: K.band.cy, R: K.band.R, ring: 1, rim: 0 };
    if (y <= L.bandEnd) {
      specs = [G(Object.assign(B, focus("band:" + S.cardLayers[bandAt(L, y).best])))];
      mode = "slow";
    } else {
      specs = [mixG(G(Object.assign(B, focus("band:all"))), flatState(S, 0), ease(seg(y, L.bandEnd, L.T5)))];
      mode = "fast";
    }
  } else if (y < L.T5 + L.P5) {
    const q = y - L.T5;
    if (q < L.Lf) {
      specs = [flatState(S, q / L.Lf)];
      mode = "fast";
    } else {
      /* Zoom toward London while night falls. The console opens out of London. What is left
         of the map rolls back up and parks as the small globe at the top right. */
      const pz = seg(q, L.Lf, L.Lf + L.Lz);
      const f1 = flatState(S, 1);
      const Sm = K.small;
      const z = ease(seg(pz, 0.02, 0.55));
      const Rz = f1.R * Math.pow(mob ? 2.4 : 4, z);
      const dl = arc(LONDON[0] - f1.l0) * D2R;
      const ph = LONDON[1] * D2R;
      const Lx = lerp(f1.cx + f1.R * dl, K.screen.cx, z);
      const Ly = lerp(f1.cy - f1.R * ph, K.screen.cy, z);
      const night = smooth(seg(pz, 0.15, 0.5));
      const r = ease(seg(pz, 0.58, 0.98));
      const g = Object.assign(f1, { R: Rz, cx: Lx - Rz * dl, cy: Ly + Rz * ph, pp: 1 - night });
      if (r > 0) {
        const st = focus("street");
        const k = seg(r, 0.8, 1);
        g.u = 1 - ease(seg(r, 0.1, 0.8));
        g.disc = 1 - clamp(g.u / 0.3);
        g.rim = k;
        g.R = Rz * Math.pow(Sm.R / Rz, r);
        g.cx = lerp(g.cx, Sm.cx, r);
        g.cy = lerp(g.cy, Sm.cy, r);
        g.l0 = f1.l0 + arc(st.l0 - f1.l0) * r;
        g.lat = st.lat * k;
        g.hl = 1 - r;
        g.w = mixArr(W_ALL, st.w, r);
        g.b = mixArr(B_ONE, st.b, r);
        g.a = 1 - 0.5 * Math.sin(PI * r);
      }
      if (q >= L.Lf + L.Lz) {
        const gp = seg(q, L.Lf + L.Lz, L.P5);
        g.l0 += gp * 16;
        mode = "fast";
      }
      specs = [g];
    }
  } else {
    /* To the close. Desktop: the small globe drops down the right side, clear of the copy,
       sets below the frame and comes back along the bottom as the whole Earth, data to
       photograph while it is low. Phone: the copy is full width, so the small globe
       dissolves and the Earth rises with the closing section. */
    const st = focus("street");
    const Sm = K.small;
    const Wh = K.whole;
    if (y < L.T6) {
      const t = seg(y, L.T5 + L.P5, L.T6);
      if (mob) {
        const a = 1 - smooth(seg(t, 0, 0.3));
        if (a > 0.003) specs.push(G({ cx: Sm.cx, cy: Sm.cy, R: Sm.R, l0: st.l0 + 16, lat: st.lat, w: st.w, b: st.b, a }));
        rend.push({ img: S.wholeImg, cx: Wh.cx, cy: Wh.cy + (L.T6 - y), s: (2 * Wh.R) / DISC0, a: 1 });
      } else {
        const d = {
          cx: lerp(Sm.cx, Wh.cx, Math.pow(t, 5)),
          cy: lerp(Sm.cy, Wh.cy, 1 - Math.pow(1 - t, 2.2)),
          R: lerp(Sm.R, Wh.R, Math.pow(t, 3.2)),
        };
        const k = smooth(seg(t, 0.1, 0.55));
        const ra = smooth(seg(t, 0.55, 0.7));
        const da = 1 - smooth(seg(t, 0.7, 0.86));
        if (ra > 0.003) rend.push({ img: S.wholeImg, cx: d.cx, cy: d.cy, s: (2 * d.R) / DISC0, a: ra });
        if (da > 0.003) {
          specs.push(
            G({
              cx: d.cx,
              cy: d.cy,
              R: d.R,
              l0: st.l0 + 16 + arc(WHOLE_C[0] - st.l0 - 16) * k,
              lat: lerp(st.lat, WHOLE_C[1], k),
              pk: PK0 * k,
              w: mixArr(st.w, W_ALL, k),
              b: mixArr(st.b, B_ONE, k),
              a: da,
              rim: 1 - ra,
            }),
          );
        }
      }
    } else {
      const d = mixK(Wh, K.whole2, smooth(seg(y, L.T6, L.maxY)));
      rend.push({ img: S.wholeImg, cx: d.cx, cy: d.cy, s: (2 * d.R) / DISC0, a: 1 });
    }
  }
  return { rend, specs, mode };
}

/**
 * Ease the globe's facing and its layer weights over TIME when the target steps (the lens
 * moving to the next place, the band moving to the next card). Scroll alone would snap them.
 *
 * Returns a function that mutates the spec it is given and reports whether it is still
 * moving, so the loop knows to keep running after the scroll has settled.
 */
export function createFocusEaser(): {
  apply: (g: GlobeSpec, dt: number, mode: FocusMode) => boolean;
  reset: () => void;
} {
  let on = false;
  let l0 = 0;
  let lat = 0;
  const w = new Float32Array(NL + 1);
  const b = new Float32Array(NL + 1);
  return {
    reset() {
      on = false;
    },
    apply(g, dt, mode) {
      if (!on || mode === "snap") {
        on = true;
        l0 = g.l0;
        lat = g.lat;
        w.set(g.w);
        b.set(g.b);
        return false;
      }
      const k = 1 - Math.exp(-dt / (mode === "slow" ? 240 : 80));
      const dl = arc(g.l0 - l0);
      const dp = g.lat - lat;
      let far = Math.abs(dl) > 0.08 || Math.abs(dp) > 0.08;
      l0 += dl * k;
      lat += dp * k;
      for (let i = 0; i <= NL; i++) {
        const dw = g.w[i] - w[i];
        const db = g.b[i] - b[i];
        if (Math.abs(dw) > 0.006 || Math.abs(db) > 0.006) far = true;
        w[i] += dw * k;
        b[i] += db * k;
      }
      if (!far) {
        l0 = g.l0;
        lat = g.lat;
        w.set(g.w);
        b.set(g.b);
      }
      g.l0 = l0;
      g.lat = lat;
      g.w = w;
      g.b = b;
      return far;
    },
  };
}

/* ------------------------------------------------------------------ reduced motion: the stills */

/**
 * The static globes of the reduced-motion page, drawn once each into an in-flow canvas.
 * `kind` is "all" for the inset globe, or 0..3 for one of the four separations.
 */
export function staticGlobe(kind: "all" | 0 | 1 | 2 | 3, w: number, h: number): GlobeSpec {
  if (kind === "all") {
    return G({ cx: w / 2, cy: h / 2, R: w / 2 - Math.max(10, w * 0.06), l0: INSET_C[0], lat: INSET_C[1], rim: 0.8 });
  }
  return G({ cx: w / 2, cy: h / 2, R: w / 2 - 12, l0: SEP_ROT[kind].l0, lat: SEP_ROT[kind].lat, rim: 0.8, w: W_FAM[kind], b: B_FAM[kind] });
}

/** The flat map of the reduced-motion page: unrolled, paper inks, cameras forward. */
export function staticFlatMap(w: number, h: number, mob: boolean): GlobeSpec {
  return G({ cx: w / 2, cy: h / 2, R: (mob ? w * 1.5 : w * 0.98) / TAU, l0: mob ? -60 : -10, u: 1, pp: 1, hl: 1, disc: 0, rim: 0 });
}

/* ------------------------------------------------------------------ review marks */

/**
 * Named scroll positions, one per moment of the page. The review screenshots and the e2e
 * tests go to a moment by name instead of by a pixel count that moves with the viewport.
 */
export function marks(S: Stage): Record<string, number> {
  const { H, L } = S;
  const fl = (t: number) => H * 0.08 + t * (L.T2 - H * 0.08);
  const pin2 = (p: number) => L.T2 + p * L.P2;
  const dz = (p: number) => L.T5 + L.Lf + p * L.Lz;
  const ds = (p: number) => L.T5 + L.Lf + L.Lz + p * L.Ls;
  const toClose = (p: number) => L.T5 + L.P5 + (L.T6 - L.T5 - L.P5) * p;
  const travel = L.band.travel;
  return {
    hero: 0,
    flight: fl(0.5),
    "flight-late": fl(0.66),
    inset: pin2(0.07),
    "split-mid": pin2(0.31),
    split: pin2(0.66),
    merge: L.T2 + L.P2 + H * 0.36,
    centre: L.T3 - 2,
    "iris-a": L.T3 + 0.22 * H,
    iris: L.A1 + (L.B1 - L.A1) * 0.3,
    camera: L.T3 + 1.4 * H,
    "volcano-iris": L.I2s + (L.I2e - L.I2s) * 0.5,
    volcano: L.I2e + 0.2 * H,
    plane: L.I3e + 0.25 * H,
    "to-band": (L.L1 + L.T4) / 2,
    band0: L.tStart,
    band: L.tStart + travel * 0.42,
    "band-end": L.tStart + travel,
    "to-flat": (L.bandEnd + L.T5) / 2,
    "unroll-mid": L.T5 + L.Lf * 0.27,
    "unroll-late": L.T5 + L.Lf * 0.38,
    flat: L.T5 + L.Lf * 0.9,
    zoom: dz(0.36),
    handoff: dz(0.68),
    street1: ds(0.08),
    street2: ds(0.48),
    street3: ds(0.92),
    "to-close": toClose(0.34),
    "to-close-late": toClose(0.9),
    close: L.T6,
    footer: L.maxY,
  };
}
