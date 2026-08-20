"use client";
// Unified world engine — ONE MapLibre GL JS map with globe projection.
//
// Replaces the old two-engine renderer (react-globe.gl GlobeView + MapLibre
// MapView, cross-faded by altitude). MapLibre v5 morphs a spinning 3D globe
// (zoomed out) into a flat street/satellite map (zoomed in) in a single canvas —
// continuous Google-Earth zoom, no cross-fade seam. Every live layer (cameras,
// planes + trails, satellites) is a MapLibre source/layer on this one map.
//
// Identity: calm + light. CARTO Positron is the default basemap; the globe is
// the hero; progressive disclosure keeps it from being dot-soup (cameras are a
// few soft glows far out, materialising into detailed icons on descent).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { WorldObject } from "@/lib/world";
import { overlay } from "@/lib/overlay";
import { cinematic } from "@/lib/cinematic/store";
import { computeDive } from "@/lib/cinematic/dive";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { useSatellites } from "@/lib/satellites/useSatellites";
import { usePlanes, type PlaneTrail, type PlanesLayer } from "@/lib/planes/usePlanes";
import { trackStore, useTrack, type TrackState } from "@/lib/planes/track";
import { pinsStore, useMapPins, type MapPin } from "@/lib/map/pins";
import { useLayers, layersStore, ACTIVE_LAYERS, type LayerState } from "@/lib/layers";
import { useCameraFilter, cameraFilterStore } from "@/lib/cameraFilter";
import { metricsStore } from "@/lib/metrics";
import { freshnessStore } from "@/lib/freshness";
import { mapViewStore, useMapView, type RegionView, type PointView, type DiveView } from "@/lib/mapView";
import { cameraFeed } from "@/lib/cameras/classify";
import { CAMERA_FEED_META, cameraRegionColor, WEBCAM_COLOR } from "@/lib/icons/svg";
import { BASEMAPS, type BasemapKey } from "@/lib/basemaps";
import {
  STYLE_LOAD_TIMEOUT_MS,
  classifyMapError,
  nextRecoveryStep,
  type MapLoadStatus,
} from "@/lib/map/resilience";
import { toCameraFC, toPlaneFC, toTrailFC, toSatelliteFC, toWebcamFC, toSignalFC, toSignalLineFC, toSignalFillFC } from "@/lib/map/features";
import {
  COUNTRY_HIT_LAYER,
  PIN_HIT_LAYERS,
  isCountryScopedSignal,
  resolveLineHit,
  resolveMapClickTarget,
  type MapClickHit,
} from "@/lib/map/hitTest";
import { toCountryLabelFC, buildCountryObject, type CountryProps } from "@/lib/geo/country";
// The Terminal chrome owns both of these contracts, so they are imported rather than
// re-declared here: the cursor event NAME (a second literal would drift the day one
// side is renamed) and the selection store the highlight ring is driven by.
import { MAP_CURSOR_EVENT } from "@/components/terminal/StageBar";
import { useTerminalSelection, type TerminalSelection } from "@/lib/terminal/selection";
import { loadCameraIcons, loadPlaneIcons, loadSatelliteIcons, loadWebcamIcons, loadSignalIcons } from "@/lib/map/icons";
import { setMapInstance } from "@/lib/map/instance";
import {
  CAMERA_CLUSTER,
  WEBCAM_CLUSTER,
  CLUSTER_FILL_OPACITY,
  clusterRadiusExpression,
  clusterTextSizeExpression,
  expandCluster,
} from "@/lib/map/cluster";
import { createThumbnailManager } from "@/lib/map/liveThumbnails";
// Map arming. Every rule lives in camslot.arm; this file supplies geometry and
// side effects and decides nothing. See the block above appendToArmedSlot for why
// none of it may be closed over.
import {
  armStore,
  useArmedSlot,
  camerasInBounds,
  normalizeBounds,
  orderByDistanceFrom,
  cadenceCap,
  planAppend,
  describeAppend,
  webcamRef,
  FALLBACK_REFRESH_SECONDS,
  type LatLon,
} from "@/lib/console/widgets/camslot.arm";
import { sanitizeCamslotConfig, type StreamRef } from "@/lib/console/widgets/camslot.model";
import { SIGNALS } from "@/lib/signals/registry";
import { useSignals, signalCountsStore } from "@/lib/signals/store";
import { signalFreshnessStore } from "@/lib/signals/freshness";
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { useTimeWindow, windowMsFor, withinWindow } from "@/lib/shell/timeWindow";
import { viewModeStore } from "@/lib/shell/viewMode";
import { useNow } from "@/lib/shell/useNow";
import {
  readInitialViewState,
  scheduleUrlWrite,
  cancelUrlWrite,
} from "@/lib/share/deepLink";

type Pt = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  available: boolean;
  source: string;
  country: string;
  live: boolean;
};

// Cluster paint, BUILT from lib/map/cluster rather than hand-typed here. The two
// used to be independent copies: the camera ramp read 15/19/24/30 and the webcam
// ramp 14/18/23/29, one pixel adrift at every tier, under a comment in cluster.ts
// promising a unit test that guarded them. No such test existed.
const CLUSTER_RADIUS_PAINT = clusterRadiusExpression();
const CLUSTER_TEXT_PAINT = clusterTextSizeExpression();

// Source / layer ids.
const CAM_SRC = "cameras";
const CAM_DOT_LAYER = "camera-dots"; // cheap glows — the zoomed-out representation (unclustered only)
const CAM_LAYER = "camera-markers"; // detailed feed/region icons — appear on descent (unclustered only)
const CAM_CLUSTER_LAYER = "camera-clusters"; // soft count badges that kill dot-soup
const CAM_CLUSTER_COUNT = "camera-cluster-count"; // numeric label on each cluster
const PLANE_SRC = "planes";
const PLANE_LAYER = "plane-markers";
const TRAIL_SRC = "trails";
const TRAIL_LAYER = "trail-lines";
// A single-feature ring drawn under the tracked plane's icon (see trackStore). Its
// own source so it updates independently of the plane layer and survives restyles.
const TRACK_SRC = "track-highlight";
const TRACK_RING_LAYER = "track-ring";
// The Terminal's cross-widget selection (lib/terminal/selection). Same shape as the
// tracked-plane ring above and for the same reason: a single-feature source that is
// empty when nothing is selected, so the layer costs nothing while idle and survives
// a basemap restyle through addAppLayers.
//
// This is NEW capability, not a restyle: before it, clicking a widget row flew the
// camera and opened a dossier but painted NOTHING on the map, so "the stage flies to
// it" ended with the user hunting for which of forty dots had just been chosen.
const SELECT_SRC = "selection-highlight";
const SELECT_RING_LAYER = "selection-ring";
// User-dropped pins (search bar + right-click). Rendered on top of everything.
const PIN_SRC = "user-pins";
const PIN_DOT_LAYER = "user-pin-dots";
const PIN_LABEL_LAYER = "user-pin-labels";
const SAT_SRC = "satellites";
const SAT_GLOW_LAYER = "satellite-glow";
const SAT_LAYER = "satellite-core";
const WEBCAM_SRC = "webcams";
const WEBCAM_DOT_LAYER = "webcam-dots"; // cheap rose glows when zoomed out (unclustered only)
const WEBCAM_LAYER = "webcam-markers"; // detailed webcam icons on descent (unclustered only)
const WEBCAM_CLUSTER_LAYER = "webcam-clusters"; // soft rose count badges
const WEBCAM_CLUSTER_COUNT = "webcam-cluster-count"; // numeric label on each cluster
const DEM_SRC = "terrain-dem";
const HILLSHADE_LAYER = "hillshade";
// Global signals — THREE aggregated sources carrying the union of every ON
// signal's features, split by geometry so each MapLibre layer type gets its own:
//   • SIGNAL_SRC   — points  → circle + label layers
//   • SIGNAL_LINE_SRC — LineString/MultiLineString → line layer (e.g. cables)
//   • SIGNAL_FILL_SRC — Polygon/MultiPolygon → fill + outline layers (e.g. jamming)
// The point circle layer is unaffected by line/area features (toSignalFC excludes
// them), and a click on ANY of them resolves to the SAME signal dossier.
const SIGNAL_SRC = "signals";
const SIGNAL_LAYER = "signal-dots";
const SIGNAL_ICON_LAYER = "signal-icons"; // white hazard pictogram drawn over the disc
const SIGNAL_LABEL = "signal-labels";
const SIGNAL_LINE_SRC = "signal-lines";
const SIGNAL_LINE_LAYER = "signal-line-paths";
// The cable you are pointing at, redrawn thick and opaque. With ~700 routes
// crossing each other, knowing a cable is under the cursor is not the same as
// knowing WHICH one — this answers that before the click, not after it.
const SIGNAL_LINE_HOVER = "signal-line-hover";
// Transparent, much wider copy of the line layer, used only as a hit target.
// See resolveLineHit in lib/map/hitTest.ts for what it is allowed to claim.
const SIGNAL_LINE_HIT = "signal-line-hit";
const SIGNAL_FILL_SRC = "signal-fills";
const SIGNAL_FILL_LAYER = "signal-fill-areas";
const SIGNAL_FILL_OUTLINE = "signal-fill-outline";
// Clickable countries — bundled Natural Earth polygons (borders + click hit-area)
// plus our own centroid name labels (raster basemaps only; Light labels itself).
const COUNTRY_SRC = "country-polys";
const COUNTRY_FILL_LAYER = COUNTRY_HIT_LAYER; // ~transparent hit-area, brightens on hover
const COUNTRY_BORDER_LAYER = "country-borders";
const COUNTRY_LABEL_SRC = "country-label-pts";
const COUNTRY_LABEL_LAYER = "country-labels";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** One point feature at the tracked plane's live position (empty when idle/lost). */
function toTrackFC(o: WorldObject | null | undefined): GeoJSON.FeatureCollection {
  if (!o) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [o.lon, o.lat] }, properties: {} }],
  };
}

/**
 * The Terminal selection → 0-or-1 point features.
 *
 * A selection without coordinates (a row for a country-wide reading, a market
 * ticker) yields an EMPTY collection rather than a feature at 0,0. Null Island is
 * the classic way a "we don't know where this is" becomes a confident pin in the
 * Gulf of Guinea, and the footer already says the honest thing ("—").
 */
function toSelectionFC(sel: TerminalSelection | null): GeoJSON.FeatureCollection {
  if (!sel || !Number.isFinite(sel.lat) || !Number.isFinite(sel.lon)) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [sel.lon as number, sel.lat as number] },
        properties: {},
      },
    ],
  };
}

/** User pins → point features (with the active flag driving the highlight paint). */
function toPinFC(pins: MapPin[], activeId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { label: p.label, active: p.id === activeId ? 1 : 0 },
    })),
  };
}

// The Light (Positron) vector basemap ships its own country names; the Satellite
// and Topographic rasters don't. Our name labels show only on the rasters.
const isRasterBasemap = (b: BasemapKey): boolean => b !== "positron";

// Every layer that takes part in the pin-vs-country arbitration (see
// lib/map/hitTest). Filtered to existing layers at call time — a layer id that is
// not in the current style makes queryRenderedFeatures throw.
const CLICK_ARBITRATION_LAYERS = [...PIN_HIT_LAYERS, COUNTRY_HIT_LAYER];

/**
 * Distil everything rendered under `point` into the pure hit-test's input.
 * MapLibre only reports layers that are actually visible, so a toggled-off layer
 * drops out on its own.
 */
function hitsAt(map: maplibregl.Map, point: maplibregl.MapLayerMouseEvent["point"]): MapClickHit[] {
  const layers = CLICK_ARBITRATION_LAYERS.filter((id) => map.getLayer(id));
  if (!layers.length) return [];
  return map.queryRenderedFeatures(point, { layers }).map((f) => {
    const signalId = (f.properties as { signalId?: unknown } | undefined)?.signalId;
    return { layer: f.layer.id, signalId: typeof signalId === "string" ? signalId : undefined };
  });
}

// Start zoomed out so the spinning globe is the hero. The palette / rail fly inward.
const HOME = { center: [-30, 28] as [number, number], zoom: 1.4 };
const SPIN_MAX_ZOOM = 4; // only auto-rotate while zoomed out this far
const SPIN_DEG_PER_SEC = 4; // calm rotation
const IDLE_RESUME_MS = 4000; // resume spin this long after the last user input
const TERRAIN_MIN_ZOOM = 6; // 3D terrain only engages in the mercator regime (setTerrain crashes on globe projection)

