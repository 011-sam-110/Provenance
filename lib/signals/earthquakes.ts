import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { normalizeUsgs } from "@/lib/signals/usgs";
import { emscEndpoint, normalizeEmsc } from "@/lib/signals/emsc";
import {
  GEOFON_FDSN,
  INGV_FDSN,
  NRCAN_FDSN,
  normalizeBmkg,
  normalizeFdsnText,
  normalizeGa,
  normalizeGeonet,
  normalizeIgn,
  normalizeJmaQuakes,
} from "@/lib/signals/quakeCatalogues";
import { clusterQuakes, type QuakeEntry } from "@/lib/signals/quakeTwin";

// THE EARTHQUAKES LAYER: one layer, many catalogues, each quake drawn once.
//
// Until 2026-10-16 this was two layers, USGS ("earthquakes") and EMSC
// ("emsc-quakes"). The source audit of that day measured three problems with that:
//   • about 54 quakes a day were drawn twice, once per layer;
//   • USGS lists only about M4 and up outside the US, and EMSC (91% of its rows are
//     relayed national solutions) misses most small events in NZ, Italy and Japan;
//   • the national agencies that actually locate those events were not read at all.
// So the layer now reads USGS, EMSC and eight national or global primaries, joins
// the rows that are one event (the rule in lib/signals/quakeTwin.ts), shows the
// preferred row and lists every catalogue that reported it.
//
// WHICH ROW IS SHOWN. A national agency inside its own country first (it located
// the event with the densest network), then USGS (inside the US it is that national
// agency), then GFZ GEOFON, then a national agency outside its own country, then
// EMSC, which is mostly a relay. The `emsc-quakes` id is retired, and saved toggles
// and share links that hold it open this layer (lib/layerAliases.ts).
//
// THE WINDOW is the last 24 hours for every catalogue, whatever its own feed spans
// (GeoNet gives ~2 days, Geoscience Australia 7, JMA 30, IGN 10).
//
// FAILURE. Each catalogue is read on its own and can fail on its own. The rows of
// the ones that answered are still shown, and the layer says which failed
// (`degradedWith`), the same rule as GDACS's per-hazard reads.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
export const QUAKE_WINDOW_HOURS = 24;

/** [west, south, east, north] in degrees. */
type Box = readonly [number, number, number, number];

export interface QuakeCatalogue {
  key: string;
  /** How the panel names it in "Reported by". */
  name: string;
  /** Where this catalogue is the national agency, so its row is preferred. */
  home: readonly Box[];
  /** Rank outside `home` (inside it, every catalogue ranks 0). */
  rankAway: number;
  /** Keep only this catalogue's rows inside `home`. */
  onlyHome?: boolean;
  /** Fetch + parse. Resolves, never rejects. */
  read(now: number): Promise<CatalogueRead>;
}

export interface CatalogueRead {
  key: string;
  ok: boolean;
  rows: SignalFeature[];
  reason?: string;
}

const since = (now: number) => new Date(now - QUAKE_WINDOW_HOURS * 3_600_000).toISOString().slice(0, 19);

/** One GET, parsed. FDSN's 204 (nothing in the window) is an empty answer, not a failure. */
async function readOne(
  key: string,
  url: string,
  parse: (res: Response) => Promise<SignalFeature[]>,
  accept = "application/json",
): Promise<CatalogueRead> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return { key, ok: true, rows: [] };
    if (!res.ok) return { key, ok: false, rows: [], reason: `http ${res.status}` };
    return { key, ok: true, rows: await parse(res) };
  } catch (e) {
    return { key, ok: false, rows: [], reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed" };
  }
}

const inBox = (lat: number, lon: number, b: Box) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

const US: readonly Box[] = [
  [-125, 24, -66, 50], // contiguous US
  [-180, 50, -129, 72], // Alaska
  [172, 50, 180, 56], // the western Aleutians
  [-161, 18, -154, 23], // Hawaii
  [-68, 17, -64, 19], // Puerto Rico and the Virgin Islands
];

const JMA_HOME: readonly Box[] = [[122, 20, 150, 46.5]];

