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
//
// A KIND CAN BE HIDDEN (the Sources tray, components/eye/EyeSources.tsx). A hidden kind is
// not drawn, not tagged, not counted and not fetched: its layers are hidden or filtered,
// its list is empty in place(), and its feed is not called. Shown again, its layers come
// back, and a list never fetched is fetched once. The console's layers that are switched on
// draw through WorldMap; here they are only counted and named: one ledger row and up to
// two tags, from queryRenderedFeatures at placement, never per frame.
//
// A VESSEL OR AN AIRCRAFT CAN BE CLICKED. A click on the map picks the nearest mark
// within reach (lib/eye/pick.ts: every mark is projected to the screen and measured, the
// GPU layer is never asked), a plate is a button for the same, and either opens the
// detail panel (DetailPanel.tsx) with a ring under the mark. Only the selection and the
// panel's content are React state, and they change on a click or a feed refresh, never
// per frame. A recording or a film (record=1, clock=manual) is not interactive at all.
//
// PREVIEWS OFF (the switch in EyeApp). A camera is a CameraIcon on its spot and fetches
// nothing; a tap opens that one camera's card, with a close button, in its place. One card
// is open at a time. It is closed by its button, by Esc, or when its spot leaves the
// frame. The open card lives in `cards` like any card, so the clips, the ages and the
// cleanup treat it alike. Switching clears every mark and places again: it does NOT
// fetch the feeds again, because `previews` is read through a ref, not an effect input.

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import {
  SIGNAL_ANCHOR_SRC,
  SIGNAL_DISC_LAYER,
  SIGNAL_FILL_LAYER,
  SIGNAL_FILL_SRC,
  SIGNAL_ICON_LAYER,
  SIGNAL_LAYER,
  SIGNAL_LINE_SRC,
  SIGNAL_SRC,
} from "@/lib/map/signalLayerIds";
import { SIGNAL_DRAWN_LINE_LAYERS } from "@/lib/map/hitTest";
import { countBySignal, signalTagPicks, type EyeKind, type EyeSourceRow, type RenderedSignal } from "@/lib/eye/sources";
import { haversineKm } from "@/lib/geo/haversine";
import { PICK_RADIUS, marksAround, pickMarks, type PickCandidate } from "@/lib/eye/pick";
import type { EyeTarget } from "@/lib/eye/places";
import { cameraCredits, cameraLedgerRow, clipsToPlay, nearCameras, type NearCamera, type PlayingCandidate } from "@/lib/eye/cameras";
import {
  GAP,
  cardBox,
  placeCards,
  placeTags,
  placementOrder,
  type Box,
  type CardSize,
  type Frame,
  type TagCandidate,
} from "@/lib/eye/declutter";
import { ICON_PHONE, ICON_WIDE, cardBoxBelow, openCardSide } from "@/lib/eye/previews";
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
  noticeRows,
  streetTag,
  streetsDownRow,
  streetsLedgerRow,
  type StreetDisruption,
  type StreetTimes,
} from "@/lib/eye/streets";
import { newestChange } from "@/lib/roads/notice";
import { AISSTREAM_ATTRIBUTION } from "@/lib/signals/ais";
import { signalLedgerRow, type LedgerRow } from "@/lib/eye/wording";
import type { EyeClock } from "@/lib/eye/motion";
import { CameraCard, releaseCardMedia } from "./cameraCard";
import { CAMERA_ROAD_MAX, cameraRoadParam, cameraRoadTileWords, type CameraRoad } from "@/lib/roads/nearCamera";
import { CameraIcon } from "./cameraIcon";
import { Tag, tagSize } from "./tag";
import DetailPanel, { type AlsoHere, type DetailSubject } from "./DetailPanel";

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
  /** What each switched-on row has in the scene now, by row id: the tray's "N here". */
  counts: Record<string, number>;
}

