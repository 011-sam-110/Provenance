// Wildfires — named fire INCIDENTS (the Active fires layer is satellite pixels).
//
// Until 2026-10-16 this was NASA EONET's wildfires category. The audit found it had
// become US-only and mostly prescribed burns: EONET's GDACS wildfire relay stopped on
// 2025-04-27, and of the 35 rows prod served, all came from the US IRWIN relay and 20
// were "Prescribed Fire" (sources-audit/eonet.md). The primaries replace it:
//
//   • NIFC WFIGS current incident locations — the US interagency system of record
//     (IRWIN), WILDFIRES ONLY (IncidentTypeCategory 'WF'): 265 incidents on
//     2026-10-16 against EONET's 15 relayed wildfires.
//   • GDACS SEARCH WF, last 7 days — the rest of the world (JRC GWIS fire events). US
//     events are dropped from it: WFIGS is the primary there. Seven days, not 30:
//     measured 2026-10-16, 30 days held 932 events, most of them over for weeks; 7
//     days held 279, every one updated in that week.
//   • Copernicus EMS wildfire activations — impact-grade, mapped events.
//   • EFFIS burnt areas mapped in the past week (EC JRC, CC BY 4.0) — the footprint of
//     each European / North African fire, with its commune. A GDACS fire event within
//     15 km of one is the same fire seen coarser, and is dropped for it.

import type { SignalFeature, SignalGeometry, SignalSource } from "@/lib/signals/types";
import { fetchGdacsSearch, gdacsToLayerFeatures } from "@/lib/signals/gdacs";
import { attachCemsToGdacs, cemsToFeatures, fetchCemsActivations } from "@/lib/signals/copernicus-ems";
import { distanceKm, getJson, readInput, ringCentroid, withInputsOutcome } from "@/lib/signals/multiInput";

/** GDACS fire events updated in this many days. */
export const GDACS_WILDFIRE_WINDOW_DAYS = 7;
/** Copernicus EMS wildfire activations this recent (or still open). */
export const CEMS_WILDFIRE_WINDOW_DAYS = 30;
export const WILDFIRE_COLOR = "#f97316";

export const WFIGS_URL =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?" +
  new URLSearchParams({
    where: "IncidentTypeCategory='WF'",
    outFields:
      "IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,POOState,UniqueFireIdentifier,IncidentTypeCategory",
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: "2000",
  }).toString();

export const WILDFIRES_ATTRIBUTION =
  "Wildfire incidents: NIFC WFIGS (IRWIN); Global Disaster Alert and Coordination System, GDACS (JRC GWIS); " +
  "EFFIS burnt areas © European Union, CC BY 4.0; © European Union, Copernicus Emergency Management Service";

export const EFFIS_URL =
  "https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0&request=GetFeature" +
  "&typeName=modis.ba.poly.week&outputFormat=geojson";

/** A GDACS fire event this close to an EFFIS burnt area is the same fire. */
export const SAME_FIRE_KM = 15;

interface EffisFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    id?: string;
    FIREDATE?: string;
    LASTUPDATE?: string;
    COUNTRY?: string;
    PROVINCE?: string;
    COMMUNE?: string;
    AREA_HA?: string | number;
  } | null;
}

/**
 * Pure: EFFIS weekly burnt-area polygons → wildfire areas. The WFS answers in
 * [lon, lat] (Casteltermini, Sicily, arrives as [13.55, 37.55]). FIREDATE is UTC.
 */
export function normalizeEffisBurntAreas(json: { features?: EffisFeature[] } | null): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    const g = f.geometry;
    let geometry: SignalGeometry | undefined;
    let anchor: { lat: number; lon: number } | null = null;
    if (g?.type === "Polygon" && Array.isArray(g.coordinates)) {
      geometry = { type: "Polygon", coordinates: g.coordinates as [number, number][][] };
      anchor = ringCentroid((g.coordinates as unknown[])[0]);
    } else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      geometry = { type: "MultiPolygon", coordinates: g.coordinates as [number, number][][][] };
      anchor = ringCentroid(((g.coordinates as unknown[][])[0] ?? [])[0]);
    }
    if (!geometry || !anchor || Math.abs(anchor.lat) > 90 || Math.abs(anchor.lon) > 180) continue;
    const id = String(p.id ?? f.id ?? "").trim();
    if (!id) continue;
    const ha = Number(p.AREA_HA);
    const t = p.FIREDATE ? Date.parse(`${p.FIREDATE.replace(" ", "T")}Z`) : Number.NaN;
    const place = [p.COMMUNE, p.PROVINCE].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
    out.push({
      id: `wildfires:effis:${id}`,
      lat: anchor.lat,
      lon: anchor.lon,
      title: `Burnt area — ${place || "Europe"}${p.COUNTRY ? ` (${p.COUNTRY})` : ""}${Number.isFinite(ha) ? `, ${Math.round(ha)} ha` : ""}`,
      signalId: "wildfires",
      precision: "area",
      geometry,
      color: "#78350f",
      ts: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
      props: {
        source: "EFFIS burnt areas",
        hectares: Number.isFinite(ha) ? ha : "—",
        country: p.COUNTRY ?? "—",
        mapped: p.LASTUPDATE?.slice(0, 16) ?? "—",
      },
    });
  }
  return out;
}

