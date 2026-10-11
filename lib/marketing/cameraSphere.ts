import type * as THREE from "three";

/**
 * THE CAMERA SPHERE: road-camera stills tiled onto a ball, the motion from the
 * LBSiUK/provenance-sphere-animation sketch, ported to run inside the landing page.
 *
 * Two halves, and only the second touches a browser:
 *
 *   layout + timing   pure functions (`layoutTiles`, `fillTimes`, `SHRINK_EASE`, `logLerp`).
 *                     They decide where each screen sits on the ball and when it lights, and a
 *                     node unit test can run them.
 *   renderer          `createCameraSphere`. It imports three.js DYNAMICALLY, so the page's first
 *                     bundle does not carry it, and it only ever paints the canvas it is handed.
 *                     It adds no listener of any kind: the caller owns the clock and the loop, so
 *                     the landing page's one-scroll-subscriber rule holds.
 *
 * WHAT THE SKETCH SETTLED, AND THIS KEEPS (2026-10-08): 4:3 screens with rounded corners and a
 * soft vignette, no scanlines; each screen is a latitude/longitude cell, so it bends round the
 * ball like webglsamples.org/imagesphere; the camera sits at 2.08 radii with a 62 degree lens and
 * never moves; the size and position of the ball on screen are a lens zoom plus a shift of the
 * picture on the film, so the bend is the same at every size; the first screen is dead centre and
 * the fill spreads outwards, 0.5 s then 0.375 s then each gap 15% shorter, never under 0.025 s,
 * each screen fading in over 0.225 s.
 *
 * THE STILLS ARE A DATED SNAPSHOT (lib/marketing/sphere-stills.data.ts). Nothing here fetches a
 * camera, and no caller may label the sphere "live".
 */

const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ the settled numbers */

export const SPHERE_EYE = 2.08;
export const SPHERE_FOV = 62;
export const SCREEN_DEG = 17;
export const ENV_INTENSITY = 0.1;
export interface FillTiming {
  readonly gap0: number;
  readonly gap1: number;
  readonly ratio: number;
  readonly floor: number;
  readonly fade: number;
}
export const FILL: FillTiming = { gap0: 0.5, gap1: 0.375, ratio: 0.85, floor: 0.025, fade: 0.225 };

/** Half the angle of the ball the camera can see, in degrees: the horizon. */
export const SPHERE_CAP = Math.acos(1 / SPHERE_EYE) / D2R;

/** The ball's radius as a share of half the frame height, at zoom 1. */
export const SPHERE_BASE = Math.tan(Math.asin(1 / SPHERE_EYE)) / Math.tan((SPHERE_FOV / 2) * D2R);

/* ------------------------------------------------------------------ pure helpers */

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** A seeded PRNG (mulberry32), so the shuffle of stills is the same on every visit. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress. */
export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  /* A halving search, not Newton's method. X(t) rises for every handle in 0..1, so halving always
     finds t, and it does not wander where the slope is nearly flat, which Newton's step does on a
     strong ease-in such as (.8, 0, .16, 1). 30 halvings is far below a pixel. */
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const target = x;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (X(m) < target) lo = m;
      else hi = m;
    }
    return Y((lo + hi) / 2);
  };
}

/** The drop into the O: slow off the mark, very fast through the middle, settling into the O. */
export const SHRINK_EASE = cubicBezier(0.7, 0, 0.16, 1);

/** Interpolate a size on a log scale, so a shrink from 900 px to 30 px looks even. */
export function logLerp(a: number, b: number, k: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
}

/* ------------------------------------------------------------------ layout + timing */

export interface TileSpec {
  /** Centre of the screen on the ball, degrees. */
  readonly lat: number;
  readonly lon: number;
  /** Angle from the point of the ball facing the camera, degrees. */
  readonly ang: number;
  /** Which still it shows, an index into the stills the renderer was given. */
  readonly still: number;
  /** When it starts to fade in, seconds from the start of the fill. */
  readonly t0: number;
}

export interface LayoutOptions {
  /** Screen width in degrees of the ball. */
  screenDeg?: number;
  /** "front" covers only the half the camera sees (the sketch); "full" covers the whole ball, for
      a sphere that turns. */
  coverage?: "front" | "full";
  stillCount: number;
  seed?: number;
}

/**
 * Where each screen sits and when it lights, nearest the centre first. Gaps are 1/8 of a screen,
 * odd rows are shifted half a screen, and the order has a little jitter so the spread is not a
 * perfect ring.
 */
