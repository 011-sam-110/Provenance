// ===========================================================================
// Global-signals registry — the single list of keyless, opt-in, global point
// layers the app can render. This is the FOUNDATION later batches extend.
//
// ── To add a new signal layer (ONE adapter + ONE entry, nothing else): ──
//   1. Write  lib/signals/<x>.ts  exporting a `SignalSource`
//      (see lib/signals/types.ts): `fetch()` returns `SignalFeature[]` from a
//      keyless endpoint and MUST resolve to `[]` on any failure (never reject).
//      Keep the upstream→SignalFeature mapping in a PURE exported function.
//   2. Add that source to `SIGNALS` below.
//   3. Add a captured fixture + a unit test for the pure normaliser
//      (mirror tests/unit/signals-*.test.ts).
//   That is the whole checklist. No edits to WorldMap, the dynamic API route,
//   the dossier, the store, or the rail — they are all data-driven off `SIGNALS`.
//
// How the pieces fit:
//   • Store     lib/signals/store.ts  — which ids are ON (default all OFF) + counts
//   • Route     app/api/signals/[id]/route.ts — generic getSignal(id).fetch()
//   • Render    components/WorldMap.tsx — ONE aggregated `signals` GeoJSON source
//                 + one data-driven circle+label layer (colour/radius from props)
//   • Dossier   components/SignalDetail.tsx via lib/overlay-content.tsx (kind:"signal")
//   • Rail      components/shell/LayerRail.tsx — auto-grouped "Global signals" section
//
// POINTS, LINES and POLYGONS are all supported. A source whose features carry a
// `geometry` (SignalFeature.geometry: LineString/MultiLineString → line layer,
// Polygon/MultiPolygon → fill layer) renders on the dedicated line/fill sources
// in WorldMap; plain points keep the circle layer. lat/lon stays the click /
// label / dossier anchor for every kind. The registry/store/route/dossier
// plumbing is identical regardless of geometry — see lib/signals/types.ts.
// ===========================================================================

import type { SignalSource } from "@/lib/signals/types";
import { EARTHQUAKES_SOURCE } from "@/lib/signals/usgs";
import {
  WILDFIRES_SOURCE,
  VOLCANOES_SOURCE,
  SEVERE_STORMS_SOURCE,
  FLOODS_SOURCE,
} from "@/lib/signals/eonet";
import { AURORA_SOURCE } from "@/lib/signals/aurora";
import { LAUNCHES_SOURCE } from "@/lib/signals/launches";
import { CABLES_SOURCE, CABLE_LANDINGS_SOURCE } from "@/lib/signals/cables";
import { GPS_JAMMING_SOURCE } from "@/lib/signals/gpsjam";
import { NUCLEAR_SOURCE } from "@/lib/signals/nuclear";
import { AIRPORTS_SOURCE } from "@/lib/signals/airports";
import { PORTS_SOURCE } from "@/lib/signals/ports";
import { CONFLICT_SOURCE, PROTESTS_SOURCE } from "@/lib/signals/gdelt";
import { GDACS_SOURCE } from "@/lib/signals/gdacs";
import { FIRE_FIRMS_SOURCE } from "@/lib/signals/fire-firms";
import { EMSC_SOURCE } from "@/lib/signals/emsc";
import { ACLED_SOURCE } from "@/lib/signals/acled";
import { WEATHER_SOURCE } from "@/lib/signals/weather";
import { AIR_QUALITY_SOURCE } from "@/lib/signals/airquality";
import { UK_CRIME_SOURCE } from "@/lib/signals/crime";
import { CYBER_C2_SOURCE } from "@/lib/signals/cyber-c2";
import { CLOUD_STATUS_SOURCE } from "@/lib/signals/cloud-status";
import { CYBER_RANSOMWARE_SOURCE } from "@/lib/signals/cyber-ransomware";
import { DISPLACEMENT_SOURCE } from "@/lib/signals/displacement";
import { FOOD_SECURITY_SOURCE } from "@/lib/signals/food-security";
import { MILITARY_AIR_SOURCE } from "@/lib/signals/military-air";
import { AIS_SOURCE } from "@/lib/signals/ais";
import { INTERNET_OUTAGES_SOURCE } from "@/lib/signals/internet-outages";
import { SPACE_WEATHER_SOURCE } from "@/lib/signals/space-weather";
import { INSTABILITY_SOURCE } from "@/lib/signals/instability";
import { AIR_QUALITY_STATIONS_SOURCE } from "@/lib/signals/airquality-stations";
import { TROPICAL_CYCLONES_SOURCE } from "@/lib/signals/tropical-cyclones";
import { RELIEFWEB_SOURCE } from "@/lib/signals/reliefweb";
import { GRID_LOAD_SOURCE } from "@/lib/signals/entsoe";

