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
//   • Rail      components/shell/SourceCatalog.tsx — the six-section Sources rail,
//                 its rows from lib/console/sources/railSources.ts
//
// POINTS, LINES and POLYGONS are all supported. A source whose features carry a
// `geometry` (SignalFeature.geometry: LineString/MultiLineString → line layer,
// Polygon/MultiPolygon → fill layer) renders on the dedicated line/fill sources
// in WorldMap; plain points keep the circle layer. lat/lon stays the click /
// label / dossier anchor for every kind. The registry/store/route/dossier
// plumbing is identical regardless of geometry — see lib/signals/types.ts.
// ===========================================================================

import type { SignalSource } from "@/lib/signals/types";
import { EARTHQUAKES_SOURCE } from "@/lib/signals/earthquakes";
// The four natural-hazard event layers were NASA EONET until 2026-10-16. Each now
// merges its primary sources (EONET stays inside severe storms and, as a background,
// volcanoes) — see the header of each module.
import { WILDFIRES_SOURCE } from "@/lib/signals/wildfires";
import { VOLCANOES_SOURCE } from "@/lib/signals/volcanoes";
import { SEVERE_STORMS_SOURCE } from "@/lib/signals/severe-storms";
import { FLOODS_SOURCE } from "@/lib/signals/floods";
import { AURORA_SOURCE } from "@/lib/signals/aurora";
import { LAUNCHES_SOURCE } from "@/lib/signals/launches";
import { CABLES_SOURCE, CABLE_LANDINGS_SOURCE } from "@/lib/signals/cables";
import { CABLE_ROUTES_SOURCE } from "@/lib/signals/cable-routes";
import { GPS_JAMMING_SOURCE } from "@/lib/signals/gpsjam";
import { GPS_JAMMING_LIVE_SOURCE } from "@/lib/signals/gpsjam-live";
import { GNSS_NOTAMS_SOURCE } from "@/lib/signals/gnss-notams";
import { NUCLEAR_SOURCE } from "@/lib/signals/nuclear";
import { AIRPORTS_SOURCE } from "@/lib/signals/airports";
import { PORTS_SOURCE } from "@/lib/signals/ports";
import { CONFLICT_SOURCE, PROTESTS_SOURCE } from "@/lib/signals/conflict";
import { UKRAINE_ALERTS_SOURCE } from "@/lib/signals/ukraine-alerts";
import { GDACS_SOURCE } from "@/lib/signals/gdacs";
import { FIRE_FIRMS_SOURCE } from "@/lib/signals/fire-firms";
import { AIR_QUALITY_SOURCE } from "@/lib/signals/airquality";
import { UK_CRIME_SOURCE } from "@/lib/signals/crime";
import { US_CITY_CRIME_SOURCE } from "@/lib/signals/crime-us";
import { CLOUD_STATUS_SOURCE } from "@/lib/signals/cloud-status";
import { CYBER_RANSOMWARE_SOURCE } from "@/lib/signals/cyber-ransomware";
import { CYBER_DISCLOSURES_SOURCE } from "@/lib/signals/cyber-disclosures";
import { CYBER_ATTACKERS_SOURCE } from "@/lib/signals/cyber-attackers";
import { DISPLACEMENT_SOURCE } from "@/lib/signals/displacement";
import { MILITARY_AIR_SOURCE } from "@/lib/signals/military-air";
import { GLIDERS_SOURCE } from "@/lib/signals/ogn";
import { AIS_SOURCE } from "@/lib/signals/ais";
import { INTERNET_OUTAGES_SOURCE } from "@/lib/signals/internet-outages";
import { SPACE_WEATHER_SOURCE } from "@/lib/signals/space-weather";
import { GEOMAG_STATIONS_SOURCE } from "@/lib/signals/geomag-stations";
import { INSTABILITY_SOURCE } from "@/lib/signals/instability";
import { AIR_QUALITY_STATIONS_SOURCE } from "@/lib/signals/airquality-stations";
import { TROPICAL_CYCLONES_SOURCE } from "@/lib/signals/tropical-cyclones";
import { CYCLONE_FORECASTS_SOURCE } from "@/lib/signals/cyclone-forecasts";
import { TSUNAMI_SOURCE } from "@/lib/signals/tsunami";
import { VOLCANO_ALERTS_SOURCE } from "@/lib/signals/volcano-alerts";
import { CEMS_ACTIVATIONS_SOURCE } from "@/lib/signals/cems-activations";
import { WEATHER_WARNINGS_SOURCE } from "@/lib/signals/weather-warnings";
import { RELIEFWEB_SOURCE } from "@/lib/signals/reliefweb";
import { GRID_LOAD_SOURCE } from "@/lib/signals/entsoe";
import { HEADLINE_PLACES_SOURCE } from "@/lib/signals/headline-places";
import { ROAD_CLOSURES_SOURCE, ROAD_INCIDENTS_SOURCE, ROAD_WORKS_SOURCE } from "@/lib/signals/roads";