export function layoutTiles(opts: LayoutOptions): TileSpec[] {
  const CW = opts.screenDeg ?? SCREEN_DEG;
  const CH = CW * 0.75;
  const G = CW / 8;
  const full = opts.coverage === "full";
  const n = Math.max(1, opts.stillCount);
  const r = rng(opts.seed ?? 3);
  const order = Array.from({ length: n }, (_, i) => i).sort(() => r() - 0.5);
  const front = { x: 0, y: 0, z: 1 };
  const raw: Array<{ lat: number; lon: number; ang: number; still: number; d: number }> = [];
  let k = 0;
  const rows = Math.ceil((full ? 90 : SPHERE_CAP + 20) / (CH + G));
  for (let row = -rows; row <= rows; row++) {
    const lat = row * (CH + G);
    if (Math.abs(lat) + CH / 2 > 89) continue;
    /* The longitudes of this row. The front half (the sketch) keeps a fixed step and shifts odd
       rows half a screen. A full ball closes each row on itself, so a row near a pole, which
       has less room, gets fewer screens spaced wider rather than screens that overlap. */
    const lons: number[] = [];
    if (full) {
      const count = Math.max(1, Math.floor((360 * Math.cos(lat * D2R)) / (CW + G)));
      const step = 360 / count;
      const off = (Math.abs(row) % 2) * (step / 2);
      for (let i = 0; i < count; i++) lons.push(-180 + off + i * step);
    } else {
      const off = (Math.abs(row) % 2) * ((CW + G) / 2);
      const cols = Math.ceil((SPHERE_CAP + 30) / (CW + G)) + 1;
      for (let col = -cols; col <= cols; col++) lons.push(col * (CW + G) + off);
    }
    for (const lon of lons) {
      const cx = Math.cos(lat * D2R) * Math.sin(lon * D2R);
      const cy = Math.sin(lat * D2R);
      const cz = Math.cos(lat * D2R) * Math.cos(lon * D2R);
      const ang = Math.acos(Math.max(-1, Math.min(1, cx * front.x + cy * front.y + cz * front.z))) / D2R;
      if (!full && ang > SPHERE_CAP + CW * 0.7) continue;
      raw.push({ lat, lon, ang, still: order[k++ % n], d: 0 });
    }
  }
  const rr = rng(9);
  for (const t of raw) t.d = t.ang + rr() * CW * 0.12;
  raw.sort((p, q) => p.d - q.d);
  const times = fillTimes(raw.length);
  return raw.map((t, i) => ({ lat: t.lat, lon: t.lon, ang: t.ang, still: t.still, t0: times[i] }));
}

/** The start time of each of `n` screens: 0, 0.5, 0.875, then each gap 15% shorter, floored. */
export function fillTimes(n: number, f: Partial<FillTiming> = {}): number[] {
  const { gap0, gap1, ratio, floor } = { ...FILL, ...f };
  const out: number[] = [];
  let time = 0;
  let gap = gap0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      time += gap;
      gap = i === 1 ? gap1 : Math.max(floor, gap * ratio);
    }
    out.push(time);
  }
  return out;
}

/* ------------------------------------------------------------------ measuring the O */

export interface Circle {
  x: number;
  y: number;
  /** Outer edge of the O's ink. */
  rOuter: number;
  /** Inside of the O's counter, a little short of the stroke so the ball never touches it. */
  rInner: number;
}

/**
 * The O's ink, measured from the rendered wordmark: its centre from the letter's box and the
 * baseline, its height from the font's own ink bounds. `baseline` is a zero-size inline element
 * after the text, which sits on the baseline. Coordinates are relative to `host`'s box.
 *
 * `strokeShare` is the O's stroke as a share of its height: about .135 for Archivo caps at 560.
 */
export function measureLetterO(
  host: HTMLElement,
  letter: HTMLElement,
  baseline: HTMLElement,
  strokeShare = 0.135,
): Circle {
  const st = host.getBoundingClientRect();
  const box = letter.getBoundingClientRect();
  const baseY = baseline.getBoundingClientRect().top;
  const cs = getComputedStyle(letter);
  const g = document.createElement("canvas").getContext("2d");
  let ascent = box.height * 0.72;
  let descent = 0;
  if (g) {
    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = g.measureText(letter.textContent || "O");
    ascent = m.actualBoundingBoxAscent;
    descent = m.actualBoundingBoxDescent;
  }
  const top = baseY - ascent;
  const bottom = baseY + descent;
  const h = bottom - top;
  const stroke = h * strokeShare;
  return {
    x: box.left + box.width / 2 - st.left,
    y: (top + bottom) / 2 - st.top,
    rOuter: h / 2,
    rInner: h / 2 - stroke - h * 0.03,
  };
}

