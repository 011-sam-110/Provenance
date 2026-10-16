import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { MAJOR_PORTS, type PortRecord } from "@/lib/signals/ports.data";
import { compiled } from "@/lib/signals/outcome";
import {
  EUROSTAT_THS_T,
  PLSCI,
  PLSCI_QUARTER,
  USACE_TONNAGE,
  USACE_YEAR,
} from "@/lib/signals/ports.stats.data";

// Major seaports — a curated STATIC dataset (lib/signals/ports.data.ts) of the
// world's busiest container/cargo ports. Deliberately static, not live: there is
// no reliable keyless "major ports" feed (OSM tags ~3,000+ harbours with no size
// signal). See ports.data.ts for the source + date. Points only.
//
// OFFICIAL FIGURES ON THE PINS (2026-10-16), joined by UN/LOCODE from
// ports.stats.data.ts (written by scripts/harvest-port-stats.mjs):
//   • UNCTAD's Port Liner Shipping Connectivity Index, quarterly, every port: the
//     layer's metric, so the directory ranks by a published number instead of by
//     file order.
//   • Eurostat gross weight of goods handled, quarterly, EU ports.
//   • USACE total tonnage, annual, US ports.

export const PORTS_ATTRIBUTION =
  "Major ports: curated from Wikipedia's List of busiest container ports (2023, CC BY-SA 4.0); " +
  "connectivity: UNCTADstat (CC BY 3.0 IGO); EU tonnage: Eurostat; US tonnage: USACE / BTS NTAD";

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

type Stats = {
  plsci: typeof PLSCI;
  eurostat: typeof EUROSTAT_THS_T;
  usace: typeof USACE_TONNAGE;
};
const STATS: Stats = { plsci: PLSCI, eurostat: EUROSTAT_THS_T, usace: USACE_TONNAGE };

const thousands = (n: number) => Math.round(n).toLocaleString("en-US");

/** Pure: the official figures for one LOCODE, as props. Empty when none applies. */
export function portStatProps(locode: string | undefined, stats: Stats = STATS): Record<string, unknown> {
  if (!locode) return {};
  const out: Record<string, unknown> = {};
  const c = stats.plsci[locode];
  if (c) {
    out.connectivity = c.value;
    out.connectivityQuarter = PLSCI_QUARTER;
    if (c.yearAgo) {
      const pct = ((c.value - c.yearAgo) / c.yearAgo) * 100;
      out.connectivityChange = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% on a year earlier`;
    }
  }
  const eu = stats.eurostat[locode];
  if (eu) out.goodsHandled = `${thousands(eu.thsTonnes)} thousand tonnes in ${eu.period} (Eurostat)`;
  const us = stats.usace[locode];
  if (us) {
    out.tonnage = `${(us.shortTons / 1e6).toFixed(1)} million short tons in ${USACE_YEAR}, US rank ${us.rank} (USACE)` +
      (us.parts.length > 1 ? `, ${us.parts.join(" + ")}` : "");
  }
  return out;
}

/** Pure: curated port records → SignalFeature[], with the derived trade `region`.
 *
 *  NO `rank`. Until 2026-10-16 each row carried `rank = array index + 1` on the claim
 *  that the file order was the published throughput order. It is not: after about
 *  #30 the file is grouped by region (31-34 = Tokyo, Yokohama, Nagoya, Kobe; 71 =
 *  Gothenburg), and the list misses about 15 ports that belong in a top 70. Prod
 *  served "#71" as a fact the source does not support. The order of this file means
 *  nothing; the directory now sorts by name. No throughput number is invented. */
export function normalizePorts(records: PortRecord[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  records.forEach((p) => {
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
        ...(p.locode ? { locode: p.locode } : {}),
        ...(p.country ? { country: p.country, region: portRegion(p.country) } : {}),
        ...portStatProps(p.locode),
      },
    });
  });
  return out;
}

export const PORTS_SOURCE: SignalSource = {
  id: "ports",
  // A named port.
  precision: "facility",
  label: "Major ports",
  group: "Infrastructure",
  kind: "asset", // permanent infrastructure → the asset-directory focus view, not the event template
  color: "#0891b2",
  refreshMs: 24 * 60 * 60 * 1000, // static data — long cadence
  attribution: PORTS_ATTRIBUTION,
  // UNCTAD's connectivity index, on its own scale ("average Q1 2023 = 100"); Shanghai,
  // the most connected port, read 2,439 in 2026 Q3.
  metric: { field: "connectivity", domain: [0, 2500] },
  directory: { codeKey: "locode", codeLabel: "UN/LOCODE" },
  async fetch() {
    // No network: a curated static list, so this is trivially dormant-safe.
    //
    // NOT degraded. There is no upstream to have failed, and marking it so rendered
    // "no answer" on the public ledger for a layer delivering a complete, correct
    // world. `observed()` is equally wrong — it would assert a live read that never
    // happens here, and the freshness classifier would then call it stale forever.
    // `compiled()` is the honest verb: ok, because nothing broke; basis "compiled",
    // so no consumer presents it as live; stamped when the list was actually made.
    return compiled(normalizePorts(MAJOR_PORTS), COMPILED_AT);
  },
};
