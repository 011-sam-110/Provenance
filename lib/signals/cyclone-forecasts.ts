import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { kmlPolygons, kmzToKml, ringAnchor } from "@/lib/signals/kmz";
import { NHC_CURRENT_STORMS, normalizeCyclones, type NhcStorm } from "@/lib/signals/tropical-cyclones";

// NHC cyclone forecasts — where a storm is likely to go, and where one may form.
//
//   Forecast cones  one per active NHC storm, the 5-day "cone of uncertainty" from
//                   the KMZ that CurrentStorms.json links for the current advisory.
//   Outlook areas   the Graphical Tropical Weather Outlook, one KMZ per basin
//                   (Atlantic, East Pacific, Central Pacific), each area with NHC's
//                   2-day and 7-day formation chances.
//
// WHY A LAYER OF ITS OWN and not part of "Tropical cyclones": these are FORECASTS,
// not storms. In the storm layer every row is a storm, and the event lists, Top
// Events and the anomaly board read it that way; a cone there would be listed as a
// cyclone. The source audit of 2026-10-16 asked for both products: the storm layer's
// own note had called the missing cone a v1 gap since it shipped.
//
// NHC's basins only. JTWC publishes no cone in a machine format we read, and the
// other basins' centres publish none at all (audit of 2026-10-16). US federal work,
// public domain; NOAA asks for credit.
//
// FAILURE. If CurrentStorms.json or every outlook basin fails, the layer says so. A
// single cone or basin that fails is a partial answer, stated as one.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const GTWO_BASINS = ["atl", "pac", "cpac"] as const;

export const NHC_FORECAST_ATTRIBUTION = "Forecast cones and tropical weather outlook © NOAA NHC";

/** Pure: an NHC forecast-cone KML → the cone of one storm, as an area. */
export function coneFeature(kml: string, storm: { id: string; name: string; color: string; advisory?: string; issued?: string }): SignalFeature | null {
  const poly = kmlPolygons(kml)[0];
  if (!poly) return null;
  const at = ringAnchor(poly.ring);
  return {
    id: `cyclone-cone:${storm.id}`,
    ...at,
    title: `${storm.name} — 5-day forecast cone`,
    signalId: "cyclone-forecasts",
    precision: "area",
    geometry: { type: "Polygon", coordinates: [poly.ring] },
    color: storm.color,
    link: "https://www.nhc.noaa.gov/aboutcone.shtml",
    ts: storm.issued,
    props: {
      storm: storm.name,
      product: "NHC forecast cone: where the centre is likely to track, not the size of the storm",
      ...(storm.advisory ? { advisory: storm.advisory } : {}),
    },
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** NHC's own colours for the 7-day formation chance. */
const OUTLOOK_COLOR: Record<string, string> = { low: "#facc15", medium: "#f97316", high: "#dc2626" };

/** Pure: a GTWO KML (one basin) → one area per disturbance. */
export function outlookFeatures(kml: string, basin: string): SignalFeature[] {
  // "<name>Graphical Tropical Weather Outlook - … basin - Fri Oct 16 17:34:38 2026</name>", in UTC.
  const issued = /Outlook[^<]*?-\s*\w{3} (\w{3}) +(\d{1,2}) (\d\d:\d\d:\d\d) (\d{4})/.exec(kml);
  const month = issued ? MONTHS.indexOf(issued[1]!) : -1;
  const ts =
    issued && month >= 0
      ? `${issued[4]}-${String(month + 1).padStart(2, "0")}-${issued[2]!.padStart(2, "0")}T${issued[3]}.000Z`
      : undefined;
  const out: SignalFeature[] = [];
  for (const poly of kmlPolygons(kml)) {
    const d = poly.data;
    const n = d.Disturbance ?? String(out.length + 1);
    const seven = (d["7day_category"] ?? "").toLowerCase();
    const discussion = (d.Discussion ?? "").replace(/\s+/g, " ").trim();
    out.push({
      id: `cyclone-outlook:${basin}:${n}`,
      ...ringAnchor(poly.ring),
      title: `Possible tropical cyclone: ${d["7day_percentage"] ?? "?"} chance in 7 days`,
      signalId: "cyclone-forecasts",
      precision: "area",
      geometry: { type: "Polygon", coordinates: [poly.ring] },
      color: OUTLOOK_COLOR[seven] ?? "#facc15",
      link: "https://www.nhc.noaa.gov/gtwo.php",
      ts,
      props: {
        product: "NHC Tropical Weather Outlook: an area where a storm may form",
        "chance in 2 days": `${d["2day_percentage"] ?? "?"} (${d["2day_category"] ?? "?"})`,
        "chance in 7 days": `${d["7day_percentage"] ?? "?"} (${d["7day_category"] ?? "?"})`,
        ...(discussion ? { discussion: discussion.length > 400 ? `${discussion.slice(0, 397)}...` : discussion } : {}),
      },
    });
  }
  return out;
}

async function get(url: string, accept: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(15_000) });
}