/* ------------------------------------------------------------------ the renderer */

export interface CameraSphereOptions {
  canvas: HTMLCanvasElement;
  /** Image URLs, served from this origin. Ones that fail to load are dropped. */
  stills: readonly string[];
  screenDeg?: number;
  coverage?: "front" | "full";
  /** "full" is the sketch: a clear-coated screen lit by a soft room, plus a faint bloom.
      "lite" is a flat emissive screen with no environment and no bloom, for small instances and
      for weak GPUs. */
  quality?: "full" | "lite";
  /** Transparent canvas, so the page's own ground shows round the ball. Turns bloom off, because
      the bloom pass writes an opaque frame. */
  transparent?: boolean;
  /** Ground colour when not transparent. */
  background?: number;
  /** Device pixel ratio cap. */
  maxDpr?: number;
  /** Strength of the soft room the screens reflect ("full" only). Tuned so three.js 0.186 matches
      the sketch's look on 0.160, whose room was dimmer. */
  envIntensity?: number;
  seed?: number;
  /** Called if the WebGL context is lost. The caller should hide the canvas and show its still. */
  onContextLost?: () => void;
}

export interface CameraSphere {
  readonly tiles: readonly TileSpec[];
  /** Start time of the last screen, seconds. The fill is complete at `lastT0 + FILL.fade`. */
  readonly lastT0: number;
  /** The canvas's size in CSS px, and the pixel ratio. Call after any layout change. */
  resize(width: number, height: number, dpr?: number): void;
  /** Put the ball's silhouette at (cx, cy) with radius r, all in CSS px of the canvas. */
  placeBall(r: number, cx: number, cy: number): void;
  /** Light the screens as they would be `t` seconds into the fill, times an overall alpha.
      Returns how many have started. */
  setFill(t: number, alpha?: number): number;
  /** Set one screen's opacity directly, for a caller with its own order. */
  setTileOpacity(i: number, a: number): void;
  /** Turn the ball. Radians: yaw about the vertical axis, then pitch. */
  setRotation(yaw: number, pitch?: number): void;
  render(): void;
  /** Free everything. `loseContext` also hands the WebGL context back to the browser at once,
      for a caller that made its own canvas and is done with it. Leave it off when the canvas
      may get a new sphere (React strict mode mounts twice on one canvas, and a canvas has only
      one context, so losing it would blank the second sphere). */
  dispose(loseContext?: boolean): void;
}

/** True if this browser will give us a WebGL context at all. Cheap, and asks for no GPU work. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const im = new Image();
    im.decoding = "async";
    /* Below the page's own images: the hero still is fetched at high priority and must stay first. */
    im.fetchPriority = "low";
    im.onload = () => ok(im);
    im.onerror = () => no(new Error(`${src} failed to load`));
    im.src = src;
  });
}

/** One still, drawn as a screen: rounded 4:3, a soft vignette and a faint rim. */
function screenCanvas(im: HTMLImageElement): HTMLCanvasElement {
  const w = 640;
  const h = 480;
  const r = 34;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  g.beginPath();
  g.roundRect(0, 0, w, h, r);
  g.clip();
  g.drawImage(im, 0, 0, w, h);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.52);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,.42)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.lineWidth = 6;
  g.strokeStyle = "rgba(205,212,225,.3)";
  g.beginPath();
  g.roundRect(3, 3, w - 6, h - 6, r - 2);
  g.stroke();
  return c;
}

/**
 * Build the ball on `canvas`. Resolves once three.js and the stills have arrived and the first
 * frame can be drawn; rejects if WebGL is refused or no still loads, and the caller then keeps
 * its fallback.
 */