const SRC = {
  cams: "eye-cams",
  ships: "eye-ships",
  ahead: "eye-ship-ahead",
  planes: "eye-planes",
  streets: "eye-streets",
  selected: "eye-selected",
} as const;
const LYR = {
  ring: "eye-cam-ring",
  dot: "eye-cam-dot",
  ahead: "eye-ship-ahead",
  ship: "eye-ship",
  plane: "eye-plane",
  /** The ring under the selected vessel or aircraft, beneath the chevrons. */
  selectedRing: "eye-selected-ring",
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
/** The selection ring's fill: its kind's colour at 0.16 alpha. */
const RING_FILL = { ship: "rgba(45,212,191,0.16)", plane: "rgba(251,191,36,0.16)" } as const;
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
const MAX_TAGS = {
  wide: { ship: 8, plane: 3, road: 2, signal: 2 },
  phone: { ship: 4, plane: 2, road: 1, signal: 1 },
} as const;
/**
 * How many marks of the console's layers are offered to the tag placement; it places the
 * first one or two (MAX_TAGS.signal) that fit clear of the frame's words, nearest the middle.
 * Offered only the first two, a view whose first two marks sat under the header got none.
 */
const SIGNAL_TAG_POOL = 200;
/** The layers a switched-on console layer is read from (the points, the discs, the areas, the lines). */
const SIGNAL_READ_LAYERS = [SIGNAL_LAYER, SIGNAL_ICON_LAYER, SIGNAL_DISC_LAYER, SIGNAL_FILL_LAYER, ...SIGNAL_DRAWN_LINE_LAYERS];
/** The sources whose data landing means the marks are worth counting again. */
const SIGNAL_SOURCES = new Set([SIGNAL_SRC, SIGNAL_ANCHOR_SRC, SIGNAL_FILL_SRC, SIGNAL_LINE_SRC]);

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

/** One feature MapLibre drew from a console layer, as the counting and the tags read it. */
function renderedSignal(f: maplibregl.MapGeoJSONFeature): RenderedSignal {
  const p = (f.properties ?? {}) as { signalId?: unknown; id?: unknown; label?: unknown };
  const g = f.geometry;
  const at = g.type === "Point" ? g.coordinates : null;
  return {
    signalId: typeof p.signalId === "string" ? p.signalId : "",
    id: typeof p.id === "string" || typeof p.id === "number" ? String(p.id) : "",
    label: typeof p.label === "string" ? p.label : "",
    lon: at ? at[0] : null,
    lat: at ? at[1] : null,
  };
}

/** TfL's notices are not asked for while all three road rows are off. */
const allRoadsHidden = (hid: ReadonlySet<EyeKind>) => hid.has("works") && hid.has("incidents") && hid.has("closures");

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
  /**
   * Camera pictures on (the default) or off. Off, each camera is an icon that fetches
   * nothing and a tap opens its card. Read through a ref: a change clears the marks and
   * places again, and never refetches the feeds.
   */
  previews: boolean;
  /** The kinds of this view's own the Sources tray has switched off. */
  hidden: ReadonlySet<EyeKind>;
  /** The console's layers switched on, in the order they were: counted and named here, drawn by WorldMap. */
  signals: readonly EyeSourceRow[];
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
  /** Previews off: a camera's icon on its spot, until its card is opened. */
  icons: Map<string, { icon: CameraIcon; marker: maplibregl.Marker }>;
  /** Previews off: the camera whose card is open (it is in `cards`), if any. */
  open: string | null;
  openSide: "above" | "below";
  /** A camera link's own camera has had its one opening. */
  pinnedOpened: boolean;
}

/** What the detail panel shows: the mark, its neighbours and, when it left the report, since when. */
interface PanelState {
  subject: DetailSubject;
  also: AlsoHere[];
  staleSince: number | null;
}

/** What the panel's buttons call, filled by the effect that owns the map and the marks. */
interface PanelApi {
  close(): void;
  /** Close without moving focus: a hidden kind's selection goes while the person is in the tray. */
  clear(): void;
  pick(id: string, kind: "ship" | "plane"): void;
  layout(): void;
}
const NO_API: PanelApi = { close() {}, clear() {}, pick() {}, layout() {} };

