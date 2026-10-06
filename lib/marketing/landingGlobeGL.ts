/**
 * The landing globe's dots and lines, drawn with WebGL.
 *
 * WHY THIS EXISTS. `landingGlobe.ts` strokes the land, the cables and 20,000 dots on a 2D
 * canvas. Chrome sends a 2D path that large down its slow route: it paints the shape on the
 * CPU, in the GPU process, and uploads the result as a picture. On a 120 Hz laptop the page
 * ran at 8 to 48 frames per second, and the page's own paint timer showed about 10 ms,
 * because the time was spent in another process (trace of 2026-10-06: GPU process 92% busy,
 * 82% of frames dropped). Here the points go to the graphics card ONCE, as longitude and
 * latitude. A frame sends a handful of numbers and the vertex shader does the projection.
 *
 * WHAT IT DRAWS, AND WHAT IT LEAVES. Only what `drawContent` draws: the land tone, the coasts,
 * the cables and the dots. The 2D canvas under this one keeps the stills, the ocean discs,
 * the rims and the bezels. `LandingStage.tsx` calls `paint(..., false)` and then `draw` here.
 * It touches no DOM: it is handed a context, as the 2D painter is.
 *
 * EVERY SET IS ONE SHAPE, NOT A SUM. The 2D painter strokes all the dots of a layer as one
 * path and all the cables as one path. One path is one shape: a hundred cameras on one city
 * are drawn at one alpha. If each dot is blended by itself, every city burns to white. So a
 * set is first GATHERED in an offscreen target. A fragment writes the set's strength with
 * its coverage as the mix,
 *
 *     new = strength * cover + old * (1 - cover)
 *
 * which climbs to the strength and never past it. Each set has a colour channel of the
 * target to itself, and one pass then puts the channels on the canvas in their colours.
 *
 * BUT TWO LAYERS DO ADD, AS THEY DO IN 2D. The 2D painter strokes each layer of dots as its
 * own path, with "lighter" on the night globe, so a quake on a wildfire is brighter than
 * either. A channel shared by a whole family lost that light: on a small globe, where the
 * layers sit on each other, it was about 1% of all the light (measured with
 * `scripts/landing-look.mjs`), and on paper the family order was not the layer order. So
 * every LAYER has its own channel: four layers are gathered, put on the canvas, and the
 * target is used again for the next four.
 *
 * ONE EXCEPTION, COPIED FROM CHROME ON PURPOSE. A stroke thinner than one device pixel is a
 * hairline in Chrome's 2D canvas, and a hairline is drawn segment by segment, so cables on
 * one route build up and the busy routes read brighter. The design was approved looking at
 * that, so a line set under one pixel wide is gathered the same way here (`hair`).
 *
 * THE LOOK COMES FROM ONE TABLE. Every width, alpha, size and colour is read from
 * `contentStyle` in `landingGlobe.ts`, the same call the 2D painter makes. Do not put a
 * style number in this file.
 *
 * IF ANYTHING HERE FAILS, THE PAGE STILL DRAWS. `createGlobeGL` returns null when the
 * context lacks something this needs, and `draw` throws when the target cannot be made.
 * `LandingStage.tsx` then hides this canvas and the 2D painter draws the dots and lines as
 * it did before. `tests/e2e/landing.spec.ts` checks that path with WebGL blocked.
 */
import {
  BUCKET,
  DISC0,
  HALO_WIDTH,
  LAYERS,
  clamp,
  contentStyle,
  globeView,
  type ContentStyle,
  type GlobeData,
  type GlobeSpec,
  type Poly,
  type Still,
} from "./landingGlobe";

/* ------------------------------------------------------------------ shaders */

const glf = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/* The projection of `landingGlobe.ts` (`project`), line for line. u = 0 is the sphere,
   u > 0 the unroll. It returns 1 when the point is on the near side. */
