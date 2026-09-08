"use client";
// The night sky behind the hero — a PHOTO SPHERE: one equirectangular texture of the
// whole celestial sphere, sampled per pixel by view direction, turning with the globe.
//
// ── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────────
// This was 767 lines that fetched the HYG catalogue, precessed it hourly, tracked
// GMST, read the hero globe's camera every frame and projected all 8,920 stars
// through it onto a 2D canvas. It was accurate, and it was too expensive.
//
// PROFILED 2026-09-08 on the landing page at rest (1440x900, dpr 1):
//   - hiding the star canvas took a rAF probe from 21fps to 110fps
//   - long tasks fell from 80 (5,578ms) to 8 (579ms) over six seconds
//   - `drawStars` was 2.0% of main-thread self time, `drawMilkyWay` 1.4%
// MapLibre used more total CPU (12.4%), but the starfield did all of its work in ONE
// main-thread pass per frame, so it was what produced the bursts that read as jank —
// and on a Retina display its canvas is 2880x1712, four times that profile's pixels.
//
// Three cheaper fixes were measured and rejected: the per-star `createRadialGradient`
// halo runs ~128 times a SECOND rather than per star per frame; rasterising the ~1,157
// on-screen stars as `arc` + `fill` costs 0.4ms/frame and sprite blits benchmarked
// identically; and the closing-section canvas is already correctly gated. The cost was
// projecting 8,920 rows every frame, most of which land off-canvas and are discarded.
//
// ── WHY A SHADER AND NOT A MOVING IMAGE ─────────────────────────────────────
// A flat capture was tried first and is WRONG, which is worth recording so nobody
// tries it again. A screen capture bakes in one perspective: it can be panned, but
// panning is a slide, and a slide behind a globe you are dragging reads as a
// backdrop on rails rather than as a sky. Rotation is the whole affordance — drag
// the Earth and the stars behind it must turn with it, on the same sphere.
//
// An equirectangular map is the whole sky in texture space (x = right ascension
// 0..360, y = declination +90..-90), so the fragment shader can reconstruct a view
// DIRECTION per pixel, rotate it by the globe's camera and sample. That is a real
// photo sphere: every drag rotates it correctly, including over the poles.
//
// AND IT IS CHEAPER THAN EITHER PREDECESSOR. One draw call of two triangles, no
// per-star work at all, no main-thread geometry. The whole sky costs one texture
// fetch per pixel on hardware that is already running MapLibre.
//
// ── WHAT IS GENUINELY LOST ──────────────────────────────────────────────────
// No twinkle, and no hourly precession: the texture is one epoch, baked. Star
// POSITIONS are still real and still from HYG; they simply no longer creep by the
// ~50 arcseconds a year that precession moves them, which is invisible on a hero
// and was only ever computed because the old renderer could.
//
// ── ATTRIBUTION IS NOT OPTIONAL ─────────────────────────────────────────────
// `public/sky/sky-equirect.jpg` is a DERIVATIVE of the HYG database v4.4 (David Nash
// / astronexus), CC BY-SA 4.0. Rasterising data does not launder its licence: the
// landing-page credit stays, and it is still literally true. `public/sky/naked-eye.json`
// and `scripts/gen-sky-texture.mjs` are kept as the source and the recipe.

import { useEffect, useRef } from "react";
import { getHeroView } from "@/lib/marketing/heroView";

const SKY_TEXTURE = "/sky/sky-equirect.jpg";

/**
 * Vertical field of view for the sky, in degrees.
 *
 * The old renderer showed the sky at a WIDER angle than the globe's own camera
 * (`SKY_DEGREES_PER_GLOBE_RADIUS = 60`) so whole constellations fit behind the
 * sphere, and the landing page's footer says so in as many words. 78 deg keeps that
 * promise: the visible field is far wider than the globe subtends, so a drag sweeps
 * recognisable groups of stars past rather than magnifying a handful.
 */
