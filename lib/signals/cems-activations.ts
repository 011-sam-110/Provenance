import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";
import { markCoverage } from "@/lib/signals/coverage";

// Copernicus EMS Rapid Mapping activations — where the EU is mapping a disaster now.
//
// An activation is a request from a national authority (or a UN / EU body) for
// satellite damage and extent maps of one disaster. It says something no hazard feed
// says: that a response is under way here, and that maps of it exist. Each one links
// to its own page of maps, and many carry the GDACS event they answer (`gdacsId`).
// Added 2026-10-16 from the source audit of the GDACS layer.
//
// What is shown: every activation CEMS has not closed, plus every one activated in
// the last 30 days, closed or not. Read from the public dashboard API of the Rapid
// Mapping service, newest first, one page of 50 (2026-10-16: the newest 50 reached
// back to June, so 30 days fit with room to spare; a full page is stated as capped).
//
// Licence: CEMS On-Demand Mapping terms allow free reproduction and distribution with
// the source cited: "© European Union, Copernicus Emergency Management Service".
// The point is the activation's centroid (the centre of its areas of interest), an
// anchor inside the affected area, so precision is "area".

const ENDPOINT = "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=50";
export const CEMS_PAGE_LIMIT = 50;
export const CEMS_RECENT_DAYS = 30;
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const CEMS_ATTRIBUTION = "© European Union, Copernicus Emergency Management Service (Rapid Mapping)";

interface CemsActivation {
  code?: string;
  name?: string;
  countries?: string[];
  category?: string;
  centroid?: string;
  eventTime?: string;
  activationTime?: string;
  lastUpdate?: string;
  closed?: boolean;
  gdacsId?: string | null;
  n_aois?: number;
  n_products?: number;
}

/** Pure: "POINT (lon lat)" → {lat, lon}, or null. */
export function parseWktPoint(wkt: string | undefined): { lat: number; lon: number } | null {
  const m = /^\s*POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)\s*$/i.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

const utc = (s: string | undefined) => {
  if (!s) return undefined;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

const CATEGORY_COLOR: Record<string, string> = {
  earthquake: "#f97316",
  flood: "#2563eb",
  wildfire: "#dc2626",
  storm: "#7c3aed",
  "volcanic activity": "#b91c1c",
};

/** Pure: one page of activations → the open ones and those of the last 30 days. */
export function normalizeCems(page: { results?: CemsActivation[] }, now: number): SignalFeature[] {
  const raw = page.results ?? [];
  const from = now - CEMS_RECENT_DAYS * 86_400_000;
  const out: SignalFeature[] = [];
  for (const a of raw) {
    const code = (a.code ?? "").trim();
    const at = parseWktPoint(a.centroid);
    if (!code || !at) continue;
    const activated = utc(a.activationTime);
    const recent = activated ? Date.parse(activated) >= from : false;
    if (a.closed === true && !recent) continue;
    const category = (a.category ?? "").trim() || "Emergency";
    out.push({
      id: `cems:${code}`,
      ...at,
      title: `${code}: ${(a.name ?? category).trim()}`,
      signalId: "cems-activations",
      color: CATEGORY_COLOR[category.toLowerCase()] ?? "#0f766e",
      link: `https://mapping.emergency.copernicus.eu/activations/${encodeURIComponent(code)}`,
      ts: activated,
      props: {
        category,
        countries: (a.countries ?? []).join(", ") || "—",
        status: a.closed ? "closed (maps delivered)" : "open",
        event: utc(a.eventTime)?.slice(0, 16).replace("T", " ") ?? "—",
        activated: activated?.slice(0, 16).replace("T", " ") ?? "—",
        maps: typeof a.n_products === "number" ? a.n_products : "—",
        ...(a.gdacsId ? { gdacs: a.gdacsId } : {}),
      },
    });
  }
  // The page is newest first. If it ends before the window starts, the window is
  // complete; only a full page that is still inside the window may hide rows.
  const oldest = Math.min(...raw.map((a) => Date.parse(utc(a.activationTime) ?? "")).filter(Number.isFinite));
  const complete = raw.length < CEMS_PAGE_LIMIT || oldest < from;
  return markCoverage(out, {
    noun: "activations",
    rule: `every open activation and every one of the last ${CEMS_RECENT_DAYS} days`,
    ...(complete ? {} : { upstream: { limit: CEMS_PAGE_LIMIT, count: raw.length } }),
  });
}

export const CEMS_ACTIVATIONS_SOURCE: SignalSource = {
  id: "cems-activations",
  // The centre of the activation's areas of interest, not the place of an event.
  precision: "area",
  label: "Emergency mapping (Copernicus EMS)",
  group: "Natural hazards",
  color: "#0f766e",
  refreshMs: 30 * 60 * 1000,
  attribution: CEMS_ATTRIBUTION,
  async fetch() {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return degraded(`http ${res.status}`);
      return observed(normalizeCems((await res.json()) as { results?: CemsActivation[] }, Date.now()));
    } catch (e) {
      return degraded((e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed");
    }
  },
};