const PROJECT = `
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
uniform vec4 uV0; // cx, cy, Rz, sc (CSS px)
uniform vec4 uV1; // pk, l0, cT, sT
uniform vec3 uV2; // u, a, k
uniform vec3 uRes; // W, H (CSS px), device pixel ratio
float project(vec2 ll, out vec2 p, out float z) {
  float l = ll.x - uV1.y;
  l -= TAU * floor((l + PI) / TAU);
  float cph = cos(ll.y);
  float sph = sin(ll.y);
  if (uV2.x <= 0.0) {
    float cl = cos(l);
    float zz = uV1.w * sph + uV1.z * cph * cl;
    float k = uV0.w / (1.0 - uV1.x * zz);
    p = vec2(uV0.x + k * cph * sin(l), uV0.y - k * (uV1.z * sph - uV1.w * cph * cl));
    z = (zz - uV1.x) / (1.0 - uV1.x);
    return zz > uV1.x ? 1.0 : 0.0;
  }
  float rho = cph + (1.0 - cph) * uV2.y;
  float Y = sph + (ll.y - sph) * uV2.y;
  if (uV2.z < 1e-4) {
    p = vec2(uV0.x + uV0.z * rho * l, uV0.y - uV0.z * Y);
    z = 1.0;
    return 1.0;
  }
  float th = l * uV2.z;
  float Z = cos(th);
  p = vec2(uV0.x + (uV0.z * rho * sin(th)) / uV2.z, uV0.y - uV0.z * Y);
  z = Z * rho;
  return Z > 0.0 ? 1.0 : 0.0;
}
vec4 toClip(vec2 p) { return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }
`;

/* A dot is a point sprite. `uDot.y` is its radius as a share of the core diameter: 0.5 for
   the core, half of HALO_WIDTH for the halo. The depth bands are BUCKET. */
const DOT_VS = `
attribute vec2 aLL;
${PROJECT}
uniform vec4 uDot;  // core diameter at the front (CSS px), radius share, largest point the GPU draws
uniform vec4 uClip; // lens centre x, y (CSS px), lens radius (device px), 1 when the lens is on
varying vec2 vRel;
varying float vRad;
varying float vSide;
varying float vInk;
void main() {
  vec2 p; float z;
  float near = project(aLL, p, z);
  if (near < 0.5 || p.x < -8.0 || p.y < -8.0 || p.x > uRes.x + 8.0 || p.y > uRes.y + 8.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float band = min(3.0, floor(z * 4.0));
  float shrink = band < 0.5 ? ${glf(BUCKET[0])} : band < 1.5 ? ${glf(BUCKET[1])} : band < 2.5 ? ${glf(BUCKET[2])} : ${glf(BUCKET[3])};
  float rad = uDot.x * shrink * uRes.z * uDot.y;
  /* The edge of a disc is a one-pixel ramp. On a disc under a pixel across, that ramp is
     more ink than the disc's area. Take the extra back, or small globes come out too bright. */
  float a = max(0.0, rad - 0.5);
  float e = rad + 0.5;
  float k = rad * rad / (a * a + 2.0 * (e * e * e / 6.0 - a * a * e / 2.0 + a * a * a / 3.0));
  vInk = mix(k, 1.0, clamp(rad - 0.5, 0.0, 1.0));
  vRad = rad;
  vSide = min(2.0 * rad + 2.0, uDot.z);
  vRel = (p - uClip.xy) * uRes.z;
  gl_PointSize = vSide;
  gl_Position = toClip(p);
}`;

/* GATHER: colour = the set's strength, alpha = the dot's coverage. The blend does the rest. */
const DOT_FS = `
precision highp float;
uniform vec4 uClipF; // strength, lens radius (device px), 1 when the lens is on
varying vec2 vRel;
varying float vRad;
varying float vSide;
varying float vInk;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vSide;
  float cover = clamp(vRad + 0.5 - length(q), 0.0, 1.0) * vInk;
  if (uClipF.z > 0.5) cover *= clamp(uClipF.y + 0.5 - length(vRel + q), 0.0, 1.0);
  gl_FragColor = vec4(vec3(uClipF.x), cover);
}`;