const vis = (on: boolean): "visible" | "none" => (on ? "visible" : "none");

// Run `fn` once the map's style is fully loaded. MapLibre's setProjection (and
// other style ops) throw "Style is not done loading" if called mid-load — and
// that throw, uncaught, crashes the whole app (React error boundary). On first
// mount and during a basemap setStyle the style is briefly not ready, so any
// caller that can fire at an arbitrary time (e.g. the view-mode → projection
// sync) MUST defer through this guard instead of calling setProjection directly.
function whenStyleReady(map: maplibregl.Map, fn: () => void): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const onData = () => {
    if (!map.isStyleLoaded()) return; // styledata fires repeatedly during load
    map.off("styledata", onData);
    fn();
  };
  map.on("styledata", onData);
}

// ── Map arming: ONE resolver, four entry points ──────────────────────────────
//
// These are MODULE-scope on purpose, and they take everything they need as
// arguments or read it from a store at call time. Two of their four callers are
// frozen closures — `wireInteractions` is a useCallback(…, []) run once at mount,
// and `createThumbnailManager`'s onPick is built inside the init effect — so a
// helper that closed over any React value would work in whichever state the map
// mounted in and never change again.
//
// The reason there is ONE resolver rather than a patch per call site is measured,
// not stylistic. At z13 over central London the map draws 97 individual camera pins
// and 24 live-thumbnail buttons; the buttons stopPropagation (liveThumbnails.ts:58)
// so they never reach the layer handler, and which of the two a given camera gets
// depends on MAX_THUMBS and on `available`. Two code paths that can disagree about
// what an armed click means would disagree for 24 cameras out of 97, side by side,
// at the same zoom — a bug no manual click-test would reliably find.

interface ArmCandidate extends LatLon {
  ref: StreamRef;
  refreshSeconds?: number;
  available?: boolean;
}

function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}

/** Mirrors camslot.tsx:32 — Windy's image tokens last ~10 minutes and
 *  /api/webcam-image is bounded by that. */
const WEBCAM_REFRESH_SECONDS = 600;


/** The cadence of a stream already in the slot. Road cameras are the only kind that
 *  varies, and loadedCamerasStore is the only place the client holds it. */
function refreshForRef(ref: StreamRef): number | undefined {
  if (ref.k === "webcam") return WEBCAM_REFRESH_SECONDS;
  if (ref.k === "yt") return undefined; // an embed is not polled; it has no cadence
  return loadedCamerasStore.get().find((c) => c.id === ref.id)?.refreshSeconds;
}

/**
 * Append candidates to the armed slot, if one is armed.
 *
 * Returns TRUE when the gesture was consumed, so every caller can bail before
 * doing its normal job. Consumption is decided synchronously and does not depend
 * on whether anything was actually added: an armed click on a camera already in
 * the slot still belongs to arming, and still owes the user a visible answer
 * rather than a silent nothing or a surprise dossier.
 *
 * The write is async because the layout store is imported lazily — the same shape
 * camslot.picker.tsx:165-169 uses, and for the same reason: it keeps the console
 * store out of the map's import graph.
 */
function appendToArmedSlot(candidates: ArmCandidate[], centre: LatLon): boolean {
  const instanceId = armStore.get();
  if (!instanceId) return false;

  void import("@/lib/console/store").then(({ shellLayoutStore }) => {
    const widget = shellLayoutStore.get().widgets.find((w) => w.id === instanceId);
    if (!widget) {
      // The armed slot was removed from the board while the mode was on.
      armStore.disarm();
      toast("That slot is gone — arming turned off.");
      return;
    }
    // Read the playlist from the STORE, never from a value captured when the mode
    // was armed: between arming and clicking, the picker or another append may have
    // changed it, and writing a stale array would silently drop those streams.
    const cfg = sanitizeCamslotConfig(widget.config);

    const ordered = orderByDistanceFrom(candidates, centre);
    // The cap is set by the FASTEST-refreshing member of the resulting playlist, so
    // the streams already in the slot count too — appending a 60s camera to a slot of
    // 300s ones is exactly the case that moves it, and ignoring the existing members
    // would let the cap drift up every time the user clicked.
    const cadences = [
      ...cfg.streams.map(refreshForRef),
      ...ordered.map((c) => c.refreshSeconds),
    ];
    const cap = cadenceCap(cadences, cfg.intervalMs);
    const plan = planAppend(cfg.streams, ordered.map((c) => c.ref), cap);
    const resolved = cadences.map((s) =>
      typeof s === "number" && s > 0 ? s : FALLBACK_REFRESH_SECONDS,
    );
    const capSetBySeconds = Math.min(...resolved, FALLBACK_REFRESH_SECONDS);
    const capMixed = new Set(resolved).size > 1;

    if (plan.next) shellLayoutStore.configure(instanceId, { streams: plan.next });
    toast(
      describeAppend(plan, {
        available: candidates.filter((c) => c.available !== false).length,
        cap,
        capSetBySeconds,
        capMixed,
      }),
    );
  });

  return true;
}

/** One road camera, from either the layer click or a live-thumbnail button. */
function armedPickCamera(id: string, lat: number, lon: number): boolean {
  if (!armStore.get()) return false;
  // The store row is the only place a per-camera cadence exists on the client.
  const row = loadedCamerasStore.get().find((c) => c.id === id);
  return appendToArmedSlot(
    [{ ref: { k: "cam", id }, lat, lon, refreshSeconds: row?.refreshSeconds, available: row?.available }],
    { lat, lon },
  );
}

/**
 * An armed click on a cluster badge appends its leaves instead of zooming.
 *
 * `point_count` from the badge is the honest denominator — it is the number the user
 * can see printed on the circle they clicked — so it is what we ask for and what the
 * note reports. Every failure path here still ends in a toast: an armed click that
 * produced no visible consequence is the one outcome this interception exists to
 * prevent, and "the map moved a bit" does not count as one.
 */
async function appendClusterLeaves(
  map: maplibregl.Map,
  sourceId: string,
  clusterId: number,
  centre: [number, number],
  pointCount: number,
): Promise<void> {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!src || typeof src.getClusterLeaves !== "function") {
    toast("Couldn't read that group — zoom in and pick the pins directly.");
    return;
  }

  let leaves: GeoJSON.Feature[] = [];
  try {
    leaves = await src.getClusterLeaves(clusterId, Math.max(pointCount, 1), 0);
  } catch {
    toast("Couldn't read that group — zoom in and pick the pins directly.");
    return;
  }

  const isWebcam = sourceId === WEBCAM_SRC;
  const rows = loadedCamerasStore.get();
  const candidates: ArmCandidate[] = [];
  for (const leaf of leaves) {
    if (leaf.geometry?.type !== "Point") continue;
    const props = leaf.properties as { id?: string; name?: string } | null;
    const id = props?.id;
    if (!id) continue;
    const [lon, lat] = leaf.geometry.coordinates as [number, number];
    if (isWebcam) {
      // toWebcamFC puts the title in `name` (features.ts:82).
      candidates.push({
        ref: webcamRef(id, props?.name),
        lat,
        lon,
        refreshSeconds: WEBCAM_REFRESH_SECONDS,
      });
    } else {
      const row = rows.find((c) => c.id === id);
      candidates.push({
        ref: { k: "cam", id },
        lat,
        lon,
        refreshSeconds: row?.refreshSeconds,
        available: row?.available,
      });
    }
  }

  if (candidates.length === 0) {
    toast("That group is empty now — nothing to add.");
    return;
  }
  appendToArmedSlot(candidates, { lat: centre[1], lon: centre[0] });
}

/**
 * Shift-drag a box → append everything inside it.
 *
 * Covers the road cameras in `loadedCamerasStore` and the webcams already drawn on
 * the map. It deliberately does NOT fire /api/webcam-search per drag: §3.1 says that
 * route fires only on an explicit search, never on pan, and §15 lists Windy's request
 * ceiling as undocumented and unmeasured. A map gesture is not an explicit search, and
 * a drag-triggered fan-out is precisely the "going wide" that risk is about. The note
 * says what was covered instead of quietly covering less.
 */
function appendBoxSelection(bounds: ReturnType<typeof normalizeBounds>, webcams: WorldObject[]): void {
  const rows = loadedCamerasStore.get();
  const cams = camerasInBounds(rows, bounds);
  const cover = camerasInBounds(webcams, bounds);

  if (rows.length === 0 && webcams.length === 0) {
    // The store is populated only while the camera layer is on (WorldMap:1859), so an
    // empty result here means "we were not looking", not "there is nothing there".
    toast("No camera pins are loaded, so a box has nothing to select. Turn on the Cameras layer.");
    return;
  }
  if (cams.length === 0 && cover.length === 0) {
    toast("No cameras inside that box.");
    return;
  }

  const candidates: ArmCandidate[] = [
    ...cams.map((c) => ({
      ref: { k: "cam", id: c.id } as StreamRef,
      lat: c.lat,
      lon: c.lon,
      refreshSeconds: c.refreshSeconds,
      available: c.available,
    })),
    ...cover.map((w) => ({
      ref: webcamRef(w.id, w.label),
      lat: w.lat,
      lon: w.lon,
      refreshSeconds: WEBCAM_REFRESH_SECONDS,
    })),
  ];

  appendToArmedSlot(candidates, {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  });
}