/** Every registered signal layer, in rail display order. */
export const SIGNALS: SignalSource[] = [
  // Synthesis — a per-country instability score composited from the conflict /
  // food / displacement / outage inputs. DATA-ONLY since 2026-09-05: it is not a
  // map layer any more (see `dataOnly` in lib/signals/types.ts), but the Daily
  // Brief, the Country Instability widget, the Strategic Risk panel and the country
  // dossier all still read it through /api/signals/instability.
  INSTABILITY_SOURCE,
  // USGS, EMSC and eight national catalogues, each quake shown once. EMSC was its own
  // layer (`emsc-quakes`) until 2026-10-16; lib/layerAliases.ts maps the old id here.
  EARTHQUAKES_SOURCE,
  WILDFIRES_SOURCE,
  VOLCANOES_SOURCE,
  SEVERE_STORMS_SOURCE,
  FLOODS_SOURCE,
  GDACS_SOURCE, // multi-hazard GDACS alerts (EQ/TC/FL/VO/DR/WF), alert-coloured
  TROPICAL_CYCLONES_SOURCE, // every warned storm: NOAA NHC + JTWC, with JMA/CMA readings (keyless)
  CYCLONE_FORECASTS_SOURCE, // NHC forecast cones + tropical weather outlook areas (keyless)
  TSUNAMI_SOURCE, // NOAA PTWC + NTWC latest tsunami bulletins (keyless)
  VOLCANO_ALERTS_SOURCE, // official volcano alert levels: USGS HANS + JMA (keyless)
  CEMS_ACTIVATIONS_SOURCE, // Copernicus EMS rapid-mapping activations (keyless)
  WEATHER_WARNINGS_SOURCE, // official NWS (US) + ECCC (Canada) weather alerts (keyless)
  FIRE_FIRMS_SOURCE, // NASA FIRMS active-fire detections (keyless global 24 h files)
  AURORA_SOURCE,
  SPACE_WEATHER_SOURCE, // NOAA SWPC Kp/storm-scale status pin (keyless)
  GEOMAG_STATIONS_SOURCE, // FMI + USGS magnetometers: MEASURED disturbance at named stations (keyless)
  // Space
  LAUNCHES_SOURCE,
  // Infrastructure (cables = line layer + landing-station nodes, gpsJamming = fill layer)
  CABLES_SOURCE,
  CABLE_LANDINGS_SOURCE,
  CABLE_ROUTES_SOURCE, // surveyed routes: NOAA (US) + EMODnet (Europe), keyless
  GPS_JAMMING_SOURCE,
  GPS_JAMMING_LIVE_SOURCE, // the last hour, computed from live adsb.lol NACp (keyless)
  GNSS_NOTAMS_SOURCE, // official GNSS jamming NOTAMs via EUROCONTROL AUGUR (keyless)
  NUCLEAR_SOURCE,
  AIRPORTS_SOURCE,
  PORTS_SOURCE,
  INTERNET_OUTAGES_SOURCE, // IODA national internet-shutdown detection (keyless, country-aggregated)
  CLOUD_STATUS_SOURCE, // vendor Statuspage summaries (keyless); empty until something is actually down
  // Intel (UCDP verified events, U.S. Embassy alerts, UK and Canadian travel advice)
  CONFLICT_SOURCE,
  // The World Headlines stream, pinned at the places its headlines NAME. Reads the same
  // cached feed /api/news serves, so it costs the publishers nothing. It makes a weak
  // claim on purpose — see lib/signals/headline-places.ts. `news-coverage`, the stronger
  // claim built from the NewsScraper pushes, was removed on 2026-10-17 (its pins were
  // held back pending an accuracy review); lib/layerAliases.ts drops its id.
  HEADLINE_PLACES_SOURCE,
  UKRAINE_ALERTS_SOURCE,
  PROTESTS_SOURCE,
  // Environment & civic (keyless Open-Meteo + data.police.uk)
  AIR_QUALITY_SOURCE,
  AIR_QUALITY_STATIONS_SOURCE, // real OpenAQ station PM2.5 (key-gated: OPENAQ_API_KEY)
  UK_CRIME_SOURCE,
  US_CITY_CRIME_SOURCE, // police departments' own portals, last 7 days, block-level (keyless)
  // Cyber threat (keyless Ransomware.live, country-aggregated). abuse.ch Feodo Tracker's
  // botnet C2 layer (`cyber-c2`) was removed on 2026-10-17: the dataset has listed no
  // current C2 since 2026-03. lib/layerAliases.ts drops its id.
  CYBER_RANSOMWARE_SOURCE,
  CYBER_DISCLOSURES_SOURCE, // incidents the victims confirmed: SEC 8-K Item 1.05 + Washington AG (keyless, US only)
  CYBER_ATTACKERS_SOURCE, // SANS ISC DShield top 20 attacking /24s, by registered country (keyless)
  // Human cost (keyless UNHCR displacement, country-aggregated)
  DISPLACEMENT_SOURCE,
  RELIEFWEB_SOURCE, // humanitarian emergencies: ReliefWeb's HDX export + IFRC GO appeals (keyless)
  // Energy / grid (key-gated: ENTSOE_API_TOKEN)
  GRID_LOAD_SOURCE,
  // Military (keyless unfiltered military ADS-B)
  MILITARY_AIR_SOURCE,
  // Aviation (keyless Open Glider Network: gliders and FLARM trackers ADS-B never sees)
  GLIDERS_SOURCE,
  // Maritime (real-time AIS vessel positions at strategic chokepoints; key-gated: AISSTREAM_API_KEY)
  AIS_SOURCE,
  // Roads (keyless road operators' own notices: TfL in London, DriveBC in British
  // Columbia): notices, never a speed. One read of each operator feeds all three; see
  // lib/signals/roads.ts.
  ROAD_WORKS_SOURCE,
  ROAD_INCIDENTS_SOURCE,
  ROAD_CLOSURES_SOURCE,
];