/** The KML of a KMZ at `url`, or the reason it could not be read. */
async function readKml(url: string): Promise<{ kml: string } | { reason: string }> {
  try {
    const res = await get(url, "application/vnd.google-earth.kmz");
    if (!res.ok) return { reason: `http ${res.status}` };
    const kml = await kmzToKml(await res.arrayBuffer());
    return kml ? { kml } : { reason: "no kml in kmz" };
  } catch (e) {
    return { reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed" };
  }
}

export interface ForecastPart {
  what: string;
  ok: boolean;
  rows: SignalFeature[];
  reason?: string;
}

/** Pure: fold the reads into the outcome-tagged layer. */
export function forecastLayerFrom(parts: ForecastPart[], at: number): SignalFeature[] {
  const rows = parts.flatMap((p) => p.rows);
  const failed = parts.filter((p) => !p.ok);
  if (parts.length > 0 && failed.length === parts.length) return degraded(failed[0]!.reason ?? "upstream read failed", at);
  if (failed.length > 0) {
    return degradedWith(rows, `partial: ${failed.map((f) => `${f.what} (${f.reason})`).join(", ")} failed`, at);
  }
  return observed(rows, at);
}

async function readCones(): Promise<ForecastPart[]> {
  let storms: NhcStorm[];
  try {
    const res = await get(NHC_CURRENT_STORMS, "application/json");
    if (!res.ok) return [{ what: "NHC storms", ok: false, rows: [], reason: `http ${res.status}` }];
    storms = ((await res.json()) as { activeStorms?: NhcStorm[] }).activeStorms ?? [];
  } catch (e) {
    return [{ what: "NHC storms", ok: false, rows: [], reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed" }];
  }
  const centres = normalizeCyclones({ activeStorms: storms });
  const parts = await Promise.all(
    storms.map(async (s): Promise<ForecastPart | null> => {
      const id = s.id?.trim();
      const url = s.trackCone?.kmzFile;
      const centre = centres.find((c) => c.id === `cyclone:${id}`);
      // Only NHC's own host: the URL comes from a payload, and is fetched server-side.
      if (!id || !url || !centre || !/^https:\/\/www\.nhc\.noaa\.gov\//.test(url)) return null;
      const r = await readKml(url);
      const what = `${centre.props?.storm ?? id} cone`;
      if ("reason" in r) return { what, ok: false, rows: [], reason: r.reason };
      const cone = coneFeature(r.kml, {
        id,
        name: String(centre.props?.storm ?? s.name ?? id),
        color: centre.color ?? "#dc2626",
        advisory: s.trackCone?.advNum ? `NHC advisory ${s.trackCone.advNum}` : undefined,
        issued: s.trackCone?.issuance,
      });
      return { what, ok: true, rows: cone ? [cone] : [] };
    }),
  );
  return [{ what: "NHC storms", ok: true, rows: [] }, ...parts.filter((p): p is ForecastPart => p !== null)];
}

async function readOutlook(): Promise<ForecastPart[]> {
  return Promise.all(
    GTWO_BASINS.map(async (b): Promise<ForecastPart> => {
      const r = await readKml(`https://www.nhc.noaa.gov/xgtwo/gtwo_${b}.kmz`);
      return "reason" in r
        ? { what: `${b} outlook`, ok: false, rows: [], reason: r.reason }
        : { what: `${b} outlook`, ok: true, rows: outlookFeatures(r.kml, b) };
    }),
  );
}

export const CYCLONE_FORECASTS_SOURCE: SignalSource = {
  id: "cyclone-forecasts",
  // A cone and an outlook area are both areas; neither is a point.
  precision: "area",
  label: "Cyclone forecasts (NHC)",
  group: "Natural hazards",
  color: "#f97316",
  refreshMs: 30 * 60 * 1000, // NHC issues advisories every 6 h (3 h with watches) and the outlook every 6 h
  attribution: NHC_FORECAST_ATTRIBUTION,
  async fetch() {
    const at = Date.now();
    const [cones, outlook] = await Promise.all([readCones(), readOutlook()]);
    return forecastLayerFrom([...cones, ...outlook], at);
  },
};
