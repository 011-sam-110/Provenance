import type { SignalFeature } from "@/lib/signals/types";
import { centroidByIso2 } from "@/lib/signals/country-centroids.data";
import { IODA_REGIONS } from "@/lib/signals/ioda-regions.data";

// Internet shutdowns — Internet Society Pulse. The "intentional shutdown" tier of
// the internet-outages layer: shutdowns that Pulse has logged with a cause
// (elections, exams, protests, government action, war), a type and a verification
// level. It fills IODA's known weak point, mobile-only and regional cuts, which IODA
// measures from outside and often misses.
//
// Key-gated: ISOC_PULSE_API_KEY (a free Pulse account → API token). Dormant without
// it: the layer still serves IODA. TERMS (pulse.internetsociety.org/terms): no
// commercial use, no redistribution, and the words "Provided by Internet Society"
// must be shown. That is why each pin carries them, and why the layer attribution
// names Pulse. If Provenance ever charges, this feed needs written permission.
//
// Pulse refreshes daily at best and asks callers not to poll more often than they
// need, so the read is held for PULSE_TTL_MS on globalThis, whatever the layer's
// own refresh.

export const PULSE_URL = "https://pulse-api.internetsociety.org/shutdowns";
export const PULSE_CREDIT = "Provided by Internet Society";
/** Shutdowns that ended within this window are still shown, marked ended. */
export const PULSE_RECENT_MS = 7 * 24 * 3600_000;
const PULSE_TTL_MS = 6 * 3600_000;

/** One row of /shutdowns, as the Pulse OpenAPI (v1.1.0) describes ShutdownSummary. */
export interface PulseShutdown {
  /** ISO 3166-1 alpha-2. */
  country?: string;
  start_date?: string;
  end_date?: string | null;
  /** "national" | "regional" | "content_blocking". */
  type?: string;
  /** "confirmed" | "acknowledged" | "unconfirmed". */
  verification_level?: string;
  cause?: string;
  affected_regions?: string;
  affected_services?: string[];
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Region names by country, folded, for matching Pulse's free-text region list. */
let byCountry: Map<string, { name: string; folded: string; lat: number; lon: number }[]> | null = null;
function regionsOf(iso2: string) {
  if (!byCountry) {
    byCountry = new Map();
    for (const [name, cc, lat, lon] of Object.values(IODA_REGIONS)) {
      let list = byCountry.get(cc);
      if (!list) byCountry.set(cc, (list = []));
      list.push({ name, folded: fold(name), lat, lon });
    }
  }
  return byCountry.get(iso2) ?? [];
}

/**
 * Pure: the admin-1 region a Pulse "affected_regions" text names, in that country,
 * or undefined. A region matches when its whole name appears as words in the text
 * ("National Capital Territory of Delhi" → Delhi). The longest match wins, so a
 * short name inside a longer one cannot steal it. No fuzzy spelling: "Balochistan"
 * does not match "Baluchistan", and that shutdown stays at country level.
 */
export function matchPulseRegion(iso2: string, text: string | undefined) {
  const t = ` ${fold(text ?? "")} `;
  if (t.trim() === "") return undefined;
  let best: { name: string; lat: number; lon: number } | undefined;
  let bestLen = 0;
  for (const r of regionsOf(iso2)) {
    if (r.folded.length > bestLen && t.includes(` ${r.folded} `)) {
      best = r;
      bestLen = r.folded.length;
    }
  }
  return best;
}

const label = (s: string | undefined) => (s ?? "").replace(/_/g, " ").trim();

/**
 * Pure: Pulse rows → features. Keeps network shutdowns (national and regional) that
 * are still running or ended within PULSE_RECENT_MS of `now`. Content blocking (a
 * social network blocked, the rest of the internet up) is a different thing from an
 * outage and is left out of this layer.
 *
 * A national shutdown is a country figure. A regional one is placed inside the
 * region Pulse names when the region table knows it; otherwise it stays a country
 * mark WITHOUT the country outline, because shading a whole country for a cut in one
 * province would overstate it.
 */
export function normalizePulse(json: { data?: PulseShutdown[] }, now: number = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const r of json.data ?? []) {
    const type = r.type ?? "";
    if (type !== "national" && type !== "regional") continue;
    const cc = (r.country ?? "").trim().toUpperCase();
    const c = centroidByIso2(cc);
    if (!c) continue;
    const start = Date.parse(r.start_date ?? "");
    if (!Number.isFinite(start)) continue;
    const end = r.end_date ? Date.parse(r.end_date) : Number.NaN;
    const ongoing = !Number.isFinite(end);
    if (!ongoing && now - end > PULSE_RECENT_MS) continue;
    if (start > now) continue;

    const region = type === "regional" ? matchPulseRegion(cc, r.affected_regions) : undefined;
    const where = region ? `${region.name}, ${c.name}` : c.name;
    const verification = r.verification_level ?? "unconfirmed";
    const services = (r.affected_services ?? []).filter(Boolean);
    out.push({
      id: `pulse:${Math.floor(start / 1000)}:${cc}`,
      lat: region ? region.lat : c.lat,
      lon: region ? region.lon : c.lon,
      precision: region ? "area" : "country",
      // Only a NATIONAL shutdown stands for the whole country, so only it may shade it.
      ...(type === "national" ? { countryIso3: c.iso3 } : {}),
      title: `${ongoing ? "Internet shutdown" : "Internet shutdown (ended)"} — ${where}`,
      signalId: "internet-outages",
      color: "#7f1d1d",
      ts: new Date(start).toISOString(),
      link: "https://pulse.internetsociety.org/shutdowns",
      props: {
        source: PULSE_CREDIT,
        country: c.name,
        countryCode: cc,
        ...(region ? { region: region.name } : {}),
        state: ongoing ? "ongoing" : "ended",
        shutdownType: label(type),
        cause: label(r.cause) || "not stated",
        verification: verification,
        affectedRegions: r.affected_regions?.trim() || (type === "national" ? "whole country" : "not stated"),
        affectedServices: services.length ? services.join(", ") : "not stated",
        startedAt: new Date(start).toISOString(),
        ...(ongoing ? {} : { endedAt: new Date(end).toISOString() }),
        // A verified, deliberate cut is the strongest thing this layer can say.
        severity: verification === "unconfirmed" ? "elevated" : "severe",
        magnitude: verification === "unconfirmed" ? 7 : 9,
      },
    });
  }
  return out;
}