export default function WorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const thumbMgrRef = useRef<{ update(): void; destroy(): void } | null>(null);
  const readyRef = useRef(false);
  // Basemap load resilience (lib/map/resilience.ts). The "Light" basemap is a REMOTE
  // style URL, so one flaky fetch used to leave a permanent black rectangle with
  // nothing on screen explaining it. These drive retry → fallback → an honest notice.
  const styleAttemptsRef = useRef(0);
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadStatus, setLoadStatus] = useState<MapLoadStatus>({ kind: "ok" });
  const rafRef = useRef(0);
  const interactUntilRef = useRef(0);
  const terrainRef = useRef(true);
  // Plane-tracking (see lib/planes/track). trackingRef mirrors the store for the
  // spin loop + input handlers (no re-render); trackedObjectRef holds the tracked
  // plane's latest WorldObject so addAppLayers can re-seed the ring after a restyle;
  // followMoveRef marks a programmatic follow easeTo so its moveend skips the URL write.
  const trackingRef = useRef<TrackState>({ id: null, label: "", mode: "follow" });
  const trackedObjectRef = useRef<WorldObject | null>(null);
  const followMoveRef = useRef(false);
  // Latest user pins, so addAppLayers can re-seed the pin source after a restyle.
  const pinsRef = useRef<{ pins: MapPin[]; activeId: string | null }>({ pins: [], activeId: null });
  // Same job for the Terminal's selection ring.
  const selectionRef = useRef<TerminalSelection | null>(null);
  // A deep-linked object id (?obj=) waiting to be resolved once its layer's data
  // has streamed in — see the restore effect below. Cleared after it opens.
  const pendingObjRef = useRef<string | null>(null);

  const [pts, setPts] = useState<Pt[]>([]);
  // Right-click "Add pin here" menu — screen position + the geo point under it.
  const [pinMenu, setPinMenu] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);
  // The cable route under the cursor — name + where to float it. Paired with the
  // SIGNAL_LINE_HOVER highlight so "which of these 697 lines am I about to open?"
  // is answered before the click rather than by it.
  const [lineHover, setLineHover] = useState<{ x: number; y: number; label: string } | null>(null);

  // Live-layer data is lifted into state from gating <…Feed> children so that a
  // hidden layer's hook (and its fetch/tick) is unmounted entirely — see the
  // bottom of this file. basemap + terrain are shared via the mapView store so
  // the top bar can drive them.
  const [satellites, setSatellites] = useState<WorldObject[]>([]);
  const [planesLayer, setPlanesLayer] = useState<PlanesLayer>({ objects: [], trails: [] });
  const [webcams, setWebcams] = useState<WorldObject[]>([]);
  // Global signals are merged from per-source <SignalFeed> children into one map
  // (id → that source's objects); `signals` is the flattened union the aggregated
  // MapLibre source renders. Toggling a signal off unmounts its feed, which clears
  // its slot here — so a hidden signal contributes nothing and never fetches.
  const [signals, setSignals] = useState<WorldObject[]>([]);
  const signalChunksRef = useRef<Record<string, WorldObject[]>>({});
  // Bundled country polygons, fetched once. addAppLayers re-seeds the source from
  // this ref after every basemap swap (setStyle wipes the source).
  const countryGeoRef = useRef<GeoJSON.FeatureCollection | null>(null);

  const view = useMapView();
  const basemap = view.basemap;
  const terrainOn = view.terrain;
  const layers = useLayers();
  const track = useTrack();
  trackingRef.current = track; // keep the spin loop / input handlers current without a re-subscribe
  const pins = useMapPins();
  pinsRef.current = pins;
  // Subscribing the map to the selection is cheap in the way the cursor readout is
  // not: a selection changes when the user clicks a widget row, so this re-renders
  // on a human action, never on a pointer move or a poll tick.
  const selection = useTerminalSelection();
  selectionRef.current = selection;
  // Which slot the map is currently filling, or null. Read as a HOOK here because
  // this is the render path — the ring, the cursor and the hint are React's job. The
  // event handlers deliberately do not use this value; they call armStore.get().
  const armedSlot = useArmedSlot();
  const camFilter = useCameraFilter();
  const signalsState = useSignals();
  // Global time-window filter (M-final): trims time-stamped signals by recency.
  // A coarse 30s clock re-evaluates the filter a couple of times a minute (the
  // windows are ≥1h, so a fast clock would only churn renders for nothing).
  const timeWindow = useTimeWindow();
  const windowMs = windowMsFor(timeWindow);
  const nowCoarse = useNow(30_000);

  // Cameras → WorldObject[] (shape = feed, colour = region).
  const cameraObjects = useMemo<WorldObject[]>(
    () =>
      pts.map((p) => {
        const feed = cameraFeed(p.live);
        const meta = CAMERA_FEED_META[feed];
        const color = cameraRegionColor(p.source);
        return {
          kind: "camera",
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          label: p.name,
          color,
          icon: meta.key,
          typeLabel: meta.label,
          meta: { available: p.available, source: p.source, country: p.country, live: p.live, feed },
        };
      }),
    [pts],
  );

  // Apply the camera sub-filters (region + live-only). camFilter is the dep.
  const filteredCameras = useMemo<WorldObject[]>(
    () =>
      cameraObjects.filter((c) =>
        cameraFilterStore.passes((c.meta?.source as string) ?? "", Boolean(c.meta?.live)),
      ),
    [cameraObjects, camFilter],
  );

  // --- Shared stores the calm shell reads (counts + freshness) ----------------
  // Cameras "online" = feeds currently reachable. Camera freshness is recorded by
  // <CamerasFeed> on fetch; planes/satellites are recorded here as their data
  // arrives. Satellites are local (propagated in-browser) so we only stamp them
  // on a count change, never per 1s tick — keeps the chrome from re-rendering.
  const camerasOnline = useMemo(() => pts.filter((p) => p.available).length, [pts]);
  useEffect(() => {
    metricsStore.set({ camerasOnline, camerasTotal: pts.length });
  }, [camerasOnline, pts.length]);
  useEffect(() => {
    metricsStore.set({ planes: planesLayer.objects.length });
    freshnessStore.record("planes", { count: planesLayer.objects.length, ok: true });
  }, [planesLayer]);
  const satCountRef = useRef(-1);
  useEffect(() => {
    metricsStore.set({ satellites: satellites.length });
    if (satellites.length !== satCountRef.current) {
      satCountRef.current = satellites.length;
      freshnessStore.record("satellites", { count: satellites.length, ok: true });
    }
  }, [satellites]);
  useEffect(() => {
    metricsStore.set({ webcams: webcams.length });
  }, [webcams]);

  // Refs holding the latest data so addAppLayers (called on every style.load,
  // i.e. each basemap swap) can re-seed sources, and clicks can resolve objects.
  const camerasRef = useRef<WorldObject[]>([]);
  camerasRef.current = filteredCameras;
  const planesRef = useRef<WorldObject[]>([]);
  planesRef.current = planesLayer.objects;
  const trailsRef = useRef<PlaneTrail[]>([]);
  trailsRef.current = planesLayer.trails;
  const satsRef = useRef<WorldObject[]>([]);
  satsRef.current = satellites;
  const webcamsRef = useRef<WorldObject[]>([]);
  webcamsRef.current = webcams;
  // Time-window-filtered signals — what the map actually renders. Untimed features
  // (no `ts`) pass through unconditionally (withinWindow returns true), so the
  // filter only ever hides timed events that are older than the chosen window.
  const visibleSignals = useMemo(
    () => signals.filter((s) => withinWindow(s.meta?.ts as string | undefined, windowMs, nowCoarse)),
    [signals, windowMs, nowCoarse],
  );
  const signalsRef = useRef<WorldObject[]>([]);
  signalsRef.current = visibleSignals;
  const layersRef = useRef<LayerState>(layers);
  layersRef.current = layers;

  // Merge one signal source's objects into the aggregated set. A SignalFeed calls
  // this with its features on load and with [] on unmount (toggle-off), so the
  // union always reflects exactly the ON signals — no per-layer WorldMap code.
  const mergeSignalChunk = useCallback((id: string, objs: WorldObject[]) => {
    const next = { ...signalChunksRef.current };
    if (objs.length) next[id] = objs;
    else delete next[id];
    signalChunksRef.current = next;
    setSignals(Object.values(next).flat());
  }, []);

  // --- Map helpers (stable; read from refs) --------------------------------

  // 3D terrain (setTerrain) CRASHES MapLibre's depth pass on globe projection
  // ("Cannot read properties of undefined (reading 'shaderPreludeCode')"), so only
  // engage true 3D once we've zoomed into the mercator regime. Hillshade relief is
  // a normal layer and is safe at any zoom, so it follows the toggle directly.
  const syncTerrain = useCallback((map: maplibregl.Map) => {
    const on = terrainRef.current && map.getZoom() >= TERRAIN_MIN_ZOOM;
    try {
      map.setTerrain(on ? { source: DEM_SRC, exaggeration: 1.3 } : null);
    } catch {
      /* terrain can briefly fight a freshly-swapped style; harmless */
    }
  }, []);

  const applyTerrain = useCallback(
    (map: maplibregl.Map, on: boolean) => {
      if (map.getLayer(HILLSHADE_LAYER)) {
        map.setLayoutProperty(HILLSHADE_LAYER, "visibility", vis(on));
      }
      syncTerrain(map);
    },
    [syncTerrain],
  );

  const applyVisibility = useCallback((map: maplibregl.Map, l: LayerState) => {
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(on));
    };
    set(CAM_DOT_LAYER, l.cameras);
    set(CAM_LAYER, l.cameras);
    set(CAM_CLUSTER_LAYER, l.cameras);
    set(CAM_CLUSTER_COUNT, l.cameras);
    set(SAT_GLOW_LAYER, l.satellites);
    set(SAT_LAYER, l.satellites);
    set(WEBCAM_DOT_LAYER, l.webcams);
    set(WEBCAM_LAYER, l.webcams);
    set(WEBCAM_CLUSTER_LAYER, l.webcams);
    set(WEBCAM_CLUSTER_COUNT, l.webcams);
    set(TRAIL_LAYER, l.planes);
    set(PLANE_LAYER, l.planes);
    // Countries: borders + click everywhere; name labels only on the raster basemaps.
    set(COUNTRY_FILL_LAYER, l.countries);
    set(COUNTRY_BORDER_LAYER, l.countries);
    set(COUNTRY_LABEL_LAYER, l.countries && isRasterBasemap(mapViewStore.get().basemap));
  }, []);

  const ensureGeoJSON = useCallback(
    (
      map: maplibregl.Map,
      id: string,
      data: GeoJSON.FeatureCollection,
      cluster?: { clusterRadius: number; clusterMaxZoom: number },
    ) => {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      // Cluster options are fixed at source-creation; setData just refreshes the
      // points (MapLibre re-clusters them off-main-thread).
      if (src) src.setData(data);
      else if (cluster)
        map.addSource(id, {
          type: "geojson",
          data,
          cluster: true,
          clusterRadius: cluster.clusterRadius,
          clusterMaxZoom: cluster.clusterMaxZoom,
        });
      else map.addSource(id, { type: "geojson", data });
    },
    [],
  );

  // Re-add every app source/layer onto the current style. Idempotent, so it runs
  // safely on the first load AND after each basemap swap (setStyle wipes them).
  const addAppLayers = useCallback(
    async (map: maplibregl.Map) => {
      // Projection follows the view mode: flat (console, default) vs globe (Explore).
      const wantProjection = viewModeStore.get() === "explore" ? "globe" : "mercator";
      try {
        map.setProjection({ type: wantProjection });
      } catch {
        /* older styles ignore this */
      }

      // Keyless 3D terrain (AWS Terrarium DEM) + hillshade relief.
      if (!map.getSource(DEM_SRC)) {
        map.addSource(DEM_SRC, {
          type: "raster-dem",
          tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 14,
          attribution: "Elevation: Terrain Tiles (AWS Open Data)",
        });
      }
      if (!map.getLayer(HILLSHADE_LAYER)) {
        map.addLayer({
          id: HILLSHADE_LAYER,
          type: "hillshade",
          source: DEM_SRC,
          layout: { visibility: vis(terrainRef.current) },
          paint: {
            "hillshade-exaggeration": 0.4,
            "hillshade-shadow-color": "#52606d",
            "hillshade-highlight-color": "#ffffff",
          },
        });
      }
      applyTerrain(map, terrainRef.current);

      // Symbol icons are wiped by setStyle — re-rasterise/register them.
      await Promise.all([
        loadCameraIcons(map),
        loadPlaneIcons(map),
        loadSatelliteIcons(map),
        loadWebcamIcons(map),
        loadSignalIcons(map),
      ]);

      // Sources, seeded from the latest refs. Cameras + webcams cluster (kills
      // dot-soup at world zoom); planes/trails/satellites stay individual.
      ensureGeoJSON(map, TRAIL_SRC, toTrailFC(trailsRef.current));
      ensureGeoJSON(map, SAT_SRC, toSatelliteFC(satsRef.current));
      ensureGeoJSON(map, CAM_SRC, toCameraFC(camerasRef.current), CAMERA_CLUSTER);
      ensureGeoJSON(map, WEBCAM_SRC, toWebcamFC(webcamsRef.current), WEBCAM_CLUSTER);
      ensureGeoJSON(map, PLANE_SRC, toPlaneFC(planesRef.current));
      ensureGeoJSON(map, TRACK_SRC, toTrackFC(trackedObjectRef.current));
      ensureGeoJSON(map, SELECT_SRC, toSelectionFC(selectionRef.current));
      ensureGeoJSON(map, PIN_SRC, toPinFC(pinsRef.current.pins, pinsRef.current.activeId));
      ensureGeoJSON(map, SIGNAL_FILL_SRC, toSignalFillFC(signalsRef.current));
      ensureGeoJSON(map, SIGNAL_LINE_SRC, toSignalLineFC(signalsRef.current));
      ensureGeoJSON(map, SIGNAL_SRC, toSignalFC(signalsRef.current));

      // Clickable countries — added FIRST so borders/labels sit beneath every pin.
      // generateId powers the hover feature-state; the polygons stream in via the
      // fetch in the init effect (empty until then). Name labels: raster basemaps only.
      const countryRaster = isRasterBasemap(mapViewStore.get().basemap);
      if (!map.getSource(COUNTRY_SRC)) {
        map.addSource(COUNTRY_SRC, {
          type: "geojson",
          data: countryGeoRef.current ?? EMPTY_FC,
          generateId: true,
        });
      } else {
        (map.getSource(COUNTRY_SRC) as GeoJSONSource).setData(countryGeoRef.current ?? EMPTY_FC);
      }
      ensureGeoJSON(map, COUNTRY_LABEL_SRC, toCountryLabelFC());

      if (!map.getLayer(COUNTRY_FILL_LAYER)) {
        map.addLayer({
          id: COUNTRY_FILL_LAYER,
          type: "fill",
          source: COUNTRY_SRC,
          layout: { visibility: vis(layersRef.current.countries) },
          paint: {
            "fill-color": "#ffffff",
            // Invisible until hovered, then a faint wash so the country reads as one
            // clickable unit over the photographic imagery.
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.12, 0],
          },
        });
      }
      if (!map.getLayer(COUNTRY_BORDER_LAYER)) {
        map.addLayer({
          id: COUNTRY_BORDER_LAYER,
          type: "line",
          source: COUNTRY_SRC,
          layout: { "line-join": "round", visibility: vis(layersRef.current.countries) },
          paint: {
            // Light hairline on the dark/photographic rasters; a touch darker on the
            // already-bordered Light basemap so it never reads as a heavy double line.
            "line-color": countryRaster ? "#f1f5f9" : "#475569",
            "line-opacity": countryRaster ? 0.4 : 0.32,
            "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 3, 0.7, 6, 1, 12, 1.4],
          },
        });
      }
      if (!map.getLayer(COUNTRY_LABEL_LAYER)) {
        map.addLayer({
          id: COUNTRY_LABEL_LAYER,
          type: "symbol",
          source: COUNTRY_LABEL_SRC,
          maxzoom: 6.5, // a country name belongs to the overview, not the street level
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Regular"], // served by CARTO_GLYPHS on every basemap
            "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 3, 11, 5, 13],
            "text-transform": "uppercase",
            "text-letter-spacing": 0.08,
            "text-max-width": 7,
            "text-padding": 6,
            visibility: vis(layersRef.current.countries && countryRaster),
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(15,23,42,0.85)",
            "text-halo-width": 1.4,
            "text-opacity": 0.92,
          },
        });
      }

      // Layers, bottom → top.
      if (!map.getLayer(TRAIL_LAYER)) {
        map.addLayer({
          id: TRAIL_LAYER,
          type: "line",
          source: TRAIL_SRC,
          layout: { "line-cap": "round", "line-join": "round", visibility: vis(layersRef.current.planes) },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 10, 2, 15, 3],
            "line-opacity": 0.5,
          },
        });
      }
      if (!map.getLayer(SAT_GLOW_LAYER)) {
        map.addLayer({
          id: SAT_GLOW_LAYER,
          type: "circle",
          source: SAT_SRC,
          layout: { visibility: vis(layersRef.current.satellites) },
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 7, 4, 11, 8, 16],
            "circle-blur": 1,
            "circle-opacity": 0.45,
          },
        });
      }
      if (!map.getLayer(SAT_LAYER)) {
        // Type icon (coloured by SAT_META) so satellites read clearly on ANY
        // basemap — the tiny grey dots vanished on the light globe.
        map.addLayer({
          id: SAT_LAYER,
          type: "symbol",
          source: SAT_SRC,
          layout: {
            // Fall back to sat-other so an unmapped/late category never renders blank.
            "icon-image": ["coalesce", ["image", ["get", "icon"]], ["image", "sat-other"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 4, 0.6, 9, 0.85],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            visibility: vis(layersRef.current.satellites),
          },
        });
      }
      if (!map.getLayer(CAM_DOT_LAYER)) {
        map.addLayer({
          id: CAM_DOT_LAYER,
          type: "circle",
          source: CAM_SRC,
          filter: ["!", ["has", "point_count"]], // singletons only; groups → cluster badges
          layout: { visibility: vis(layersRef.current.cameras) },
          paint: {
            // Live → region colour; down → muted slate (= CAMERA_OFFLINE_COLOR) so
            // a dead feed reads as dead even as a faint glow.
            "circle-color": ["case", ["get", "available"], ["get", "regionColor"], "#9aa6b2"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.3, 3, 2, 6, 3, 9, 4],
            // Fade the cheap glows out as the detailed markers (minzoom 5) fade in.
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 3, 0.65, 5, 0.45, 6, 0],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0, 5, 0.5],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 6, 0.5],
          },
        });
      }
      if (!map.getLayer(CAM_LAYER)) {
        map.addLayer({
          id: CAM_LAYER,
          type: "symbol",
          source: CAM_SRC,
          minzoom: 5,
          filter: ["!", ["has", "point_count"]], // singletons only; groups → cluster badges
          layout: {
            // icon name = "cam-<feed>-<regionKey>", or the muted "cam-<feed>-offline"
            // variant when the feed is down — matches loadCameraIcons().
            "icon-image": [
              "case",
              ["get", "available"],
              ["concat", "cam-", ["get", "feed"], "-", ["get", "regionKey"]],
              ["concat", "cam-", ["get", "feed"], "-offline"],
            ],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 9, 0.55, 13, 0.7, 17, 0.9],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            visibility: vis(layersRef.current.cameras),
          },
          paint: { "icon-opacity": ["case", ["get", "available"], 1, 0.45] },
        });
      }
      if (!map.getLayer(CAM_CLUSTER_LAYER)) {
        // Soft cyan count badge — the zoomed-out group representation that kills
        // dot-soup. Radius grows in gentle tiers (mirrors CLUSTER_RADIUS_TIERS).
        map.addLayer({
          id: CAM_CLUSTER_LAYER,
          type: "circle",
          source: CAM_SRC,
          filter: ["has", "point_count"],
          layout: { visibility: vis(layersRef.current.cameras) },
          paint: {
            "circle-color": "#0ea5e9",
            "circle-opacity": CLUSTER_FILL_OPACITY,
            "circle-radius": CLUSTER_RADIUS_PAINT as never,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.9,
          },
        });
      }
      if (!map.getLayer(CAM_CLUSTER_COUNT)) {
        map.addLayer({
          id: CAM_CLUSTER_COUNT,
          type: "symbol",
          source: CAM_SRC,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Regular"], // served by CARTO_GLYPHS on every basemap
            "text-size": CLUSTER_TEXT_PAINT as never,
            "text-allow-overlap": true,
            visibility: vis(layersRef.current.cameras),
          },
          paint: { "text-color": "#ffffff" },
        });
      }
      if (!map.getLayer(WEBCAM_DOT_LAYER)) {
        map.addLayer({
          id: WEBCAM_DOT_LAYER,
          type: "circle",
          source: WEBCAM_SRC,
          filter: ["!", ["has", "point_count"]], // singletons only; groups → cluster badges
          layout: { visibility: vis(layersRef.current.webcams) },
          paint: {
            "circle-color": WEBCAM_COLOR,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.3, 3, 2, 6, 3, 9, 4],
            // Fade the cheap glows out as the detailed icons (minzoom 5) fade in.
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 3, 0.65, 5, 0.45, 6, 0],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 0, 0, 5, 0.5],
            "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 6, 0.5],
          },
        });
      }
      if (!map.getLayer(WEBCAM_LAYER)) {
        map.addLayer({
          id: WEBCAM_LAYER,
          type: "symbol",
          source: WEBCAM_SRC,
          minzoom: 5,
          filter: ["!", ["has", "point_count"]], // singletons only; groups → cluster badges
          layout: {
            "icon-image": "webcam",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.32, 9, 0.5, 13, 0.65, 17, 0.85],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            visibility: vis(layersRef.current.webcams),
          },
        });
      }
      if (!map.getLayer(WEBCAM_CLUSTER_LAYER)) {
        // Rose count badge — the webcam analogue of the camera cluster badge.
        map.addLayer({
          id: WEBCAM_CLUSTER_LAYER,
          type: "circle",
          source: WEBCAM_SRC,
          filter: ["has", "point_count"],
          layout: { visibility: vis(layersRef.current.webcams) },
          paint: {
            "circle-color": WEBCAM_COLOR,
            "circle-opacity": CLUSTER_FILL_OPACITY,
            "circle-radius": CLUSTER_RADIUS_PAINT as never,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.9,
          },
        });
      }
      if (!map.getLayer(WEBCAM_CLUSTER_COUNT)) {
        map.addLayer({
          id: WEBCAM_CLUSTER_COUNT,
          type: "symbol",
          source: WEBCAM_SRC,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Regular"],
            "text-size": CLUSTER_TEXT_PAINT as never,
            "text-allow-overlap": true,
            visibility: vis(layersRef.current.webcams),
          },
          paint: { "text-color": "#ffffff" },
        });
      }
      // Tracked-plane ring — a prominent stroked halo under the icon so the followed
      // aircraft is unmistakable at any zoom. Empty source ⇒ invisible when idle.
      if (!map.getLayer(TRACK_RING_LAYER)) {
        map.addLayer({
          id: TRACK_RING_LAYER,
          type: "circle",
          source: TRACK_SRC,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 6, 18, 11, 26, 15, 34],
            "circle-color": "#0e7d97",
            "circle-opacity": 0.14,
            "circle-stroke-color": "#0e7d97",
            "circle-stroke-width": 2.5,
            "circle-stroke-opacity": 0.9,
          },
        });
      }
      if (!map.getLayer(PLANE_LAYER)) {
        map.addLayer({
          id: PLANE_LAYER,
          type: "symbol",
          source: PLANE_SRC,
          layout: {
            "icon-image": ["concat", "plane-", ["get", "category"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 7, 0.6, 11, 0.8, 15, 1],
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            visibility: vis(layersRef.current.planes),
          },
        });
      }
      // Global signals — AREA fill (Polygon/MultiPolygon, e.g. GPS jamming). Added
      // first so it sits beneath the line + circle layers; per-feature `color`
      // tints both the fill and its outline. Always visible (source = ON signals).
      if (!map.getLayer(SIGNAL_FILL_LAYER)) {
        map.addLayer({
          id: SIGNAL_FILL_LAYER,
          type: "fill",
          source: SIGNAL_FILL_SRC,
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": 0.28,
          },
        });
      }
      if (!map.getLayer(SIGNAL_FILL_OUTLINE)) {
        map.addLayer({
          id: SIGNAL_FILL_OUTLINE,
          type: "line",
          source: SIGNAL_FILL_SRC,
          paint: {
            "line-color": ["get", "color"],
            "line-width": 1,
            "line-opacity": 0.7,
          },
        });
      }
      // Global signals — LINE layer (LineString/MultiLineString, e.g. submarine
      // cables). Thin, per-feature coloured, gently thickening with zoom.
      if (!map.getLayer(SIGNAL_LINE_LAYER)) {
        map.addLayer({
          id: SIGNAL_LINE_LAYER,
          type: "line",
          source: SIGNAL_LINE_SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            // Nudged up from 0.6/1.1/2. At the old low-zoom width a cable was a
            // sub-pixel ghost on a satellite basemap — visible enough to look
            // like an artefact, not enough to look like a thing you can open.
            "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 4, 1.6, 10, 2.6],
            "line-opacity": 0.8,
          },
        });
      }
      // The hovered route, over the top: same geometry, thick and opaque. Filtered
      // to nothing until a pointer resolves to a cable (setFilter in wireInteractions).
      if (!map.getLayer(SIGNAL_LINE_HOVER)) {
        map.addLayer({
          id: SIGNAL_LINE_HOVER,
          type: "line",
          source: SIGNAL_LINE_SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          filter: ["==", ["get", "id"], "__none__"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 0, 2.6, 4, 3.4, 10, 5],
            "line-opacity": 1,
          },
        });
      }
      // The hit target. `line-opacity: 0` still renders the geometry for
      // queryRenderedFeatures, which is the whole trick — it must NOT be
      // `visibility: none`, which would take it out of hit-testing too.
      if (!map.getLayer(SIGNAL_LINE_HIT)) {
        map.addLayer({
          id: SIGNAL_LINE_HIT,
          type: "line",
          source: SIGNAL_LINE_SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#000000",
            "line-width": ["interpolate", ["linear"], ["zoom"], 0, 12, 6, 16, 12, 22],
            "line-opacity": 0,
          },
        });
      }
      // Global signals — ONE data-driven circle layer for ALL POINT signal sources.
      // Colour + radius come straight from the per-feature props (see toSignalFC),
      // so a new signal source renders here with zero changes. The source only ever
      // holds the union of ON signals' points, so the layer stays visible always.
      if (!map.getLayer(SIGNAL_LAYER)) {
        map.addLayer({
          id: SIGNAL_LAYER,
          type: "circle",
          source: SIGNAL_SRC,
          paint: {
            "circle-color": ["get", "color"],
            // Per-feature base radius, gently scaled by zoom.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              ["*", ["get", "radius"], 0.7],
              6,
              ["get", "radius"],
              12,
              ["*", ["get", "radius"], 1.4],
            ],
            "circle-opacity": 0.82,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
            "circle-stroke-opacity": 0.85,
          },
        });
      }
      // The hazard pictogram (white) sits ON the disc — the disc carries hue +
      // magnitude, the icon names the hazard. icon-size tracks the per-feature
      // `radius` (so a bigger quake = bigger icon) AND the zoom, mirroring the disc.
      if (!map.getLayer(SIGNAL_ICON_LAYER)) {
        const iconScale: maplibregl.ExpressionSpecification = [
          "interpolate", ["linear"], ["get", "radius"],
          4, 0.32, 7, 0.42, 26, 0.85,
        ];
        map.addLayer({
          id: SIGNAL_ICON_LAYER,
          type: "symbol",
          source: SIGNAL_SRC,
          layout: {
            "icon-image": ["coalesce", ["image", ["get", "icon"]], ["image", "sig-generic"]],
            "icon-size": [
              "interpolate", ["linear"], ["zoom"],
              0, ["*", iconScale, 0.75],
              6, iconScale,
              12, ["*", iconScale, 1.4],
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      }
      if (!map.getLayer(SIGNAL_LABEL)) {
        map.addLayer({
          id: SIGNAL_LABEL,
          type: "symbol",
          source: SIGNAL_SRC,
          minzoom: 4, // declutter — labels only once zoomed past the globe overview
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Regular"], // served by CARTO_GLYPHS on every basemap
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true, // drop the label rather than hide the dot
          },
          paint: {
            "text-color": "#0f172a",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.2,
          },
        });
      }

      // Terminal selection ring — the map's answer to "which one did I just click?".
      //
      // Modelled on TRACK_RING_LAYER above rather than invented: same circle-with-halo
      // idiom, so the two highlights read as one language, and the same empty-source
      // trick means it is invisible with zero cost until something is selected. It is
      // added AFTER every data layer so it is never buried under a dot, and BEFORE the
      // user pins so a pin the user placed themselves still wins the top of the stack.
      //
      // Deliberately NOT registered in PIN_HIT_LAYERS (lib/map/hitTest): that list is
      // "layers whose features are a clickable object in their own right", and this
      // ring has no object of its own — it is a halo drawn around whatever is already
      // there. Adding it would make resolveMapClickTarget answer "pin" for every click
      // inside the ring while no layer-scoped click handler exists to open anything,
      // so the country dossier under it would go dark and nothing would replace it.
      //
      // The accent is the design's #ffb020, hard-coded for the same reason every other
      // paint value in this file is: MapLibre paint properties cannot read a CSS custom
      // property, and a JS read of getComputedStyle here would tie the map to whether
      // the terminal shell happened to have mounted first.
      if (!map.getLayer(SELECT_RING_LAYER)) {
        map.addLayer({
          id: SELECT_RING_LAYER,
          type: "circle",
          source: SELECT_SRC,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 16, 11, 24, 15, 32],
            "circle-color": "#ffb020",
            "circle-opacity": 0.12,
            "circle-stroke-color": "#ffb020",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.95,
          },
        });
      }

      // User pins — drawn on top of every data layer. The active pin reads larger
      // and fully-opaque; its label rides above the dot. Data-driven off `active`.
      if (!map.getLayer(PIN_DOT_LAYER)) {
        map.addLayer({
          id: PIN_DOT_LAYER,
          type: "circle",
          source: PIN_SRC,
          paint: {
            "circle-radius": ["case", ["==", ["get", "active"], 1], 8, 6],
            "circle-color": "#e0483b",
            "circle-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.85],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["case", ["==", ["get", "active"], 1], 3, 2],
          },
        });
      }
      if (!map.getLayer(PIN_LABEL_LAYER)) {
        map.addLayer({
          id: PIN_LABEL_LAYER,
          type: "symbol",
          source: PIN_SRC,
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Regular"],
            "text-size": 12,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-optional": true,
            "text-max-width": 12,
          },
          paint: {
            "text-color": "#b91c1c",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4,
          },
        });
      }

      applyVisibility(map, layersRef.current);
      readyRef.current = true;
    },
    [applyTerrain, applyVisibility, ensureGeoJSON],
  );

  // Click + cursor handlers, wired ONCE. Layer-scoped handlers survive basemap
  // swaps (resolved by layer id at event time), so they must not be re-added.
  const wireInteractions = useCallback((map: maplibregl.Map) => {
    // ONE physical click is delivered TWICE to these handlers, because the pins and
    // the glows are two layers over one source and both are bound to the same
    // function. Verified live: a single click produced one generic map `click` and
    // one delivery each from camera-markers and camera-dots.
    //
    // Unarmed that was invisible — two identical cinematic.dive calls collapse into
    // one dossier. Armed it is not: the first delivery appends and the second reports
    // "Already in this slot — nothing added" for the same click, so the user is told
    // their click did nothing immediately after being told it worked. Keying off the
    // underlying DOM event drops the second delivery without changing which layers
    // are clickable.
    let lastCamEvent: MouseEvent | null = null;
    let lastWebcamEvent: MouseEvent | null = null;

    const camClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== "Point") return;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const p = f.properties as { id: string; name: string; available: boolean | string };
      // INTERCEPTION 1. A road pin does not open a dossier — it flies the map and
      // lands a full-screen hero card, so an armed click that fell through here
      // would be loudly wrong rather than merely inert. Bail before the dive.
      if (armStore.get()) {
        if (e.originalEvent === lastCamEvent) return; // second layer delivery
        lastCamEvent = e.originalEvent;
        armedPickCamera(p.id, lat, lon);
        return;
      }
      cinematic.dive({
        kind: "camera",
        id: p.id,
        lat,
        lon,
        label: p.name,
        meta: { available: p.available === true || p.available === "true" },
      });
    };
    map.on("click", CAM_LAYER, camClick);
    map.on("click", CAM_DOT_LAYER, camClick);

    map.on("click", PLANE_LAYER, (e) => {
      const id = (e.features?.[0]?.properties as { id?: string })?.id;
      const plane = planesRef.current.find((p) => p.id === id);
      if (plane) overlay.open(plane);
    });

    // Right-click anywhere on the map → the "Add pin here" menu at the cursor.
    map.on("contextmenu", (e) => {
      e.preventDefault();
      setPinMenu({ x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    // Any left-click / drag dismisses the menu; a click on a pin makes it active.
    map.on("click", () => setPinMenu(null));
    map.on("movestart", () => setPinMenu(null));
    map.on("click", PIN_DOT_LAYER, (e) => {
      e.preventDefault?.();
      const feat = e.features?.[0];
      if (!feat) return;
      // Match by coordinates (the source carries no id in props) to activate it.
      const [lon, lat] = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
      const hit = pinsRef.current.pins.find((p) => Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lon - lon) < 1e-6);
      if (hit) pinsStore.setActive(hit.id);
    });
    const pinEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const pinLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("mouseenter", PIN_DOT_LAYER, pinEnter);
    map.on("mouseleave", PIN_DOT_LAYER, pinLeave);
    map.on("click", SAT_LAYER, (e) => {
      const id = (e.features?.[0]?.properties as { id?: string })?.id;
      const sat = satsRef.current.find((s) => s.id === id);
      if (sat) overlay.open(sat);
    });
    const webcamClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = (e.features?.[0]?.properties as { id?: string })?.id;
      const cam = webcamsRef.current.find((w) => w.id === id);
      if (!cam) return;
      // Webcam pins ARE the dossier case, unlike road pins — so this suppression is
      // written separately rather than folded in with camClick. The id is the same
      // "windy:NNN" key /api/webcam-image re-resolves server-side (WebcamsFeed:2016),
      // so the ref is valid without any translation.
      if (armStore.get()) {
        if (e.originalEvent === lastWebcamEvent) return; // second layer delivery
        lastWebcamEvent = e.originalEvent;
        appendToArmedSlot(
          [
            {
              ref: webcamRef(cam.id, cam.label),
              lat: cam.lat,
              lon: cam.lon,
              refreshSeconds: WEBCAM_REFRESH_SECONDS,
            },
          ],
          { lat: cam.lat, lon: cam.lon },
        );
        return;
      }
      overlay.open(cam);
    };
    map.on("click", WEBCAM_LAYER, webcamClick);
    map.on("click", WEBCAM_DOT_LAYER, webcamClick);

    // Points, lines and areas all resolve to the SAME signal dossier by id.
    const signalClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feats = e.features ?? [];
      // A country-scoped pin (the instability index) sits on the country centroid
      // and stands for the country, so anything stacked on it takes priority.
      const f =
        feats.find((x) => !isCountryScopedSignal((x.properties as { signalId?: string })?.signalId)) ??
        feats[0];
      if (!f) return;
      // …and when it IS the topmost thing here, the COUNTRY dossier owns the click
      // (it renders the full index — see CountryDetail's InstabilitySlot). Only
      // consult the arbiter for that case; every other pin is unconditional.
      if (
        isCountryScopedSignal((f.properties as { signalId?: string })?.signalId) &&
        resolveMapClickTarget(hitsAt(map, e.point)) === "country"
      ) {
        return;
      }
      const id = (f.properties as { id?: string })?.id;
      const sig = signalsRef.current.find((s) => s.id === id);
      if (sig) overlay.open(sig);
    };
    map.on("click", SIGNAL_LAYER, signalClick);
    map.on("click", SIGNAL_ICON_LAYER, signalClick);
    map.on("click", SIGNAL_LINE_LAYER, signalClick);
    map.on("click", SIGNAL_FILL_LAYER, signalClick);

    // ── Cables: a hairline you can actually hit ────────────────────────────
    // The four handlers above only fire when the pointer is ON the drawn
    // geometry. For a 1px cable route that is a coin-flip even in the busiest
    // ocean, so the layer's dossier — owners, ready-for-service date, length,
    // every landing point — was effectively unreachable.
    //
    // SIGNAL_LINE_HIT is a transparent, much wider copy of the same source.
    // resolveLineHit decides whether this wide target may claim the event, or
    // whether a pin or the country underneath has the better claim; because
    // both the click and the hover ask it, the cable that lights up under the
    // cursor is always the one a click will open.
    const lineFeatureAt = (point: maplibregl.MapLayerMouseEvent["point"]) => {
      if (!map.getLayer(SIGNAL_LINE_HIT)) return null;
      const lineHits = map.queryRenderedFeatures(point, { layers: [SIGNAL_LINE_HIT] });
      if (lineHits.length === 0) return null;
      const hits = hitsAt(map, point);
      return resolveLineHit({
        lineHits,
        onDrawnLine: hits.some((h) => h.layer === SIGNAL_LINE_LAYER),
        otherPin: hits.some((h) => h.layer !== SIGNAL_LINE_LAYER && h.layer !== COUNTRY_FILL_LAYER),
        overCountry: hits.some((h) => h.layer === COUNTRY_FILL_LAYER),
      });
    };
    const clearLineHover = () => {
      if (map.getLayer(SIGNAL_LINE_HOVER)) map.setFilter(SIGNAL_LINE_HOVER, ["==", ["get", "id"], "__none__"]);
      setLineHover(null);
    };
    map.on("mousemove", SIGNAL_LINE_HIT, (e) => {
      const f = lineFeatureAt(e.point);
      const props = f?.properties as { id?: string; label?: string } | undefined;
      if (!f || !props?.id) {
        clearLineHover();
        return;
      }
      map.setFilter(SIGNAL_LINE_HOVER, ["==", ["get", "id"], props.id]);
      map.getCanvas().style.cursor = "pointer";
      setLineHover({ x: e.point.x, y: e.point.y, label: props.label ?? "Cable" });
    });
    map.on("mouseleave", SIGNAL_LINE_HIT, clearLineHover);
    map.on("movestart", clearLineHover);
    map.on("click", SIGNAL_LINE_HIT, (e) => {
      // The drawn-line handler above already owns a click that landed on the
      // geometry; this one exists for the near-misses it cannot see.
      const hits = hitsAt(map, e.point);
      if (hits.some((h) => h.layer === SIGNAL_LINE_LAYER)) return;
      const f = lineFeatureAt(e.point);
      const id = (f?.properties as { id?: string } | undefined)?.id;
      const sig = id ? signalsRef.current.find((s) => s.id === id) : undefined;
      if (sig) overlay.open(sig);
    });

    // Countries — the fill covers every landmass and sits UNDER every pin layer,
    // so this fires for pin clicks too. lib/map/hitTest is the single arbiter both
    // this and signalClick consult, so exactly one dossier opens. Hover washes the
    // country via feature-state. Both survive basemap swaps (the source id is
    // resolved at event time; addAppLayers re-creates the source).
    map.on("click", COUNTRY_FILL_LAYER, (e) => {
      if (resolveMapClickTarget(hitsAt(map, e.point)) !== "country") return;
      const f = e.features?.[0];
      if (!f) return;
      overlay.open(buildCountryObject(f.properties as CountryProps, e.lngLat.lat, e.lngLat.lng));
    });
    let hoveredCountry: number | string | undefined;
    const clearCountryHover = () => {
      if (hoveredCountry !== undefined) {
        map.setFeatureState({ source: COUNTRY_SRC, id: hoveredCountry }, { hover: false });
        hoveredCountry = undefined;
      }
    };
    map.on("mousemove", COUNTRY_FILL_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f || f.id == null) return;
      if (hoveredCountry !== f.id) {
        clearCountryHover();
        hoveredCountry = f.id;
        map.setFeatureState({ source: COUNTRY_SRC, id: hoveredCountry }, { hover: true });
      }
    });
    map.on("mouseleave", COUNTRY_FILL_LAYER, clearCountryHover);

    // Click a cluster badge → ease into the zoom where it splits apart.
    //
    // INTERCEPTION 3, and it is the majority path, not an edge case. Measured over
    // central London with the camera layer on: z11 draws 71 cluster badges against
    // 18 individual pins, z9 draws 30 against 3. So below z12 most armed clicks land
    // here, and the unarmed behaviour — move the camera, leave the slot unchanged —
    // would read as "arming is broken" rather than "zoom in first".
    const clusterClick = (sourceId: string) => (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const props = f?.properties as { cluster_id?: number; point_count?: number } | undefined;
      const clusterId = props?.cluster_id;
      if (clusterId == null || f?.geometry.type !== "Point") return;
      const centre = f.geometry.coordinates as [number, number];

      if (armStore.get()) {
        void appendClusterLeaves(map, sourceId, clusterId, centre, props?.point_count ?? 0);
        return;
      }
      void expandCluster(map, sourceId, clusterId, centre);
    };
    map.on("click", CAM_CLUSTER_LAYER, clusterClick(CAM_SRC));
    map.on("click", WEBCAM_CLUSTER_LAYER, clusterClick(WEBCAM_SRC));

    const hoverLayers = [
      CAM_LAYER, CAM_DOT_LAYER, CAM_CLUSTER_LAYER,
      WEBCAM_LAYER, WEBCAM_DOT_LAYER, WEBCAM_CLUSTER_LAYER,
      PLANE_LAYER, SAT_LAYER, SIGNAL_LAYER, SIGNAL_ICON_LAYER, SIGNAL_LINE_LAYER, SIGNAL_FILL_LAYER,
    ];
    for (const layer of hoverLayers) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }, []);

  // --- Basemap load resilience ---------------------------------------------
  // `style.load` -> addAppLayers() -> readyRef=true is the ONLY signal that the
  // basemap actually came up. If it never fires we get a black stage with no
  // error, so arm a watchdog around every style load and recover from it.

  const clearStyleWatchdog = useCallback(() => {
    if (styleTimerRef.current) clearTimeout(styleTimerRef.current);
    styleTimerRef.current = null;
  }, []);

  /**
   * Switch basemap from a RECOVERY path.
   *
   * The normal basemap effect bails while `readyRef` is false — which is exactly
   * the state we are in when a style has failed to load. Left to that effect, a
   * fallback would update the store and the notice would claim "showing Satellite
   * instead" while nothing had actually changed. So drive setStyle directly here
   * when the effect would have skipped it, and let the effect handle the normal
   * case so we never issue setStyle twice.
   */
  const applyBasemapNow = useCallback(
    (key: BasemapKey) => {
      const map = mapRef.current;
      const effectWillHandleIt = readyRef.current;
      mapViewStore.setBasemap(key); // keep the basemap switcher UI in sync
      if (!map || effectWillHandleIt) return;
      readyRef.current = false;
      try {
        map.setStyle(BASEMAPS[key].style, { diff: false });
      } catch {
        /* torn down mid-swap — the unmount cleanup handles it */
      }
      armStyleWatchdogRef.current();
    },
    [],
  );

  /** Decide and perform the next recovery step. Safe to call more than once. */
  const runRecovery = useCallback(() => {
    const map = mapRef.current;
    if (!map || readyRef.current) return; // a style is up — nothing to recover
    clearStyleWatchdog();
    const basemap = mapViewStore.get().basemap;
    const step = nextRecoveryStep(styleAttemptsRef.current, basemap, BASEMAPS);
    if (step.action === "retry") {
      setLoadStatus({ kind: "retrying", attempt: styleAttemptsRef.current });
      styleTimerRef.current = setTimeout(() => {
        const m = mapRef.current;
        if (!m || readyRef.current) return;
        styleAttemptsRef.current += 1;
        try {
          m.setStyle(BASEMAPS[mapViewStore.get().basemap].style, { diff: false });
        } catch {
          /* torn down mid-retry — the unmount cleanup handles it */
        }
        armStyleWatchdogRef.current();
      }, step.delayMs);
    } else if (step.action === "fallback") {
      // Switch to an INLINE style (one that cannot fail to fetch) and say so.
      setLoadStatus({ kind: "fallback", from: basemap, to: step.to });
      styleAttemptsRef.current = 0;
      applyBasemapNow(step.to);
    } else {
      setLoadStatus({ kind: "lost" });
    }
  }, [clearStyleWatchdog]);

  const armStyleWatchdog = useCallback(() => {
    clearStyleWatchdog();
    styleTimerRef.current = setTimeout(runRecovery, STYLE_LOAD_TIMEOUT_MS);
  }, [clearStyleWatchdog, runRecovery]);

  // The retry path re-arms the watchdog from inside runRecovery, which is defined
  // first — go through a ref so neither callback has to depend on the other.
  const armStyleWatchdogRef = useRef(armStyleWatchdog);
  armStyleWatchdogRef.current = armStyleWatchdog;

  /**
   * Called after every style.load. addAppLayers() is what sets readyRef, so a
   * rejection there means we have a style but no pins — still broken, so leave the
   * watchdog running rather than declaring success.
   */
  const onStyleSettled = useCallback(() => {
    if (!readyRef.current) return;
    clearStyleWatchdog();
    styleAttemptsRef.current = 0;
    // Keep a "fallback" notice on screen — the user is looking at a different
    // basemap than they asked for and deserves to know why. Clear the transient
    // "retrying" state, which has served its purpose.
    setLoadStatus((s) => (s.kind === "fallback" ? s : { kind: "ok" }));
  }, [clearStyleWatchdog]);

  /** Manual "Try again" from the notice. */
  const retryBasemap = useCallback(
    (key: BasemapKey) => {
      styleAttemptsRef.current = 0;
      setLoadStatus({ kind: "retrying", attempt: 0 });
      applyBasemapNow(key);
    },
    [applyBasemapNow],
  );

  // --- Init (once) ---------------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    // Restore a shared deep-link view (?lat=&lon=&z=&layers=&base=&obj=) BEFORE
    // the map is built so we open at the saved camera/basemap with no fly/flash.
    // This runs after ConsoleShell's localStorage hydrate (WorldMap is lazy /
    // ssr:false → it mounts later), so URL state wins over persisted toggles.
    const initial = readInitialViewState();
    if (initial.basemap) mapViewStore.setBasemap(initial.basemap);
    if (initial.layers) {
      for (const k of ACTIVE_LAYERS) layersStore.set(k, initial.layers.includes(k));
    }
    pendingObjRef.current = initial.obj ?? null;
    const center: [number, number] =
      initial.lat != null && initial.lon != null ? [initial.lon, initial.lat] : HOME.center;
    const zoom = initial.zoom ?? HOME.zoom;
    // A deep-linked camera/zoom means the user wants that exact view — don't let
    // the idle spin immediately drag it away on first paint.
    if (initial.lat != null || initial.zoom != null) {
      interactUntilRef.current = performance.now() + IDLE_RESUME_MS;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAPS[mapViewStore.get().basemap].style,
      center,
      zoom,
      maxZoom: 18,
      renderWorldCopies: false,
      attributionControl: false,
    });
    mapRef.current = map;
    // Published so the export control can READ this map (centre, zoom, canvas)
    // without a ref threaded through the console layout. Read-only by contract —
    // see lib/map/instance.
    setMapInstance(map);
    (window as unknown as { __map?: maplibregl.Map }).__map = map; // debug handle
    (window as unknown as { __overlay?: typeof overlay }).__overlay = overlay;
    // Same debug-handle pattern as the two above, and it earns its place: arming is
    // a mode whose failures are invisible to clicking. At z13 over central London the
    // map draws 97 camera pins and 24 live-thumbnail buttons, and only the buttons
    // stopPropagation — so "I clicked a pin and it armed" is true 75% of the time
    // whether or not interception 2 works. A handle is the only way to aim a test at
    // a NAMED camera on a chosen path.
    (window as unknown as { __arm?: typeof armStore }).__arm = armStore;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    wireInteractions(map);

    // Bundled country polygons (borders + click hit-areas). Fetched once; cached in
    // a ref so every basemap swap re-seeds the source. Optional chrome — a failure
    // never blocks the map (the layers just stay empty).
    fetch("/geo/countries-110m.geojson")
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.FeatureCollection>) : null))
      .then((geo) => {
        if (!geo) return;
        countryGeoRef.current = geo;
        (mapRef.current?.getSource(COUNTRY_SRC) as GeoJSONSource | undefined)?.setData(geo);
      })
      .catch(() => {});

    // SP6 — live thumbnail markers: a capped pool of poster thumbnails over the
    // in-viewport cameras above THUMB_MIN_ZOOM, so streams are visible at a glance.
    const thumbMgr = createThumbnailManager({
      map,
      layerId: CAM_LAYER,
      // INTERCEPTION 2, and it is the same call as the layer handler on purpose.
      // These DOM buttons stopPropagation (liveThumbnails.ts:58) so they never reach
      // map.on("click", CAM_LAYER). Measured at z13 over central London: 24 of the 97
      // visible cameras are routed through here and 73 are not, and which is which
      // depends on MAX_THUMBS and on `available`. If arming were patched into camClick
      // alone it would fail for those 24 while working for the 73 beside them.
      onPick: (c) => {
        if (armedPickCamera(c.id, c.lat, c.lon)) return;
        cinematic.dive({ kind: "camera", id: c.id, lat: c.lat, lon: c.lon, label: c.name, meta: { available: true } });
      },
    });
    thumbMgrRef.current = thumbMgr;
    const onThumbRefresh = () => thumbMgr.update();
    const onThumbSource = (e: maplibregl.MapSourceDataEvent) => {
      // Re-evaluate when the camera source finishes loading (cameras can arrive
      // after the user has already stopped moving over a dense region).
      if (e.sourceId === CAM_SRC && e.isSourceLoaded) thumbMgr.update();
    };
    map.on("moveend", onThumbRefresh);
    map.on("zoomend", onThumbRefresh);
    map.on("sourcedata", onThumbSource);

    map.on("style.load", () => {
      void addAppLayers(map).then(onStyleSettled, onStyleSettled);
    });

    // MapLibre reports a dead style CDN and a single missing tile through the SAME
    // event, so classify before acting — raster basemaps 404 tiles routinely (poles,
    // past maxzoom) and recovering on those would thrash the map. Only a failed
    // style DOCUMENT, while we have no working style, triggers recovery — and it
    // does so IMMEDIATELY rather than waiting out the watchdog, since we already
    // know the load failed.
    map.on("error", (e) => {
      if (classifyMapError(e as unknown as { error?: { message?: string } }) !== "style") return;
      runRecovery();
    });

    // A lost WebGL context cannot be recovered in place — say so rather than
    // leaving a frozen canvas that looks like a hung app.
    map.getCanvas().addEventListener("webglcontextlost", () => setLoadStatus({ kind: "lost" }));

    armStyleWatchdog();
    // Engage/disengage 3D terrain as we cross the mercator threshold (see syncTerrain).
    map.on("zoom", () => syncTerrain(map));

    // Pause auto-spin on any direct user input (native events, not programmatic
    // camera moves) — keeps the calm idle rotation from fighting interaction.
    const el = map.getCanvasContainer();
    const markInteract = () => {
      interactUntilRef.current = performance.now() + IDLE_RESUME_MS;
      // Grabbing the map "breaks" a live follow → drop to manual recenter so we stop
      // chasing the plane out from under the user (a Recenter affordance re-arms it).
      const t = trackingRef.current;
      if (t.id && t.mode === "follow") trackStore.setMode("recenter");
    };
    const inputs: (keyof HTMLElementEventMap)[] = ["mousedown", "wheel", "touchstart", "pointerdown"];
    for (const ev of inputs) el.addEventListener(ev, markInteract, { passive: true });

    // ── Cursor lat/lon readout (the Terminal stage bar) ──────────────────────
    //
    // A window CustomEvent, and NOT React state. `mousemove` on the whole map fires
    // at pointer rate; a setState here would re-render WorldMap — and with it every
    // <…Feed> child, the 27-layer effect chain and the thumbnail pool — on every
    // mouse move across the globe. The stage bar's readout writes the text straight
    // into its own DOM node instead (see StageCursor in components/terminal/StageBar).
    //
    // requestAnimationFrame coalesces the burst: MapLibre can emit several moves per
    // frame, and only the last one is worth publishing because only the last one is
    // what the pointer is on when the frame paints. The pending coordinate is held in
    // a closure variable rather than dispatched immediately, so the cost of a fast
    // drag across the map is one dispatch per frame, not one per event.
    let cursorFrame = 0;
    let cursorLat = 0;
    let cursorLon = 0;
    const flushCursor = () => {
      cursorFrame = 0;
      window.dispatchEvent(
        new CustomEvent(MAP_CURSOR_EVENT, { detail: { lat: cursorLat, lon: cursorLon } }),
      );
    };
    const onCursorMove = (e: maplibregl.MapMouseEvent) => {
      cursorLat = e.lngLat.lat;
      cursorLon = e.lngLat.lng; // PointView-style naming: `lon` on the wire, `lng` from MapLibre
      if (cursorFrame === 0) cursorFrame = requestAnimationFrame(flushCursor);
    };
    map.on("mousemove", onCursorMove);

    // Shareable deep links: mirror the live view into the URL (debounced,
    // replaceState — no history spam, no reload). moveend writes are skipped while
    // the calm idle spin is running so the URL doesn't churn on its own; deliberate
    // moves (user pan/zoom, region fly-to) and store changes always persist.
    const isAutoSpinning = () =>
      performance.now() > interactUntilRef.current &&
      !overlay.get().object &&
      !trackingRef.current.id &&
      map.getZoom() < SPIN_MAX_ZOOM;
    const onMoveEnd = () => {
      // Our own follow easeTo shouldn't churn the shareable URL every poll.
      if (followMoveRef.current) { followMoveRef.current = false; return; }
      if (!isAutoSpinning()) scheduleUrlWrite(map);
    };
    map.on("moveend", onMoveEnd);
    const unsubLayers = layersStore.subscribe(() => scheduleUrlWrite(map));
    const unsubView = mapViewStore.subscribe(() => scheduleUrlWrite(map));
    const unsubOverlay = overlay.subscribe(() => scheduleUrlWrite(map));

    // Calm idle rotation: nudge centre longitude while zoomed out + idle.
    let last = performance.now();
    const spin = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (
        performance.now() > interactUntilRef.current &&
        !overlay.get().object &&
        !trackingRef.current.id && // a tracked plane owns the camera; don't spin away from it
        map.getZoom() < SPIN_MAX_ZOOM
      ) {
        const c = map.getCenter();
        map.setCenter([c.lng + SPIN_DEG_PER_SEC * dt, c.lat]);
      }
      rafRef.current = requestAnimationFrame(spin);
    };
    rafRef.current = requestAnimationFrame(spin);

    return () => {
      cancelAnimationFrame(rafRef.current);
      for (const ev of inputs) el.removeEventListener(ev, markInteract);
      map.off("mousemove", onCursorMove);
      // A queued frame would otherwise dispatch one last coordinate after the map is
      // gone — harmless for the readout, but it is exactly the kind of leak that
      // survives a remount and then fires against two maps at once.
      if (cursorFrame !== 0) cancelAnimationFrame(cursorFrame);
      cancelUrlWrite();
      unsubLayers();
      unsubView();
      unsubOverlay();
      map.off("moveend", onThumbRefresh);
      map.off("zoomend", onThumbRefresh);
      map.off("sourcedata", onThumbSource);
      thumbMgr.destroy();
      thumbMgrRef.current = null;
      clearStyleWatchdog(); // never let a pending retry fire at a removed map
      map.remove();
      mapRef.current = null;
      setMapInstance(null); // a removed map must never be handed to a capture
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the canvas sized to its container. The map is an inset centre panel (not
  // the full viewport), so dragging a side/bottom panel wall changes the map's box
  // WITHOUT a window resize — a ResizeObserver re-fits the globe on those drags.
  useEffect(() => {
    const onResize = () => mapRef.current?.resize();
    window.addEventListener("resize", onResize);
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(onResize) : null;
    if (el && ro) ro.observe(el);
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); };
  }, []);

  // Basemap swap → setStyle; addAppLayers re-runs on the resulting style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    readyRef.current = false;
    styleAttemptsRef.current = 0;
    map.setStyle(BASEMAPS[basemap].style, { diff: false });
    // A user-chosen basemap can fail to load just like the first one did.
    armStyleWatchdog();
  }, [basemap, armStyleWatchdog]);

  // Terrain toggle.
  useEffect(() => {
    terrainRef.current = terrainOn;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyTerrain(map, terrainOn);
  }, [terrainOn, applyTerrain]);

  // Layer visibility toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyVisibility(map, layers);
  }, [layers, applyVisibility]);

  // Live data → source updates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(CAM_SRC) as GeoJSONSource | undefined)?.setData(toCameraFC(filteredCameras));
  }, [filteredCameras]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(SAT_SRC) as GeoJSONSource | undefined)?.setData(toSatelliteFC(satellites));
  }, [satellites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(WEBCAM_SRC) as GeoJSONSource | undefined)?.setData(toWebcamFC(webcams));
  }, [webcams]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(SIGNAL_SRC) as GeoJSONSource | undefined)?.setData(toSignalFC(visibleSignals));
    (map.getSource(SIGNAL_LINE_SRC) as GeoJSONSource | undefined)?.setData(toSignalLineFC(visibleSignals));
    (map.getSource(SIGNAL_FILL_SRC) as GeoJSONSource | undefined)?.setData(toSignalFillFC(visibleSignals));
  }, [visibleSignals]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(PLANE_SRC) as GeoJSONSource | undefined)?.setData(toPlaneFC(planesLayer.objects));
    (map.getSource(TRAIL_SRC) as GeoJSONSource | undefined)?.setData(toTrailFC(planesLayer.trails));
  }, [planesLayer]);

  // Plane tracking: keep the highlight ring on the tracked plane's live position,
  // and (in follow mode) gently re-centre the globe on it each poll. Re-runs when a
  // new track is set OR when fresh plane positions arrive. If the plane is not in
  // the current snapshot ("signal lost") the ring clears but the track is retained —
  // the chip shows the lost state until the user stops it or it reappears.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const found = track.id ? planesLayer.objects.find((o) => o.id === track.id) ?? null : null;
    trackedObjectRef.current = found;
    (map.getSource(TRACK_SRC) as GeoJSONSource | undefined)?.setData(toTrackFC(found));
    if (found && track.mode === "follow") {
      followMoveRef.current = true; // this camera move is ours, not the user's
      const zoom = Math.max(map.getZoom(), 4.5); // ensure the plane is legible, never zoom out
      map.easeTo({ center: [found.lon, found.lat], zoom, duration: 900, essential: true });
    }
  }, [track, planesLayer]);

  // User pins → source update (search bar / right-click / navigator all flow here).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(PIN_SRC) as GeoJSONSource | undefined)?.setData(toPinFC(pins.pins, pins.activeId));
  }, [pins]);

  // Terminal selection → the highlight ring. selectionStore.select() already flies
  // the camera; this is the other half of that gesture — the ring is what makes the
  // arrival mean something. Clearing the selection empties the source, so Escape
  // takes the ring away without touching the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(SELECT_SRC) as GeoJSONSource | undefined)?.setData(toSelectionFC(selection));
  }, [selection]);

  // Restore a deep-linked dossier (?obj=) once its layer's data has streamed in.
  // Planes/satellites stream after first paint, so this retries on each data tick
  // until the id resolves, then clears the pending marker. A stale id (a landed
  // flight, a decayed sat) simply never resolves — the map view is still restored.
  useEffect(() => {
    const id = pendingObjRef.current;
    if (!id) return;
    const found =
      camerasRef.current.find((c) => c.id === id) ??
      planesRef.current.find((p) => p.id === id) ??
      satsRef.current.find((s) => s.id === id) ??
      webcamsRef.current.find((w) => w.id === id) ??
      signalsRef.current.find((s) => s.id === id);
    if (found) {
      overlay.open(found);
      pendingObjRef.current = null;
    }
  }, [filteredCameras, planesLayer, satellites, webcams, visibleSignals]);

  // Debug handle for live tuning (basemap / terrain).
  useEffect(() => {
    (
      window as unknown as {
        __worldmap?: { setBasemap: (k: BasemapKey) => void; setTerrain: (on: boolean) => void };
      }
    ).__worldmap = { setBasemap: mapViewStore.setBasemap, setTerrain: mapViewStore.setTerrain };
  }, []);

  // Fly the globe to a region (called from the ⌘K palette via mapView.flyTo).
  const flyToRegion = useCallback((target: RegionView) => {
    const map = mapRef.current;
    if (!map) return;
    // Suppress the idle spin through the fly animation.
    interactUntilRef.current = performance.now() + 2400;
    const zoom = Math.max(3, Math.min(9, 9.5 - target.altitude * 4));
    map.flyTo({ center: [target.lng, target.lat], zoom, duration: 1600, essential: true });
  }, []);

  useEffect(() => {
    mapViewStore.registerFlyTo(flyToRegion);
    return () => mapViewStore.registerFlyTo(null);
  }, [flyToRegion]);

  // Fly to a precise point at an explicit zoom (M5 place search + "near me").
  const flyToPoint = useCallback((target: PointView) => {
    const map = mapRef.current;
    if (!map) return;
    interactUntilRef.current = performance.now() + 2400; // suppress idle spin through the fly
    const zoom = Math.max(2, Math.min(15, target.zoom ?? 11));
    map.flyTo({ center: [target.lon, target.lat], zoom, duration: 1600, essential: true });
  }, []);

  useEffect(() => {
    mapViewStore.registerFlyToPoint(flyToPoint);
    return () => mapViewStore.registerFlyToPoint(null);
  }, [flyToPoint]);

  // Re-project live when the user toggles Console ⇄ Explore. Deferred through
  // whenStyleReady: this can fire mid-mount or during a basemap swap, when the
  // style isn't loaded yet — calling setProjection then throws "Style is not done
  // loading" and crashes the app. The type is re-checked at apply time in case the
  // mode changed again while we were waiting.
  useEffect(() => {
    return viewModeStore.subscribe(() => {
      const map = mapRef.current;
      if (!map) return;
      whenStyleReady(map, () => {
        const want = viewModeStore.get() === "explore" ? "globe" : "mercator";
        if (map.getProjection?.()?.type !== want) {
          try {
            map.setProjection({ type: want });
          } catch {
            /* style swapped out from under us mid-defer — the next style.load re-applies */
          }
        }
      });
    });
  }, []);

  // Cinematic dive (SP6): a pitched flyTo to a single camera; on arrival, promote
  // the dive store to "landed" so <CinematicDive> materialises the hero feed.
  // animate=false (reduced motion) jumps instantly and lands at once.
  const diveTo = useCallback((view: DiveView, animate: boolean, onArrive: () => void) => {
    const map = mapRef.current;
    if (!map) { onArrive(); return; }
    const p = computeDive({ lat: view.lat, lon: view.lon });
    // Suppress the idle spin through the dive (+ a little slack).
    interactUntilRef.current = performance.now() + p.duration + 600;
    if (!animate) {
      map.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
      onArrive();
      return;
    }
    map.once("moveend", onArrive);
    map.flyTo({
      center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing,
      duration: p.duration, essential: true,
    });
  }, []);

  useEffect(() => {
    mapViewStore.registerDiveTo(diveTo);
    return () => mapViewStore.registerDiveTo(null);
  }, [diveTo]);

  // ── INTERCEPTION 4: shift-drag, and custody of MapLibre's box zoom ─────────
  //
  // BoxZoomHandler owns shift-drag and is on by default — the constructor passes no
  // `boxZoom` option (verified live: map.boxZoom.isEnabled() === true). So arming has
  // to borrow it and give it back, and BOTH halves live in this one effect so they
  // cannot desync. The alternative, the constructor-only `boxZoomEnd` option,
  // suppresses fit-to-box unconditionally and would have silently deleted shift-drag
  // zoom from all seven boards for everyone, armed or not.
  //
  // The re-enable is in the CLEANUP, not merely on disarm. StageHost.tsx:33,37
  // unmounts <WorldMap/> when a widget is focused, so the disable and the re-enable
  // can be separated by an unmount; without this path, focusing a widget while armed
  // would leave box zoom off for the rest of the session with nothing on screen to
  // explain it — a silent, sitewide regression from a feature nobody was using.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !armedSlot) return;

    map.boxZoom.disable();
    const canvas = map.getCanvasContainer();
    let start: { x: number; y: number } | null = null;
    let box: HTMLDivElement | null = null;

    const clearBox = () => {
      box?.remove();
      box = null;
      start = null;
    };

    const onDown = (ev: MouseEvent) => {
      if (!ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      start = { x: ev.clientX, y: ev.clientY };
      box = document.createElement("div");
      box.className = "tn-arm-box";
      // Geometry inline, skin in CSS. A stylesheet this file does not own is not a
      // safe place for "does not break the map": without position:absolute this div
      // would be a static block inside the canvas container and would shove the map
      // around, and pointer-events would swallow the mouseup that ends the drag.
      box.style.position = "absolute";
      box.style.left = "0";
      box.style.top = "0";
      box.style.pointerEvents = "none";
      canvas.appendChild(box);
    };

    const onMove = (ev: MouseEvent) => {
      if (!start || !box) return;
      const rect = canvas.getBoundingClientRect();
      box.style.transform = `translate(${Math.min(start.x, ev.clientX) - rect.left}px, ${
        Math.min(start.y, ev.clientY) - rect.top
      }px)`;
      box.style.width = `${Math.abs(ev.clientX - start.x)}px`;
      box.style.height = `${Math.abs(ev.clientY - start.y)}px`;
    };

    const onUp = (ev: MouseEvent) => {
      if (!start) return;
      const from = start;
      clearBox();
      // A shift-CLICK is not a box. Under a few pixels the user was aiming at a pin,
      // and turning that into a zero-area selection would answer "0 cameras here"
      // to a gesture that just added one.
      if (Math.abs(ev.clientX - from.x) < 4 && Math.abs(ev.clientY - from.y) < 4) return;
      const rect = canvas.getBoundingClientRect();
      const a = map.unproject([from.x - rect.left, from.y - rect.top]);
      const b = map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
      appendBoxSelection(
        normalizeBounds({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }),
        webcamsRef.current,
      );
    };

    canvas.addEventListener("mousedown", onDown);
    // move/up on the window, not the canvas: a drag that ends outside the map still
    // ends, rather than leaving a ghost rectangle stuck to the cursor.
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearBox();
      map.boxZoom.enable();
    };
  }, [armedSlot]);

  const trackedFound = track.id ? planesLayer.objects.some((o) => o.id === track.id) : false;

  // Drop a pin at a point (right-click menu). Labels with coords immediately, then
  // upgrades to a place name if a reverse geocode resolves (dormant-safe).
  const addPinHere = useCallback((lat: number, lon: number) => {
    const pin = pinsStore.add(lat, lon);
    setPinMenu(null);
    mapViewStore.flyToPoint({ lat, lon, zoom: Math.max(mapRef.current?.getZoom() ?? 4, 4) });
    fetch(`/api/geocode?lat=${lat}&lon=${lon}`)
      .then((r) => r.json())
      .then((d) => { const name = (d?.results?.[0]?.name as string) || ""; if (name) pinsStore.relabel(pin.id, name); })
      .catch(() => {});
  }, []);

  return (
    <div className={armedSlot ? "world-map tn-armed" : "world-map"}>
      <div ref={containerRef} className="map-canvas" />

      {/* INTERCEPTION 7, the visible half. A global mode on a map that has no other
          mode has to say it is on and say how to leave, or the next click is a
          surprise. Rendered from the hook, so it survives the fact that the click
          handlers themselves are frozen closures. */}
      {armedSlot && (
        <div className="tn-arm-hint" role="status" aria-live="polite">
          <span>
            Filling a slot — click a pin, or shift-drag a box. <kbd>Esc</kbd> to stop.
          </span>
        </div>
      )}

      {/* Basemap load notice. A basemap that fails to load used to leave a silent
          black rectangle; say what happened and offer a way back. */}
      {loadStatus.kind !== "ok" && (
        <div className="tn-map-notice" role="status" aria-live="polite">
          {loadStatus.kind === "retrying" && <span>Basemap is slow to load — retrying…</span>}
          {loadStatus.kind === "fallback" && (
            <>
              <span>
                Couldn&apos;t load the {BASEMAPS[loadStatus.from].label} basemap. Showing{" "}
                {BASEMAPS[loadStatus.to].label} instead.
              </span>
              <button type="button" onClick={() => retryBasemap(loadStatus.from)}>
                Try again
              </button>
            </>
          )}
          {loadStatus.kind === "lost" && (
            <span>The map couldn&apos;t start in this browser. Reload the page to try again.</span>
          )}
        </div>
      )}

      {/* The hovered cable's name, floating at the cursor. Presentational only —
          the dossier it opens is the accessible surface, and a tooltip that
          tracks a pointer has no keyboard equivalent to announce. */}
      {lineHover && (
        <div className="tn-linetip" style={{ left: lineHover.x, top: lineHover.y }} aria-hidden>
          {lineHover.label}
        </div>
      )}

      {/* Right-click "Add pin here" menu, positioned at the cursor over the map. */}
      {pinMenu && (
        <div className="tn-pinmenu" style={{ left: pinMenu.x, top: pinMenu.y }} role="menu">
          <button type="button" className="tn-pinmenu-add" onClick={() => addPinHere(pinMenu.lat, pinMenu.lon)}>
            📍 Add pin here
          </button>
          <div className="tn-pinmenu-coord">{pinMenu.lat.toFixed(4)}, {pinMenu.lon.toFixed(4)}</div>
        </div>
      )}

      {/* Tracking chip — persists across board/widget changes because the track lives
          in an external store; the map just reflects it. Recenter appears once the
          user has grabbed the map (mode flipped to "recenter"). */}
      {track.id && (
        <div className="tn-track-chip" role="status" aria-live="polite">
          <span className="tn-track-dot" aria-hidden />
          <span className="tn-track-label">
            Tracking <b>{track.label}</b>
            {!trackedFound && <span className="tn-track-lost"> · signal lost</span>}
          </span>
          {track.mode === "recenter" && trackedFound && (
            <button type="button" className="tn-track-recenter" onClick={() => trackStore.setMode("follow")}>
              Recenter
            </button>
          )}
          <button type="button" className="tn-track-stop" onClick={() => trackStore.stop()} aria-label="Stop tracking">
            ✕
          </button>
        </div>
      )}

      {/* Gating feeds: a layer's data hook is mounted only while it is visible,
          so a hidden layer does not fetch or tick. They render no DOM. */}
      {layers.cameras && <CamerasFeed onData={setPts} />}
      {layers.planes && <PlanesFeed onData={setPlanesLayer} />}
      {layers.satellites && <SatellitesFeed onData={setSatellites} />}
      {layers.webcams && <WebcamsFeed onData={setWebcams} />}

      {/* One gating feed per ON signal — mounted only while its toggle is on, so a
          hidden signal never fetches (mirrors CamerasFeed). Each lifts its objects
          into the aggregated set and clears its slot on unmount. */}
      {SIGNALS.filter((s) => signalsState[s.id]).map((s) => (
        <SignalFeed key={s.id} source={s} onData={mergeSignalChunk} />
      ))}
    </div>
  );
}