/** Every registered signal layer, in rail display order. */
export const SIGNALS: SignalSource[] = [
  // Synthesis — the flagship: a per-country instability score composited from the
  // conflict / food / displacement / outage layers (keyless inputs; ACLED upgrades it).
  INSTABILITY_SOURCE,
  EARTHQUAKES_SOURCE,
  WILDFIRES_SOURCE,
  VOLCANOES_SOURCE,
  SEVERE_STORMS_SOURCE,
  FLOODS_SOURCE,
  GDACS_SOURCE, // multi-hazard GDACS alerts (EQ/TC/FL/VO/DR/WF), alert-coloured
  TROPICAL_CYCLONES_SOURCE, // NOAA NHC active named storms (keyless; empty in quiet season)
  FIRE_FIRMS_SOURCE, // NASA FIRMS active-fire detections (key-gated: FIRMS_MAP_KEY)
  EMSC_SOURCE, // EMSC quakes — a 2nd, faster Euro-Med catalogue alongside USGS
  AURORA_SOURCE,
  SPACE_WEATHER_SOURCE, // NOAA SWPC Kp/storm-scale status pin (keyless)
  // Space
  LAUNCHES_SOURCE,
  // Infrastructure (cables = line layer + landing-station nodes, gpsJamming = fill layer)
  CABLES_SOURCE,
  CABLE_LANDINGS_SOURCE,
  GPS_JAMMING_SOURCE,
  NUCLEAR_SOURCE,
  AIRPORTS_SOURCE,
  PORTS_SOURCE,
  INTERNET_OUTAGES_SOURCE, // IODA national internet-shutdown detection (keyless, country-aggregated)
  CLOUD_STATUS_SOURCE, // vendor Statuspage summaries (keyless); empty until something is actually down
  // Intel (GDELT geolocated news coverage)
  CONFLICT_SOURCE,
  PROTESTS_SOURCE,
  // Conflict events (ACLED — key-gated: ACLED_EMAIL + ACLED_PASSWORD)
  ACLED_SOURCE,
  // Environment & civic (keyless Open-Meteo + data.police.uk)
  WEATHER_SOURCE,
  AIR_QUALITY_SOURCE,
  AIR_QUALITY_STATIONS_SOURCE, // real OpenAQ station PM2.5 (key-gated: OPENAQ_API_KEY)
  UK_CRIME_SOURCE,
  // Cyber threat (keyless abuse.ch + Ransomware.live, country-aggregated)
  CYBER_C2_SOURCE,
  CYBER_RANSOMWARE_SOURCE,
  // Human cost (keyless UNHCR displacement + WFP HungerMap, country-aggregated)
  DISPLACEMENT_SOURCE,
  FOOD_SECURITY_SOURCE,
  RELIEFWEB_SOURCE, // UN OCHA humanitarian emergencies (key-gated: RELIEFWEB_APPNAME)
  // Energy / grid (key-gated: ENTSOE_API_TOKEN)
  GRID_LOAD_SOURCE,
  // Military (keyless unfiltered military ADS-B)
  MILITARY_AIR_SOURCE,
  // Maritime (real-time AIS vessel positions at strategic chokepoints; key-gated: AISSTREAM_API_KEY)
  AIS_SOURCE,
];

/** Lookup a source by id (the dynamic route + store key). */
export function getSignal(id: string): SignalSource | undefined {
  return SIGNALS.find((s) => s.id === id);
}

/** Registry grouped by `group`, preserving registration order — used by the rail. */
export function signalsByGroup(): { group: string; sources: SignalSource[] }[] {
  const groups: { group: string; sources: SignalSource[] }[] = [];
  for (const s of SIGNALS) {
    let g = groups.find((x) => x.group === s.group);
    if (!g) {
      g = { group: s.group, sources: [] };
      groups.push(g);
    }
    g.sources.push(s);
  }
  return groups;
}
