"use client";
// The console mount of the ISS-orbit follow. Renders NOTHING — the Map
// settings switch is the whole UI — and while the pref is on it drives the
// real map's camera around the station's live sub-point with the same math
// the /demo-cinematic page demos (lib/cinematic/verbs.ts).
//
// OWNERSHIP + HONESTY, the two rules this component exists to hold:
//   • One motion ever: createMotionOwner tokens. A new claim, a user gesture,
//     or the pref flipping off all settle the running loop on its next frame.
//   • The switch never lies: any pointer/wheel gesture on the map settles the
//     motion AND flips the pref back off, because the user's hand owns the
//     camera from that moment. prefers-reduced-motion flattens the follow to
//     one eased pan and flips the pref off — a pan is not an orbit.
//
// CAMERA LOOP: one rAF, driven by the station ref (not React state), so the
// per-second station tick never re-anchors or restarts the loop. The loop
// effect depends on a scalar `ready` flag, never on the per-second object.

import { useCallback, useEffect, useRef } from "react";
import { getMapInstance } from "@/lib/map/instance";
import { issOrbitStore, useIssOrbitPrefs } from "@/lib/cinematic/orbitStore";
import { ISS_ORBIT_DEG_PER_SEC } from "@/lib/cinematic/prefs";
import { useIssStation } from "@/lib/cinematic/useIssStation";
import {
  ORBIT_DEFAULTS,
  advanceOrbit,
  approachValue,
  createMotionOwner,
  orbitRadiusKm,
} from "@/lib/cinematic/verbs";
import { tangentBearingDeg } from "@/lib/cinematic/routeFlight";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function IssOrbit() {
  const prefs = useIssOrbitPrefs();
  const { station, load } = useIssStation();
  const stationRef = useRef(station);
  stationRef.current = station;
  const ownerRef = useRef(createMotionOwner());
  const rafRef = useRef(0);

  // Hydrate the persisted pref on mount (the Map settings tool hydrates too;
  // whichever surface mounts first loads the same envelope).
  useEffect(() => {
    issOrbitStore.hydrate();
  }, []);

  /** The ONE way the motion ends from outside: invalidate the token, cancel
   *  the loop, and make the settings switch tell the truth about it. */
  const settle = useCallback(() => {
    ownerRef.current.invalidate();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (issOrbitStore.get().enabled) issOrbitStore.setEnabled(false);
  }, []);

  // User input owns the camera the moment it happens. Bound to the MAP's own
  // container (capture phase, like the demo page) so inspector clicks, panel
  // drags and settings toggles never settle the orbit by accident.
  useEffect(() => {
    if (!prefs.enabled) return;
    const map = getMapInstance();
    const el = map?.getContainer();
    if (!el) return;
    el.addEventListener("pointerdown", settle, { capture: true });
    el.addEventListener("wheel", settle, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", settle, { capture: true });
      el.removeEventListener("wheel", settle, { capture: true });
    };
  }, [prefs.enabled, settle]);

  // The orbit loop itself. `ready` is a scalar so the per-second station tick
  // (a fresh object every second) does NOT restart the loop; the loop reads
  // stationRef.current each frame instead.
  const ready = load === "ok" && station !== null;

  useEffect(() => {
    if (!prefs.enabled || !ready) return; // dormant-safe: nothing to orbit yet
    const map = getMapInstance();
    if (!map) return;
    const stationNow = stationRef.current;
    if (!stationNow) return;

    const token = ownerRef.current.claim();
    const degPerSec = ISS_ORBIT_DEG_PER_SEC[prefs.speed];

    if (prefersReducedMotion()) {
      // No continuous orbit — one eased pan onto the orbit ring, then the
      // pref flips off because the motion is done, not running.
      const start = advanceOrbit(
        { headingDeg: 0 },
        { lat: stationNow.lat, lon: stationNow.lon },
        { degPerSec, radiusKm: ORBIT_DEFAULTS.baseRadiusKm, pitchDeg: ORBIT_DEFAULTS.pitchDeg },
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
      issOrbitStore.setEnabled(false);
      return;
    }

    // Start from where the camera IS: the heading that points from the station
    // back through the current centre, and the zoom the user has. Both then
    // settle via approachValue — zoom toward the orbit altitude, radius
    // remapped from zoom every frame — so the orbit begins as an approach,
    // not a cut. (Same start the demo page's Orbit ISS uses.)
    const center = map.getCenter();
    const heading0 = tangentBearingDeg([stationNow.lon, stationNow.lat], [center.lng, center.lat]);
    let orbitState = { headingDeg: heading0 };
    let zoomNow = map.getZoom();
    let last = performance.now();

    const container = map.getContainer();
    container.setAttribute("data-tn-orbit", "1");
    container.setAttribute("data-tn-orbit-heading", orbitState.headingDeg.toFixed(2));

    const tick = (now: number) => {
      if (!ownerRef.current.owns(token)) return; // settled by input or the switch
      const dt = (now - last) / 1000;
      last = now;
      const m = getMapInstance();
      const s = stationRef.current;
      if (!m || !s) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      zoomNow = approachValue(zoomNow, ORBIT_DEFAULTS.baseZoom, 2.5, dt);
      const radiusKm = orbitRadiusKm(zoomNow, ORBIT_DEFAULTS.baseZoom, ORBIT_DEFAULTS.baseRadiusKm);
      const next = advanceOrbit(
        orbitState,
        { lat: s.lat, lon: s.lon },
        { degPerSec, radiusKm, pitchDeg: ORBIT_DEFAULTS.pitchDeg },
        dt,
      );
      orbitState = next.state;
      m.jumpTo({
        center: [next.camera.centerLon, next.camera.centerLat],
        zoom: zoomNow,
        pitch: next.camera.pitch,
        bearing: next.camera.bearing,
      });
      container.setAttribute("data-tn-orbit-heading", orbitState.headingDeg.toFixed(2));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      ownerRef.current.invalidate();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      container.removeAttribute("data-tn-orbit");
      container.removeAttribute("data-tn-orbit-heading");
    };
  }, [prefs.enabled, prefs.speed, ready]);

  return null;
}