const FOV_DEG = 78;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// `mediump` and not `highp`: the only precision-sensitive step is the atan2 near the
// texture seam, and mediump carries that fine at this texture size. highp is not
// guaranteed in fragment shaders on older mobile GPUs, and asking for it is how a
// shader silently fails to compile on exactly the hardware that needs the cheap path.
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform mat3 uRot;
uniform float uTan;
uniform sampler2D uSky;
const float TAU = 6.2831853;
const float PI = 3.14159265;
void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  // A ray through this pixel, in view space, looking down -Z.
  vec3 dir = normalize(vec3(ndc.x * aspect * uTan, ndc.y * uTan, -1.0));
  // Into world (celestial) space using the globe's own orientation.
  vec3 w = normalize(uRot * dir);
  float lon = atan(w.z, w.x);
  float lat = asin(clamp(w.y, -1.0, 1.0));
  gl_FragColor = texture2D(uSky, vec2(lon / TAU + 0.5, 0.5 - lat / PI));
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * `className` is still a prop and still defaults to the same class, because both call
 * sites position this element themselves — `.pv-hero-stage > .pv-hero-stars` and
 * `.pv-handoff > .pv-hero-stars` in app/provenance.css. Neither has to change.
 *
 * `aria-hidden` because it is decoration; the canvas it replaces had no accessible
 * name either, for the same reason.
 */