export async function createCameraSphere(opts: CameraSphereOptions): Promise<CameraSphere> {
  const [T, stills] = await Promise.all([
    import("three"),
    Promise.allSettled(opts.stills.map(loadImage)).then((rs) =>
      rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    ),
  ]);
  if (!stills.length) throw new Error("no camera still loaded");

  const quality = opts.quality ?? "full";
  const transparent = !!opts.transparent;
  const useBloom = quality === "full" && !transparent;
  const CW = opts.screenDeg ?? SCREEN_DEG;
  const CH = CW * 0.75;

  const renderer = new T.WebGLRenderer({
    canvas: opts.canvas,
    antialias: true,
    alpha: transparent,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  if (transparent) renderer.setClearColor(0x000000, 0);

  const scene = new T.Scene();
  if (!transparent) scene.background = new T.Color(opts.background ?? 0x000000);

  let pmrem: THREE.PMREMGenerator | null = null;
  if (quality === "full") {
    const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
    pmrem = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = opts.envIntensity ?? ENV_INTENSITY;
    room.dispose();
  }

  const camera = new T.PerspectiveCamera(SPHERE_FOV, 1, 0.05, 100);
  camera.position.set(0, 0, SPHERE_EYE);
  camera.lookAt(0, 0, 0);

  type Composer = { render(): void; setSize(w: number, h: number): void; setPixelRatio(r: number): void; dispose(): void };
  let composer: Composer | null = null;
  if (useBloom) {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
    ]);
    const c = new EffectComposer(renderer);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new T.Vector2(1, 1), 0.25, 0.5, 0.8));
    c.addPass(new OutputPass());
    composer = c;
  }

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures = stills.map((im) => {
    const t = new T.CanvasTexture(screenCanvas(im));
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  });

  const tiles = layoutTiles({
    screenDeg: CW,
    coverage: opts.coverage,
    stillCount: textures.length,
    seed: opts.seed,
  });

  const ball = new T.Group();
  scene.add(ball);
  const materials: Array<THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial> = [];
  const geometries: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[] = [];
  for (const t of tiles) {
    const geo = new T.PlaneGeometry(1, 1, 32, 24);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lon = (t.lon + pos.getX(i) * CW) * D2R;
      const lat = (t.lat + pos.getY(i) * CH) * D2R;
      pos.setXYZ(i, Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
    }
    geo.computeVertexNormals();
    const tex = textures[t.still];
    const mat =
      quality === "full"
        ? new T.MeshPhysicalMaterial({
            map: tex,
            color: 0x0a0a0a,
            emissive: 0xffffff,
            emissiveMap: tex,
            emissiveIntensity: 1,
            roughness: 0.5,
            metalness: 0,
            clearcoat: 0.35,
            clearcoatRoughness: 0.25,
            envMapIntensity: 0.12,
            transparent: true,
            opacity: 0,
            side: T.FrontSide,
          })
        : new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, side: T.FrontSide });
    const mesh = new T.Mesh(geo, mat);
    mesh.visible = false;
    ball.add(mesh);
    geometries.push(geo);
    materials.push(mat);
    meshes.push(mesh);
  }

  let W = 1;
  let H = 1;
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    opts.onContextLost?.();
  };
  opts.canvas.addEventListener("webglcontextlost", onLost);

  const sphere: CameraSphere = {
    tiles,
    lastT0: tiles.length ? tiles[tiles.length - 1].t0 : 0,
    resize(width, height, dpr = window.devicePixelRatio || 1) {
      W = Math.max(1, width);
      H = Math.max(1, height);
      const ratio = Math.min(dpr, opts.maxDpr ?? 2);
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
      if (composer) {
        composer.setPixelRatio(ratio);
        composer.setSize(W, H);
      }
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    },
    placeBall(r, cx, cy) {
      camera.zoom = Math.max(1e-4, r / ((H / 2) * SPHERE_BASE));
      camera.updateProjectionMatrix();
      const e = camera.projectionMatrix.elements;
      e[8] = -(cx - W / 2) / (W / 2);
      e[9] = (cy - H / 2) / (H / 2);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },
    setFill(t, alpha = 1) {
      let lit = 0;
      for (let i = 0; i < tiles.length; i++) {
        if (t >= tiles[i].t0) lit++;
        sphere.setTileOpacity(i, smoothstep(tiles[i].t0, tiles[i].t0 + FILL.fade, t) * alpha);
      }
      return lit;
    },
    setTileOpacity(i, a) {
      const m = materials[i];
      if (!m) return;
      m.opacity = a;
      meshes[i].visible = a > 0.001;
    },
    setRotation(yaw, pitch = 0) {
      ball.rotation.set(pitch, yaw, 0, "XYZ");
    },
    render() {
      if (lost) return;
      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
    dispose(loseContext = false) {
      opts.canvas.removeEventListener("webglcontextlost", onLost);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      composer?.dispose();
      if (scene.environment) scene.environment.dispose();
      pmrem?.dispose();
      renderer.dispose();
      if (loseContext) renderer.forceContextLoss();
    },
  };
  return sphere;
}
