"use client";

import { useEffect } from "react";

/**
 * The page's ONLY scroll subscriber.
 *
 * Everything scroll-driven on the landing page — the bone→ink ground, the
 * foreground flip, the pinned adapter's beat, the horizontal source wall, the
 * open-source parallax — is computed here once per animation frame and published
 * as CSS custom properties / data attributes. Nothing else may add a scroll
 * listener, and nothing here may set React state: a re-render per frame would
 * undo the whole point.
 *
 * Elements opt in by data attribute:
 *   [data-pv-hero]      the night stage (writes --pv-globe-o/-y/-s)
 *   [data-pv-adapter]   the pinned adapter section (writes --pv-marker-scale,
 *                       --pv-dossier-o and data-beat="0|1|2")
 *   [data-pv-wall]      the pinned horizontal wall (writes --pv-wall-x/-p)
 *   [data-pv-parallax]  any element that should drift (writes --pv-shift)
 *
 * The ground ramp is deliberately NOT a linear function of page scroll. It runs
 * NIGHT -> DAY -> NIGHT and is driven off two opaque landmarks — the hero on the
 * way out and the adapter panel on the way in — so the ambiguous mid-grey the
 * ramp passes through is only ever on screen while one of them covers the
 * viewport. See provenance.css.
 */
export default function ScrollGround() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".pv-root");
    if (!root) return;

    const hero = root.querySelector<HTMLElement>("[data-pv-hero]");
    const adapter = root.querySelector<HTMLElement>("[data-pv-adapter]");
    const wall = root.querySelector<HTMLElement>("[data-pv-wall]");
    const wallTracks = Array.from(root.querySelectorAll<HTMLElement>("[data-pv-wall-track]"));
    const parallax = Array.from(root.querySelectorAll<HTMLElement>("[data-pv-parallax]"));

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastBeat = -1;

    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    /** Height of the sticky instrument bar; must match `.pv-bar` in provenance.css. */
    const BAR_H = 44;

    // offsetTop is measured from the nearest POSITIONED ancestor, and both
    // .pv-root and .pv-doc are position:relative — so it silently means different
    // things depending on how deeply a section is nested. Always resolve to a
    // document-absolute offset instead.
    const docTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;

    function read() {
      frame = 0;
      if (!root) return;
      const vh = window.innerHeight;
      const y = window.scrollY;
      const docMax = document.documentElement.scrollHeight - vh;

      root.style.setProperty("--pv-p", clamp01(docMax > 0 ? y / docMax : 0).toFixed(4));

      // ── ground ramp: night -> day -> night ──────────────────────────────
      // Leg 1 (inside the hero): ink lifts to bone, eased, over the first 72% of
      //   the stage. The hero is opaque, so the whole transit is hidden behind it.
      // Leg 2 (the document): a slow drift to a 0.28 mix — dusk, but still holding
      //   contrast for ink type.
      // Leg 3 (into the adapter): the plunge back to full ink, timed to happen
      //   precisely while the opaque panel sweeps up the screen.
      const heroH = hero ? hero.offsetHeight : vh;
      let g = 1;
      if (y < heroH) {
        g = 1 - easeOut(clamp01(y / (heroH * 0.72)));
      } else if (adapter) {
        const top = docTop(adapter);
        const enter = Math.max(heroH + 1, top - vh);
        if (y <= enter) g = clamp01((y - heroH) / Math.max(1, enter - heroH)) * 0.28;
        else if (y < top) g = 0.28 + ((y - enter) / Math.max(1, top - enter)) * 0.72;
        else g = 1;
      } else {
        g = docMax > 0 ? clamp01(y / docMax) : 0;
      }
      g = clamp01(g);
      root.style.setProperty("--pv-g", g.toFixed(4));
      // The foreground set follows the ground rather than a scroll position of its
      // own. Deriving it from `g` is what guarantees light type never lands on a
      // light ground: the two cannot drift apart, because there is only one number.
      root.classList.toggle("pv-night", g > 0.5);

      // ── the instrument bar's own ground ─────────────────────────────────
      // The bar is sticky AND translucent, so it is the one thing on the page that
      // can straddle two grounds: mid-exit, the opaque night stage is still behind
      // it while the ground under the rest of the viewport has already lifted to
      // bone. Give it the ground DIRECTLY BENEATH IT rather than the page's, or it
      // paints a bone strip across the hero.
      const barOverHero = hero ? y < heroH - BAR_H : false;
      root.style.setProperty("--pv-bar-g", barOverHero ? "1" : g.toFixed(4));
      root.classList.toggle("pv-bar-night", barOverHero);

      // ── the hero globe leaves with the hero ─────────────────────────────
      // Sinks, swells very slightly, and dims to nothing by the time the stage is
      // gone. Published as custom properties; the transform itself is composed in
      // CSS alongside the centring translate.
      if (hero) {
        const t = clamp01(y / Math.max(1, heroH));
        hero.style.setProperty("--pv-globe-o", (1 - t * 0.9).toFixed(3));
        if (reduce.matches) {
          hero.style.setProperty("--pv-globe-y", "0%");
          hero.style.setProperty("--pv-globe-s", "1");
        } else {
          hero.style.setProperty("--pv-globe-y", `${(t * 12).toFixed(1)}%`);
          hero.style.setProperty("--pv-globe-s", (1 + t * 0.08).toFixed(3));
        }
      }

      // ── the adapter's three beats ───────────────────────────────────────
      if (adapter && !reduce.matches) {
        const track = adapter.querySelector<HTMLElement>("[data-pv-adapter-track]");
        if (track) {
          const scrolled = y - docTop(track);
          const span = Math.max(1, track.offsetHeight - vh);
          const t = clamp01(scrolled / span);
          const beat = t < 0.34 ? 0 : t < 0.67 ? 1 : 2;
          if (beat !== lastBeat) {
            adapter.dataset.beat = String(beat);
            lastBeat = beat;
          }
          // The marker pops in over beat 3, the dossier follows it.
          adapter.style.setProperty("--pv-marker-scale", clamp01((t - 0.66) / 0.12).toFixed(3));
          adapter.style.setProperty("--pv-dossier-o", clamp01((t - 0.78) / 0.12).toFixed(3));
        }
      } else if (adapter) {
        adapter.dataset.beat = "2";
        adapter.style.setProperty("--pv-marker-scale", "1");
        adapter.style.setProperty("--pv-dossier-o", "1");
      }

      // ── the horizontal source wall ──────────────────────────────────────
      if (wall && wallTracks.length && !reduce.matches) {
        const scrolled = y - docTop(wall);
        const span = Math.max(1, wall.offsetHeight - vh);
        const t = clamp01(scrolled / span);
        // Each row travels its OWN width. Sharing one offset would leave the shorter
        // row stranded mid-scrub while the longer one was still going.
        wallTracks.forEach((track, i) => {
          const travel = Math.max(0, track.scrollWidth - window.innerWidth + 40);
          wall.style.setProperty(`--pv-wall-x${i + 1}`, (t * travel).toFixed(1));
        });
        wall.style.setProperty("--pv-wall-p", t.toFixed(4));
      }

      // ── parallax ────────────────────────────────────────────────────────
      if (!reduce.matches) {
        for (const el of parallax) {
          const r = el.getBoundingClientRect();
          if (r.bottom < -200 || r.top > vh + 200) continue;
          // -1..1 across the viewport, scaled by the element's own factor.
          const centre = (r.top + r.height / 2 - vh / 2) / vh;
          const factor = Number(el.dataset.pvParallax || "40");
          el.style.setProperty("--pv-shift", (centre * -factor).toFixed(1));
        }
      }
    }

    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(read);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    reduce.addEventListener("change", onScroll);
    read();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce.removeEventListener("change", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