/* A line segment is a capsule: the quad is longer than the segment by the half width at each
   end, and the fragment measures its distance to the segment. That is the round cap and the
   round join of the 2D stroke. */
const LINE_VS = `
attribute vec4 aSeg;    // lon A, lat A, lon B, lat B (radians)
attribute vec2 aCorner; // 0 or 1 along the segment, -1 or +1 across it
${PROJECT}
uniform vec4 uLine; // half width (device px), seam limit (CSS px)
uniform vec4 uClip;
varying vec2 vQ;    // along from A, across (device px)
varying float vLen; // device px
varying vec2 vRel;
void main() {
  vec2 pa; vec2 pb; float za; float zb;
  float nearA = project(aSeg.xy, pa, za);
  float nearB = project(aSeg.zw, pb, zb);
  vec2 d = pb - pa;
  float len = length(d);
  /* A segment that jumps most of the flat map is the wrap at the seam, not a line. */
  if (nearA < 0.5 || nearB < 0.5 || abs(d.x) > uLine.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 t = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float reach = uLine.x + 0.5;
  float along = mix(-reach, len * uRes.z + reach, aCorner.x);
  vec2 p = pa + t * (along / uRes.z) + n * (aCorner.y * reach / uRes.z);
  vQ = vec2(along, aCorner.y * reach);
  vLen = len * uRes.z;
  vRel = (p - uClip.xy) * uRes.z;
  gl_Position = toClip(p);
}`;

const LINE_FS = `
precision highp float;
uniform vec4 uLineF; // half width (device px), lens radius (device px), 1 when the lens is on, strength
uniform vec2 uThin;  // x: takes back the extra ink of a line under a pixel wide. y: 1 = hairline
varying vec2 vQ;
varying float vLen;
varying vec2 vRel;
void main() {
  float lens = 1.0;
  if (uLineF.z > 0.5) lens = clamp(uLineF.y + 0.5 - length(vRel), 0.0, 1.0);
  if (uThin.y > 0.5) {
    /* HAIRLINE: flat ends, so two segments of one line share their joint and do not bead.
       The value is the finished alpha, and the blend lets lines on one route build up. */
    float along = clamp(min(vQ.x + 0.5, vLen) - max(vQ.x - 0.5, 0.0), 0.0, 1.0);
    float c = clamp(uLineF.x + 0.5 - abs(vQ.y), 0.0, 1.0) * along * uThin.x * lens;
    gl_FragColor = vec4(uLineF.w * c);
    return;
  }
  float past = max(0.0, max(-vQ.x, vQ.x - vLen));
  float cover = clamp(uLineF.x + 0.5 - length(vec2(past, vQ.y)), 0.0, 1.0) * uThin.x * lens;
  gl_FragColor = vec4(vec3(uLineF.w), cover);
}`;

/* One triangle over the whole canvas. `vUv` is where this pixel is in the target, which is
   the size of the canvas. It is a varying and not `gl_FragCoord` on purpose: WebGL 1 declares
   `gl_FragCoord` mediump whatever the shader asks for, and mediump on a phone GPU can be a
   16-bit float, which cannot tell two pixels apart past column 1024. */
const FULL_VS = `
attribute vec2 aP;
varying vec2 vUv;
void main() {
  vUv = aP * 0.5 + 0.5;
  gl_Position = vec4(aP, 0.0, 1.0);
}`;

/* The gathered lines onto the canvas: the cables over the coasts over the land tone, the
   order the 2D painter strokes them in. Premultiplied. */
