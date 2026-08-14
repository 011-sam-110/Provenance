import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, groupByCountry } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";

// Live botnet command-and-control servers — keyless abuse.ch Feodo Tracker. The
// feed is a conservative, high-confidence list of currently-tracked C2s (Emotet,
// QakBot, IcedID, …), each with an ISO-2 country but no precise location, so we
// AGGREGATE by country and plot one marker per country at its centroid, sized by
// the number of C2s hosted there. Often sparse (only active C2s) — that's honest;
// it swells during a live campaign. Confirmed keyless 2026-06-27.

const ENDPOINT = "https://feodotracker.abuse.ch/downloads/ipblocklist.json";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const FEODO_ATTRIBUTION = "Botnet C2 data © abuse.ch Feodo Tracker (CC0)";

interface FeodoRow {
  ip_address?: string;
  status?: string; // "online" | "offline"
  country?: string | null; // ISO-3166 alpha-2
  as_name?: string | null;
  malware?: string | null;
  last_online?: string | null;
}

/** Red ramp by the number of C2 servers in a country. */
export function c2Color(n: number): string {
  if (n >= 20) return "#7f1d1d";
  if (n >= 8) return "#b91c1c";
  if (n >= 3) return "#dc2626";
  return "#ef4444";
}

/** Pure: Feodo rows → one aggregated SignalFeature per country (with a known centroid). */
export function normalizeFeodoC2(rows: FeodoRow[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const [cc, list] of groupByCountry(rows, (r) => r.country)) {
    const ctr = centroidByIso2(cc);
    if (!ctr) continue;
    const online = list.filter((r) => r.status === "online").length;
    const malware = [...new Set(list.map((r) => r.malware).filter(Boolean))] as string[];
    out.push({
      id: `cyber-c2:${cc}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${list.length} botnet C2${list.length === 1 ? "" : "s"}`,
      signalId: "cyber-c2",
      color: c2Color(list.length),
      // Snapshot of currently-tracked infrastructure — no per-feature `ts` (the
      // time-window filter shouldn't hide a live threat picture; lastSeen is a prop).
      props: {
        country: ctr.name,
        c2Servers: list.length,
        online,
        offline: list.length - online,
        malware: malware.length ? malware.join(", ") : "—",
        magnitude: countMagnitude(list.length),
      },
    });
  }
  return out;
}

export const CYBER_C2_SOURCE: SignalSource = {
  id: "cyber-c2",
  label: "Botnet C2 servers",
  group: "Cyber threat",
  color: "#dc2626",
  refreshMs: 900_000, // abuse.ch refreshes the blocklist a few times an hour
  attribution: FEODO_ATTRIBUTION,
  // Real scalar: active C2 servers tracked in that country (not the radius proxy).
  // Calm ≈ a lone C2; extreme ≈ the ramp's top bucket (a country hosting a swarm).
  metric: { field: "c2Servers", domain: [1, 20] },
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as FeodoRow[];
      // An empty blocklist is a real answer (the feed is often sparse); a body that
      // is not a list at all is not.
      return Array.isArray(json) ? observed(normalizeFeodoC2(json)) : degraded("bad json");
    } catch {
      return degraded("fetch failed");
    }
  },
};
