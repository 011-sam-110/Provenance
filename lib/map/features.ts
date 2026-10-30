// Pure GeoJSON FeatureCollection builders for the unified MapLibre engine.
//
// WorldMap renders every live layer (cameras, planes, trails, satellites) as a
// MapLibre GeoJSON source. These builders turn the shared WorldObject[] (and the
// plane trails) into the feature collections those sources consume. Kept DOM-free
// and pure so they're trivially testable and importable anywhere.

import type { WorldObject } from "@/lib/world";
import type { PlaneTrail } from "@/lib/planes/usePlanes";
import type { SignalGeometry } from "@/lib/signals/types";
import { cameraRegionColor, signalIconKey } from "@/lib/icons/svg";

const KNOWN_REGIONS = ["tfl", "caltrans", "scdot", "digitraffic", "castlerock", "tripcheck", "drivebc"];

/** Camera source id → icon region key ("default" for anything unmapped). */
export function regionKeyOf(source: string | undefined): string {
  return source && KNOWN_REGIONS.includes(source) ? source : "default";
}

/** Cameras → point features (shape = feed, colour = region, dimmed when down). */
export function toCameraFC(cameras: WorldObject[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cameras.map((c) => {
      const m = (c.meta ?? {}) as { available?: boolean; source?: string; feed?: string };
      const source = m.source;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: {
          id: c.id,
          name: c.label,
          available: Boolean(m.available),
          // icon name pieces: shape = feed, colour = region (see loadCameraIcons)
          feed: m.feed === "video" ? "video" : "still",
          regionKey: regionKeyOf(source),
          regionColor: c.color ?? cameraRegionColor(source ?? ""),
        },
      };
    }),
  };
}

/** Planes → point features carrying heading (icon-rotate) + per-type category. */
export function toPlaneFC(planes: WorldObject[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: planes.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        category: (p.meta?.category as string) ?? "airliner",
        heading: p.heading ?? 0,
        color: p.color ?? "#fbbf24",
      },
    })),
  };
}

/** Plane breadcrumb trails → line features (history + projected heading ahead). */
export function toTrailFC(trails: PlaneTrail[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: trails
      .filter((t) => t.points.length >= 2)
      .map((t) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: t.points.map((p) => [p[1], p[0]]) },
        properties: { id: t.id, color: t.color },
      })),
  };
}

/** Webcams (Windy) → point features. Single hue/icon, so only id + name ride along. */
export function toWebcamFC(webcams: WorldObject[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: webcams.map((w) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [w.lon, w.lat] },
      properties: { id: w.id, name: w.label },
    })),
  };
}

/** The line/area geometry a signal feature carries, if any (rides in meta). */
function signalGeometry(s: WorldObject): SignalGeometry | undefined {
  const g = s.meta?.geometry as SignalGeometry | undefined;
  if (!g) return undefined;
  return g.type === "LineString" ||
    g.type === "MultiLineString" ||
    g.type === "Polygon" ||
    g.type === "MultiPolygon"
    ? g
    : undefined;
}

const isLine = (g: SignalGeometry) => g.type === "LineString" || g.type === "MultiLineString";
const isArea = (g: SignalGeometry) => g.type === "Polygon" || g.type === "MultiPolygon";

/** Shared props every signal geometry carries for click resolution + styling. */
function signalProps(s: WorldObject) {
  const line = s.meta?.line;
  return {
    id: s.id,
    signalId: (s.meta?.signalId as string) ?? "",
    label: s.label,
    color: s.color ?? "#64748b",
    // The line's pattern (SignalFeature.line); "solid" when the feature names none.
    line: line === "dash" || line === "dot" || line === "bar" || line === "speed" ? line : "solid",
    // How an area is filled (SignalFeature.fill): "hatch" for ground of unknown status,
    // "flat" for the tint every other area gets. Read by WorldMap's fill layers only.
    fill: s.meta?.fill === "hatch" ? "hatch" : "flat",
  };
}

/**
 * Global POINT signals (earthquakes, wildfires, aurora, …) → point features for
 * the ONE data-driven circle+label layer. Every point signal funnels through
 * this: the per-feature `color` paints the dot, `radius` sizes it, and
 * `label`/`signalId` ride along for the label layer + click resolution. `radius`
 * is derived here from the documented `meta.props.magnitude` convention (see
 * lib/signals/types.ts) so the WorldMap layer needs no per-source knowledge.
 *
 * Features that carry a line/area geometry are EXCLUDED here (they render on the
 * line/fill sources instead — see below), so adding a cable or jamming layer
 * never disturbs the point circle layer.
 */
export function toSignalFC(signals: WorldObject[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: signals
      .filter((s) => !signalGeometry(s))
      .map((s) => {
        const props = (s.meta?.props ?? {}) as Record<string, unknown>;
        const mag = Number(props.magnitude);
        // magnitude (≈0–10) scales the marker; everything else gets a calm fixed dot.
        const radius = Number.isFinite(mag) ? Math.max(4, Math.min(26, 4 + mag * 1.6)) : 7;
        // Per-hazard pictogram drawn white on the disc — keyed by the source id
        // (GDACS resolves per-feature from its hazard). See signalIconKey.
        const icon = signalIconKey((s.meta?.signalId as string) ?? "", props);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
          // `shape`: "diamond" draws the pin as a diamond (SignalFeature.shape), so the
          // second side of a two-sided pair is never told apart by colour alone.
          properties: { ...signalProps(s), radius, icon, shape: s.meta?.shape === "diamond" ? "diamond" : "round" },
        };
      }),
  };
}

/**
 * Line signals (e.g. submarine cables) → LineString/MultiLineString features for
 * the dedicated signal `line` layer. The feature's own geometry is passed
 * straight through; the same `signalProps` ride along so a click resolves to the
 * SAME dossier as a point signal.
 */
export function toSignalLineFC(signals: WorldObject[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of signals) {
    const g = signalGeometry(s);
    if (!g || !isLine(g)) continue;
    features.push({
      type: "Feature",
      geometry: g as GeoJSON.Geometry,
      properties: signalProps(s),
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Area signals (e.g. GPS-jamming H3 hexes) → Polygon/MultiPolygon features for
 * the dedicated signal `fill` layer. Mirrors toSignalLineFC; the per-feature
 * `color` tints the fill + outline.
 */
export function toSignalFillFC(signals: WorldObject[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of signals) {
    const g = signalGeometry(s);
    if (!g || !isArea(g)) continue;
    features.push({
      type: "Feature",
      geometry: g as GeoJSON.Geometry,
      properties: signalProps(s),
    });
  }
  return { type: "FeatureCollection", features };
}

/** Satellites → sub-satellite point features (altitude lives in the dossier). */
export function toSatelliteFC(sats: WorldObject[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sats.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.label,
        color: s.color ?? "#cbd5e1",
        icon: s.icon ?? "sat-other",
      },
    })),
  };
}
