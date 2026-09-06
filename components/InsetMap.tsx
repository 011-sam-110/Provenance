// components/InsetMap.tsx
"use client";
// A small, single-layer MapLibre map for detail views: renders one set of point
// features on the keyless OpenFreeMap Positron basemap, auto-fits to their bounds, and
// calls onSelect(id) when a point is clicked. Dependency-free beyond maplibre-gl
// (already used by the globe). NOT the 1379-line WorldMap — deliberately minimal.
import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { pointsToFC, boundsOf, type InsetPoint } from "@/lib/map/inset";
// The SAME style the console's Light basemap uses, read from the registry rather
// than re-typed. This file held its own copy of the old CARTO URL, which is exactly
// how eleven detail-view insets would have stayed on CARTO after the globe moved off
// it. See POSITRON_STYLE_URL for the full reasoning.
import { POSITRON_STYLE_URL } from "@/lib/basemaps";

const SRC = "inset-points";
const LAYER = "inset-point-circles";
const TRACK_SRC = "inset-track";
const TRACK_LAYER = "inset-track-line";
// Literal accent (the satellite layer's violet). Map layers use literal colours,
// consistent with the circle layer's literal "#0b1220" stroke below.
const TRACK_COLOR = "#7c3aed";


export default function InsetMap({
  points,
  height = 320,
  onSelect,
  onMapClick,
  track,
  selectedId,
  maxZoom = 6,
}: {
  points: InsetPoint[];
  height?: number;
  onSelect?: (id: string) => void;
  /** Optional: fired on a click NOT on a point (used for click-to-add-asset). */
  onMapClick?: (lat: number, lon: number) => void;
  /** Optional ground-track polyline: [lon,lat] segments (already antimeridian-split). */
  track?: [number, number][][];
  /** Highlights the matching point (enlarged, accent ring) — kept in sync with a row selection. */
  selectedId?: string;
  /**
   * How far the auto-fit is allowed to zoom in. Default 6 is what every existing caller
   * has always had, and it is right for them: a satellite's ground track spans continents
   * and a tight fit on one aircraft position tells a reader nothing.
   *
   * It is wrong for a set of points that are genuinely close together. The camera page's
   * neighbour map fits six cameras 0.6 km apart and rendered the whole of southern
   * England, because the fit wanted zoom ~15 and was capped at 6.
   */
  maxZoom?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const mapClickRef = useRef(onMapClick);
  mapClickRef.current = onMapClick;
  // Latest props for the async 'load' handler — it is registered once, so without these
  // it would paint the INITIAL selection if props changed during the style fetch.
  const pointsRef = useRef(points); pointsRef.current = points;
  const trackRef = useRef(track); trackRef.current = track;
  const maxZoomRef = useRef(maxZoom); maxZoomRef.current = maxZoom;
  // Auto-fit ONLY when the set of points changes (a new selection), not on every
  // position update — a moving caller (satellites re-propagate every 5s) would otherwise
  // re-snap the camera each tick and discard the user's manual pan/zoom.
  const fitKeyRef = useRef<string>("");

  // Create the map once.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: POSITRON_STYLE_URL,
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource(SRC, { type: "geojson", data: pointsToFC(pointsRef.current) });
      map.addLayer({
        id: LAYER,
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1,
          "circle-opacity": 0.9,
        },
      });
      map.on("click", LAYER, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string" && id) selectRef.current?.(id);
      });
      // Generic map click (add-asset mode) — only when the click missed a point.
      map.on("click", (e) => {
        if (!mapClickRef.current) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER] });
        if (hits.length === 0) mapClickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
      map.on("mouseenter", LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", LAYER, () => { map.getCanvas().style.cursor = ""; });
      syncTrack(map, trackRef.current);
      fit(map, pointsRef.current, trackRef.current, maxZoomRef.current);
      fitKeyRef.current = pointsKey(pointsRef.current);
    });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new features + refit when points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      src.setData(pointsToFC(points));
      syncTrack(map, track);
      // Re-fit only when the point set changes — preserves the user's pan/zoom while a
      // moving caller updates positions in place.
      const key = pointsKey(points);
      if (key !== fitKeyRef.current) { fit(map, points, track, maxZoom); fitKeyRef.current = key; }
    }
  }, [points, track, maxZoom]);

  // Highlight the selected point (enlarged + accent ring) whenever the selection changes.
  // Data-driven paint keyed off the feature id; an empty id matches nothing → all default.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer(LAYER)) return;
    const sel = selectedId ?? "";
    map.setPaintProperty(LAYER, "circle-radius", ["case", ["==", ["get", "id"], sel], 9, 6]);
    map.setPaintProperty(LAYER, "circle-stroke-color", ["case", ["==", ["get", "id"], sel], "#0e7d97", "#0b1220"]);
    map.setPaintProperty(LAYER, "circle-stroke-width", ["case", ["==", ["get", "id"], sel], 3, 1]);
  }, [selectedId, points]);

  return <div ref={boxRef} className="tn-inset-map" style={{ width: "100%", height }} />;
}

/** Identity of the point SET (ids, or coords when unkeyed) — used to gate auto-fit. */
function pointsKey(points: InsetPoint[]): string {
  return points.map((p) => p.id ?? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join("|");
}

function fit(map: maplibregl.Map, points: InsetPoint[], track: [number, number][][] | undefined, maxZoom: number) {
  const extra: InsetPoint[] = track ? track.flat().map(([lon, lat]) => ({ lat, lon })) : [];
  const b = boundsOf([...points, ...extra]);
  if (b) map.fitBounds(b, { padding: 40, maxZoom, duration: 0 });
}

// The optional ground-track polyline. Added LAZILY the first time a non-empty
// track arrives, so a caller that never passes `track` gets a byte-identical
// single-layer map (no extra source/layer registered at all).
function trackToFC(segs: [number, number][][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: segs }, properties: {} }],
  };
}

function syncTrack(map: maplibregl.Map, track?: [number, number][][]) {
  const segs = (track ?? []).filter((s) => s.length >= 2);
  const existing = map.getSource(TRACK_SRC) as GeoJSONSource | undefined;
  if (segs.length === 0) {
    if (existing) existing.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  if (existing) { existing.setData(trackToFC(segs)); return; }
  map.addSource(TRACK_SRC, { type: "geojson", data: trackToFC(segs) });
  // Insert BENEATH the point circles so the sub-point marker stays clickable on top.
  map.addLayer(
    {
      id: TRACK_LAYER,
      type: "line",
      source: TRACK_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": TRACK_COLOR, "line-width": 2, "line-opacity": 0.85 },
    },
    LAYER,
  );
}
