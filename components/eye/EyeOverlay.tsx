"use client";
// What the God's eye view puts INTO the scene, over WorldMap's ground and buildings:
// camera cards standing on their real spots, each over a ring on the street.
//
// TWO KINDS OF MARK, BY WHAT EACH NEEDS:
//   GPU layers (rings): many, cheap, and sunk UNDER the buildings, so a tower in front
//     hides a ring the way it would hide the street. Circle layers do not depth-test;
//     layer order is what does it.
//   DOM markers (cards): few and rich (a picture, text), moved by MapLibre per frame
//     as a transform only.
//
// NEVER REBUILT PER FRAME. MapLibre fires `moveend` on every jumpTo and setBearing, so
// a camera move driven per frame (the view's own orbit) fires it per frame too. In the
// design pass an undebounced handler rebuilt every card per frame and halved the frame
// rate. Placement runs 300 ms after the camera settles, and at most once a second
// while it moves; between runs a card is only re-positioned, by MapLibre.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BUILDING_LAYER } from "@/lib/map/buildings";
import type { EyeTarget } from "@/lib/eye/places";
import { cameraCredits, cameraLedgerRow, type NearCamera } from "@/lib/eye/cameras";
import { placeCards, placementOrder, type Box, type CardSize, type Frame } from "@/lib/eye/declutter";
import type { LedgerRow } from "@/lib/eye/wording";
import { CameraCard, releaseCardMedia } from "./cameraCard";

export interface OverlayReport {
  rows: LedgerRow[];
  /** All first fetches have answered or failed, and the first placement ran. */
  ready: boolean;
  /** The name of the camera a camera link opened on, once known. */
  cameraName?: string;
}

const SRC_CAMS = "eye-cams";
const LYR_RING = "eye-cam-ring";
const LYR_DOT = "eye-cam-dot";

const CARD_WIDE: CardSize & { max: number } = { width: 172, height: Math.round(172 / (352 / 288)) + 40, stalk: 52, max: 5 };
const CARD_PHONE: CardSize & { max: number } = { width: 120, height: Math.round(120 / (352 / 288)) + 46, stalk: 34, max: 3 };

/** The bands the HUD keeps: no card or tag is placed under the header or the ledger. */
export function safeFrame(width: number, height: number, portrait: boolean): Frame {
  return portrait
    ? { width, height, top: 132, bottom: 112, side: 8 }
    : { width, height, top: 104, bottom: 150, side: 12 };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface Props {
  map: maplibregl.Map;
  /** Bumped by EyeApp each time WorldMap finishes a style, so the layers go back on. */
  styleEpoch: number;
  target: EyeTarget;
  portrait: boolean;
  onReport: (r: OverlayReport) => void;
}

interface State {
  cams: NearCamera[] | null;
  cards: Map<string, { card: CameraCard; marker: maplibregl.Marker }>;
}

export default function EyeOverlay({ map, styleEpoch, target, portrait, onReport }: Props) {
  const state = useRef<State>({ cams: null, cards: new Map() });
  const reportRef = useRef(onReport);
  reportRef.current = onReport;
  const pinned = target.kind === "camera" ? target.cameraId : null;

  /** Sources and layers on the current style. Idempotent: every style gets them once. */
  const ensureLayers = useRef(() => {});
  ensureLayers.current = () => {
    const cams = state.current.cams;
    // Added once the cameras are known, because the source carries their credit
    // ("Powered by TfL Open Data") into MapLibre's attribution control.
    if (cams && !map.getSource(SRC_CAMS)) {
      map.addSource(SRC_CAMS, { type: "geojson", data: EMPTY, attribution: cameraCredits(cams.filter((c) => c.available)).join(" · ") });
    }
    if (map.getSource(SRC_CAMS)) {
      const before = map.getLayer(BUILDING_LAYER) ? BUILDING_LAYER : undefined;
      if (!map.getLayer(LYR_RING)) {
        map.addLayer(
          {
            id: LYR_RING,
            type: "circle",
            source: SRC_CAMS,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 6, 17, 16],
              "circle-color": "rgba(232,241,248,0.10)",
              "circle-stroke-color": "rgba(232,241,248,0.9)",
              "circle-stroke-width": 1.5,
              "circle-pitch-alignment": "map",
            },
          },
          before,
        );
      }
      if (!map.getLayer(LYR_DOT)) {
        map.addLayer(
          {
            id: LYR_DOT,
            type: "circle",
            source: SRC_CAMS,
            paint: { "circle-radius": 2.6, "circle-color": "#e8f1f8", "circle-pitch-alignment": "map" },
          },
          before,
        );
      }
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: (cams ?? [])
          .filter((c) => c.available)
          .map((c) => ({ type: "Feature", properties: { id: c.id }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })),
      };
      (map.getSource(SRC_CAMS) as maplibregl.GeoJSONSource).setData(fc);
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
    let ready = false;
    let shownCount = 0;

    const report = () => {
      const cams = s.cams;
      const rows: LedgerRow[] = cams ? [cameraLedgerRow(shownCount, cams)] : [];
      const cameraName = pinned ? cams?.find((c) => c.id === pinned)?.name : undefined;
      reportRef.current({ rows, ready, cameraName });
    };

    const place = () => {
      if (disposed) return;
      const box = map.getContainer();
      const width = box.clientWidth;
      const height = box.clientHeight;
      const frame = safeFrame(width, height, portrait);
      const taken: Box[] = [];

      const cams = (s.cams ?? []).filter((c) => c.available);
      const cands = cams.map((c) => {
        const p = map.project([c.lon, c.lat]);
        return { id: c.id, x: p.x, y: p.y };
      });
      const order = placementOrder(cands, { x: width / 2, y: height / 2 }, new Set(s.cards.keys()), pinned);
      const placed = placeCards(order, size, frame, size.max, taken);
      const keep = new Set(placed.map((p) => p.id));
      for (const [id, entry] of s.cards) {
        if (keep.has(id)) continue;
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
      const nowReady = s.cams != null;
      if (shownCount !== placed.length || ready !== nowReady) {
        shownCount = placed.length;
        ready = nowReady;
        report();
      }
    };

    // --- when to place --------------------------------------------------------
    let settle: ReturnType<typeof setTimeout> | null = null;
    let lastPlace = 0;
    const placeNow = () => {
      lastPlace = performance.now();
      place();
    };
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

    // --- data -------------------------------------------------------------------
    const { lat, lon } = target.view;
    fetch(`/api/near?lat=${lat}&lon=${lon}&n=25`)
      .then((r) => (r.ok ? r.json() : { cameras: [] }))
      .catch(() => ({ cameras: [] }))
      .then((d: { cameras?: NearCamera[] }) => {
        if (disposed) return;
        s.cams = d.cameras ?? [];
        ensureLayers.current();
        report();
        // After the map has drawn the data once, so projections are of a settled view.
        // The first placement is what marks the view ready.
        map.once("idle", placeNow);
        map.triggerRepaint();
      });

    // The age on every card, re-worded twice a minute.
    const ticker = setInterval(() => {
      const now = Date.now();
      for (const { card } of s.cards.values()) card.tick(now);
    }, 30_000);

    return () => {
      disposed = true;
      map.off("moveend", onMoveEnd);
      map.off("move", onMove);
      if (settle) clearTimeout(settle);
      clearInterval(ticker);
      for (const { card, marker } of s.cards.values()) {
        marker.remove();
        card.destroy();
      }
      s.cards.clear();
      releaseCardMedia();
    };
  }, [map, target, portrait, pinned]);

  return null;
}
