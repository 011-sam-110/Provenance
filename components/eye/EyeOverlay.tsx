"use client";
// What the God's eye view puts INTO the scene, over WorldMap's ground and buildings:
// camera cards standing on their real spots, vessels and aircraft with their tags.
//
// TWO KINDS OF MARK, BY WHAT EACH NEEDS:
//   GPU layers (rings, chevrons, one-minute lines): many and cheap. The camera rings
//     are sunk UNDER the buildings, so a tower in front hides a ring the way it would
//     hide the street. Circle layers do not depth-test; layer order is what does it.
//   DOM markers (cards, tags): few and rich, moved by MapLibre per frame as a
//     transform only.
//
// NEVER REBUILT PER FRAME. MapLibre fires `moveend` on every jumpTo and setBearing, so
// a camera move driven per frame (the view's own orbit) fires it per frame too. In the
// design pass an undebounced handler rebuilt every card per frame and halved the frame
// rate. Placement runs 300 ms after the camera settles, and at most once a second
// while it moves; between runs a mark is only re-positioned, by MapLibre.
//
// MARKS JUMP AT EACH REPORT. A vessel or an aircraft is drawn where its last report
// put it and moves when the next one lands (60 s for AIS, 90 s for aircraft). Nothing
// glides between reports: an in-between position is a place nobody reported.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import type { EyeTarget } from "@/lib/eye/places";
import { cameraCredits, cameraLedgerRow, nearCameras, type NearCamera } from "@/lib/eye/cameras";
import {
  GAP,
  placeCards,
  placeTags,
  placementOrder,
  type Box,
  type CardSize,
  type Frame,
  type TagCandidate,
} from "@/lib/eye/declutter";
import {
  AIRCRAFT_CREDIT,
  aircraftLedgerRow,
  aircraftTag,
  inBounds,
  toAircraft,
  toVessel,
  vesselCredits,
  vesselLedgerRow,
  vesselTag,
  type AisFeatureLike,
  type Aircraft,
  type PlaneLike,
  type Vessel,
} from "@/lib/eye/traffic";
import {
  STREETS_EVERY_MS,
  TFL_CREDIT,
  inLondon,
  severityWeight,
  speedLedgerRow,
  speedPhoneNote,
  streetTag,
  streetsDownRow,
  streetsLedgerRow,
  type StreetDisruption,
} from "@/lib/eye/streets";
import { AISSTREAM_ATTRIBUTION } from "@/lib/signals/ais";
import type { LedgerRow } from "@/lib/eye/wording";
import { CameraCard, releaseCardMedia } from "./cameraCard";
import { Tag, tagSize } from "./tag";

export interface OverlayReport {
  rows: LedgerRow[];
  /** All first fetches have answered or failed, and the first placement ran. */
  ready: boolean;
  /** The name of the camera a camera link opened on, once known. */
  cameraName?: string;
  /** When the vessels or the aircraft last arrived, for the HUD's "refreshed" line. */
  refreshedAt?: number;
  /** The phone's one line about what is not here (no measured road speed). */
  phoneNote?: string;
}

const SRC = {
  cams: "eye-cams",
  ships: "eye-ships",
  ahead: "eye-ship-ahead",
  planes: "eye-planes",
  streets: "eye-streets",
} as const;
const LYR = {
  ring: "eye-cam-ring",
  dot: "eye-cam-dot",
  ahead: "eye-ship-ahead",
  ship: "eye-ship",
  plane: "eye-plane",
  streetLine: "eye-street-line",
  streetDot: "eye-street-dot",
} as const;
const IMG = { ship: "eye-chevron-ship", plane: "eye-chevron-plane" } as const;
const COLOUR = { ship: "#2dd4bf", plane: "#fbbf24", road: "#fb7185" } as const;

const CARD_WIDE: CardSize & { max: number } = { width: 172, height: Math.round(172 / (352 / 288)) + 40, stalk: 52, max: 5 };
const CARD_PHONE: CardSize & { max: number } = { width: 120, height: Math.round(120 / (352 / 288)) + 46, stalk: 34, max: 3 };
const MAX_TAGS = { wide: { ship: 8, plane: 3, road: 2 }, phone: { ship: 4, plane: 2, road: 1 } } as const;