// --- Global-signals gating feed ----------------------------------------------
// Fetches ONE signal source through the generic /api/signals/<id> proxy, converts
// its SignalFeature[] into clickable WorldObject[], and lifts them up. Refreshes
// on the source's own cadence; reports its live count to the rail; clears its
// contribution + count on unmount (toggle-off). See SIGNALS / lib/signals.
function SignalFeed({
  source,
  onData,
}: {
  source: SignalSource;
  onData: (id: string, objs: WorldObject[]) => void;
}) {
  const { id } = source;
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/signals/${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const features = (d.features as SignalFeature[]) ?? [];
          const objs: WorldObject[] = features.map((f) => ({
            kind: "signal",
            id: f.id,
            lat: f.lat,
            lon: f.lon,
            label: f.title,
            color: f.color ?? source.color,
            typeLabel: source.label,
            meta: {
              signalId: f.signalId,
              props: f.props ?? {},
              attribution: source.attribution,
              sourceLabel: source.label,
              link: f.link,
              // Provider dataset/home URL for the dossier's mandatory clickable
              // source (used when a feature carries no deep record link). Optional
              // on the adapter; SignalDetail falls back to the keyed provider table.
              sourceUrl: source.sourceUrl,
              // ISO timestamp (when known) — the global time-window filter reads
              // this; untimed features have no ts and are always shown.
              ts: f.ts,
              // Carries line/area geometry (cables, jamming) through to the
              // line/fill builders in lib/map/features; absent for point signals.
              ...(f.geometry ? { geometry: f.geometry } : {}),
            },
          }));
          onData(id, objs);
          signalCountsStore.set(id, objs.length);
          signalFreshnessStore.record(id, { ok: true, count: objs.length });
        })
        .catch(() => {
          if (!alive) return;
          onData(id, []);
          signalCountsStore.set(id, 0);
          signalFreshnessStore.record(id, { ok: false, count: 0 });
        });
    };
    load();
    // Refresh on the source's cadence (floored so a misconfigured 0 can't spin).
    const t = setInterval(load, Math.max(30_000, source.refreshMs));
    return () => {
      alive = false;
      clearInterval(t);
      onData(id, []);
      signalCountsStore.set(id, null);
      signalFreshnessStore.clear(id);
    };
  }, [id, source, onData]);
  return null;
}