const LINES_OUT_FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec4 uLand;  // rgb, alpha
uniform vec4 uCoast; // rgb, alpha
uniform vec4 uCable; // rgb, alpha
varying vec2 vUv;
void main() {
  vec4 s = texture2D(uTex, vUv);
  float aL = uLand.a * s.r;
  float aC = uCoast.a * s.g;
  float aK = uCable.a * s.b;
  vec4 acc = vec4(uLand.rgb * aL, aL);
  acc = vec4(uCoast.rgb * aC, aC) + acc * (1.0 - aC);
  acc = vec4(uCable.rgb * aK, aK) + acc * (1.0 - aK);
  gl_FragColor = acc;
}`;

/** Strengths are stored times this, because a core over its own halo is up to 1.22. */
const STORE = 0.8;

/* The gathered dots onto the canvas: four layers, one in each channel, each in the colour of
   its family. */
const DOTS_OUT_FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize; // the canvas, device px
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uPaper;
uniform vec4 uDisc; // centre x, y (device px, y up), radius (device px), how opaque the 2D canvas is inside it
varying vec2 vUv;
void main() {
  vec4 s = texture2D(uTex, vUv) * ${glf(1 / STORE)};
  if (uPaper > 0.5) {
    /* On paper a dot covers what is under it, and a later layer covers an earlier one. */
    s = min(s, 1.0);
    vec4 acc = vec4(uC0 * s.r, s.r);
    acc = vec4(uC1 * s.g, s.g) + acc * (1.0 - s.g);
    acc = vec4(uC2 * s.b, s.b) + acc * (1.0 - s.b);
    acc = vec4(uC3 * s.a, s.a) + acc * (1.0 - s.a);
    gl_FragColor = acc;
  } else {
    /* On the night globe a dot is light: its colour is ADDED. Over the opaque ocean disc it
       adds no alpha, so this canvas stays clear there and the disc shows through. Where
       nothing opaque is under the dot (the flat map in the zoom) it brings its own alpha.
       That is what "lighter" does on a 2D canvas, and without it the dots on the light
       ground turn to white blobs. */
    float under = uDisc.w * clamp(uDisc.z + 0.5 - distance(vUv * uSize, uDisc.xy), 0.0, 1.0);
    float a = min(1.0, s.r + s.g + s.b + s.a);
    gl_FragColor = vec4(uC0 * s.r + uC1 * s.g + uC2 * s.b + uC3 * s.a, a * (1.0 - under));
  }
}`;

/** The shader sources and the uniforms each program is asked for. Exported for the unit test
    that fails when a name is asked for and not declared: WebGL reports that as nothing at all. */
export const GL_PROGRAMS = {
  dot: { vs: DOT_VS, fs: DOT_FS, uniforms: ["uV0", "uV1", "uV2", "uRes", "uDot", "uClip", "uClipF"], attributes: ["aLL"] },
  line: { vs: LINE_VS, fs: LINE_FS, uniforms: ["uV0", "uV1", "uV2", "uRes", "uLine", "uClip", "uLineF", "uThin"], attributes: ["aSeg", "aCorner"] },
  linesOut: { vs: FULL_VS, fs: LINES_OUT_FS, uniforms: ["uTex", "uLand", "uCoast", "uCable"], attributes: ["aP"] },
  dotsOut: { vs: FULL_VS, fs: DOTS_OUT_FS, uniforms: ["uTex", "uSize", "uC0", "uC1", "uC2", "uC3", "uPaper", "uDisc"], attributes: ["aP"] },
} as const;

/* ------------------------------------------------------------------ plain data, testable without a context */

/** Six vertices per segment, six floats per vertex: lon A, lat A, lon B, lat B, along, across. */
export function segmentVertices(P: Poly): Float32Array {
  let n = 0;
  for (let i = 1; i < P.n; i++) if (!P.brk[i]) n++;
  const out = new Float32Array(n * 36);
  const corner = [0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1];
  let o = 0;
  for (let i = 1; i < P.n; i++) {
    if (P.brk[i]) continue;
    for (let k = 0; k < 6; k++) {
      out[o++] = P.lam[i - 1];
      out[o++] = P.phi[i - 1];
      out[o++] = P.lam[i];
      out[o++] = P.phi[i];
      out[o++] = corner[k * 2];
      out[o++] = corner[k * 2 + 1];
    }
  }
  return out;
}

