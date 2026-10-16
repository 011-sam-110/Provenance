import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";

// Top attacking networks — the SANS Internet Storm Center's DShield Recommended Block List.
//
// WHAT IT IS. The 20 /24 networks that the most DShield sensors reported scanning or
// attacking them over the last three days, each with the network's name and its
// registered country. Updated several times a day. Keyless; licensed CC BY-NC-SA 2.5
// (stated in the file's own header), so it is credited, and the non-commercial term is
// a condition on this layer.
//
// WHAT IT IS NOT. These are SCANNERS and attackers, not botnet command servers, which is
// why this is a sibling of the C2 layer and not part of it (audited 2026-10-16). Many of
// the top networks are research scanners and cloud ranges (Censys, Google Cloud), so a
// country here says where noisy networks are REGISTERED, not who is attacking whom.
//
// One feature per country with any of the 20 networks; a network with no registered
// country ("-") is counted and named, never placed. The file's contact e-mail column is
// never read into a feature.

const ENDPOINT = "https://feeds.dshield.org/block.txt";
const UA = "Provenance/2.0 (+https://provenance-online.com)";

export const DSHIELD_ATTRIBUTION = "Attack sources: SANS Internet Storm Center DShield (CC BY-NC-SA 2.5)";

export interface DshieldBlock {
  /** "64.62.197.0/24" */
  network: string;
  /** Targets reporting scans from it over the last three days. */
  targets: number;
  /** The registered network name, when the file gives one. */
  name?: string;
  /** ISO-2 of the registration, when the file gives one. */
  country?: string;
}

/** Pure: block.txt → its rows, plus the file's own "updated" time when it states one. */
export function parseDshieldBlocklist(text: string): { blocks: DshieldBlock[]; updated?: number } {
  const blocks: DshieldBlock[] = [];
  let updated: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = /updated:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(line);
      if (m) {
        const t = Date.parse(`${m[1]}Z`);
        if (Number.isFinite(t)) updated = t;
      }
      continue;
    }
    const c = raw.split("\t");
    if (c.length < 4) continue;
    const start = c[0]!.trim();
    const bits = c[2]!.trim();
    const targets = Number(c[3]);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(start) || !Number.isFinite(targets)) continue;
    const name = (c[4] ?? "").trim();
    const cc = (c[5] ?? "").trim().toUpperCase();
    blocks.push({
      network: `${start}/${bits || "24"}`,
      targets,
      name: name && name !== "-" ? name : undefined,
      country: /^[A-Z]{2}$/.test(cc) ? cc : undefined,
    });
  }
  return { blocks, updated };
}

/** Pure: blocks → one feature per registered country. */
export function normalizeDshield(blocks: DshieldBlock[]): SignalFeature[] {
  const byCountry = new Map<string, DshieldBlock[]>();
  for (const b of blocks) {
    if (!b.country) continue;
    let list = byCountry.get(b.country);
    if (!list) byCountry.set(b.country, (list = []));
    list.push(b);
  }
  const unplaced = blocks.filter((b) => !b.country);
  const out: SignalFeature[] = [];
  for (const [cc, list] of byCountry) {
    const ctr = centroidByIso2(cc);
    if (!ctr) continue;
    list.sort((a, b) => b.targets - a.targets);
    const targets = list.reduce((s, b) => s + b.targets, 0);
    out.push({
      id: `cyber-attackers:${cc}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${list.length} of the top ${blocks.length} attacking networks`,
      signalId: "cyber-attackers",
      countryIso3: ctr.iso3,
      color: list.length >= 4 ? "#9a3412" : list.length >= 2 ? "#c2410c" : "#ea580c",
      props: {
        country: ctr.name,
        networks: list.length,
        topNetworks: list
          .slice(0, 6)
          .map((b) => `${b.network}${b.name ? ` (${b.name})` : ""}: ${b.targets} targets`)
          .join("; "),
        targetsReporting: targets,
        magnitude: countMagnitude(list.length * 10),
        ...(unplaced.length
          ? { unplaced: `${unplaced.length} of the top ${blocks.length} networks have no registered country and are not on the map.` }
          : {}),
        meaning: "Networks registered in this country that DShield sensors saw scanning or attacking. Not who is behind them.",
      },
    });
  }
  return out.sort((a, b) => Number(b.props?.networks) - Number(a.props?.networks));
}

export const CYBER_ATTACKERS_SOURCE: SignalSource = {
  id: "cyber-attackers",
  // A count for each country, on its centroid.
  precision: "country",
  label: "Top attacking networks",
  group: "Cyber threat",
  color: "#c2410c",
  refreshMs: 60 * 60 * 1000,
  attribution: DSHIELD_ATTRIBUTION,
  sourceUrl: "https://feeds.dshield.org/block.txt",
  metric: { field: "networks", domain: [1, 10] },
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, { headers: { "User-Agent": UA, Accept: "text/plain" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return degraded(`http ${res.status}`);
      const { blocks, updated } = parseDshieldBlocklist(await res.text());
      // The list always holds 20 networks. None at all is a broken file, not a quiet internet.
      if (blocks.length === 0) return degraded("empty block list");
      return observed(normalizeDshield(blocks), Date.now(), updated);
    } catch {
      return degraded("fetch failed");
    }
  },
};