// --- Gating data feeds -------------------------------------------------------
// Each mounts a live-data hook and lifts the result into WorldMap state. Because
// WorldMap only renders these while the matching layer is on, toggling a layer
// off unmounts the hook and tears down its fetch/interval (the hidden-don't-fetch
// contract), without any edit to the data hooks themselves.

function CamerasFeed({ onData }: { onData: (pts: Pt[]) => void }) {
  useEffect(() => {
    let alive = true;
    fetch("/api/cameras")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const cams = (d.cameras as Pt[]) ?? [];
        onData(cams);
        loadedCamerasStore.set(cams);
        freshnessStore.record("cameras", { count: cams.length, ok: true });
      })
      .catch(() => {
        if (!alive) return;
        onData([]);
        freshnessStore.record("cameras", { count: 0, ok: false });
      });
    return () => {
      alive = false;
    };
  }, [onData]);
  return null;
}

function PlanesFeed({ onData }: { onData: (layer: PlanesLayer) => void }) {
  const layer = usePlanes();
  useEffect(() => {
    onData(layer);
  }, [layer, onData]);
  return null;
}

function SatellitesFeed({ onData }: { onData: (sats: WorldObject[]) => void }) {
  const sats = useSatellites();
  useEffect(() => {
    onData(sats);
  }, [sats, onData]);
  return null;
}

