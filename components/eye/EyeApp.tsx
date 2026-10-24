"use client";
// The God's eye view: the console's own map engine, opened tilted over satellite
// imagery with the buildings up, and the view's overlays on top. app/(console)/eye
// renders this and nothing else.
//
// THE PAGE READS ITS LINK AFTER MOUNT, so the route stays static (the rule
// tests/unit/console-static.test.ts holds for every page in app/(console)). Nothing
// renders the map until the link is read: WorldMap reads its stores at construction,
// and the stores below must already say satellite, buildings on, no console layers.
//
// THOSE STORE WRITES STAY IN THIS TAB. The layer toggles persist only through the
// console's own boot (variantStore.bootstrap subscribes the writer, and
// inspectorStore saves only after its hydrate), and neither runs on this page. Every
// way in is a full page load (a plain <a>, never a client-side route), so this page
// always starts from a fresh module state, and leaves the same way.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { mapViewStore } from "@/lib/mapView";
import { ACTIVE_LAYERS, layersStore, type LayerKey } from "@/lib/layers";
import { consoleHref, parseEyeLink, type EyeTarget } from "@/lib/eye/places";
import { EYE_LIGHT, eyePaintOps } from "@/lib/eye/look";
import { fmtLat, fmtLon } from "@/lib/eye/wording";
import EyeHud from "./EyeHud";
import styles from "./eye.module.css";

const WorldMap = dynamic(() => import("@/components/WorldMap"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Loading the map</div>,
});

/** The same line the CSS draws between the wide and the phone layouts. */
export const PORTRAIT_QUERY = "(max-aspect-ratio: 4/5)";

/** The console's own layers. This view draws its own cameras and aircraft instead. */
const CONSOLE_LAYERS: readonly LayerKey[] = [...ACTIVE_LAYERS, "countries"];

/** Repaint the ground and the buildings. Called after WorldMap's own paint, on every style. */
function applyLook(map: maplibregl.Map): void {
  for (const op of eyePaintOps()) {
    if (!map.getLayer(op.layer)) continue;
    map.setPaintProperty(op.layer, op.property, op.value as never);
  }
  map.setLight(EYE_LIGHT);
}

function titleFor(target: EyeTarget): { title: string; area?: string } {
  if (target.kind === "place") return { title: target.place.name, area: target.place.area };
  if (target.kind === "camera") return { title: "Road camera" };
  return { title: `${fmtLat(target.view.lat)}, ${fmtLon(target.view.lon)}` };
}

export default function EyeApp() {
  const [target, setTarget] = useState<EyeTarget | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    // Before the map exists: WorldMap reads these when it is built.
    mapViewStore.setBasemap("satellite");
    mapViewStore.setTerrain(false);
    mapViewStore.setBuildings(true);
    for (const k of CONSOLE_LAYERS) layersStore.set(k, false);
    const portrait = window.matchMedia(PORTRAIT_QUERY).matches;
    setTarget(parseEyeLink(new URLSearchParams(window.location.search), portrait));
  }, []);

  // The console's right-click "Add pin here" menu belongs to the console. Caught on
  // the way down, so it never reaches the map.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("contextmenu", stop, true);
    return () => el.removeEventListener("contextmenu", stop, true);
  }, []);

  const onStyleReady = useCallback((m: maplibregl.Map) => {
    applyLook(m);
    mapRef.current = m;
    setMap(m);
  }, []);

  const openAt = useMemo(
    () =>
      target && {
        lat: target.view.lat,
        lon: target.view.lon,
        zoom: target.view.zoom,
        pitch: target.view.tilt,
        bearing: target.view.heading,
      },
    [target],
  );

  const getBackHref = useCallback(() => {
    const m = mapRef.current;
    if (!m) return consoleHref(target?.view ?? { lat: 0, lon: 0, zoom: 2 });
    const c = m.getCenter();
    return consoleHref({ lat: c.lat, lon: c.lng, zoom: m.getZoom() });
  }, [target]);

  const words = target ? titleFor(target) : null;

  return (
    <main ref={rootRef} className={styles.root}>
      <div className={styles.map}>{openAt && <WorldMap openAt={openAt} onStyleReady={onStyleReady} />}</div>
      {target && words && (
        <EyeHud
          map={map}
          start={target.view}
          title={words.title}
          area={words.area}
          rows={[]}
          getBackHref={getBackHref}
          record={false}
        />
      )}
    </main>
  );
}