/** One draw of one point layer into its channel of the target. */
export interface DotPass {
  /** Index into `LAYERS`. */
  i: number;
  /** The colour: index into `FAMILIES`. */
  fam: number;
  /** Which use of the target this layer is gathered in. Four layers a round. */
  round: number;
  /** The layer's channel in that round, 0 to 3. No other layer writes to it. */
  ch: number;
  /** Core diameter at the front of the globe, CSS px. */
  size: number;
  /** Radius of this pass as a share of the core diameter. */
  share: number;
  /** What a covered pixel is raised to, already scaled for storage. Never above 1. */
  strength: number;
}

/**
 * The dot draws for one globe state: the layers in the 2D painter's draw order, four to a
 * round, and in each layer THE HALO BEFORE THE CORE.
 *
 * The 2D painter draws a halo pass (wide, faint) and a core pass per layer and adds them. A
 * pixel under a core is also under that dot's halo, so the core is gathered at
 * `alpha * (1 + halo)` and the halo at `alpha * halo`: where a core ends its halo carries on.
 * The order of the two matters because the gather can only replace: a core drawn before its
 * halo would be pulled down to the halo wherever a neighbour's halo covers it. Paper has no
 * halo pass, as in 2D, and there the draw order is which layer covers which.
 */
export function dotPasses(s: ContentStyle): DotPass[] {
  const out: DotPass[] = [];
  s.dots.forEach((d, k) => {
    const at = { i: d.i, fam: d.fam, round: (k / 4) | 0, ch: k % 4, size: d.size };
    if (s.paper) {
      out.push({ ...at, share: 0.5, strength: Math.min(1, d.alpha * STORE) });
      return;
    }
    /* A halo under one part in a hundred changes no pixel. Skipping it saves the widest sprites. */
    if (d.alpha * d.halo >= 0.01) out.push({ ...at, share: HALO_WIDTH / 2, strength: Math.min(1, d.alpha * d.halo * STORE) });
    out.push({ ...at, share: 0.5, strength: Math.min(1, d.alpha * (1 + d.halo) * STORE) });
  });
  return out;
}

/** How opaque the 2D canvas is under one globe: its ocean disc, and a still it sits on. */
export function opacityUnder(g: GlobeSpec, rend: readonly Still[]): number {
  let a = clamp(g.a * g.disc);
  for (const r of rend) {
    if (!r.img || r.a <= 0.003) continue;
    const rr = (r.s * DISC0) / 2;
    const dx = g.cx - r.cx;
    const dy = g.cy - r.cy;
    if (dx * dx + dy * dy < rr * rr) a = 1 - (1 - a) * (1 - clamp(r.a));
  }
  return a;
}

/* ------------------------------------------------------------------ the painter */

export interface GlobeGL {
  /** Upload a data set. Call it again when the data changes (a phone thins three layers). */
  setData(D: GlobeData): void;
  /** Draw one frame: every globe's lines and dots. It throws if the target cannot be made. */
  draw(W: number, H: number, dpr: number, rend: readonly Still[], specs: readonly GlobeSpec[]): void;
  /** Free everything. The context itself stays with its canvas. */
  dispose(): void;
}

/** The context this painter wants. Premultiplied, because a dot of light is colour with no alpha. */
export const GL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

/** The widest halo is about 66 device px at a device pixel ratio of 2. */
const MIN_POINT_SIZE = 96;

/* The line sets, in upload order. */
const SCAN = 0;
const SCAN_S = 1;
const COAST = 2;
const COAST_S = 3;
const CABLE = 4;

type Locs = Record<string, WebGLUniformLocation | null>;

function build(gl: WebGLRenderingContext, def: { vs: string; fs: string; uniforms: readonly string[]; attributes: readonly string[] }) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader did not compile");
    return s;
  };
  const p = gl.createProgram();
  if (!p) throw new Error("no program");
  const vs = sh(gl.VERTEX_SHADER, def.vs);
  const fs = sh(gl.FRAGMENT_SHADER, def.fs);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program did not link");
  const u: Locs = {};
  for (const n of def.uniforms) u[n] = gl.getUniformLocation(p, n);
  const a: Record<string, number> = {};
  for (const n of def.attributes) a[n] = gl.getAttribLocation(p, n);
  return { p, u, a };
}