// Windy webcams — a one-shot global sample (the API is rate-limited, so this is a
// fetched snapshot, not a poll). Thin markers only; the dossier re-resolves the
// short-lived image URL on click. Mirrors CamerasFeed's hidden-doesn't-fetch gate.
type WebcamMarker = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  available?: boolean;
  detailUrl?: string;
};

function WebcamsFeed({ onData }: { onData: (webcams: WorldObject[]) => void }) {
  useEffect(() => {
    let alive = true;
    fetch("/api/webcams")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const markers = (d.webcams as WebcamMarker[]) ?? [];
        const objects: WorldObject[] = markers.map((w) => ({
          kind: "webcam",
          id: w.id,
          lat: w.lat,
          lon: w.lon,
          label: w.title,
          color: WEBCAM_COLOR,
          icon: "webcam",
          typeLabel: "Webcam",
          meta: {
            available: w.available ?? true,
            region: w.region,
            country: w.country,
            detailUrl: w.detailUrl,
          },
        }));
        onData(objects);
        freshnessStore.record("webcams", { count: objects.length, ok: true });
      })
      .catch(() => {
        if (!alive) return;
        onData([]);
        freshnessStore.record("webcams", { count: 0, ok: false });
      });
    return () => {
      alive = false;
    };
  }, [onData]);
  return null;
}
