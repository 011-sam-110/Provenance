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
//
// ONE CLIP PLAYS WHILE THE VIEW MOVES. Three clips playing at once halved the moving
// view's frames, one cost none (lib/eye/cameras.ts, clipsToPlay). At rest every clip plays.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import type { EyeTarget } from "@/lib/eye/places";
import { cameraCredits, cameraLedgerRow, clipsToPlay, nearCameras, type NearCamera, type PlayingCandidate } from "@/lib/eye/cameras";
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
  streetFeatures,
  streetTag,
  streetsDownRow,
  streetsLedgerRow,
  type StreetDisruption,
  type StreetTimes,
} from "@/lib/eye/streets";
import { newestChange } from "@/lib/roads/notice";
import { AISSTREAM_ATTRIBUTION } from "@/lib/signals/ais";
import type { LedgerRow } from "@/lib/eye/wording";
import type { EyeClock } from "@/lib/eye/motion";
import { CameraCard, releaseCardMedia } from "./cameraCard";
import { CAMERA_ROAD_MAX, cameraRoadParam, cameraRoadTileWords, type CameraRoad } from "@/lib/roads/nearCamera";
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
  // Road notices, bottom to top: a closure's white base, its rose bars, works dashes,
  // incident dots, then the rings of notices TfL gave no street line for.
  streetClosedBase: "eye-street-closed-base",
  streetClosed: "eye-street-closed",
  streetWorks: "eye-street-works",
  streetIncident: "eye-street-incident",
  streetDot: "eye-street-dot",
} as const;
const IMG = { ship: "eye-chevron-ship", plane: "eye-chevron-plane" } as const;
const COLOUR = { ship: "#2dd4bf", plane: "#fbbf24", road: "#fb7185", incident: "#c4b5fd", bar: "#eef3f1" } as const;
/** A street line's width: by zoom only, never by a feature's property (see streetFeatures). */
const roadWidth = (at14: number, at17: number): maplibregl.ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  at14,
  17,
  at17,
];
/** TfL's heavier severities (Moderate and up) are drawn opaque, the lighter ones fainter. */
const ROAD_OPACITY: maplibregl.ExpressionSpecification = ["case", ["==", ["get", "heavy"], true], 0.95, 0.65];

/** The camera roads are asked again this often, as the camera wall does. */
const CAMERA_ROAD_EVERY_MS = 120_000;
// The words take 40 (46 on a phone) under the picture, and the camera's road line 20 (18).
const CARD_WIDE: CardSize & { max: number } = { width: 172, height: Math.round(172 / (352 / 288)) + 60, stalk: 52, max: 5 };
const CARD_PHONE: CardSize & { max: number } = { width: 120, height: Math.round(120 / (352 / 288)) + 64, stalk: 34, max: 3 };
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
  /**
   * The wall clock, or a film's own under clock=manual (lib/eye/motion.ts). In a film
   * every age reads it, no feed is fetched again, and the cards' clips step with it.
   */
  clock: EyeClock;
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
  /** When the server last asked TfL: the route's own `fetchedAt`, never the browser's. */
  streetsFetchedAt: number | null;
  planesSampled: boolean;
  planesFetchedAt: number | null;
  refreshedAt?: number;
  cards: Map<string, { card: CameraCard; marker: maplibregl.Marker }>;
  tags: Map<string, Tag>;
  /** Each camera's road (/api/camera-road), by camera id; null until it answers. */
  roads: Map<string, CameraRoad> | null;
}