/** How often each feed is asked again. The server's own cadence for each. */
const AIS_EVERY_MS = 60_000;
const PLANES_EVERY_MS = 90_000;
/** Vessels and aircraft this far outside the opening view are not kept at all. */
const KEEP_PAD_DEG = 0.06;

/**
 * The edges no card or tag is placed in. The frame's own words are kept clear by
 * measuring them (keptBoxes). A 9:16 recording keeps more: Instagram lays its caption
 * over the bottom quarter and its buttons down the right edge, so the frame's words
 * move up above the caption (eye.module.css, [data-record]) and nothing is placed
 * under either.
 */
export function safeFrame(width: number, height: number, portrait: boolean, record = false): Frame {
  if (portrait && record) {
    return { width, height, top: Math.round(height * 0.12), bottom: Math.round(height * 0.27), side: 10, right: Math.round(width * 0.13) };
  }
  return portrait ? { width, height, top: 10, bottom: 10, side: 8 } : { width, height, top: 12, bottom: 12, side: 12 };
}

/**
 * The boxes of the frame's words (EyeHud marks them data-eye-keep), in the map's
 * own pixels and padded by GAP: the header, the buttons, the ledger and the credits,
 * wherever the layout of the moment puts them.
 */
function keptBoxes(container: HTMLElement): Box[] {
  const origin = container.getBoundingClientRect();
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-eye-keep]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({
      x0: r.left - origin.left - GAP,
      y0: r.top - origin.top - GAP,
      x1: r.right - origin.left + GAP,
      y1: r.bottom - origin.top + GAP,
    });
  }
  return out;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** A chevron for the GPU symbol layers, drawn once per style on a canvas. */
function chevron(fill: string): ImageData {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.translate(s / 2, s / 2);
  g.beginPath();
  g.moveTo(0, -25);
  g.lineTo(17, 21);
  g.lineTo(0, 11);
  g.lineTo(-17, 21);
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 5;
  g.strokeStyle = "rgba(3,7,9,0.9)";
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  return g.getImageData(0, 0, s, s);
}

const point = (id: string, lon: number, lat: number, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: { id, ...props },
  geometry: { type: "Point", coordinates: [lon, lat] },
});

interface Props {
  map: maplibregl.Map;
  /** Bumped by EyeApp each time WorldMap finishes a style, so the layers go back on. */
  styleEpoch: number;
  target: EyeTarget;
  portrait: boolean;
  /** A recording (record=1): the 9:16 frame keeps clear of Instagram's own bands. */
  record: boolean;
  onReport: (r: OverlayReport) => void;
  /** Filled with "place the cards and tags now", for the record script's frame-by-frame clock. */
  placeRef?: React.MutableRefObject<(() => void) | null>;
}

interface State {
  cams: NearCamera[] | null;
  ships: Vessel[] | null;
  planes: Aircraft[] | null;
  /** TfL's disruptions around the view; stays null outside London, where none are asked for. */
  streets: StreetDisruption[] | null;
  /** The streets route answered without TfL's data (a cold start with TfL down). */
  streetsDown: boolean;
  planesSampled: boolean;
  planesFetchedAt: number | null;
  refreshedAt?: number;
  cards: Map<string, { card: CameraCard; marker: maplibregl.Marker }>;
  tags: Map<string, Tag>;
}

