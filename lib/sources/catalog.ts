// The single unified view over every monitorable data source: the 4 bespoke core
// layers (lib/layers.ts) and the 39 data-driven signals (lib/signals/registry.ts),
// flattened behind one descriptor so the catalog UI and the widget grid can be
// data-driven off ONE list. Pure + isomorphic (node-testable): static descriptors
// only — live count/freshness are read from the existing stores by lib/sources/live.ts.

import { MAP_SIGNALS } from "@/lib/signals/registry";
import { ADSB_ATTRIBUTION } from "@/lib/sources/adsb";

export type SourceKind = "core" | "signal";

export interface CatalogSource {
  id: string;
  kind: SourceKind;
  label: string;
  group: string;
  color: string;
  attribution: string;
  refreshMs: number;
  /** Env var that unlocks the source, if key-gated (drives the "needs key" state later). */
  keyEnv?: string;
}

export const CORE_IDS = ["cameras", "planes", "satellites", "webcams"] as const;

// Core-layer descriptors. refreshMs mirrors lib/freshness.ts seed(); groups use the
// roll-up vocabulary (a group with one source still yields a valid 1-source roll-up).
const CORE_SOURCES: CatalogSource[] = [
  { id: "cameras",    kind: "core", label: "Cameras",    group: "Cameras",  color: "#0e7d97", attribution: "TfL · Caltrans · SCDOT · Digitraffic · 511 · DriveBC · MUP Srbije · Putevi Srbije", refreshMs: 300_000 },
  { id: "webcams",    kind: "core", label: "Webcams",    group: "Cameras",  color: "#ec4899", attribution: "Windy.com — global webcams", refreshMs: 600_000 },
  // adsb.lol, not OpenSky: OpenSky's global /states/all was the source until it was
  // removed on licensing grounds (app/api/planes/route.ts, lib/sources/opensky.ts
  // fetchAircraftOnce). Production has been served entirely by the adsb.lol grid
  // sweep for months — this descriptor just said the wrong thing about it. Same
  // string, same fix, in components/shell/SourceCatalog.tsx's LAYER_META.
  { id: "planes",     kind: "core", label: "Planes",     group: "Aviation", color: "#d97706", attribution: ADSB_ATTRIBUTION, refreshMs: 12_000 },
  { id: "satellites", kind: "core", label: "Satellites", group: "Space",    color: "#7c3aed", attribution: "CelesTrak TLE · SGP4 (local)", refreshMs: 1_000 },
];

// MAP_SIGNALS, not SIGNALS: a data-only source (lib/signals/types.ts) is registered
// and fetchable but is not a layer, so it must not enter the catalog the rail and the
// widget grid are built from.
const SIGNAL_SOURCES: CatalogSource[] = MAP_SIGNALS.map((s) => ({
  id: s.id,
  kind: "signal" as const,
  label: s.label,
  group: s.group,
  color: s.color,
  attribution: s.attribution,
  refreshMs: s.refreshMs,
}));

/** Core first (always-relevant transport layers), then signals in registry order. */
export const SOURCE_CATALOG: CatalogSource[] = [...CORE_SOURCES, ...SIGNAL_SOURCES];

const BY_ID = new Map(SOURCE_CATALOG.map((s) => [s.id, s]));

export function getCatalogSource(id: string): CatalogSource | undefined {
  return BY_ID.get(id);
}

export function kindOf(id: string): SourceKind {
  return (CORE_IDS as readonly string[]).includes(id) ? "core" : "signal";
}

/** Grouped by `group`, preserving first-seen order — drives the catalog + roll-ups. */
export function catalogByGroup(): { group: string; sources: CatalogSource[] }[] {
  const out: { group: string; sources: CatalogSource[] }[] = [];
  for (const s of SOURCE_CATALOG) {
    let g = out.find((x) => x.group === s.group);
    if (!g) {
      g = { group: s.group, sources: [] };
      out.push(g);
    }
    g.sources.push(s);
  }
  return out;
}