/**
 * The signals that are offered as MAP LAYERS — every registered source except the
 * data-only ones (see `SignalSource.dataOnly`).
 *
 * This is the list for anything that draws, lists, toggles or shares a layer: the
 * source catalog, the Sources rail, WorldMap, the monitor presets, the ⌘K palette,
 * the variant profiles and the `?sig=` share URL. `SIGNALS` stays the full registry
 * and is what the /api/signals/<id> route, /api/status and the explainers read.
 *
 * Getting these two the wrong way round is the failure this split exists to prevent:
 * import `SIGNALS` into a layer surface and a data-only source reappears as a layer.
 */
export const MAP_SIGNALS: SignalSource[] = SIGNALS.filter((s) => !s.dataOnly);

/** Ids that are registered but deliberately not map layers. */
export const DATA_ONLY_SIGNAL_IDS: readonly string[] = SIGNALS.filter((s) => s.dataOnly).map((s) => s.id);

/** Lookup a source by id (the dynamic route + store key). */
export function getSignal(id: string): SignalSource | undefined {
  return SIGNALS.find((s) => s.id === id);
}

/** Map layers grouped by `group`, preserving registration order — used by the rail.
 *  Walks MAP_SIGNALS, so a data-only source never appears as a group or a row. */
export function signalsByGroup(): { group: string; sources: SignalSource[] }[] {
  const groups: { group: string; sources: SignalSource[] }[] = [];
  for (const s of MAP_SIGNALS) {
    let g = groups.find((x) => x.group === s.group);
    if (!g) {
      g = { group: s.group, sources: [] };
      groups.push(g);
    }
    g.sources.push(s);
  }
  return groups;
}