export default function EyeOverlay({ map, styleEpoch, target, portrait, record, onReport, placeRef }: Props) {
  const state = useRef<State>({
    cams: null,
    ships: null,
    planes: null,
    streets: null,
    streetsDown: false,
    planesSampled: false,
    planesFetchedAt: null,
    cards: new Map(),
    tags: new Map(),
  });
  const reportRef = useRef(onReport);
  reportRef.current = onReport;
  const pinned = target.kind === "camera" ? target.cameraId : null;

  /**
   * Sources, images and layers on the current style. Idempotent: every style gets
   * them once. A source is added only once its data is known, because it carries
   * that data's credit into MapLibre's attribution control.
   */
  const ensureLayers = useRef(() => {});
  ensureLayers.current = () => {
    const s = state.current;
    const under = map.getLayer(BUILDING_LAYER) ? BUILDING_LAYER : undefined;

    if (s.cams && !map.getSource(SRC.cams)) {
      const credit = cameraCredits(s.cams.filter((c) => c.available)).join(" · ");
      map.addSource(SRC.cams, { type: "geojson", data: EMPTY, attribution: credit });
    }
    if (map.getSource(SRC.cams)) {
      if (!map.getLayer(LYR.ring)) {
        map.addLayer(
          {
            id: LYR.ring,
            type: "circle",
            source: SRC.cams,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 6, 17, 16],
              "circle-color": "rgba(232,241,248,0.10)",
              "circle-stroke-color": "rgba(232,241,248,0.9)",
              "circle-stroke-width": 1.5,
              "circle-pitch-alignment": "map",
            },
          },
          under,
        );
      }
      if (!map.getLayer(LYR.dot)) {
        map.addLayer(
          {
            id: LYR.dot,
            type: "circle",
            source: SRC.cams,
            paint: { "circle-radius": 2.6, "circle-color": "#e8f1f8", "circle-pitch-alignment": "map" },
          },
          under,
        );
      }
      (map.getSource(SRC.cams) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: (s.cams ?? []).filter((c) => c.available).map((c) => point(c.id, c.lon, c.lat)),
      });
    }

    // TfL's disruptions lie ON the street, under the buildings like the camera rings,
    // so a tower in front hides them. Dashed: a notice, never a measured speed.
    if (s.streets && !map.getSource(SRC.streets)) {
      map.addSource(SRC.streets, { type: "geojson", data: EMPTY, attribution: TFL_CREDIT });
    }
    if (map.getSource(SRC.streets)) {
      if (!map.getLayer(LYR.streetLine)) {
        map.addLayer(
          {
            id: LYR.streetLine,
            type: "line",
            source: SRC.streets,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": COLOUR.road,
              "line-width": ["interpolate", ["linear"], ["zoom"], 14, ["*", 1.2, ["get", "w"]], 17, ["*", 2.6, ["get", "w"]]],
              "line-opacity": 0.9,
              "line-dasharray": [1.2, 1],
            },
          },
          under,
        );
      }
      if (!map.getLayer(LYR.streetDot)) {
        map.addLayer(
          {
            id: LYR.streetDot,
            type: "circle",
            source: SRC.streets,
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 7],
              "circle-color": "rgba(251,113,133,0.25)",
              "circle-stroke-color": COLOUR.road,
              "circle-stroke-width": 1.5,
              "circle-pitch-alignment": "map",
            },
          },
          under,
        );
      }
      const features: GeoJSON.Feature[] = [];
      for (const d of s.streets ?? []) {
        const w = severityWeight(d.severity);
        if (d.lines.length === 0) features.push(point(d.id, d.lon, d.lat, { w }));
        for (const line of d.lines) {
          features.push({ type: "Feature", properties: { id: d.id, w }, geometry: { type: "LineString", coordinates: line } });
        }
      }
      (map.getSource(SRC.streets) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    }

    if (!map.hasImage(IMG.ship)) map.addImage(IMG.ship, chevron(COLOUR.ship), { pixelRatio: 2 });
    if (!map.hasImage(IMG.plane)) map.addImage(IMG.plane, chevron(COLOUR.plane), { pixelRatio: 2 });

    // The vessels' credit names the feeds of the vessels around the view (AISStream on
    // the Thames). A source's credit is fixed when it is added, so a change of feeds
    // (none at first, then some) puts the source back with the new one.
    if (s.ships) {
      const credit = vesselCredits(s.ships).join(" · ") || AISSTREAM_ATTRIBUTION;
      const had = map.getSource(SRC.ships) as { attribution?: string } | undefined;
      if (had && had.attribution !== credit) {
        for (const id of [LYR.ship, LYR.ahead]) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of [SRC.ships, SRC.ahead]) if (map.getSource(id)) map.removeSource(id);
      }
      if (!map.getSource(SRC.ships)) {
        map.addSource(SRC.ships, { type: "geojson", data: EMPTY, attribution: credit });
        map.addSource(SRC.ahead, { type: "geojson", data: EMPTY });
      }
    }
    if (map.getSource(SRC.ships)) {
      if (!map.getLayer(LYR.ahead)) {
        map.addLayer({
          id: LYR.ahead,
          type: "line",
          source: SRC.ahead,
          layout: { "line-cap": "round" },
          paint: { "line-color": COLOUR.ship, "line-width": 1.6, "line-opacity": 0.85, "line-dasharray": [2, 2] },
        });
      }
      if (!map.getLayer(LYR.ship)) {
        map.addLayer({
          id: LYR.ship,
          type: "symbol",
          source: SRC.ships,
          layout: {
            "icon-image": IMG.ship,
            "icon-size": ["case", ["get", "moving"], 0.62, 0.46],
            "icon-rotate": ["get", "rot"],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
          },
          paint: { "icon-opacity": ["case", ["get", "moving"], 1, 0.55] },
        });
      }
      const ships = s.ships ?? [];
      (map.getSource(SRC.ships) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: ships.map((v) => point(v.id, v.lon, v.lat, { moving: v.moving, rot: v.rot })),
      });
      (map.getSource(SRC.ahead) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: ships
          .filter((v) => v.ahead)
          .map((v) => ({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[v.lon, v.lat], v.ahead!] },
          })),
      });
    }

    if (s.planes && !map.getSource(SRC.planes)) {
      map.addSource(SRC.planes, { type: "geojson", data: EMPTY, attribution: AIRCRAFT_CREDIT });
    }
    if (map.getSource(SRC.planes)) {
      if (!map.getLayer(LYR.plane)) {
        map.addLayer({
          id: LYR.plane,
          type: "symbol",
          source: SRC.planes,
          layout: {
            "icon-image": IMG.plane,
            "icon-size": 0.5,
            "icon-rotate": ["get", "rot"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
          },
        });
      }
      (map.getSource(SRC.planes) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: (s.planes ?? []).map((a) => point(a.id, a.lon, a.lat, { rot: a.rot })),
      });
    }
  };

  // Every finished style: the layers go back on (a basemap swap wipes them).
  useEffect(() => {
    ensureLayers.current();
  }, [map, styleEpoch]);

  useEffect(() => {
    let disposed = false;
    const s = state.current;
    const size = portrait ? CARD_PHONE : CARD_WIDE;
    const maxTags = portrait ? MAX_TAGS.phone : MAX_TAGS.wide;
    let ready = false;
    let lastRowsKey = "";
    // What the ledger counts: the marks that carry words on screen now (a card, a tag),
    // so every count can be read off the view. "of N nearby" is what was fetched around it.
    let labelled = { cams: 0, ships: [] as Vessel[], planes: 0, roads: 0 };
    const london = inLondon(target.view.lat, target.view.lon);

    const report = () => {
      const rows: LedgerRow[] = [];
      if (s.cams) rows.push(cameraLedgerRow(labelled.cams, s.cams));
      if (s.ships) rows.push(vesselLedgerRow(labelled.ships, s.ships.length));
      if (s.planes) {
        const ageMs = s.planesFetchedAt != null ? Date.now() - s.planesFetchedAt : null;
        rows.push(aircraftLedgerRow(labelled.planes, s.planes.length, { sampled: s.planesSampled, ageMs }));
      }
      if (s.streets) rows.push(s.streetsDown ? streetsDownRow() : streetsLedgerRow(labelled.roads, s.streets.length));
      rows.push(speedLedgerRow(london));
      const cameraName = pinned ? s.cams?.find((c) => c.id === pinned)?.name : undefined;
      const phoneNote = speedPhoneNote(london);
      const key = JSON.stringify([rows, ready, cameraName, s.refreshedAt]);
      if (key === lastRowsKey) return;
      lastRowsKey = key;
      reportRef.current({ rows, ready, cameraName, refreshedAt: s.refreshedAt, phoneNote });
    };

    const place = () => {
      if (disposed) return;
      const box = map.getContainer();
      const width = box.clientWidth;
      const height = box.clientHeight;
      // No depth test before projecting: map.project() mirrors a point behind the
      // camera, but the mirror lands above the horizon, which stays above the top of the
      // screen at any tilt up to 60 degrees (MapLibre's default ceiling, kept here).
      // Checked against MapLibre's own depth over the whole fetched area, 25 Oct 2026.
      const frame = safeFrame(width, height, portrait, record);
      const centre = { x: width / 2, y: height / 2 };
      const taken: Box[] = keptBoxes(box);

      // Cards first: they are the largest and the reason for the view.
      const cams = (s.cams ?? []).filter((c) => c.available);
      const camCands = cams.map((c) => {
        const p = map.project([c.lon, c.lat]);
        return { id: c.id, x: p.x, y: p.y };
      });
      const placed = placeCards(
        placementOrder(camCands, centre, new Set(s.cards.keys()), pinned),
        size,
        frame,
        size.max,
        taken,
      );
      const keepCards = new Set(placed.map((p) => p.id));
      for (const [id, entry] of s.cards) {
        if (keepCards.has(id)) continue;
        entry.marker.remove();
        entry.card.destroy();
        s.cards.delete(id);
      }
      for (const p of placed) {
        if (s.cards.has(p.id)) continue;
        const cam = cams.find((c) => c.id === p.id)!;
        const card = new CameraCard(cam, portrait);
        card.el.style.setProperty("--w", `${size.width}px`);
        card.el.style.setProperty("--stalk", `${size.stalk}px`);
        const marker = new maplibregl.Marker({ element: card.el, anchor: "bottom" }).setLngLat([cam.lon, cam.lat]).addTo(map);
        s.cards.set(p.id, { card, marker });
      }

      // Then tags: moving vessels before stopped ones, then aircraft, then streets.
      type Item = TagCandidate & { kind: "ship" | "plane" | "road"; lngLat: [number, number]; title: string; meta: string };
      const tagItems = (list: { id: string; lat: number; lon: number; words: { title: string; meta: string } }[], kind: Item["kind"]) =>
        list.map((o): Item => {
          const p = map.project([o.lon, o.lat]);
          const sz = tagSize(o.words.title, o.words.meta, portrait);
          return { id: o.id, x: p.x, y: p.y, ...sz, kind, lngLat: [o.lon, o.lat], ...o.words };
        });
      const shownTags = new Set(s.tags.keys());
      const ships = s.ships ?? [];
      const moving = tagItems(ships.filter((v) => v.moving).map((v) => ({ ...v, words: vesselTag(v) })), "ship");
      const stopped = tagItems(ships.filter((v) => !v.moving).map((v) => ({ ...v, words: vesselTag(v) })), "ship");
      const shipOrder = [...placementOrder(moving, centre, shownTags), ...placementOrder(stopped, centre, shownTags)];
      const planeItems = tagItems((s.planes ?? []).map((a) => ({ ...a, words: aircraftTag(a) })), "plane");
      const roadItems = tagItems((s.streets ?? []).map((d) => ({ ...d, words: streetTag(d) })), "road");
      // TfL's most severe first; among equals, the usual order.
      const weight = new Map((s.streets ?? []).map((d) => [d.id, severityWeight(d.severity)]));
      const roadOrder = placementOrder(roadItems, centre, shownTags).sort(
        (a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0),
      );
      const tagPlaced = [
        ...placeTags(shipOrder, frame, maxTags.ship, taken),
        ...placeTags(placementOrder(planeItems, centre, shownTags), frame, maxTags.plane, taken),
        ...placeTags(roadOrder, frame, maxTags.road, taken),
      ];
      const byId = new Map<string, Item>([...shipOrder, ...planeItems, ...roadItems].map((i) => [i.id, i]));
      const keepTags = new Set(tagPlaced.map((t) => t.id));
      const tagged = (kind: Item["kind"]) => tagPlaced.filter((t) => byId.get(t.id)?.kind === kind);
      labelled = {
        cams: placed.length,
        ships: ships.filter((v) => keepTags.has(v.id)),
        planes: tagged("plane").length,
        roads: tagged("road").length,
      };
      for (const [id, tag] of s.tags) {
        if (keepTags.has(id)) continue;
        tag.remove();
        s.tags.delete(id);
      }
      for (const t of tagPlaced) {
        const item = byId.get(t.id)!;
        let tag = s.tags.get(t.id);
        if (!tag) {
          tag = new Tag(item.kind);
          s.tags.set(t.id, tag);
        }
        tag.setText(item.title, item.meta);
        tag.show(map, item.lngLat, t.flip);
      }

      ready = s.cams != null && s.ships != null && s.planes != null && (!london || s.streets != null);
      report();
    };

    // --- when to place --------------------------------------------------------
    let settle: ReturnType<typeof setTimeout> | null = null;
    let lastPlace = 0;
    const placeNow = () => {
      lastPlace = performance.now();
      place();
    };
    if (placeRef) placeRef.current = placeNow;
    const onMoveEnd = () => {
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        placeNow();
      }, 300);
    };
    const onMove = () => {
      if (performance.now() - lastPlace > 1000) placeNow();
    };
    map.on("moveend", onMoveEnd);
    map.on("move", onMove);
    /** New data: onto the GPU now, the DOM once the map has drawn it. */
    const landed = () => {
      if (disposed) return;
      ensureLayers.current();
      report();
      map.once("idle", placeNow);
      map.triggerRepaint();
    };

    // --- data -------------------------------------------------------------------
    const { lat, lon } = target.view;
    const region = {
      west: lon - KEEP_PAD_DEG * 2,
      east: lon + KEEP_PAD_DEG * 2,
      south: lat - KEEP_PAD_DEG,
      north: lat + KEEP_PAD_DEG,
    };
    const getJson = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    void getJson(`/api/near?lat=${lat}&lon=${lon}&n=25`).then((d: { cameras?: NearCamera[] } | null) => {
      if (disposed) return;
      s.cams = nearCameras(d?.cameras ?? []);
      landed();
    });

    const loadShips = () =>
      void getJson("/api/signals/ais").then((d: { features?: AisFeatureLike[] } | null) => {
        if (disposed) return;
        s.ships = (d?.features ?? [])
          .filter((f) => inBounds(f.lat, f.lon, region, 0))
          .map(toVessel)
          .filter((v): v is Vessel => v != null);
        s.refreshedAt = Date.now();
        landed();
      });
    const loadPlanes = () =>
      void getJson("/api/planes").then(
        (d: { planes?: PlaneLike[]; fetchedAt?: number; coverage?: { capped?: boolean } } | null) => {
          if (disposed) return;
          s.planes = (d?.planes ?? [])
            .filter((p) => inBounds(p.lat, p.lon, region, 0))
            .map(toAircraft)
            .filter((a): a is Aircraft => a != null);
          s.planesSampled = Boolean(d?.coverage?.capped);
          s.planesFetchedAt = typeof d?.fetchedAt === "number" ? d.fetchedAt : null;
          s.refreshedAt = Date.now();
          landed();
        },
      );
    // TfL covers London only; elsewhere nothing is asked for, and the ledger says the
    // road speed is not measured in this view.
    const loadStreets = () =>
      void getJson("/api/eye/streets").then((d: { ok?: boolean; features?: StreetDisruption[] } | null) => {
        if (disposed) return;
        if (d?.ok) {
          s.streets = (d.features ?? []).filter((f) => inBounds(f.lat, f.lon, region, 0));
          s.streetsDown = false;
        } else if (s.streets == null) {
          // Nothing from TfL yet: the ledger says so rather than "0". A failed refresh
          // after a good one keeps what is drawn.
          s.streets = [];
          s.streetsDown = true;
        }
        landed();
      });
    loadShips();
    loadPlanes();
    if (london) loadStreets();
    const shipTimer = setInterval(loadShips, AIS_EVERY_MS);
    const planeTimer = setInterval(loadPlanes, PLANES_EVERY_MS);
    const streetTimer = london ? setInterval(loadStreets, STREETS_EVERY_MS) : null;

    // The age on every card, re-worded twice a minute.
    const ticker = setInterval(() => {
      const now = Date.now();
      for (const { card } of s.cards.values()) card.tick(now);
    }, 30_000);

    return () => {
      disposed = true;
      if (placeRef?.current === placeNow) placeRef.current = null;
      map.off("moveend", onMoveEnd);
      map.off("move", onMove);
      if (settle) clearTimeout(settle);
      clearInterval(ticker);
      clearInterval(shipTimer);
      clearInterval(planeTimer);
      if (streetTimer) clearInterval(streetTimer);
      for (const { card, marker } of s.cards.values()) {
        marker.remove();
        card.destroy();
      }
      s.cards.clear();
      for (const tag of s.tags.values()) tag.remove();
      s.tags.clear();
      releaseCardMedia();
    };
  }, [map, target, portrait, record, pinned, placeRef]);

  return null;
}
