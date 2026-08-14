import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { countMagnitude } from "@/lib/signals/aggregate";
import { markCoverage } from "@/lib/signals/coverage";
import { degraded, observed } from "@/lib/signals/outcome";

// ACLED — real-time armed-conflict & protest events with actor attribution and
// fatality counts. The canonical "is the line moving today" source. Key-gated:
// it uses an OAuth2 password grant (free myACLED account → ACLED_EMAIL +
// ACLED_PASSWORD). Dormant-safe: no creds, or an account whose API access isn't
// yet activated (the read returns 403 "Access denied"), simply yields [].
//
// Auth flow (per https://acleddata.com/api-documentation/getting-started):
//   POST https://acleddata.com/oauth/token
//     username, password, grant_type=password, client_id=acled, scope=authenticated
//   GET  https://acleddata.com/api/acled/read?... with  Authorization: Bearer <token>

const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

/** Page size asked of the ACLED read API. A full page means there are more events. */
export const ACLED_PAGE_LIMIT = 2000;
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const ACLED_ATTRIBUTION = "Conflict data © ACLED (acleddata.com)";

interface AcledRow {
  event_id_cnty?: string;
  event_date?: string;
  event_type?: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country?: string;
  admin1?: string;
  location?: string;
  latitude?: string | number;
  longitude?: string | number;
  fatalities?: string | number;
  notes?: string;
  source?: string;
}

/** ACLED event_type → colour. */
export function acledColor(eventType: string): string {
  switch (eventType) {
    case "Battles": return "#dc2626";
    case "Violence against civilians": return "#7f1d1d";
    case "Explosions/Remote violence": return "#9333ea";
    case "Riots": return "#ea580c";
    case "Protests": return "#f59e0b";
    case "Strategic developments": return "#64748b";
    default: return "#64748b";
  }
}

function num(v: string | number | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;
  const s = (v ?? "").toString().trim();
  if (s === "") return Number.NaN; // empty cell — Number("") is 0, so guard first
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Pure: ACLED read payload → SignalFeature[]. Skips rows with no/garbled coords.
 * The read API is paged at `limit`; a saturated page means the map is showing a
 * slice of the conflict record, so the payload publishes that rather than letting
 * the count pass for a total.
 */
export function normalizeAcled(
  json: { data?: AcledRow[] },
  limit = ACLED_PAGE_LIMIT,
): SignalFeature[] {
  const rows = json.data ?? [];
  const out: SignalFeature[] = [];
  for (const e of rows) {
    const lat = num(e.latitude);
    const lon = num(e.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const id = (e.event_id_cnty ?? "").trim();
    if (!id) continue;
    const eventType = e.event_type?.trim() || "Event";
    const fatalities = Math.max(0, num(e.fatalities) || 0);
    const place = e.location?.trim() || e.country?.trim() || "Unknown";
    const actors = [e.actor1, e.actor2].map((a) => a?.trim()).filter(Boolean).join(" vs ");
    out.push({
      id: `acled:${id}`,
      lat,
      lon,
      title: `${eventType} — ${place}`,
      signalId: "acled",
      color: acledColor(eventType),
      ts: e.event_date ?? undefined,
      props: {
        eventType,
        subType: e.sub_event_type?.trim() || "—",
        actors: actors || "—",
        country: e.country?.trim() || "—",
        fatalities,
        ...(e.notes?.trim() ? { notes: e.notes.trim().slice(0, 240) } : {}),
        source: e.source?.trim() || "—",
        date: e.event_date ?? "—",
        // fatal events grow; non-fatal stay at a visible base radius.
        magnitude: fatalities > 0 ? Math.max(2, countMagnitude(fatalities)) : 2,
      },
    });
  }
  return markCoverage(out, {
    noun: "conflict events",
    rule: "the first page the ACLED read API returned",
    upstream: { limit, count: rows.length },
  });
}

// --- token cache (module-scoped; refreshed on demand) -----------------------
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(email: string, password: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    username: email,
    password,
    grant_type: "password",
    client_id: "acled",
    scope: "authenticated",
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 86_400) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

export const ACLED_SOURCE: SignalSource = {
  id: "acled",
  label: "Conflict events (ACLED)",
  group: "Conflict",
  color: "#dc2626",
  refreshMs: 30 * 60 * 1000,
  attribution: ACLED_ATTRIBUTION,
  async fetch() {
    const email = (process.env.ACLED_EMAIL ?? "").trim();
    const password = (process.env.ACLED_PASSWORD ?? "").trim();
    if (!email || !password) return degraded("no key"); // dormant until creds are set
    const token = await getToken(email, password);
    if (!token) return degraded("token request failed");
    try {
      const res = await fetch(`${READ_URL}?limit=${ACLED_PAGE_LIMIT}&_format=json`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      // e.g. 403 "Access denied" until API access is activated
      if (!res.ok) return degraded(`http ${res.status}`);
      const json = (await res.json()) as { data?: AcledRow[] };
      return observed(normalizeAcled(json));
    } catch {
      return degraded("fetch failed");
    }
  },
};
