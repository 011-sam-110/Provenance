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
  /**
   * This source has no map layer — it is only ever a console widget.
   *
   * Absent (the normal case) means the row gets a map toggle. Set, the rail draws
   * the row with its ＋ and NO toggle, because a switch labelled "show on the map"
   * beside something the map cannot draw is a control that lies. Nothing in
   * SOURCE_CATALOG sets it; see WIDGET_ONLY_SOURCES in
   * lib/console/sources/railSources.ts.
   */
  widgetOnly?: boolean;
}

export const CORE_IDS = ["livecams", "staticcams", "planes", "satellites"] as const;

/** Every operator in the road-camera registry. Both camera tiers are drawn from it. */
const REGISTRY_ATTRIBUTION =
  "TfL · Caltrans · SCDOT · Digitraffic · 511 · DriveBC · MUP Srbije · Putevi Srbije";

// Core-layer descriptors. refreshMs mirrors lib/freshness.ts seed(); groups use the
// roll-up vocabulary (a group with one source still yields a valid 1-source roll-up).
//
// THE TWO CAMERA ROWS ARE ONE REGISTRY CUT IN TWO, PLUS WINDY ON THE STILL SIDE.
// They are not two upstreams — see the note on LayerKey in lib/layers.ts for why the
// split is by what a pin shows rather than by which feed it came from. Both carry the
// registry's attribution because both draw from it; the still row names Windy as well,
// because the Windy webcams are drawn on that row and their terms are separate from
// ours (see the licence note in CLAUDE.md).
const CORE_SOURCES: CatalogSource[] = [
  { id: "livecams",   kind: "core", label: "Live cams",   group: "Cameras",  color: "#0e7d97", attribution: REGISTRY_ATTRIBUTION, refreshMs: 300_000 },
  { id: "staticcams", kind: "core", label: "Static cams", group: "Cameras",  color: "#ec4899", attribution: `${REGISTRY_ATTRIBUTION} · Windy.com — global webcams`, refreshMs: 300_000 },
  // adsb.lol, not OpenSky: OpenSky's global /states/all was the source until it was
  // removed on licensing grounds (app/api/planes/route.ts, lib/sources/opensky.ts
  // fetchAircraftOnce). Everything since has come from adsb.lol — a 40-cell sweep
  // until 2026-09-06, a worldwide pull by ICAO type after — and this descriptor
  // used to credit the wrong feed. Same string, same fix, in
  // components/shell/SourceCatalog.tsx's LAYER_META.
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
