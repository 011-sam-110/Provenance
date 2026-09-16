"use client";
// /demo-cinematic — GEV-style cinematic camera, trimmed to the ONE motion the
// product keeps: Orbit ISS. The same loop now also runs in the real console
// (components/console/IssOrbit.tsx, toggled from the Map settings page); this
// page is the isolated playground for it, with its own Orbit button.
//
// Mounts the REAL WorldMap (read-only import) and drives ITS camera through
// lib/map/instance.ts. MapLibre v5 has no FreeCameraOptions (verified against
// maplibre-gl 5.24 dist/src — that API never made it out of Mapbox), so the
// repo's own per-frame precedent is used instead: a rAF loop calling
// map.jumpTo, the exact pattern the removed console spin loop and the landing
// HeroGlobe used.
//
// Motion ownership: one motion ever. A new claim or a pointer/wheel gesture on
// the map settles the running loop on its next frame — there is no Stop button
// because the user's hand IS the stop.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import WorldMap from "@/components/WorldMap";
import { getMapInstance } from "@/lib/map/instance";
import { useIssStation } from "@/lib/cinematic/useIssStation";
import {
  ORBIT_DEFAULTS,
  advanceOrbit,
  approachValue,
  createMotionOwner,
  orbitRadiusKm,
} from "@/lib/cinematic/verbs";
import { tangentBearingDeg } from "@/lib/cinematic/routeFlight";
import styles from "./demo.module.css";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function DemoCinematicPage() {
  const { station, load } = useIssStation();
  const [orbiting, setOrbiting] = useState(false);
  const [status, setStatus] = useState<string>("Waiting for station TLEs…");
  const [satsReady, setSatsReady] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<{ token: number; raf: number } | null>(null);
  const ownerRef = useRef(createMotionOwner());
  const stationRef = useRef(station);
  stationRef.current = station;

  // Say the load-state line ONCE per transition — the station re-ticks every
  // second, and a naive dependency would stomp "Orbiting…" mid-motion.
  const loadStateRef = useRef({ load, satsOk: load === "ok" && station !== null });
  useEffect(() => {
    const satsOk = load === "ok" && station !== null;
    const prev = loadStateRef.current;
    if (prev.load === load && prev.satsOk === satsOk) return;
    loadStateRef.current = { load, satsOk };
    setSatsReady(satsOk);
    if (load === "loading") setStatus("Loading station TLEs from CelesTrak…");
    else if (load === "unavailable") setStatus("CelesTrak unavailable — orbit stays disabled.");
    else if (satsOk) setStatus(`${station?.label ?? "Station"} loaded — ready to orbit.`);
    else setStatus("Station TLEs arrived but propagation yielded nothing usable.");
  }, [load, station]);

  /** The ONE way the orbit ends: invalidate the token, cancel the loop. New
   *  claims and user input both funnel through here. */
  const stopMotion = useCallback(() => {
    ownerRef.current.invalidate();
    const m = motionRef.current;
    if (m) {
      cancelAnimationFrame(m.raf);
      motionRef.current = null;
    }
    setOrbiting(false);
  }, []);

  // A pointer/wheel gesture on the map settles the orbit immediately (spec:
  // "one active motion ever" — user input owns the camera the moment it
  // happens). Capture phase, so it wins over MapLibre's own handlers. The
  // control strip is a SIBLING of this wrapper, so its button never stops
  // itself.
  useEffect(() => {
    const el = mapWrapRef.current;
    if (!el) return;
    const settle = () => stopMotion();
    el.addEventListener("pointerdown", settle, { capture: true });
    el.addEventListener("wheel", settle, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", settle, { capture: true });
      el.removeEventListener("wheel", settle, { capture: true });
    };
  }, [stopMotion]);

  // Map readiness for the screenshot script: style loaded + not animating +
  // stations in. Deliberately isStyleLoaded(), NOT loaded() — loaded() demands
  // every tile on every source be finished, and the live feeds keep that false
  // for minutes. Tile settling is the screenshot script's own fixed wait.
  useEffect(() => {
    const iv = setInterval(() => {
      const map = getMapInstance();
      const ready = !!map && map.isStyleLoaded() && !map.isMoving() && satsReady;
      rootRef.current?.setAttribute("data-ready", ready ? "1" : "0");
    }, 250);
    return () => clearInterval(iv);
  }, [satsReady]);

  // ── Orbit ISS ────────────────────────────────────────────────────────────────
  const startOrbit = useCallback(() => {
    const map = getMapInstance();
    const stationNow = stationRef.current;
    if (!map || !stationNow) {
      setStatus("No live station to orbit yet.");
      return;
    }
    stopMotion();
    const token = ownerRef.current.claim();
    setOrbiting(true);
    setStatus(`Orbiting ${stationNow.label} — touch the map to take control.`);

    if (prefersReducedMotion()) {
      // Reduced motion: no continuous orbit — one eased pan onto the orbit ring.
      const start = advanceOrbit(
        { headingDeg: 0 },
        { lat: stationNow.lat, lon: stationNow.lon },
        { degPerSec: ORBIT_DEFAULTS.degPerSec, radiusKm: ORBIT_DEFAULTS.baseRadiusKm, pitchDeg: ORBIT_DEFAULTS.pitchDeg },
        0,
      ).camera;
      map.easeTo({
        center: [start.centerLon, start.centerLat],
        zoom: ORBIT_DEFAULTS.baseZoom,
        pitch: start.pitch,
        bearing: start.bearing,
        duration: 1200,
        essential: true,
      });
      setOrbiting(false);
      setStatus("Orbit flattened to a pan (prefers-reduced-motion).");
      return;
    }

    // Start from where the camera IS: the heading that points from the station
    // back through the current centre, and the zoom the user has. Both then
    // SETTLE via approachValue — zoom toward the orbit altitude, radius
    // remapped from zoom every frame — so the orbit begins as an approach, not
    // a cut.
    const center = map.getCenter();
    const heading0 = tangentBearingDeg([stationNow.lon, stationNow.lat], [center.lng, center.lat]);
    let orbitState = { headingDeg: heading0 };
    let zoomNow = map.getZoom();
    let last = performance.now();
    const motion = { token, raf: 0 };

    const tick = (now: number) => {
      if (!ownerRef.current.owns(token)) return; // settled by input or a new motion
      const dt = (now - last) / 1000;
      last = now;
      const m = getMapInstance();
      const st = stationRef.current;
      if (!m || !st) {
        motion.raf = requestAnimationFrame(tick);
        return;
      }
      zoomNow = approachValue(zoomNow, ORBIT_DEFAULTS.baseZoom, 2.5, dt);
      const radiusKm = orbitRadiusKm(zoomNow, ORBIT_DEFAULTS.baseZoom, ORBIT_DEFAULTS.baseRadiusKm);
      const next = advanceOrbit(
        orbitState,
        { lat: st.lat, lon: st.lon },
        { degPerSec: ORBIT_DEFAULTS.degPerSec, radiusKm, pitchDeg: ORBIT_DEFAULTS.pitchDeg },
        dt,
      );
      orbitState = next.state;
      m.jumpTo({
        center: [next.camera.centerLon, next.camera.centerLat],
        zoom: zoomNow,
        pitch: next.camera.pitch,
        bearing: next.camera.bearing,
      });
      motion.raf = requestAnimationFrame(tick);
    };
    motionRef.current = motion;
    motion.raf = requestAnimationFrame(tick);
  }, [stopMotion]);

  const orbitDisabled = !satsReady;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-motion={orbiting ? "orbit" : "idle"}
      data-sats={load}
      data-demo-root="1"
    >
      <div ref={mapWrapRef} className={styles.map}>
        <WorldMap />
      </div>

      <header className={styles.header}>
        <div>
          <h1>Cinematic camera — orbit</h1>
          <p className={styles.sub}>
            GEV-style orbit around the live station on the real MapLibre map. The same motion
            runs in the console, toggled from Map settings → ISS orbit.
          </p>
        </div>
        <Link className={styles.back} href="/">
          ← Back to map
        </Link>
      </header>

      <section className={styles.strip} aria-label="Cinematic motion controls">
        <div className={styles.buttons}>
          <button id="btn-orbit" type="button" onClick={startOrbit} disabled={orbitDisabled}>
            Orbit ISS
          </button>
        </div>

        <div className={styles.status} role="status" aria-live="polite">
          {status}
        </div>
        {load === "loading" && <div className={styles.status}>Fetching CelesTrak &ldquo;stations&rdquo; group…</div>}
        {load === "unavailable" && (
          <div className={styles.status}>
            No live objects — the orbit stays disabled until CelesTrak answers.
          </div>
        )}
      </section>
    </div>
  );
}