export default function Starfield({ className = "pv-hero-stars" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // DORMANT-SAFE, the same rule every upstream fetch in this repo follows. If WebGL
    // is unavailable — a locked-down browser, a lost context, a blocklisted GPU — the
    // element keeps the CSS background the stylesheet already gives it, so the hero is
    // a night sky with no stars rather than a black hole where the sky should be.
    // A WebGL canvas reads back BLANK unless the drawing buffer is preserved, which
    // costs real performance — so it is opt-in via `?capture=1`, for the verification
    // script and never paid for by an actual visitor. Same switch, and the same
    // reasoning, as HeroGlobe's.
    const capture = new URLSearchParams(window.location.search).has("capture");
    const attrs = { alpha: true, antialias: false, depth: false, preserveDrawingBuffer: capture };
    const gl =
      (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl", attrs) as WebGLRenderingContext | null);
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Two triangles covering clip space. Nothing else is ever drawn.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uRot = gl.getUniformLocation(prog, "uRot");
    const uTan = gl.getUniformLocation(prog, "uTan");
    const uSky = gl.getUniformLocation(prog, "uSky");
    gl.uniform1f(uTan, Math.tan(((FOV_DEG * Math.PI) / 180) * 0.5));

    // THE TEXTURE IS 8192 WIDE AND THE SPEC ONLY GUARANTEES 4096. Uploading past a
    // GPU's limit does not throw — it raises INVALID_VALUE and leaves the texture
    // incomplete, which samples as transparent black: a hero with no sky and nothing
    // in the console to say why. Checking up front means such a device keeps the CSS
    // fallback in app/provenance.css instead, which is the same image, flat.
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (typeof maxTex === "number" && maxTex < 8192) return;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // One blue-black pixel until the JPEG decodes, so the first frame is night rather
    // than the transparent default (which would show as a hole over the page ground).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([6, 8, 11, 255]));
    // REPEAT on S because the texture wraps at RA 0/360 and a ray can sample either
    // side of the seam; CLAMP on T because declination does not wrap — sampling past
    // a pole must hold the last row, not fold round to the other hemisphere.
    // No mipmaps: the derivative discontinuity at the atan2 seam makes a mipmapped
    // fetch pick the coarsest level in a one-pixel-wide stripe, drawing a visible
    // grey line down the sky. LINEAR on a 4096x2048 texture is cheap and has no seam.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(uSky, 0);

    let disposed = false;
    let ready = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
      invalidate();
    };
    img.src = SKY_TEXTURE;

    // FULL dpr, capped at 2. This was 1.5 and that was the wrong trade: the sky is
    // the largest surface on the page and the softening WAS visible — reported as
    // "the background looks very low quality". The shader is one texture fetch per
    // pixel with no per-star work behind it, so the fragments are cheap in a way the
    // old canvas's fills never were; this is the one place to spend them. The texture
    // is authored at 22.8 px/deg precisely to be ~1:1 against a dpr-2 hero.
    let w = 0;
    let h = 0;
    // MEASURED SIZE, NOT A PER-FRAME MEASUREMENT. This used to call
    // getBoundingClientRect() inside the draw loop, and that alone cost the page
    // 31fps with 77 long tasks — worse than the canvas renderer this replaced, on a
    // shader that draws two triangles. A rect read is a FORCED SYNCHRONOUS LAYOUT:
    // the browser must flush pending style and layout work before it can answer, so
    // asking once a frame reintroduces exactly the main-thread stall the rewrite
    // existed to remove. The old canvas file called this out too ("no layout read")
    // and it was still got wrong here.
    //
    // A ResizeObserver delivers the box instead, only when it actually changes.
    let pendingSize: { w: number; h: number } | null = null;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      pendingSize = {
        w: Math.max(1, Math.round(box.width * dpr)),
        h: Math.max(1, Math.round(box.height * dpr)),
      };
      invalidate();
    });
    ro.observe(canvas);

    function resize() {
      if (!pendingSize) return false;
      const { w: nw, h: nh } = pendingSize;
      pendingSize = null;
      if (nw === w && nh === h) return false;
      w = nw; h = nh;
      canvas!.width = w;
      canvas!.height = h;
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes, w, h);
      return true;
    }

    /**
     * The camera's orientation as a 3x3, column-major for `uniformMatrix3fv`.
     *
     * Ry(lon) then Rx(-lat): yaw the sky about the celestial pole by the globe's
     * centre longitude, then tilt by its latitude. The SIGNS are the part that is
     * easy to get backwards and obvious only in motion — with either flipped, the
     * sky travels the wrong way under a drag and reads as the globe dragging a
     * backdrop along with it rather than turning against a fixed sky.
     */
    function rotation(lonDeg: number, latDeg: number): Float32Array {
      // ── THE SENSE OF THIS ROTATION. Read this before touching a sign. ──────
      //
      // Ry(yaw) * Rx(pitch), UNTRANSPOSED, with yaw = +lon and pitch = -lat. Measured
      // against the running page: dragging the globe RIGHT moves the Earth's surface
      // right and takes `getCenter().lng` DOWN (13.26 to -14.04 in one drag), and with
      // these signs the sky sweeps LEFT across the screen as that happens — the stars
      // wheel past the turning Earth rather than being towed along behind it.
      //
      // TWO WAYS TO GET THIS WRONG, both of which happened here:
      //   - negating BOTH angles. That is not the inverse of this product (the inverse
      //     of Ry(a)Rx(b) is Rx(-b)Ry(-a), a different matrix); it mirrors the sphere,
      //     so constellations come out handed the wrong way while still moving
      //     plausibly enough that nobody notices for a while.
      //   - transposing AND negating. A transpose already inverts a rotation, so doing
      //     both cancels and the sky turns exactly as it did before, which reads as
      //     "the fix did nothing".
      // If it ever needs inverting again, do ONE of those, and verify with `?capture=1`
      // rather than by reasoning — armchair sign analysis has lost every round here.
      const a = (lonDeg * Math.PI) / 180;
      const b = (-latDeg * Math.PI) / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const cb = Math.cos(b), sb = Math.sin(b);
      // Columns, because a GLSL mat3 is column-major.
      return new Float32Array([
        ca, 0, -sa,
        sa * sb, cb, ca * sb,
        sa * cb, -sb, ca * cb,
      ]);
    }

    let raf = 0;
    let onScreen = false;
    let lastLon = Number.NaN;
    let lastLat = Number.NaN;

    function draw() {
      raf = 0;
      if (disposed || !onScreen || document.hidden) return;
      const resized = resize();
      const view = getHeroView();
      // No globe in front of this sky (the closing section) — hold a fixed
      // orientation rather than guessing one, exactly as getHeroView's own contract
      // says a caller must decide.
      const lon = view ? view.lngDeg : 0;
      const lat = view ? view.latDeg : 0;
      // Nothing moved and nothing resized: do not redraw. The globe settles after
      // ~8 seconds and then holds still, so without this the GPU would keep redrawing
      // an identical frame for the life of the page.
      if (!resized && ready && lon === lastLon && lat === lastLat) {
        schedule();
        return;
      }
      lastLon = lon;
      lastLat = lat;
      gl!.uniformMatrix3fv(uRot, false, rotation(lon, lat));
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      schedule();
    }

    function schedule() {
      if (disposed || raf) return;
      raf = window.requestAnimationFrame(draw);
    }
    function invalidate() {
      lastLon = Number.NaN;
      schedule();
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) onScreen = e.isIntersecting;
        if (onScreen) invalidate();
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(canvas);

    const onVis = () => { if (!document.hidden) invalidate(); };
    // A lost context is not an error to log and forget: without this the canvas keeps
    // its last frame frozen forever. Prevent the default so the browser will restore.
    const onLost = (e: Event) => { e.preventDefault(); };
    document.addEventListener("visibilitychange", onVis);
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