export default function EyeOverlay({ map, styleEpoch, target, portrait, record, clock, onReport, placeRef }: Props) {
  const state = useRef<State>({
    cams: null,
    ships: null,
    planes: null,
    streets: null,
    streetsDown: false,
    streetsFetchedAt: null,
    planesSampled: false,
    planesFetchedAt: null,
    cards: new Map(),
    tags: new Map(),
    roads: null,
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
              "circle-stroke-width": 2,
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

    // TfL's notices lie ON the street, under the buildings like the camera rings, so a
    // tower in front hides them. None is ever a solid single colour, because a solid line
    // is how a measured speed will be drawn: works are rose dashes, incidents violet dots,
    // and only a street TfL marks Closed gets rose and white bars.
    if (s.streets && !map.getSource(SRC.streets)) {
      map.addSource(SRC.streets, { type: "geojson", data: EMPTY, attribution: TFL_CREDIT });
    }
    if (map.getSource(SRC.streets)) {
      const line = (id: string, paint: string, style: maplibregl.LineLayerSpecification["paint"]) => {
        if (map.getLayer(id)) return;
        map.addLayer(
          {
            id,
            type: "line",
            source: SRC.streets,
            filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "paint"], paint]],
            layout: { "line-cap": paint === "incident" ? "round" : "butt", "line-join": "round" },
            paint: style,
          },
          under,
        );
      };
      line(LYR.streetClosedBase, "closed", { "line-color": COLOUR.bar, "line-width": roadWidth(2.6, 6), "line-opacity": ROAD_OPACITY });
      line(LYR.streetClosed, "closed", {
        "line-color": COLOUR.road,
        "line-width": roadWidth(2.6, 6),
        "line-opacity": ROAD_OPACITY,
        "line-dasharray": [1, 1],
      });
      line(LYR.streetWorks, "works", {
        "line-color": COLOUR.road,
        "line-width": roadWidth(1.6, 3.6),
        "line-opacity": ROAD_OPACITY,
        "line-dasharray": [1.4, 1],
      });
      line(LYR.streetIncident, "incident", {
        "line-color": COLOUR.incident,
        "line-width": roadWidth(2.4, 5),
        "line-opacity": ROAD_OPACITY,
        "line-dasharray": [0, 2],
      });
      if (!map.getLayer(LYR.streetDot)) {
        map.addLayer(
          {
            id: LYR.streetDot,
            type: "circle",
            source: SRC.streets,
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 7],
              "circle-color": ["match", ["get", "paint"], "closed", COLOUR.bar, "rgba(0,0,0,0)"],
              "circle-stroke-color": ["match", ["get", "paint"], "incident", COLOUR.incident, COLOUR.road],
              "circle-stroke-width": 1.8,
              "circle-opacity": ROAD_OPACITY,
              "circle-stroke-opacity": ROAD_OPACITY,
              "circle-pitch-alignment": "map",
            },
          },
          under,
        );
      }
      (map.getSource(SRC.streets) as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: streetFeatures(s.streets ?? []),
      });
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
          paint: { "line-color": COLOUR.ship, "line-width": 2.2, "line-opacity": 0.95, "line-dasharray": [2, 2] },
        });
      }
      if (!map.getLayer(LYR.ship)) {
        map.addLayer({
          id: LYR.ship,
          type: "symbol",
          source: SRC.ships,
          layout: {
            "icon-image": IMG.ship,
            // Critique round 2: at 0.62 and 0.46 a vessel was a speck beside the
            // reference reel's marks. A moving one is the larger.
            "icon-size": ["case", ["get", "moving"], 0.9, 0.66],
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
            "icon-size": 0.72,
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
        const ageMs = s.planesFetchedAt != null ? clock.now() - s.planesFetchedAt : null;
        rows.push(aircraftLedgerRow(labelled.planes, s.planes.length, { sampled: s.planesSampled, ageMs }));
      }
      // TfL's newest change among the notices around the view, and when the server asked.
      const roadTimes: StreetTimes | undefined =
        s.streets && !s.streetsDown
          ? { changedAt: newestChange(s.streets), fetchedAt: s.streetsFetchedAt, now: clock.now() }
          : undefined;
      if (s.streets) rows.push(s.streetsDown ? streetsDownRow() : streetsLedgerRow(labelled.roads, s.streets.length, roadTimes));
      rows.push(speedLedgerRow(london));
      const cameraName = pinned ? s.cams?.find((c) => c.id === pinned)?.name : undefined;
      const phoneNote = speedPhoneNote(london, roadTimes);
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
        const card = new CameraCard(cam, { phone: portrait, clock, onMedia: clipsChanged });
        card.el.style.setProperty("--w", `${size.width}px`);
        card.el.style.setProperty("--stalk", `${size.stalk}px`);
        const road = s.roads?.get(cam.id);
        if (road) card.setRoad(cameraRoadTileWords(road, clock.now()));
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
      playClips();
    };

    // --- which clips play (clipsToPlay) ------------------------------------------
    // Every clip while the view rests; one while it moves, so the move keeps its frames.
    let moving = false;
    const playClips = () => {
      if (disposed) return;
      const box = map.getContainer();
      const showing: PlayingCandidate[] = [];
      for (const [id, { card, marker }] of s.cards) {
        const media = card.media;
        if (media !== "clip" && media !== "stream") continue;
        const p = map.project(marker.getLngLat());
        showing.push({ id, media, x: p.x, y: p.y });
      }
      const play = clipsToPlay(showing, { x: box.clientWidth / 2, y: box.clientHeight / 2 }, moving, pinned);
      for (const [id, { card }] of s.cards) card.setPlay(play.has(id));
    };
    // A card's picture arrived or changed: decide again, once for a burst of them.
    let clipsQueued = false;
    const clipsChanged = () => {
      if (clipsQueued) return;
      clipsQueued = true;
      queueMicrotask(() => {
        clipsQueued = false;
        playClips();
      });
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
        moving = false;
        placeNow();
      }, 300);
    };
    const onMove = () => {
      const started = !moving;
      moving = true;
      if (performance.now() - lastPlace > 1000) placeNow();
      else if (started) playClips();
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

    // What the road operators say about each camera's road. Asked once the cameras are
    // known, then with the other feeds; a failed ask keeps the last answer.
    const loadRoads = () => {
      const cams = s.cams ?? [];
      if (cams.length === 0) return;
      const qs = cams.slice(0, CAMERA_ROAD_MAX).map((c) => `c=${encodeURIComponent(cameraRoadParam(c))}`).join("&");
      void getJson(`/api/camera-road?${qs}`).then((d: { roads?: Record<string, CameraRoad> } | null) => {
        if (disposed || !d?.roads) return;
        s.roads = new Map(Object.entries(d.roads));
        const now = clock.now();
        for (const [id, { card }] of s.cards) {
          const road = s.roads.get(id);
          if (road) card.setRoad(cameraRoadTileWords(road, now));
        }
      });
    };

    void getJson(`/api/near?lat=${lat}&lon=${lon}&n=25`).then((d: { cameras?: NearCamera[] } | null) => {
      if (disposed) return;
      s.cams = nearCameras(d?.cameras ?? []);
      landed();
      loadRoads();
    });

    const loadShips = () =>
      void getJson("/api/signals/ais").then((d: { features?: AisFeatureLike[] } | null) => {
        if (disposed) return;
        s.ships = (d?.features ?? [])
          .filter((f) => inBounds(f.lat, f.lon, region, 0))
          .map(toVessel)
          .filter((v): v is Vessel => v != null);
        s.refreshedAt = clock.now();
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
          s.refreshedAt = clock.now();
          landed();
        },
      );
    // TfL covers London only; elsewhere nothing is asked for, and the ledger says the
    // road speed is not measured in this view.
    const loadStreets = () =>
      void getJson("/api/eye/streets").then(
        (d: { ok?: boolean; fetchedAt?: number | null; features?: StreetDisruption[] } | null) => {
        if (disposed) return;
        if (d?.ok) {
          s.streets = (d.features ?? []).filter((f) => inBounds(f.lat, f.lon, region, 0));
          s.streetsDown = false;
          s.streetsFetchedAt = typeof d.fetchedAt === "number" ? d.fetchedAt : null;
        } else if (s.streets == null) {
          // Nothing from TfL yet: the ledger says so rather than "0". A failed refresh
          // after a good one keeps what is drawn.
          s.streets = [];
          s.streetsDown = true;
        }
        landed();
        },
      );
    loadShips();
    loadPlanes();
    if (london) loadStreets();
    // A film keeps the reports it opened with: it is drawn far slower than it plays, so
    // a report fetched during it would be minutes newer than the film's own clock.
    const timers = clock.film
      ? []
      : [
          setInterval(loadShips, AIS_EVERY_MS),
          setInterval(loadPlanes, PLANES_EVERY_MS),
          ...(london ? [setInterval(loadStreets, STREETS_EVERY_MS)] : []),
          setInterval(loadRoads, CAMERA_ROAD_EVERY_MS),
        ];

    // The age on every card: re-worded twice a minute, or at each step of a film.
    const tickCards = () => {
      const now = clock.now();
      for (const { card } of s.cards.values()) card.tick(now);
    };
    const ticker = clock.film ? null : setInterval(tickCards, 30_000);
    const leaveFilm = clock.film ? clock.subscribe(tickCards) : null;

    return () => {
      disposed = true;
      if (placeRef?.current === placeNow) placeRef.current = null;
      map.off("moveend", onMoveEnd);
      map.off("move", onMove);
      if (settle) clearTimeout(settle);
      if (ticker) clearInterval(ticker);
      leaveFilm?.();
      for (const t of timers) clearInterval(t);
      for (const { card, marker } of s.cards.values()) {
        marker.remove();
        card.destroy();
      }
      s.cards.clear();
      for (const tag of s.tags.values()) tag.remove();
      s.tags.clear();
      releaseCardMedia();
    };
  }, [map, target, portrait, record, clock, pinned, placeRef]);

  return null;
}
