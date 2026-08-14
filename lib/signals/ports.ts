import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { MAJOR_PORTS, type PortRecord } from "@/lib/signals/ports.data";
import { degradedWith } from "@/lib/signals/outcome";

// Major seaports — a curated STATIC dataset (lib/signals/ports.data.ts) of the
// world's busiest container/cargo ports. Deliberately static, not live: there is
// no reliable keyless "major ports" feed (OSM tags ~3,000+ harbours with no size
// signal). See ports.data.ts for the source + date. Points only.

export const PORTS_ATTRIBUTION = "Major ports: curated from public busiest-port rankings (2023)";

/** When the curated list in ports.data.ts was compiled (see its header). The outcome
 *  stamps the age of the DATA, so these rows never read as a read that just happened. */
const COMPILED_AT = Date.parse("2026-06-27T00:00:00Z");

/** Stable slug for a namespaced feature id. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Coarse trade region for a port's ISO-3166-1 alpha-2 country — the asset-directory
 *  breakdown groups by this. Pure + unit-tested; covers every country in the dataset. */
export function portRegion(country: string | undefined): string {
  const R: Record<string, string> = {
    CN: "East Asia", HK: "East Asia", TW: "East Asia", KR: "East Asia", JP: "East Asia",
    SG: "SE Asia", MY: "SE Asia", TH: "SE Asia", PH: "SE Asia", VN: "SE Asia", ID: "SE Asia",
    IN: "South Asia", LK: "South Asia", BD: "South Asia", PK: "South Asia",
    AE: "Middle East", SA: "Middle East", OM: "Middle East", QA: "Middle East", TR: "Middle East", KW: "Middle East",
    NL: "Europe", BE: "Europe", DE: "Europe", ES: "Europe", GR: "Europe", GB: "Europe", IT: "Europe", FR: "Europe", PL: "Europe", SE: "Europe", PT: "Europe",
    US: "North America", CA: "North America",
    MX: "Latin America", BR: "Latin America", CO: "Latin America", AR: "Latin America", PE: "Latin America", PA: "Latin America", CL: "Latin America", EC: "Latin America",
    ZA: "Africa", EG: "Africa", MA: "Africa", NG: "Africa", KE: "Africa", DJ: "Africa", TZ: "Africa",
    AU: "Oceania", NZ: "Oceania", PG: "Oceania",
  };
  return R[(country ?? "").toUpperCase()] ?? "Other";
}

/** Pure: curated port records → SignalFeature[]. The list is ordered by 2023 container
 *  throughput, so the array position IS the published rank — carried as `rank` (1-based)
 *  for the leaderboard, alongside the derived trade `region`. No throughput number is
 *  invented (the source publishes it, but it is not in this file). */
export function normalizePorts(records: PortRecord[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  records.forEach((p, i) => {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return;
    out.push({
      id: `port:${slug(p.name)}`,
      lat: p.lat,
      lon: p.lon,
      title: p.name,
      signalId: "ports",
      color: "#0891b2",
      props: {
        type: "Major seaport",
        rank: i + 1,
        ...(p.country ? { country: p.country, region: portRegion(p.country) } : {}),
      },
    });
  });
  return out;
}

export const PORTS_SOURCE: SignalSource = {
  id: "ports",
  label: "Major ports",
  group: "Infrastructure",
  kind: "asset", // permanent infrastructure → the asset-directory focus view, not the event template
  color: "#0891b2",
  refreshMs: 24 * 60 * 60 * 1000, // static data — long cadence
  attribution: PORTS_ATTRIBUTION,
  async fetch() {
    // No network: a curated static list, so this is trivially dormant-safe.
    // There is no upstream to have answered, so `observed()` would assert a live read
    // that never happens here. Keep every row — they are real and complete — and
    // declare the layer for what it is: a dated compilation, stamped when it was made.
    return degradedWith(normalizePorts(MAJOR_PORTS), "static dataset, no live feed", COMPILED_AT);
  },
};