export default function EyeOverlay({ map, styleEpoch, target, portrait, record, clock, previews, hidden, signals, onReport, placeRef }: Props) {
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
    icons: new Map(),
    open: null,
    openSide: "above",
    pinnedOpened: false,
  });
  const reportRef = useRef(onReport);
  reportRef.current = onReport;
  // Not an input of the main effect below: a change must not fetch four feeds again.
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  /** Filled by the main effect: clear every mark, then place again. */
  const resetMarks = useRef<() => void>(() => {});
  const pinned = target.kind === "camera" ? target.cameraId : null;
  // A recording or a film is a frame, not a tool: nothing in it can be clicked.
  const interactive = !record && !clock.film;
  const selRef = useRef<{ kind: "ship" | "plane"; id: string } | null>(null);
  const ringRef = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const panelApi = useRef<PanelApi>(NO_API);
  // What the Sources tray has chosen is read through refs, so a change never rebuilds the
  // big effect below (its cards, tags and timers); the effect after ensureLayers acts on it.
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  // What the big effect gives the small one: place now, and the feeds' loaders.
  const placeNowRef = useRef<(() => void) | null>(null);
  const loaders = useRef<{ ships?: () => void; planes?: () => void; streets?: () => void }>({});
  const prevHidden = useRef(hidden);

  /**
   * Hide or show the layers of the kinds the Sources tray has switched off. Layers that do
   * not exist yet are skipped, and ensureLayers calls this again as it adds them. Cameras
   * are one pair of layers for both kinds, so they are filtered on the feature's `live`.
   */
  const applyHidden = () => {
    const hid = hiddenRef.current;
    const show = (id: string, shown: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", shown ? "visible" : "none");
    };
    const live = !hid.has("livecams");
    const still = !hid.has("staticcams");
    for (const id of [LYR.ring, LYR.dot]) {
      if (!map.getLayer(id)) continue;
      map.setFilter(id, (live && still ? null : ["==", ["get", "live"], live]) as maplibregl.FilterSpecification | null);
      show(id, live || still);
    }
    for (const id of [LYR.ship, LYR.ahead]) show(id, !hid.has("ships"));
    show(LYR.plane, !hid.has("planes"));
    show(LYR.streetWorks, !hid.has("works"));
    show(LYR.streetIncident, !hid.has("incidents"));
    for (const id of [LYR.streetClosedBase, LYR.streetClosed]) show(id, !hid.has("closures"));
    // The rings of notices TfL gave no street line for carry their paint, so they are
    // filtered by it.
    const paints = [!hid.has("works") && "works", !hid.has("incidents") && "incident", !hid.has("closures") && "closed"].filter(Boolean);
    if (map.getLayer(LYR.streetDot)) {
      map.setFilter(LYR.streetDot, ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "paint"], ["literal", paints]]] as maplibregl.FilterSpecification);
      show(LYR.streetDot, paints.length > 0);
    }
  };

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
        features: (s.cams ?? []).filter((c) => c.available).map((c) => point(c.id, c.lon, c.lat, { live: c.live })),
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

    // The ring under the selected mark, flattened by the view's tilt as the chevrons are,
    // and under them: before the first of their layers that exists. Its own source, never
    // a filter on SRC.ships, because that source is removed and put back whenever the
    // vessels' credit changes. Empty until something is selected.
    if (interactive) {
      if (!map.getSource(SRC.selected)) map.addSource(SRC.selected, { type: "geojson", data: ringRef.current });
      if (!map.getLayer(LYR.selectedRing)) {
        const before = [LYR.ahead, LYR.ship, LYR.plane].find((id) => map.getLayer(id));
        map.addLayer(
          {
            id: LYR.selectedRing,
            type: "circle",
            source: SRC.selected,
            paint: {
              "circle-radius": portrait ? 20 : 16,
              "circle-color": ["match", ["get", "kind"], "plane", RING_FILL.plane, RING_FILL.ship],
              "circle-stroke-color": ["match", ["get", "kind"], "plane", COLOUR.plane, COLOUR.ship],
              "circle-stroke-width": 2.5,
              "circle-pitch-alignment": "map",
            },
          },
          before,
        );
      }
    }
    // Layers just added start visible; a hidden kind's go back off.
    applyHidden();
  };

  // Every finished style: the layers go back on (a basemap swap wipes them).
  useEffect(() => {
    ensureLayers.current();
  }, [map, styleEpoch]);

  // The switch changed: every card and icon goes, and the marks are placed again.
  const shownPreviews = useRef(previews);
  useEffect(() => {
    if (shownPreviews.current === previews) return;
    shownPreviews.current = previews;
    resetMarks.current();
  }, [previews]);
  // The Sources tray changed what is shown. A kind hidden: its layers go, its marks and
  // tags are re-placed away, a selection of it is cleared. A kind shown again: its layers
  // come back FIRST and then ensureLayers runs, so a layer another feature owns the look of
  // (eye-boat-models hides the chevrons while its models draw) gets the last word; a feed
  // never fetched is fetched once. A console layer switched on or off: counted and named
  // again, now and as its data lands.
  useEffect(() => {
    applyHidden();
    ensureLayers.current();
    const sel = selRef.current;
    if (sel && hidden.has(sel.kind === "ship" ? "ships" : "planes")) panelApi.current.clear();
    const s = state.current;
    const was = prevHidden.current;
    prevHidden.current = hidden;
    if (was.has("ships") && !hidden.has("ships") && s.ships == null) loaders.current.ships?.();
    if (was.has("planes") && !hidden.has("planes") && s.planes == null) loaders.current.planes?.();
    if (allRoadsHidden(was) && !allRoadsHidden(hidden) && s.streets == null) loaders.current.streets?.();
    placeNowRef.current?.();

    let settle: ReturnType<typeof setTimeout> | null = null;
    const onData = (e: { sourceId?: string; dataType?: string }) => {
      if (e.dataType !== "source" || !e.sourceId || !SIGNAL_SOURCES.has(e.sourceId)) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => placeNowRef.current?.(), 400);
    };
    if (signals.length > 0) map.on("sourcedata", onData);
    return () => {
      if (settle) clearTimeout(settle);
      map.off("sourcedata", onData);
    };
    // applyHidden reads the refs; what changes is the two sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hidden, signals]);

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
    // The marks each switched-on console layer has in view, counted in place() only.
    let signalCounts = new Map<string, number>();
    const london = inLondon(target.view.lat, target.view.lon);
    // Which marks the Sources tray lets this view show.
    const camShown = (c: Pick<NearCamera, "live">) => (c.live ? !hiddenRef.current.has("livecams") : !hiddenRef.current.has("staticcams"));
    const noticeShown = (d: StreetDisruption) => noticeRows(d).some((r) => !hiddenRef.current.has(r));

    const report = () => {
      const hid = hiddenRef.current;
      const rows: LedgerRow[] = [];
      if (s.cams && !(hid.has("livecams") && hid.has("staticcams"))) {
        rows.push(cameraLedgerRow(labelled.cams, s.cams.filter(camShown)));
      }
      if (s.ships && !hid.has("ships")) rows.push(vesselLedgerRow(labelled.ships, s.ships.length));
      if (s.planes && !hid.has("planes")) {
        const ageMs = s.planesFetchedAt != null ? clock.now() - s.planesFetchedAt : null;
        rows.push(aircraftLedgerRow(labelled.planes, s.planes.length, { sampled: s.planesSampled, ageMs }));
      }
      // TfL's newest change among the notices around the view, and when the server asked.
      const shownStreets = (s.streets ?? []).filter(noticeShown);
      const roadTimes: StreetTimes | undefined =
        s.streets && !s.streetsDown
          ? { changedAt: newestChange(shownStreets), fetchedAt: s.streetsFetchedAt, now: clock.now() }
          : undefined;
      if (s.streets && !allRoadsHidden(hid)) {
        rows.push(s.streetsDown ? streetsDownRow() : streetsLedgerRow(labelled.roads, shownStreets.length, roadTimes));
      }
      // One row for each console layer that is on, then the line about the road speed.
      for (const r of signalsRef.current) rows.push(signalLedgerRow(r, r.layer ? null : signalCounts.get(r.id) ?? 0));
      rows.push(speedLedgerRow(london));
      // The tray's "N here": the marks each switched-on row has in the scene.
      const counts: Record<string, number> = {};
      for (const r of signalsRef.current) if (!r.layer) counts[r.id] = signalCounts.get(r.id) ?? 0;
      if (s.cams) {
        counts.livecams = 0;
        counts.staticcams = 0;
        for (const c of s.cams) if (c.available) counts[c.live ? "livecams" : "staticcams"] += 1;
      }
      if (s.ships) counts.ais = s.ships.length;
      if (s.planes) counts.planes = s.planes.length;
      for (const d of s.streets ?? []) for (const r of new Set(noticeRows(d))) counts[`road-${r}`] = (counts[`road-${r}`] ?? 0) + 1;
      const cameraName = pinned ? s.cams?.find((c) => c.id === pinned)?.name : undefined;
      const phoneNote = speedPhoneNote(london, roadTimes);
      const key = JSON.stringify([rows, ready, cameraName, s.refreshedAt, counts]);
      if (key === lastRowsKey) return;
      lastRowsKey = key;
      reportRef.current({ rows, ready, cameraName, refreshedAt: s.refreshedAt, phoneNote, counts });
    };

    // --- previews off: icons, and one open card ---------------------------------------
    const iconSize = portrait ? ICON_PHONE : ICON_WIDE;

    /** Take the open card's marker off the map and forget it. Does not place again. */
    const dropOpen = () => {
      const id = s.open;
      if (!id) return;
      const entry = s.cards.get(id);
      if (entry) {
        entry.marker.remove();
        entry.card.destroy();
        s.cards.delete(id);
      }
      s.open = null;
    };

    /** Stand a card's wrapper (or link) on its camera's spot, above it or hanging below. */
    const standOpen = (card: CameraCard, cam: NearCamera, side: "above" | "below") => {
      card.node.dataset.side = side;
      return new maplibregl.Marker({ element: card.node, anchor: side === "below" ? "top" : "bottom" })
        .setLngLat([cam.lon, cam.lat])
        .addTo(map);
    };

    /**
     * Previews off. The pinned camera opens once; the open card stands first (above its
     * camera, or below near the top of the frame) and keeps its room; the other cameras
     * get icons through placeCards. Returns what the ledger counts: the icons and the card.
     */
    const placeOff = (
      cams: NearCamera[],
      camCands: { id: string; x: number; y: number }[],
      centre: { x: number; y: number },
      frame: Frame,
      taken: Box[],
    ): number => {
      if (pinned && !s.pinnedOpened && cams.some((c) => c.id === pinned)) {
        s.pinnedOpened = true;
        s.open = pinned;
      }
      if (s.open) {
        const id = s.open;
        const cand = camCands.find((c) => c.id === id);
        const cam = cams.find((c) => c.id === id);
        // Gone from the list, or its spot has left the frame: the card closes.
        const inView =
          cand != null &&
          Number.isFinite(cand.x) &&
          Number.isFinite(cand.y) &&
          cand.x >= frame.side &&
          cand.x <= frame.width - (frame.right ?? frame.side) &&
          cand.y >= frame.top &&
          cand.y <= frame.height - frame.bottom;
        if (!cand || !cam || !inView) {
          dropOpen();
        } else {
          const side = openCardSide(cand.x, cand.y, size, frame, taken);
          const entry = s.cards.get(id);
          if (!entry) {
            const card = new CameraCard(cam, { phone: portrait, clock, onMedia: clipsChanged, onClose: () => closeOpen(true) });
            card.el.style.setProperty("--w", `${size.width}px`);
            card.el.style.setProperty("--stalk", `${size.stalk}px`);
            card.node.style.setProperty("--w", `${size.width}px`);
            card.node.style.setProperty("--stalk", `${size.stalk}px`);
            const road = s.roads?.get(cam.id);
            if (road) card.setRoad(cameraRoadTileWords(road, clock.now()));
            s.cards.set(id, { card, marker: standOpen(card, cam, side) });
            s.openSide = side;
          } else if (side !== s.openSide) {
            // The same card, hung on the other side of its camera.
            entry.marker.remove();
            s.cards.set(id, { card: entry.card, marker: standOpen(entry.card, cam, side) });
            s.openSide = side;
          }
          taken.push(side === "below" ? cardBoxBelow(cand.x, cand.y, size) : cardBox(cand.x, cand.y, size));
        }
      }

      const rest = camCands.filter((c) => c.id !== s.open);
      const placedIcons = placeCards(placementOrder(rest, centre, new Set(s.icons.keys()), null), iconSize, frame, iconSize.max, taken);
      const keepIcons = new Set(placedIcons.map((p) => p.id));
      for (const [id, entry] of s.icons) {
        if (keepIcons.has(id)) continue;
        entry.marker.remove();
        s.icons.delete(id);
      }
      for (const p of placedIcons) {
        if (s.icons.has(p.id)) continue;
        const cam = cams.find((c) => c.id === p.id)!;
        const icon = new CameraIcon(cam, { onOpen: openCam });
        const marker = new maplibregl.Marker({ element: icon.el, anchor: "bottom" }).setLngLat([cam.lon, cam.lat]).addTo(map);
        s.icons.set(p.id, { icon, marker });
      }
      return placedIcons.length + (s.open ? 1 : 0);
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

      // Cards first: they are the largest and the reason for the view. A kind the Sources
      // tray has switched off is left out of the list ONCE, here: no card, no count.
      const hid = hiddenRef.current;
      const cams = (s.cams ?? []).filter((c) => c.available && camShown(c));
      const camCands = cams.map((c) => {
        const p = map.project([c.lon, c.lat]);
        return { id: c.id, x: p.x, y: p.y };
      });
      // Previews off: icons, and the one open card, take their room first. The cards below
      // are then given no candidates, and the open card is kept.
      const on = previewsRef.current;
      const offShown = on ? 0 : placeOff(cams, camCands, centre, frame, taken);
      const placed = placeCards(
        placementOrder(on ? camCands : [], centre, new Set(s.cards.keys()), pinned),
        size,
        frame,
        size.max,
        taken,
      );
      const keepCards = new Set(placed.map((p) => p.id));
      if (s.open) keepCards.add(s.open);
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
      type Item = TagCandidate & { kind: "ship" | "plane" | "road" | "signal"; lngLat: [number, number]; title: string; meta: string };
      const tagItems = (list: { id: string; lat: number; lon: number; words: { title: string; meta: string } }[], kind: Item["kind"]) =>
        list.map((o): Item => {
          const p = map.project([o.lon, o.lat]);
          const sz = tagSize(o.words.title, o.words.meta, portrait);
          return { id: o.id, x: p.x, y: p.y, ...sz, kind, lngLat: [o.lon, o.lat], ...o.words };
        });
      const shownTags = new Set(s.tags.keys());
      const ships = hid.has("ships") ? [] : s.ships ?? [];
      const moving = tagItems(ships.filter((v) => v.moving).map((v) => ({ ...v, words: vesselTag(v) })), "ship");
      const stopped = tagItems(ships.filter((v) => !v.moving).map((v) => ({ ...v, words: vesselTag(v) })), "ship");
      const shipOrder = [...placementOrder(moving, centre, shownTags), ...placementOrder(stopped, centre, shownTags)];
      const planeItems = tagItems((hid.has("planes") ? [] : s.planes ?? []).map((a) => ({ ...a, words: aircraftTag(a) })), "plane");
      const shownStreets = (s.streets ?? []).filter(noticeShown);
      const roadItems = tagItems(shownStreets.map((d) => ({ ...d, words: streetTag(d) })), "road");
      // TfL's most severe first; among equals, the usual order.
      const weight = new Map(shownStreets.map((d) => [d.id, severityWeight(d.severity)]));
      // The console's layers that are on: what MapLibre drew of them in view, counted, and the
      // first one or two named. A layer's marks are read once per placement, never per frame.
      const sigRows = signalsRef.current;
      let rendered: RenderedSignal[] = [];
      if (sigRows.length > 0) {
        const layers = SIGNAL_READ_LAYERS.filter((id) => map.getLayer(id));
        if (layers.length > 0) rendered = map.queryRenderedFeatures({ layers }).map(renderedSignal);
      }
      signalCounts = countBySignal(rendered);
      const sigColour = new Map(sigRows.map((r) => [r.id, r.color]));
      const sigLabel = new Map(sigRows.map((r) => [r.id, r.label]));
      const sigItems = tagItems(
        signalTagPicks(rendered, sigRows.map((r) => r.id), SIGNAL_TAG_POOL).map((f) => ({
          id: `sig:${f.signalId}:${f.id}`,
          lat: f.lat!,
          lon: f.lon!,
          words: { title: f.label, meta: sigLabel.get(f.signalId) ?? "" },
        })),
        "signal",
      );
      const roadOrder = placementOrder(roadItems, centre, shownTags).sort(
        (a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0),
      );
      const tagPlaced = [
        ...placeTags(shipOrder, frame, maxTags.ship, taken),
        ...placeTags(placementOrder(planeItems, centre, shownTags), frame, maxTags.plane, taken),
        ...placeTags(roadOrder, frame, maxTags.road, taken),
        ...placeTags(placementOrder(sigItems, centre, shownTags), frame, maxTags.signal, taken),
      ];
      const byId = new Map<string, Item>([...shipOrder, ...planeItems, ...roadItems, ...sigItems].map((i) => [i.id, i]));
      const keepTags = new Set(tagPlaced.map((t) => t.id));
      const tagged = (kind: Item["kind"]) => tagPlaced.filter((t) => byId.get(t.id)?.kind === kind);
      labelled = {
        cams: placed.length + offShown,
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
          const kind = item.kind;
          // A console layer's tag id is "sig:<layer id>:<feature id>"; a layer id has no colon.
          const sig = kind === "signal" ? item.id.slice(4).split(":")[0] : undefined;
          tag = new Tag(
            kind,
            kind === "signal"
              ? { color: sig ? sigColour.get(sig) : undefined }
              : interactive && kind !== "road"
                ? { onSelect: () => select(kind, t.id) }
                : undefined,
          );
          s.tags.set(t.id, tag);
        }
        tag.setText(item.title, item.meta);
        tag.setSelected(selRef.current?.id === t.id);
        tag.show(map, item.lngLat, t.flip);
      }

      ready =
        s.cams != null &&
        (hid.has("ships") || s.ships != null) &&
        (hid.has("planes") || s.planes != null) &&
        (!london || allRoadsHidden(hid) || s.streets != null);
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

    /** Close the open card; by its button or Esc, focus goes back to its icon. */
    const closeOpen = (focusIcon: boolean) => {
      const id = s.open;
      if (!id || disposed) return;
      dropOpen();
      placeNow();
      if (focusIcon) s.icons.get(id)?.icon.focus();
    };
    /** An icon was tapped: its card opens on its spot, and any other open card closes. */
    const openCam = (id: string) => {
      if (disposed || previewsRef.current || s.open === id) return;
      dropOpen();
      const icon = s.icons.get(id);
      if (icon) {
        icon.marker.remove();
        s.icons.delete(id);
      }
      s.open = id;
      placeNow();
      requestAnimationFrame(() => s.cards.get(id)?.card.focusClose());
    };
    // On `document`, so it runs before the detail panel's `window` listener below: one Esc
    // closes the open card, and the prevented default keeps the panel open for the next.
    const onCardKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !s.open) return;
      e.preventDefault();
      closeOpen(true);
    };
    document.addEventListener("keydown", onCardKey);
    // The switch changed: nothing stays, and the link's own camera has had its turn.
    resetMarks.current = () => {
      if (disposed) return;
      for (const { card, marker } of s.cards.values()) {
        marker.remove();
        card.destroy();
      }
      s.cards.clear();
      for (const { marker } of s.icons.values()) marker.remove();
      s.icons.clear();
      s.open = null;
      s.pinnedOpened = true;
      releaseCardMedia();
      placeNow();
    };

    // --- when to place --------------------------------------------------------
    let settle: ReturnType<typeof setTimeout> | null = null;
    let lastPlace = 0;
    const placeNow = () => {
      lastPlace = performance.now();
      place();
    };
    if (placeRef) placeRef.current = placeNow;
    placeNowRef.current = placeNow;
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
      refreshSelection();
      report();
      map.once("idle", placeNow);
      map.triggerRepaint();
    };

    // --- the selection: which vessel or aircraft has its details open -------------------
    type Kind = "ship" | "plane";
    const minR = portrait ? PICK_RADIUS.phone : PICK_RADIUS.wide;
    /**
     * How far from a mark's point a click still means it, in px. One number for every
     * mark today. eye-boat-models replaces the body of this for vessels with the drawn
     * hull's own radius, so a long ship is no harder to hit than a small one.
     */
    const markRadius = (_kind: Kind, _item: Vessel | Aircraft): number => minR;
    const find = (kind: Kind, id: string): Vessel | Aircraft | undefined =>
      kind === "ship" ? s.ships?.find((v) => v.id === id) : s.planes?.find((a) => a.id === id);
    /** Every vessel and aircraft, projected onto the screen, for pickMarks. */
    const candidates = (): PickCandidate[] => {
      const out: PickCandidate[] = [];
      for (const v of s.ships ?? []) {
        const p = map.project([v.lon, v.lat]);
        out.push({ id: v.id, kind: "ship", x: p.x, y: p.y, r: markRadius("ship", v) });
      }
      for (const a of s.planes ?? []) {
        const p = map.project([a.lon, a.lat]);
        out.push({ id: a.id, kind: "plane", x: p.x, y: p.y, r: markRadius("plane", a) });
      }
      return out;
    };
    const alsoItems = (centre: Vessel | Aircraft, near: readonly PickCandidate[]): AlsoHere[] =>
      near.flatMap((c) => {
        const o = find(c.kind, c.id);
        if (!o) return [];
        const name = "name" in o ? o.name : o.callsign;
        return [{ id: c.id, kind: c.kind, name, metres: haversineKm(centre.lat, centre.lon, o.lat, o.lon) * 1000 }];
      });
    const subjectOf = (kind: Kind, item: Vessel | Aircraft): DetailSubject =>
      kind === "ship" ? { kind, v: item as Vessel } : { kind, a: item as Aircraft, pulledAt: s.planesFetchedAt };
    const setRing = (fc: GeoJSON.FeatureCollection) => {
      ringRef.current = fc;
      (map.getSource(SRC.selected) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
    };
    const ringOf = (kind: Kind, item: Vessel | Aircraft): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: [point(item.id, item.lon, item.lat, { kind })],
    });
    const nearTo = (item: Vessel | Aircraft, kind: Kind): PickCandidate[] => {
      const all = candidates();
      const me = all.find((c) => c.kind === kind && c.id === item.id);
      return me ? marksAround(all, me, minR) : [];
    };

    const select = (kind: Kind, id: string, near?: readonly PickCandidate[]) => {
      const item = find(kind, id);
      if (!item) return;
      selRef.current = { kind, id };
      setRing(ringOf(kind, item));
      for (const [tagId, tag] of s.tags) tag.setSelected(tagId === id);
      setPanel({ subject: subjectOf(kind, item), also: alsoItems(item, near ?? nearTo(item, kind)), staleSince: null });
      window.addEventListener("keydown", onKey);
    };

    /** Close the panel. A button or a key puts focus back on the plate (or the map); a click on the map does not. */
    const close = (refocus: boolean) => {
      const sel = selRef.current;
      if (!sel) return;
      selRef.current = null;
      setRing(EMPTY);
      for (const tag of s.tags.values()) tag.setSelected(false);
      setPanel(null);
      window.removeEventListener("keydown", onKey);
      if (refocus) {
        const tag = s.tags.get(sel.id);
        if (tag) tag.focusPlate();
        else map.getCanvas().focus({ preventScroll: true });
      }
    };

    // Escape closes the panel, after anything that closed something else first (a camera
    // card's own listener, the sources menu) and so did not get to prevent the default.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !selRef.current) return;
      e.preventDefault();
      close(true);
    };

    /** After each feed: the mark again as it now is, or, if it left the report, as it last was. */
    const refreshSelection = () => {
      const sel = selRef.current;
      if (!sel) return;
      const item = find(sel.kind, sel.id);
      if (item) {
        setRing(ringOf(sel.kind, item));
        setPanel({ subject: subjectOf(sel.kind, item), also: alsoItems(item, nearTo(item, sel.kind)), staleSince: null });
        return;
      }
      setRing(EMPTY);
      setPanel((prev) => {
        if (!prev || prev.staleSince != null) return prev;
        const was = prev.subject.kind === "ship" ? prev.subject.v.reportedAt : prev.subject.pulledAt;
        return { ...prev, staleSince: was ?? clock.now() };
      });
    };

    /** The mark must not hide under the panel: after it lays out, pan it clear. */
    const keepClear = () => {
      const sel = selRef.current;
      const item = sel ? find(sel.kind, sel.id) : undefined;
      const el = document.querySelector<HTMLElement>('[role="dialog"][data-eye-keep]');
      if (!item || !el) return;
      const box = map.getContainer().getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const p = map.project([item.lon, item.lat]);
      const x = box.left + p.x;
      const y = box.top + p.y;
      const NEAR = 24;
      if (x < r.left - NEAR || x > r.right + NEAR || y < r.top - NEAR || y > r.bottom + NEAR) return;
      // A wide screen moves it sideways, to the left of the panel; a phone moves it up
      // above the sheet. Panning the map by +d moves what is on it by -d.
      const offset: [number, number] = portrait ? [0, y - (r.top - 2 * NEAR)] : [x - (r.left - 2 * NEAR), 0];
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.panBy(offset, { duration: still ? 0 : 300 });
    };
    let layoutFrame = 0;
    const onLayout = () => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        if (disposed) return;
        placeNow();
        keepClear();
      });
    };

    // A click on the map. MapLibre also fires `click` for clicks inside a marker (the
    // camera cards, the plates), which handle themselves, so only the canvas counts.
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.target !== map.getCanvas()) return;
      const { hit, also } = pickMarks(candidates(), e.point, minR);
      if (hit) select(hit.kind, hit.id, also);
      else close(false);
    };
    // A pointer cursor over a mark you can click: at most once a frame, never while the view moves.
    let hoverFrame = 0;
    let hoverAt: { x: number; y: number } | null = null;
    const onHover = (e: maplibregl.MapMouseEvent) => {
      hoverAt = e.point;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (disposed || !hoverAt || map.isMoving()) return;
        map.getCanvas().style.cursor = pickMarks(candidates(), hoverAt, minR).hit ? "pointer" : "";
      });
    };
    if (interactive) {
      map.on("click", onClick);
      map.on("mousemove", onHover);
      panelApi.current = { close: () => close(true), clear: () => close(false), pick: (id, kind) => select(kind, id), layout: onLayout };
    }

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
    // A hidden kind's feed is not asked for (the loaders' own bodies are untouched).
    const askShips = () => {
      if (!hiddenRef.current.has("ships")) loadShips();
    };
    const askPlanes = () => {
      if (!hiddenRef.current.has("planes")) loadPlanes();
    };
    const askStreets = () => {
      if (!allRoadsHidden(hiddenRef.current)) loadStreets();
    };
    loaders.current = { ships: loadShips, planes: loadPlanes, streets: london ? loadStreets : undefined };
    askShips();
    askPlanes();
    if (london) askStreets();
    // A film keeps the reports it opened with: it is drawn far slower than it plays, so
    // a report fetched during it would be minutes newer than the film's own clock.
    const timers = clock.film
      ? []
      : [
          setInterval(askShips, AIS_EVERY_MS),
          setInterval(askPlanes, PLANES_EVERY_MS),
          ...(london ? [setInterval(askStreets, STREETS_EVERY_MS)] : []),
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
      resetMarks.current = () => {};
      document.removeEventListener("keydown", onCardKey);
      if (placeRef?.current === placeNow) placeRef.current = null;
      if (placeNowRef.current === placeNow) placeNowRef.current = null;
      loaders.current = {};
      map.off("moveend", onMoveEnd);
      map.off("move", onMove);
      if (interactive) {
        map.off("click", onClick);
        map.off("mousemove", onHover);
        window.removeEventListener("keydown", onKey);
        cancelAnimationFrame(hoverFrame);
        cancelAnimationFrame(layoutFrame);
        map.getCanvas().style.cursor = "";
        panelApi.current = NO_API;
        if (selRef.current) {
          selRef.current = null;
          try {
            setRing(EMPTY);
          } catch {
            /* the map is already gone */
          }
          setPanel(null);
        }
      }
      if (settle) clearTimeout(settle);
      if (ticker) clearInterval(ticker);
      leaveFilm?.();
      for (const t of timers) clearInterval(t);
      for (const { card, marker } of s.cards.values()) {
        marker.remove();
        card.destroy();
      }
      s.cards.clear();
      for (const { marker } of s.icons.values()) marker.remove();
      s.icons.clear();
      s.open = null;
      for (const tag of s.tags.values()) tag.remove();
      s.tags.clear();
      releaseCardMedia();
    };
  }, [map, target, portrait, record, clock, pinned, placeRef, interactive]);

  if (!panel) return null;
  return (
    <DetailPanel
      subject={panel.subject}
      also={panel.also}
      staleSince={panel.staleSince}
      clock={clock}
      onClose={() => panelApi.current.close()}
      onPick={(id, kind) => panelApi.current.pick(id, kind)}
      onLayout={() => panelApi.current.layout()}
    />
  );
}
