"use client";

import { useEffect, useRef } from "react";

/**
 * The star field behind the hero globe.
 *
 * Procedural canvas rather than an image: it costs a few hundred bytes instead of
 * a megabyte, scales to any aperture size, and re-renders crisply on a HiDPI
 * screen. Stars twinkle by a slow per-star phase, not by redrawing everything at
 * full rate — the whole field is one 30fps pass over ~420 points.
 *
 * Deliberately dim. It sits behind a globe carrying live data; if you notice the
 * stars first, they are wrong.
 */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let stars: { x: number; y: number; r: number; a: number; phase: number; speed: number }[] = [];
    let w = 0;
    let h = 0;

    function seed() {
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scaled to area so a wide aperture is not sparse.
      const count = Math.round(Math.min(620, Math.max(180, (w * h) / 1400)));
      stars = Array.from({ length: count }, () => {
        // Cube the roll so most stars are faint and a handful are bright — a flat
        // distribution reads as noise, not sky.
        const roll = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.35 + roll * roll * 1.5,
          a: 0.18 + roll * roll * roll * 0.72,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.9,
        };
      });
    }

    let last = 0;
    function draw(t: number) {
      raf = window.requestAnimationFrame(draw);
      if (t - last < 33) return; // ~30fps is plenty for a twinkle
      last = t;
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);
      // A faint galactic wash so the field is not a flat black rectangle. It runs
      // dark-to-light LEFT to RIGHT on purpose: the aperture is masked away on its
      // left edge, so any brightness there shows through the fade as a pale stripe
      // against the bone ground. Keep the light in the solid half.
      const wash = ctx.createLinearGradient(0, h, w, 0);
      wash.addColorStop(0, "rgba(8,11,18,0.5)");
      wash.addColorStop(0.55, "rgba(16,24,38,0.34)");
      wash.addColorStop(1, "rgba(34,29,58,0.4)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      const time = t / 1000;
      for (const s of stars) {
        const twinkle = reduce.matches ? 1 : 0.72 + 0.28 * Math.sin(time * s.speed + s.phase);
        ctx.globalAlpha = s.a * twinkle;
        ctx.fillStyle = "#eaf2ff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    seed();
    raf = window.requestAnimationFrame(draw);

    const ro = new ResizeObserver(seed);
    ro.observe(canvas);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="pv-aperture-canvas" aria-hidden="true" />;
}