/** True when the Pulse row is one the instability index should count as a crackdown. */
export function isVerifiedShutdown(f: SignalFeature): boolean {
  const p = f.props ?? {};
  return p.source === PULSE_CREDIT && p.state === "ongoing" && (p.verification === "confirmed" || p.verification === "acknowledged");
}

interface PulseCache {
  key: string;
  at: number;
  rows: PulseShutdown[];
}
const CACHE = Symbol.for("provenance.pulse.shutdowns");
type Holder = { [CACHE]?: PulseCache };

/**
 * The Pulse rows, or null when there is no key or no answer. Held for PULSE_TTL_MS;
 * a failed refresh keeps the last good rows, because a daily dataset does not go
 * stale in an hour.
 */
export async function fetchPulse(): Promise<PulseShutdown[] | null> {
  const key = (process.env.ISOC_PULSE_API_KEY ?? "").trim();
  if (!key) return null; // dormant until the free token is set
  const holder = globalThis as Holder;
  const cached = holder[CACHE];
  if (cached && cached.key === key && Date.now() - cached.at < PULSE_TTL_MS) return cached.rows;
  try {
    const res = await fetch(PULSE_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return cached?.key === key ? cached.rows : null;
    const json = (await res.json()) as { data?: PulseShutdown[] };
    const rows = Array.isArray(json.data) ? json.data : [];
    holder[CACHE] = { key, at: Date.now(), rows };
    return rows;
  } catch {
    return cached?.key === key ? cached.rows : null;
  }
}
