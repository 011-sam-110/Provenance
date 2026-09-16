"use client";
// HUD — the calm-light heads-up overlay. A thin, read-only DOM layer over the map:
// camera readout (lat / lon / zoom / heading), a UTC clock, the live metric counts
// from lib/metrics.ts, and chips for the active core layers. Corner brackets, quiet
// --tn-* styling, no glow. 'H' toggles it — but ONLY the /demo-hud page binds that
// key (see app/demo-hud/page.tsx), so the console's own keymap is untouched.
//
// Variants (Full / Compact / Minimal) are a pure table in lib/hud/model.ts; this
// component is one render pass over the chosen row, so a new variant is a data row
// and nothing else.
//
// CAMERA READOUT SUBSCRIPTION: the live MapLibre instance publishes move events at
// pointer rate. We coalesce to ONE read per animation frame and re-render only when
// the DISPLAYED string changes, so a drag never re-renders the overlay per event —
// the same discipline WorldMap's own comments demand of map subscribers.

import { useEffect, useRef, useState } from "react";
import { ACTIVE_LAYERS, useLayers } from "@/lib/layers";
import { getMapInstance } from "@/lib/map/instance";
import { useMetrics } from "@/lib/metrics";
import { useNow } from "@/lib/shell/useNow";
import { hudStore, useHudPrefs } from "@/lib/hud/store";
import {
  HUD_CHIP_LABEL,
  VARIANT_SPEC,
  formatCount,
  formatHeading,
  formatLat,
  formatLon,
  formatUtcClock,
  formatZoom,
  type HudChipKey,
} from "@/lib/hud/model";
import SplitFlap from "./SplitFlap";
import styles from "./hud.module.css";

interface CameraReadout {
  lat: string;
  lon: string;
  zoom: string;
  heading: string;
}

export default function Hud() {
  const prefs = useHudPrefs();
  const metrics = useMetrics();
  const layers = useLayers();
  const now = useNow(1000); // one re-render per second for the clock, nothing faster
  const [cam, setCam] = useState<CameraReadout | null>(null);
  const camRef = useRef<CameraReadout | null>(null);
  // The clock's server-rendered text can never match the client's (Date.now() moves
  // between SSR and hydration), so the first render shows a stable placeholder and
  // the effect swaps the live time in — the same mounted-gate the rest of the app
  // uses to keep its time readouts hydration-safe.
  const [clockReady, setClockReady] = useState(false);
  useEffect(() => {
    setClockReady(true);
  }, []);

  // Persisted prefs hydrate on mount (client-only — loadPersisted no-ops on the
  // server). The Map settings tool hydrates too; whichever surface mounts first
  // loads the same envelope.
  useEffect(() => {
    hudStore.hydrate();
  }, []);

  useEffect(() => {
    let map = getMapInstance();
    let raf = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const read = () => {
      const m = map;
      if (!m) return;
      const c = m.getCenter();
      const next: CameraReadout = {
        lat: formatLat(c.lat),
        lon: formatLon(c.lng),
        zoom: formatZoom(m.getZoom()),
        heading: formatHeading(m.getBearing()),
      };
      const prev = camRef.current;
      if (
        !prev ||
        prev.lat !== next.lat ||
        prev.lon !== next.lon ||
        prev.zoom !== next.zoom ||
        prev.heading !== next.heading
      ) {
        camRef.current = next;
        setCam(next);
      }
    };

    const onMove = () => {
      if (raf) return; // already scheduled for this frame
      raf = requestAnimationFrame(() => {
        raf = 0;
        read();
      });
    };

    // The HUD can mount before the map (sibling mounts are unordered), so acquire
    // the instance lazily with a few short retries instead of assuming order.
    const tryAttach = () => {
      const m = getMapInstance();
      if (!m) {
        retry = setTimeout(tryAttach, 250);
        return;
      }
      map = m;
      m.on("move", onMove);
      read();
    };

    const initial = getMapInstance();
    if (initial) {
      map = initial;
      initial.on("move", onMove);
      read();
    } else {
      retry = setTimeout(tryAttach, 250);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (retry !== null) clearTimeout(retry);
      map?.off("move", onMove);
    };
  }, []);

  if (!prefs.enabled) return null;

  const spec = VARIANT_SPEC[prefs.variant];

  return (
    <div
      className={styles.hud}
      data-tn-hud=""
      data-tn-hud-variant={prefs.variant}
      style={{ opacity: prefs.opacity / 100 }}
    >
      <span className={styles.corner} data-corner="tl" aria-hidden="true" />
      <span className={styles.corner} data-corner="tr" aria-hidden="true" />
      <span className={styles.corner} data-corner="bl" aria-hidden="true" />
      <span className={styles.corner} data-corner="br" aria-hidden="true" />

      <div className={styles.inner}>
        {spec.camera && cam && (
          <div className={styles.block} data-tn-hud-block="camera">
            <span className={styles.blockTitle}>Camera</span>
            <div className={styles.row}>
              <SplitFlap value={cam.lat} label="LAT" size="sm" animate={prefs.animate} announce={false} />
              <SplitFlap value={cam.lon} label="LON" size="sm" animate={prefs.animate} announce={false} />
              <SplitFlap value={cam.zoom} label="ZOOM" size="sm" animate={prefs.animate} announce={false} />
              <SplitFlap value={cam.heading} label="HDG" size="sm" animate={prefs.animate} announce={false} />
            </div>
          </div>
        )}

        {spec.clock && (
          <div className={styles.block} data-tn-hud-block="clock">
            <span className={styles.blockTitle}>UTC</span>
            <SplitFlap value={clockReady ? formatUtcClock(now) : "00:00:00"} size="sm" animate={prefs.animate} announce={false} />
          </div>
        )}

        {spec.counts && (
          <div className={styles.block} data-tn-hud-block="counts">
            <span className={styles.blockTitle}>Live</span>
            <div className={styles.row}>
              <SplitFlap value={formatCount(metrics.camerasOnline)} label="CAM" size="sm" animate={prefs.animate} />
              <SplitFlap value={formatCount(metrics.planes)} label="PLN" size="sm" animate={prefs.animate} />
              <SplitFlap value={formatCount(metrics.satellites)} label="SAT" size="sm" animate={prefs.animate} />
            </div>
          </div>
        )}

        {spec.chips && (
          <div className={styles.chips} data-tn-hud-block="chips">
            {/* ACTIVE_LAYERS is the four core layers by definition; the predicate
                narrows the LayerKey union down to the keys the chip table owns. */}
            {ACTIVE_LAYERS.filter((k): k is HudChipKey => layers[k]).map((k) => (
              <span key={k} className={styles.chip}>
                {HUD_CHIP_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
