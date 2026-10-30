"use client";
// The Discord pop-up's globe: a dark planet, slowly turning, with one dot per member on it. It
// bursts out of its centre when the pop-up opens, spins down, and keeps turning for as long as
// the pop-up is up. The loop exists only while this is mounted, so the page behind pays nothing
// afterwards. Under reduced motion it draws one still frame and runs no loop.

import { useEffect, useRef } from "react";
import { dotRadius, memberDots, turnDot } from "@/lib/community/memberGlobe";

const TILT = -0.42;
/** Radians per millisecond: one turn in about 45 seconds. */
const DRIFT = 0.00014;
/** How far the ball spins while it settles after the burst. */
const BURST_TURN = 2.4;
const BURST_SETTLE_MS = 700;
/** Each dot takes this long to fly out, and the last one leaves this much after the first. */
const DOT_FLIGHT_MS = 620;
const DOT_STAGGER_MS = 460;
const BURST_DELAY_MS = 150;

/** The dots thin out behind the figures in the middle, so the digits and their labels stay
 *  clean. The dots are all still drawn: the count on the ball does not change. */
function clearing(fromMiddle: number): number {
  const t = Math.min(1, Math.max(0, (fromMiddle - 0.32) / 0.46));
  return 0.22 + 0.78 * t * t * (3 - 2 * t);
}

/** Overshoot, so the ball swells slightly past its size and comes back. */
function easeOutBack(t: number): number {
  const c = 1.55;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export default function MemberGlobe({ members, online }: { members: number | null; online: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dots = memberDots(members, online);
    const started = performance.now();

    let size = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = el.clientWidth;
      el.width = Math.round(size * dpr);
      el.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const t = still ? Infinity : now - started - BURST_DELAY_MS;
      ctx.clearRect(0, 0, size, size);
      const ball = size * 0.46;
      const middle = size / 2;
      const r = dotRadius(dots.length, ball);
      const settled = still ? 0 : BURST_TURN * Math.exp(-Math.max(0, t) / BURST_SETTLE_MS);
      const spin = 0.9 + (still ? 0 : Math.max(0, t) * DRIFT) - settled;

      // The planet itself, which grows with the burst. Its colours are Discord's blurple taken
      // down towards the panel, so the white digits on it clear AA by a wide margin.
      const body = ball * 1.03 * easeOutBack(Math.min(1, Math.max(0, t / DOT_FLIGHT_MS)));
      if (body > 0) {
        const shade = ctx.createRadialGradient(middle - body * 0.34, middle - body * 0.38, body * 0.08, middle, middle, body);
        shade.addColorStop(0, "#3a44cf");
        shade.addColorStop(0.62, "#262c9c");
        shade.addColorStop(1, "#171a66");
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(middle, middle, body, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgb(255 255 255 / 0.3)";
        ctx.stroke();
      }

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const flight = Math.min(1, Math.max(0, (t - (i / dots.length) * DOT_STAGGER_MS) / DOT_FLIGHT_MS));
        if (flight <= 0) continue;
        const out = easeOutBack(flight);
        const p = turnDot(d, spin, TILT);
        const near = (p.z + 1) / 2;
        // The green dots breathe: they are the ones that are live, so they are the ones that move.
        const breath = d.online && !still ? 0.82 + 0.18 * Math.sin(t / 620 + i) : 1;
        ctx.globalAlpha = Math.min(1, flight * 1.6) * (0.2 + 0.8 * near * near) * breath * clearing(Math.hypot(p.x, p.y));
        ctx.fillStyle = d.online ? "#57f287" : "#ffffff";
        ctx.beginPath();
        ctx.arc(middle + ball * out * p.x, middle + ball * out * p.y, r * (0.62 + 0.58 * near) * (d.online ? 1.3 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    fit();
    let frame = 0;
    if (still) {
      draw(started);
    } else {
      const loop = (now: number) => {
        draw(now);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }

    const watcher = new ResizeObserver(() => {
      fit();
      if (still) draw(started);
    });
    watcher.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
    };
  }, [members, online]);

  return <canvas ref={canvas} className="tn-join-globe" aria-hidden />;
}
