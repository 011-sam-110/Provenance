import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { countMagnitude, groupByCountry } from "@/lib/signals/aggregate";
import { degraded, observed } from "@/lib/signals/outcome";

// Botnet command-and-control servers — keyless abuse.ch Feodo Tracker. Each row has an
// ISO-2 country but no precise location, so we AGGREGATE by country and plot one
// marker per country at its centroid, sized by the number of C2s hosted there.
//
// THE FEED IS EMPTY, AND THE LAYER SAYS SO (audited 2026-10-16). abuse.ch prints "Our
// Feodo Tracker datasets are currently empty" on every page: the takedowns of Emotet
// (2021) and Operation Endgame (2024) removed every live C2 of the families it tracks.
// The blocklist still held 5 leftover IPs, last online 2026-03-12, and the file had not
// changed since 2026-06-30. The old adapter drew them as "3 countries, 1 online", and
// the "online" one had not been seen for seven months. So:
//   - a C2 counts only when abuse.ch saw it online within C2_CURRENT_DAYS;
//   - "online" is believed only when that last sighting is within C2_ONLINE_DAYS,
//     because a frozen file keeps the status of its very last check forever;
//   - a list with nothing current is a DEGRADED read that names the newest sighting,
//     never `observed([])`, which would read as "no botnets anywhere".
// The replacement (Shadowserver's daily C2 counts) is fetched by the relay host, not
// here; abuse.ch ThreatFox is on hold for a licence decision.

const ENDPOINT = "https://feodotracker.abuse.ch/downloads/ipblocklist.json";
const UA = "Provenance/2.0 (+https://github.com/011-sam-110/Provenance)";

/** No longer "(CC0)": since 2025-11-04 the abuse.ch Terms of Use govern the data. */
export const FEODO_ATTRIBUTION = "Botnet C2 data © abuse.ch Feodo Tracker (abuse.ch Terms of Use)";

/** A C2 last seen online longer ago than this is history, not current infrastructure. */
export const C2_CURRENT_DAYS = 30;
/** The upstream's `status: "online"` is believed only when its last sighting is this recent. */
export const C2_ONLINE_DAYS = 2;

const DAY_MS = 86_400_000;

export interface FeodoRow {
  ip_address?: string;
  status?: string; // "online" | "offline"
  country?: string | null; // ISO-3166 alpha-2
  as_name?: string | null;
  malware?: string | null;
  last_online?: string | null; // "YYYY-MM-DD"
}

/** Red ramp by the number of C2 servers in a country. */
export function c2Color(n: number): string {
  if (n >= 20) return "#7f1d1d";
  if (n >= 8) return "#b91c1c";
  if (n >= 3) return "#dc2626";
  return "#ef4444";
}

/** Epoch ms of a row's last sighting, read as a UTC day. Undefined when absent or garbled. */
export function feodoLastOnline(r: FeodoRow): number | undefined {
  const raw = typeof r.last_online === "string" ? r.last_online.trim() : "";
  if (!raw) return undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  return Number.isFinite(t) ? t : undefined;
}

/** Pure: the rows abuse.ch saw online within C2_CURRENT_DAYS of `now`. */
export function currentFeodoRows(rows: FeodoRow[], now: number = Date.now()): FeodoRow[] {
  return rows.filter((r) => {
    const t = feodoLastOnline(r);
    return t !== undefined && now - t <= C2_CURRENT_DAYS * DAY_MS;
  });
}

/** Pure: newest sighting across the whole list, as YYYY-MM-DD. */
export function newestFeodoSighting(rows: FeodoRow[]): string | undefined {
  let best = 0;
  for (const r of rows) {
    const t = feodoLastOnline(r);
    if (t !== undefined && t > best) best = t;
  }
  return best ? new Date(best).toISOString().slice(0, 10) : undefined;
}

/**
 * Pure: Feodo rows → one aggregated SignalFeature per country (with a known centroid).
 * Only CURRENT rows count (see the header); a stale "online" is reported as offline.
 */
export function normalizeFeodoC2(rows: FeodoRow[], now: number = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const [cc, list] of groupByCountry(currentFeodoRows(rows, now), (r) => r.country)) {
    const ctr = centroidByIso2(cc);
    if (!ctr) continue;
    const online = list.filter((r) => {
      const t = feodoLastOnline(r);
      return r.status === "online" && t !== undefined && now - t <= C2_ONLINE_DAYS * DAY_MS;
    }).length;
    const malware = [...new Set(list.map((r) => r.malware).filter(Boolean))] as string[];
    out.push({
      id: `cyber-c2:${cc}`,
      lat: ctr.lat,
      lon: ctr.lon,
      title: `${ctr.name} — ${list.length} botnet C2${list.length === 1 ? "" : "s"}`,
      signalId: "cyber-c2",
      countryIso3: ctr.iso3,
      color: c2Color(list.length),
      // Snapshot of currently-tracked infrastructure — no per-feature `ts` (the
      // time-window filter shouldn't hide a live threat picture; lastSeen is a prop).
      props: {
        country: ctr.name,
        c2Servers: list.length,
        online,
        offline: list.length - online,
        malware: malware.length ? malware.join(", ") : "—",
        lastSeen: newestFeodoSighting(list) ?? "—",
        magnitude: countMagnitude(list.length),
      },
    });
  }
  return out;
}

/**
 * Pure: what one read of the blocklist means. `reason` is set when nothing in it is
 * current — the feed answered, but with history, so the read is degraded, not quiet.
 */
export function readFeodo(
  rows: FeodoRow[],
  now: number = Date.now(),
): { features: SignalFeature[]; reason?: string; newest?: string } {
  const features = normalizeFeodoC2(rows, now);
  const newest = newestFeodoSighting(rows);
  if (features.length > 0) return { features, newest };
  if (rows.length === 0) return { features, reason: "Feodo Tracker dataset is empty" };
  return { features, newest, reason: `no current C2s; newest sighting ${newest ?? "unknown"}` };
}

export const CYBER_C2_SOURCE: SignalSource = {
  id: "cyber-c2",
  // A count for each country, placed on a centroid.
  precision: "country",
  label: "Botnet C2 servers",
  group: "Cyber threat",
  color: "#dc2626",
  // The file has not changed since 2026-06-30; hourly is more than it needs.
  refreshMs: 3_600_000,
  attribution: FEODO_ATTRIBUTION,
  // Real scalar: current C2 servers tracked in that country (not the radius proxy).
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
      if (!Array.isArray(json)) return degraded("bad json");
      const now = Date.now();
      const { features, reason, newest } = readFeodo(json, now);
      if (reason) return degraded(reason, now);
      const sourceAt = newest ? Date.parse(`${newest}T00:00:00Z`) : undefined;
      return observed(features, now, sourceAt);
    } catch {
      return degraded("fetch failed");
    }
  },
};