/** In preference order for a tie. */
export const QUAKE_CATALOGUES: readonly QuakeCatalogue[] = [
  {
    key: "geonet",
    name: "GeoNet",
    // New Zealand with its subantarctic islands, and the Kermadecs across 180°.
    home: [[160, -56, 180, -29], [-180, -38, -175, -29]],
    rankAway: 3,
    read: () =>
      readOne("geonet", "https://api.geonet.org.nz/quake?MMI=-1", async (r) => normalizeGeonet(await r.json()),
        "application/vnd.geo+json;version=2"),
  },
  {
    key: "ingv",
    name: "INGV",
    home: [[6, 35, 19, 47.5]],
    rankAway: 3,
    read: (now) =>
      readOne("ingv", `https://webservices.ingv.it/fdsnws/event/1/query?starttime=${since(now)}&format=text`,
        async (r) => normalizeFdsnText(await r.text(), INGV_FDSN), "text/plain"),
  },
  {
    key: "jma",
    name: "JMA",
    home: JMA_HOME,
    rankAway: 3,
    // Japan only. JMA also bulletins large quakes abroad, but with a time to the minute
    // that is not always the origin: its Kamchatka M6.9 of 2026-10-16 was stamped
    // 2.5 minutes after GEOFON's origin, so it could not join that event and would
    // have drawn a second dot. Abroad, the agencies that located the quake are read.
    onlyHome: true,
    read: () =>
      readOne("jma", "https://www.jma.go.jp/bosai/quake/data/list.json", async (r) => normalizeJmaQuakes(await r.json())),
  },
  {
    key: "ga",
    name: "Geoscience Australia",
    home: [[112, -44, 154, -10]],
    rankAway: 3,
    read: () =>
      readOne(
        "ga",
        "https://earthquakes.ga.gov.au/geoserver/earthquakes/wfs?service=WFS&request=getfeature&typeNames=earthquakes:earthquakes_seven_days&outputFormat=application/json",
        async (r) => normalizeGa(await r.json()),
      ),
  },
  {
    key: "nrcan",
    name: "Earthquakes Canada",
    home: [[-141, 41.5, -52, 84]],
    rankAway: 3,
    read: (now) =>
      readOne("nrcan", `https://www.earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?starttime=${since(now)}&format=text`,
        async (r) => normalizeFdsnText(await r.text(), NRCAN_FDSN), "text/plain"),
  },
  {
    key: "bmkg",
    name: "BMKG",
    home: [[95, -11, 141, 6]],
    rankAway: 3,
    read: async () => {
      const lists = ["gempadirasakan", "gempaterkini"];
      const reads = await Promise.all(
        lists.map((l) =>
          readOne(`bmkg:${l}`, `https://data.bmkg.go.id/DataMKG/TEWS/${l}.json`, async (r) => normalizeBmkg(await r.json())),
        ),
      );
      const failed = reads.filter((r) => !r.ok);
      // The felt list and the M5+ list can hold the same quake under the same id.
      const rows = [...new Map(reads.flatMap((r) => r.rows).map((f) => [f.id, f])).values()];
      return failed.length
        ? { key: "bmkg", ok: false, rows, reason: failed[0]!.reason }
        : { key: "bmkg", ok: true, rows };
    },
  },
  {
    key: "ign",
    name: "IGN Spain",
    home: [[-32, 27, 5, 44.5]],
    rankAway: 3,
    read: () =>
      readOne("ign", "https://www.ign.es/ign/RssTools/sismologia.xml", async (r) => normalizeIgn(await r.text()),
        "application/rss+xml"),
  },
  {
    key: "usgs",
    name: "USGS",
    home: US,
    rankAway: 1,
    read: () =>
      readOne("usgs", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", async (r) =>
        normalizeUsgs(await r.json(), { keepNonQuakes: true }),
      ),
  },
  {
    key: "geofon",
    name: "GFZ GEOFON",
    home: [],
    rankAway: 2,
    read: (now) =>
      readOne("geofon", `https://geofon.gfz.de/fdsnws/event/1/query?starttime=${since(now)}&format=text`,
        async (r) => normalizeFdsnText(await r.text(), GEOFON_FDSN), "text/plain"),
  },
  {
    key: "emsc",
    name: "EMSC",
    home: [],
    rankAway: 4,
    read: (now) => readOne("emsc", emscEndpoint(now), async (r) => normalizeEmsc(await r.json())),
  },
];

export const EARTHQUAKES_ATTRIBUTION =
  "Earthquake data: U.S. Geological Survey (USGS); EMSC-CSEM (CC BY 4.0); GeoNet / GNS Science (CC BY 3.0 NZ); " +
  "INGV (CC BY 4.0); GFZ GEOFON (CC BY 4.0); Geoscience Australia (CC BY 4.0); Source: Japan Meteorological Agency; " +
  "Natural Resources Canada (Earthquakes Canada); BMKG; Instituto Geográfico Nacional (CC BY 4.0)";

/** Pure: the rank of one row of one catalogue (lower is preferred). */
export function quakeRank(cat: Pick<QuakeCatalogue, "home" | "rankAway">, row: Pick<SignalFeature, "lat" | "lon">): number {
  return cat.home.some((b) => inBox(row.lat, row.lon, b)) ? 0 : cat.rankAway;
}