/** Pure: drop a GDACS fire event that an EFFIS burnt area already shows. */
export function dropGdacsCoveredByEffis(gdacs: SignalFeature[], effis: SignalFeature[]): SignalFeature[] {
  if (!effis.length) return gdacs;
  return gdacs.filter((g) => !effis.some((e) => distanceKm(e, g) <= SAME_FIRE_KM));
}

interface WfigsFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    IncidentName?: string | null;
    IncidentSize?: number | null;
    PercentContained?: number | null;
    FireDiscoveryDateTime?: number | null;
    ModifiedOnDateTime_dt?: number | null;
    POOState?: string | null;
    UniqueFireIdentifier?: string | null;
    IncidentTypeCategory?: string | null;
  } | null;
}

/** Orange ramp by burned area in acres. */
function acresColor(acres: number | null): string {
  if (acres == null) return WILDFIRE_COLOR;
  if (acres >= 10_000) return "#9a3412";
  if (acres >= 1_000) return "#c2410c";
  if (acres >= 100) return "#ea580c";
  return WILDFIRE_COLOR;
}

const isoOf = (ms: number | null | undefined) =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;

/**
 * Pure: WFIGS GeoJSON → wildfire incidents. Anything that is not a wildfire ('WF') is
 * dropped even if the query let it through: a prescribed burn is not a wildfire. The
 * point is the incident's point of origin, so the layer default (`exact`) applies.
 */
export function normalizeWfigs(json: { features?: WfigsFeature[] } | null): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const f of json?.features ?? []) {
    const p = f.properties ?? {};
    if ((p.IncidentTypeCategory ?? "").toUpperCase() !== "WF") continue;
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const [lon, lat] = c as number[];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const uid = (p.UniqueFireIdentifier ?? "").trim();
    if (!uid) continue;
    const acres = typeof p.IncidentSize === "number" && Number.isFinite(p.IncidentSize) ? p.IncidentSize : null;
    const pct = typeof p.PercentContained === "number" && Number.isFinite(p.PercentContained) ? p.PercentContained : null;
    const state = (p.POOState ?? "").replace(/^US-/, "");
    const name = (p.IncidentName ?? "").trim() || "Unnamed";
    const bits = [
      acres != null ? `${Math.round(acres).toLocaleString("en-US")} acres` : null,
      pct != null ? `${Math.round(pct)}% contained` : null,
    ].filter(Boolean);
    out.push({
      id: `wildfires:wfigs:${uid}`,
      lat,
      lon,
      title: `${name} Fire${state ? ` (${state})` : ""}${bits.length ? ` — ${bits.join(", ")}` : ""}`,
      signalId: "wildfires",
      color: acresColor(acres),
      ts: isoOf(p.ModifiedOnDateTime_dt) ?? isoOf(p.FireDiscoveryDateTime),
      props: {
        source: "NIFC WFIGS",
        acres: acres != null ? Math.round(acres * 10) / 10 : "—",
        contained: pct != null ? `${Math.round(pct)}%` : "not reported",
        discovered: isoOf(p.FireDiscoveryDateTime) ?? "—",
        state: state || "—",
        incidentId: uid,
      },
    });
  }
  return out;
}

export const US_ISO3: ReadonlySet<string> = new Set(["USA"]);

export const WILDFIRES_SOURCE: SignalSource = {
  id: "wildfires",
  // A WFIGS incident is its point of origin. GDACS and Copernicus points stand for an
  // affected area and set "area" per feature.
  precision: "exact",
  label: "Wildfires",
  group: "Natural hazards",
  color: WILDFIRE_COLOR,
  refreshMs: 10 * 60 * 1000,
  attribution: WILDFIRES_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const [wfigs, gdacs, cems, effis] = await Promise.all([
      readInput("wildfires:wfigs", "NIFC WFIGS", async () => normalizeWfigs(await getJson(WFIGS_URL, 20_000)), now),
      readInput("wildfires:gdacs", "GDACS", async () =>
        gdacsToLayerFeatures(
          await fetchGdacsSearch("WF", GDACS_WILDFIRE_WINDOW_DAYS, now, (u) => getJson(u, 20_000)),
          { signalId: "wildfires", idPrefix: "wildfires:gdacs", sourceLabel: "GDACS (JRC GWIS)", excludeIso3: US_ISO3 },
        ),
      now),
      readInput("wildfires:cems", "Copernicus EMS", async () =>
        cemsToFeatures(await fetchCemsActivations(now), {
          category: "Wildfire",
          signalId: "wildfires",
          color: WILDFIRE_COLOR,
          maxAgeDays: CEMS_WILDFIRE_WINDOW_DAYS,
          now,
        }),
      now),
      readInput("wildfires:effis", "EFFIS", async () => normalizeEffisBurntAreas(await getJson(EFFIS_URL, 30_000)), now),
    ]);
    const features = [
      ...wfigs.features,
      ...attachCemsToGdacs(dropGdacsCoveredByEffis(gdacs.features, effis.features), cems.features),
      ...effis.features,
    ];
    return withInputsOutcome([wfigs, gdacs, cems, effis], features, now);
  },
};
