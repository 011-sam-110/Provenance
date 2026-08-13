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
 *   [data-pv-adapter]   the pinned adapter section (writes --pv-marker-scale,
 *                       --pv-dossier-o and data-beat="0|1|2")
 *   [data-pv-wall]      the pinned horizontal wall (writes --pv-wall-x/-p)
 *   [data-pv-parallax]  any element that should drift (writes --pv-shift)
 *
 * The ground ramp is deliberately NOT a linear function of page scroll. It is
 * driven off the adapter panel's position so the ambiguous mid-grey is only ever
 * on screen while that opaque panel covers the viewport — see provenance.css.
 */
export default function ScrollGround() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".pv-root");
    if (!root) return;

    const adapter = root.querySelector<HTMLElement>("[data-pv-adapter]");
    const wall = root.querySelector<HTMLElement>("[data-pv-wall]");
    const wallTrack = root.querySelector<HTMLElement>("[data-pv-wall-track]");
    const parallax = Array.from(root.querySelectorAll<HTMLElement>("[data-pv-parallax]"));

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastBeat = -1;

    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

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

      // ── ground ramp, anchored to the adapter panel ──────────────────────
      // Above the panel the ground only ever reaches a 0.30 mix, which still
      // holds contrast for ink type. The plunge to full ink happens precisely
      // while the opaque panel sweeps up the screen.
      let g = 0;
      let night = false;
      if (adapter) {
        const top = docTop(adapter);
        const enter = Math.max(1, top - vh);
        const full = Math.max(enter + 1, top);
        if (y <= enter) g = (y / enter) * 0.3;
        else if (y < full) g = 0.3 + ((y - enter) / (full - enter)) * 0.7;
        else g = 1;
        night = y >= full;
      } else {
        g = docMax > 0 ? y / docMax : 0;
        night = g > 0.5;
      }
      root.style.setProperty("--pv-g", clamp01(g).toFixed(4));
      root.classList.toggle("pv-night", night);

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
      if (wall && wallTrack && !reduce.matches) {
        const scrolled = y - docTop(wall);
        const span = Math.max(1, wall.offsetHeight - vh);
        const t = clamp01(scrolled / span);
        const travel = Math.max(0, wallTrack.scrollWidth - window.innerWidth + 40);
        wall.style.setProperty("--pv-wall-x", (t * travel).toFixed(1));
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