const isQuake = (f: SignalFeature) => {
  const t = String(f.props?.type ?? "earthquake").trim().toLowerCase();
  return t === "" || t === "earthquake";
};

/**
 * Pure: the catalogues' answers → the layer. No network, no clock of its own.
 *
 * Rows outside the window are dropped first. Rows that are one event are grouped
 * (clusterQuakes); a group is dropped when ANY catalogue in it types the event as
 * something other than an earthquake (USGS and INGV type blasts; EMSC does not, so
 * its copy of a USGS "explosion" would otherwise survive as a quake). The shown row
 * gets `catalogue` and `reportedBy`.
 */
export function mergeQuakeReads(
  reads: readonly CatalogueRead[],
  now: number,
  catalogues: readonly QuakeCatalogue[] = QUAKE_CATALOGUES,
): SignalFeature[] {
  const byKey = new Map(catalogues.map((c, i) => [c.key, { c, i }]));
  const from = now - QUAKE_WINDOW_HOURS * 3_600_000;
  const to = now + 10 * 60_000; // a little clock skew, never a future event

  const entries: (QuakeEntry & { order: number })[] = [];
  for (const read of reads) {
    const hit = byKey.get(read.key);
    if (!hit) continue;
    for (const row of read.rows) {
      const t = row.ts ? Date.parse(row.ts) : Number.NaN;
      if (!Number.isFinite(t) || t < from || t > to) continue;
      if (hit.c.onlyHome && !hit.c.home.some((b) => inBox(row.lat, row.lon, b))) continue;
      entries.push({ row, catalogue: read.key, rank: quakeRank(hit.c, row), order: hit.i });
    }
  }
  // Catalogue order breaks a rank tie, because clusterQuakes keeps input order.
  entries.sort((a, b) => a.order - b.order);

  const out: SignalFeature[] = [];
  for (const group of clusterQuakes(entries)) {
    if (!group.every((e) => isQuake(e.row))) continue;
    const shown = group[0]!;
    const names = group.map((e) => {
      const m = e.row.props?.magnitude;
      const name = byKey.get(e.catalogue)!.c.name;
      return typeof m === "number" && m !== 0 ? `${name} (M${m.toFixed(1)})` : name;
    });
    const { type: _type, ...props } = shown.row.props ?? {};
    out.push({
      ...shown.row,
      props: { ...props, catalogue: byKey.get(shown.catalogue)!.c.name, reportedBy: names.join(", ") },
    });
  }
  out.sort((a, b) => Date.parse(b.ts ?? "") - Date.parse(a.ts ?? ""));
  return out;
}

/** Pure: fold the reads into the outcome-tagged layer. */
export function quakeLayerFrom(
  reads: readonly CatalogueRead[],
  now: number,
  catalogues: readonly QuakeCatalogue[] = QUAKE_CATALOGUES,
): SignalFeature[] {
  const okReads = reads.filter((r) => r.ok);
  const failed = reads.filter((r) => !r.ok);
  const nameOf = (k: string) => catalogues.find((c) => c.key === k)?.name ?? k;
  if (okReads.length === 0 && reads.every((r) => r.rows.length === 0)) {
    return degraded(failed[0]?.reason ?? "every catalogue failed", now);
  }
  const rows = markCoverage(mergeQuakeReads(reads, now, catalogues), {
    noun: "events",
    rule:
      `events in the past ${QUAKE_WINDOW_HOURS} hours from ${okReads.length} of ${reads.length} catalogues, ` +
      "each event shown once (USGS is complete to about M2.5 in the US and M4.5 elsewhere; national agencies add smaller local events)",
  });
  if (failed.length > 0) {
    return degradedWith(rows, `partial: ${failed.map((f) => nameOf(f.key)).join(", ")} failed (${failed[0]!.reason})`, now);
  }
  return observed(rows, now);
}

export const EARTHQUAKES_SOURCE: SignalSource = {
  id: "earthquakes",
  // An instrument-located epicentre.
  precision: "exact",
  label: "Earthquakes",
  group: "Natural hazards",
  color: "#f97316",
  refreshMs: 60_000, // USGS regenerates its summary feed about every minute
  attribution: EARTHQUAKES_ATTRIBUTION,
  metric: { field: "magnitude", domain: [2, 8] }, // Richter → magnitude bar (lime→red ramp)
  async fetch() {
    const now = Date.now();
    const reads = await Promise.all(QUAKE_CATALOGUES.map((c) => c.read(now)));
    return quakeLayerFrom(reads, now);
  },
};
