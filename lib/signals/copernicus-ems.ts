// Copernicus Emergency Management Service — Rapid Mapping activations.
//
// An activation is the EU mapping a disaster on request: the impact-grade events, few
// of them (267 since the service began; 13 activations from mid-August to mid-October
// 2026). Each has a code (EMSR934), a category, a centroid and, when GDACS also
// tracks the event, its GDACS id. One keyless JSON list feeds three layers — floods,
// wildfires and severe storms — through one cached read.
//
// Licence: Copernicus EMS free and open data policy (Reg. (EU) 1159/2013). Credit
// "© European Union, Copernicus Emergency Management Service".
//
// Audited 2026-10-16 (sources-audit/eonet.md, candidate 9), re-probed the same evening.

import type { SignalFeature } from "@/lib/signals/types";
import { getJson } from "@/lib/signals/multiInput";

export const CEMS_ATTRIBUTION = "© European Union, Copernicus Emergency Management Service";
export const CEMS_LIST_URL =
  "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=400";

export interface CemsActivation {
  code?: string;
  countries?: string[];
  eventTime?: string;
  name?: string;
  centroid?: string;
  activationTime?: string;
  category?: string;
  lastUpdate?: string;
  closed?: boolean;
  gdacsId?: string | null;
}

/** "POINT (-80.67 8.00)" → { lon, lat }, or null. */
export function parseWktPoint(wkt: string | undefined): { lon: number; lat: number } | null {
  const m = /^\s*POINT\s*\(\s*(-?[\d.]+(?:e-?\d+)?)\s+(-?[\d.]+(?:e-?\d+)?)\s*\)\s*$/i.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat };
}

/** The activation's page on the Rapid Mapping portal. */
export function cemsLink(code: string): string {
  return `https://mapping.emergency.copernicus.eu/activations/${encodeURIComponent(code)}/`;
}

/** Copernicus's own naive timestamps are UTC. */
function utcMs(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Pure: activations of one category → features for one layer. An activation is kept
 * while it is open, or when its event happened inside `maxAgeDays` of `now`.
 * The centroid stands for a mapped area, so every feature is `area`.
 */
export function cemsToFeatures(
  list: CemsActivation[],
  opts: { category: string; signalId: string; color: string; maxAgeDays: number; now: number },
): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const a of list) {
    if ((a.category ?? "").toLowerCase() !== opts.category.toLowerCase()) continue;
    const code = (a.code ?? "").trim();
    if (!code) continue;
    const at = utcMs(a.eventTime) ?? utcMs(a.activationTime);
    const recent = at != null && opts.now - at <= opts.maxAgeDays * 86_400_000;
    if (a.closed !== false && !recent) continue;
    const pt = parseWktPoint(a.centroid);
    if (!pt) continue;
    out.push({
      id: `${opts.signalId}:cems:${code}`,
      lat: pt.lat,
      lon: pt.lon,
      title: `${(a.name ?? code).trim().replace(/\.$/, "")} (${code})`,
      signalId: opts.signalId,
      precision: "area",
      color: opts.color,
      link: cemsLink(code),
      ts: at != null ? new Date(at).toISOString() : undefined,
      props: {
        source: "Copernicus EMS Rapid Mapping",
        activation: code,
        countries: (a.countries ?? []).join(", ") || "—",
        activated: a.activationTime?.slice(0, 16) ?? "—",
        status: a.closed === false ? "open" : "closed",
        ...(a.gdacsId ? { gdacsId: a.gdacsId } : {}),
      },
    });
  }
  return out;
}

/**
 * Pure: fold activations into a layer whose GDACS events they may already be.
 *
 * Copernicus names the GDACS event it mapped ("FL1104124"). When that event is on the
 * layer, the activation is attached to it as `copernicusEms` instead of a second pin
 * at nearly the same place.
 */
export function attachCemsToGdacs(gdacs: SignalFeature[], cems: SignalFeature[]): SignalFeature[] {
  const onLayer = new Set(gdacs.map((f) => String(f.props?.gdacsEventId ?? "")).filter(Boolean));
  const attached = new Map<string, SignalFeature>();
  const extra: SignalFeature[] = [];
  for (const c of cems) {
    const gid = String(c.props?.gdacsId ?? "").replace(/^[A-Z]{2}/, "");
    if (gid && onLayer.has(gid)) attached.set(gid, c);
    else extra.push(c);
  }
  const merged = gdacs.map((f) => {
    const c = attached.get(String(f.props?.gdacsEventId ?? ""));
    return c ? { ...f, props: { ...f.props, copernicusEms: c.props?.activation, copernicusEmsLink: c.link } } : f;
  });
  return [...merged, ...extra];
}

// --- shared cached read ---------------------------------------------------------

const TTL_MS = 10 * 60 * 1000;
let cache: { list: CemsActivation[]; at: number } | null = null;
let inflight: Promise<CemsActivation[]> | null = null;

/** The activation list, cached for 10 minutes across the three layers. Throws on failure. */
export async function fetchCemsActivations(now: number = Date.now()): Promise<CemsActivation[]> {
  if (cache && now - cache.at < TTL_MS) return cache.list;
  if (!inflight) {
    inflight = getJson<{ results?: CemsActivation[] }>(CEMS_LIST_URL, 20_000)
      .then((json) => {
        const list = json?.results ?? [];
        cache = { list, at: Date.now() };
        return list;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