/**
 * Make the painter on a context, or return null when the context cannot run it. Null is not
 * an error: the caller falls back to the 2D painter.
 */
export function createGlobeGL(gl: WebGLRenderingContext): GlobeGL | null {
  if (gl.isContextLost()) return null;
  /* The pass to the canvas reads the target at its own pixel, and a canvas is wider than mediump can count. */
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!hp || hp.precision <= 0) return null;
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const maxPoint = range ? range[1] : 0;
  if (maxPoint < MIN_POINT_SIZE) return null;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  let dot: ReturnType<typeof build>;
  let line: ReturnType<typeof build>;
  let linesOut: ReturnType<typeof build>;
  let dotsOut: ReturnType<typeof build>;
  try {
    dot = build(gl, GL_PROGRAMS.dot);
    line = build(gl, GL_PROGRAMS.line);
    linesOut = build(gl, GL_PROGRAMS.linesOut);
    dotsOut = build(gl, GL_PROGRAMS.dotsOut);
  } catch {
    return null;
  }

  const dotVbo = gl.createBuffer();
  const lineVbo = gl.createBuffer();
  const triVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  /* Where each point layer and each line set starts in its buffer, and how long it is. */
  let dotFirst: number[] = [];
  let dotCount: number[] = [];
  let lineFirst: number[] = [];
  let lineCount: number[] = [];
  let hasData = false;

  /* The offscreen target the sets are gathered in. The size of the canvas. */
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let tw = 0;
  let th = 0;
  function target(w: number, h: number) {
    if (w === tw && h === th) return;
    if (w > maxTex || h > maxTex) throw new Error("the canvas is larger than the largest texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok && !gl.isContextLost()) throw new Error("the offscreen target is not complete");
    tw = w;
    th = h;
  }

  function sendView(u: Locs, g: GlobeSpec, s: ContentStyle, W: number, H: number, dpr: number): number {
    const v = globeView(g);
    /* The shader works in 32-bit floats. Keep the centre longitude inside one turn. */
    let l0 = v.l0 % (Math.PI * 2);
    if (l0 > Math.PI) l0 -= Math.PI * 2;
    if (l0 < -Math.PI) l0 += Math.PI * 2;
    gl.uniform4f(u.uV0, v.cx, v.cy, v.Rz, v.sc);
    gl.uniform4f(u.uV1, v.pk, l0, v.cT, v.sT);
    gl.uniform3f(u.uV2, v.u, v.a, v.k);
    gl.uniform3f(u.uRes, W, H, dpr);
    gl.uniform4f(u.uClip, g.cx, g.cy, g.R * dpr, s.lens ? 1 : 0);
    /* The same seam rule as `strokeLines`. */
    return v.u > 0 ? v.Rz * 2.5 : 1e9;
  }

  /** GATHER: `new = strength * cover + old * (1 - cover)`, in the channels the mask leaves open. */
  function gather(strength: number) {
    gl.blendColor(0, 0, 0, strength);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.CONSTANT_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function toCanvas(prog: ReturnType<typeof build>) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.colorMask(true, true, true, true);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, triVbo);
    gl.enableVertexAttribArray(prog.a.aP);
    gl.vertexAttribPointer(prog.a.aP, 2, gl.FLOAT, false, 8, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u.uTex, 0);
  }

  function drawGlobe(g: GlobeSpec, rend: readonly Still[], W: number, H: number, dpr: number, bw: number, bh: number) {
    const s = contentStyle(g);

    /* The part of the canvas this globe can touch, in device px, y up. A sphere stays inside
       its disc plus the widest halo. The unrolling map can be anywhere. */
    let sx = 0;
    let sy = 0;
    let sw = bw;
    let sh = bh;
    if (g.u <= 0) {
      const pad = 40;
      const x0 = Math.max(0, Math.floor((g.cx - g.R - pad) * dpr));
      const x1 = Math.min(bw, Math.ceil((g.cx + g.R + pad) * dpr));
      const y0 = Math.max(0, Math.floor((g.cy - g.R - pad) * dpr));
      const y1 = Math.min(bh, Math.ceil((g.cy + g.R + pad) * dpr));
      if (x1 <= x0 || y1 <= y0) return;
      sx = x0;
      sy = bh - y1;
      sw = x1 - x0;
      sh = y1 - y0;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, sw, sh);

    /* ---- lines: the land tone in red, the coasts in green, the cables in blue */
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(line.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
    gl.enableVertexAttribArray(line.a.aSeg);
    gl.vertexAttribPointer(line.a.aSeg, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(line.a.aCorner);
    gl.vertexAttribPointer(line.a.aCorner, 2, gl.FLOAT, false, 24, 16);
    const seam = sendView(line.u, g, s, W, H, dpr);
    /* Returns true when the set was drawn as hairlines: its channel then holds the finished
       alpha, and the pass to the canvas must not multiply by the alpha again. */
    const stroke = (set: number, strength: number, widthCss: number, alpha: number): boolean => {
      if (strength <= 0.004 || alpha <= 0 || !lineCount[set]) return false;
      const hw = (widthCss * dpr) / 2;
      const hair = hw < 0.5;
      gl.uniform4f(line.u.uLine, hw, seam, 0, 0);
      gl.uniform4f(line.u.uLineF, hw, g.R * dpr, s.lens ? 1 : 0, hair ? strength * alpha : strength);
      gl.uniform2f(line.u.uThin, hair ? (2 * hw) / ((hw + 0.5) * (hw + 0.5)) : 1, hair ? 1 : 0);
      if (hair) gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
      else gather(strength);
      gl.drawArrays(gl.TRIANGLES, lineFirst[set], lineCount[set]);
      return hair;
    };
    /* In each channel the weaker Antarctic set goes first. */
    gl.colorMask(true, false, false, false);
    stroke(SCAN_S, s.south, s.scanW, s.scanA);
    const hairLand = stroke(SCAN, 1, s.scanW, s.scanA);
    gl.colorMask(false, true, false, false);
    stroke(COAST_S, s.south, s.coastW, s.coastA);
    const hairCoast = stroke(COAST, 1, s.coastW, s.coastA);
    gl.colorMask(false, false, true, false);
    const hairCable = stroke(CABLE, 1, s.cableW, s.cableA);
    gl.disableVertexAttribArray(line.a.aSeg);
    gl.disableVertexAttribArray(line.a.aCorner);

    toCanvas(linesOut);
    gl.uniform4f(linesOut.u.uLand, s.land[0] / 255, s.land[1] / 255, s.land[2] / 255, hairLand ? 1 : s.scanA);
    gl.uniform4f(linesOut.u.uCoast, s.coast[0] / 255, s.coast[1] / 255, s.coast[2] / 255, hairCoast ? 1 : s.coastA);
    gl.uniform4f(linesOut.u.uCable, s.cable[0] / 255, s.cable[1] / 255, s.cable[2] / 255, hairCable ? 1 : s.cableA);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(linesOut.a.aP);

    /* ---- dots: one channel per layer, four layers a round */
    const passes = dotPasses(s);
    const under = passes.length ? opacityUnder(g, rend) : 0;
    const colour = [dotsOut.u.uC0, dotsOut.u.uC1, dotsOut.u.uC2, dotsOut.u.uC3];
    for (let k = 0; k < passes.length; ) {
      const round = passes[k].round;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(dot.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, dotVbo);
      gl.enableVertexAttribArray(dot.a.aLL);
      gl.vertexAttribPointer(dot.a.aLL, 2, gl.FLOAT, false, 8, 0);
      sendView(dot.u, g, s, W, H, dpr);
      /* A channel no layer of this round uses stays clear, so its colour is never read. */
      const fam = [0, 0, 0, 0];
      for (; k < passes.length && passes[k].round === round; k++) {
        const p = passes[k];
        fam[p.ch] = p.fam;
        if (!dotCount[p.i]) continue;
        gl.colorMask(p.ch === 0, p.ch === 1, p.ch === 2, p.ch === 3);
        gl.uniform4f(dot.u.uDot, p.size, p.share, maxPoint, 0);
        gl.uniform4f(dot.u.uClipF, p.strength, g.R * dpr, s.lens ? 1 : 0, 0);
        gather(p.strength);
        gl.drawArrays(gl.POINTS, dotFirst[p.i], dotCount[p.i]);
      }
      gl.disableVertexAttribArray(dot.a.aLL);

      toCanvas(dotsOut);
      gl.uniform2f(dotsOut.u.uSize, bw, bh);
      for (let ch = 0; ch < 4; ch++) {
        const c = s.fam[fam[ch]];
        gl.uniform3f(colour[ch], c[0] / 255, c[1] / 255, c[2] / 255);
      }
      gl.uniform1f(dotsOut.u.uPaper, s.paper ? 1 : 0);
      gl.uniform4f(dotsOut.u.uDisc, g.cx * dpr, bh - g.cy * dpr, g.R * dpr, under);
      /* On the night globe the rounds add up, as the layers do in 2D. On paper each round
         goes over the one before it, which is the layers' draw order. */
      if (s.paper) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(dotsOut.a.aP);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.SCISSOR_TEST);
  }

  function draw(W: number, H: number, dpr: number, rend: readonly Still[], specs: readonly GlobeSpec[]) {
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    target(bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!hasData) return;
    for (const g of specs) if (g.a > 0.004) drawGlobe(g, rend, W, H, dpr, bw, bh);
  }

  return {
    setData(D) {
      let total = 0;
      for (const P of D.pts) total += P.n;
      const pts = new Float32Array(total * 2);
      dotFirst = [];
      dotCount = [];
      let o = 0;
      for (let i = 0; i < LAYERS.length; i++) {
        const P = D.pts[i];
        dotFirst.push(o / 2);
        dotCount.push(P ? P.n : 0);
        if (!P) continue;
        for (let j = 0; j < P.n; j++) {
          pts[o++] = P.lam[j];
          pts[o++] = P.phi[j];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, dotVbo);
      gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);

      const sets = [D.scan, D.scanS, D.coast, D.coastS, D.cables].map(segmentVertices);
      let floats = 0;
      for (const v of sets) floats += v.length;
      const lines = new Float32Array(floats);
      lineFirst = [];
      lineCount = [];
      o = 0;
      for (const v of sets) {
        lineFirst.push(o / 6);
        lineCount.push(v.length / 6);
        lines.set(v, o);
        o += v.length;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      hasData = true;

      /* WARM UP. A driver finishes compiling a program the first time it draws with it, and
         that first frame took 25 to 33 ms in the prototype. Spend it now, at load, on a
         frame nobody sees: one small globe with every layer and both line kinds. */
      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      if (cw > 0 && ch > 0) {
        const w = new Float32Array(LAYERS.length + 1).fill(1);
        const warm = (o2: Partial<GlobeSpec>): GlobeSpec => ({ cx: 60, cy: 60, R: 40, l0: 0, lat: 0, u: 0, pk: 0, zoom: 1, a: 1, disc: 1, pp: 0, hl: 0, rim: 0, ring: 0, bez: 0, w, b: w, ...o2 });
        draw(cw, ch, 1, [], [warm({}), warm({ R: 400, u: 1, pp: 1 })]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const err = gl.getError();
        if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) throw new Error("WebGL error " + err + " in the first draw");
      }
    },
    draw,
    dispose() {
      hasData = false;
      gl.deleteBuffer(dotVbo);
      gl.deleteBuffer(lineVbo);
      gl.deleteBuffer(triVbo);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      for (const p of [dot, line, linesOut, dotsOut]) gl.deleteProgram(p.p);
    },
  };
}
