import type { AisVessel } from "@/lib/signals/ais";
import { shipTypeLabel } from "@/lib/signals/aisDigitraffic";

// Vessel positions from BarentsWatch Live AIS (Kystverket, the Norwegian Coastal
// Administration), licensed NLOD. Covers the Norwegian economic zone, Svalbard and
// Jan Mayen, which includes the Barents Sea and the North Cape approaches to
// Murmansk. The open data leaves out fishing vessels under 15 m and leisure craft
// under 45 m.
//
// Needs a free BarentsWatch API client (OAuth client credentials, scope "ais"):
// BARENTSWATCH_CLIENT_ID + BARENTSWATCH_CLIENT_SECRET. Dormant without them. The
// token is held until a minute before it expires. One POST to /v1/latest/combined
// returns the newest message per MMSI inside a polygon since a given time; the field
// names follow the published OpenAPI document
// (live.ais.barentswatch.no/live/openapi/ais/openapi.json, AisComboSimple).

export const BW_TOKEN_URL = "https://id.barentswatch.no/connect/token";
export const BW_LATEST_URL = "https://live.ais.barentswatch.no/v1/latest/combined";
export const BARENTSWATCH_CREDIT = "AIS data: Kystverket / BarentsWatch, NLOD";

/** One row of AisComboSimple. */
export interface BwAis {
  mmsi?: number;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedOverGround?: number | null;
  courseOverGround?: number | null;
  trueHeading?: number | null;
  navigationalStatus?: number | null;
  shipType?: number | null;
  msgtime?: string;
}

/** Pure: the request body for one bounding box [[swLat,swLon],[neLat,neLon]], since `sinceMs`. */
export function bwRequestBody(bbox: [[number, number], [number, number]], sinceMs: number) {
  const [[s, w], [n, e]] = bbox;
  return {
    modelType: "Simple",
    modelFormat: "Json",
    since: new Date(sinceMs).toISOString(),
    geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  };
}

/** Pure: BarentsWatch rows → vessels reported within `windowMs` of `now`. */
export function normalizeBarentswatch(rows: BwAis[], now: number, windowMs: number): AisVessel[] {
  const out: AisVessel[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(r.msgtime ?? "");
    if (!r.mmsi || !Number.isFinite(t) || now - t > windowMs) continue;
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
    out.push({
      MMSI: r.mmsi,
      ShipName: r.name?.trim() || undefined,
      latitude: r.latitude,
      longitude: r.longitude,
      Sog: r.speedOverGround ?? null,
      Cog: r.courseOverGround ?? null,
      TrueHeading: r.trueHeading ?? null,
      NavigationalStatus: r.navigationalStatus ?? null,
      time_utc: new Date(t).toISOString(),
      source: "BarentsWatch",
      shipType: shipTypeLabel(r.shipType),
    });
  }
  return out;
}

const TOKEN = Symbol.for("provenance.ais.barentswatch.token");
type Holder = { [TOKEN]?: { id: string; token: string; expiresAt: number } };

async function token(id: string, secret: string): Promise<string | null> {
  const holder = globalThis as Holder;
  const held = holder[TOKEN];
  if (held && held.id === id && Date.now() < held.expiresAt - 60_000) return held.token;
  try {
    const res = await fetch(BW_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, scope: "ais", grant_type: "client_credentials" }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    holder[TOKEN] = { id, token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  } catch {
    return null;
  }
}

/**
 * Recent BarentsWatch vessels inside `bbox`, or null when the client is not
 * configured or BarentsWatch did not answer.
 */
export async function fetchBarentswatch(bbox: [[number, number], [number, number]], windowMs: number): Promise<AisVessel[] | null> {
  const id = (process.env.BARENTSWATCH_CLIENT_ID ?? "").trim();
  const secret = (process.env.BARENTSWATCH_CLIENT_SECRET ?? "").trim();
  if (!id || !secret) return null; // dormant until the free API client exists
  const bearer = await token(id, secret);
  if (!bearer) return null;
  const now = Date.now();
  try {
    const res = await fetch(BW_LATEST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(bwRequestBody(bbox, now - windowMs)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return normalizeBarentswatch((await res.json()) as BwAis[], now, windowMs);
  } catch {
    return null;
  }
}
