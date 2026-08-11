import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap } from "@/lib/signals/coverage";
import { recordCredentialRefusal } from "@/lib/sources/upstreamEvidence";

// Real-time ship tracking — AISStream.io (free WebSocket). AISStream streams live
// vessel positions; there is no REST snapshot, so the adapter opens the socket
// IN-REQUEST, subscribes to the strategic chokepoint boxes, accumulates the latest
// PositionReport per vessel for a few seconds, then closes and returns the snapshot.
// The registry caches the result (refreshMs), so the socket only opens occasionally.
// Key-gated: set AISSTREAM_API_KEY (free, no card); dormant (→ []) until then.
// Coverage is terrestrial-station AIS (~200 km offshore), so mid-ocean is patchy.

const WS_URL = "wss://stream.aisstream.io/v0/stream";
const WS_HOST = new URL(WS_URL).hostname;

/**
 * Pure: is this the text of an AISStream auth failure, as opposed to some other
 * `{"error": ...}` frame (malformed subscription, throttling)? AISStream answers
 * an invalid/rejected APIKey with exactly `{"error": "Api Key Is Not Valid"}` and
 * closes the socket — confirmed against aisstream/issues#174. Matched loosely
 * (case-insensitive, "api key" + a rejection word) rather than on the exact
 * string so a wording tweak upstream does not silently stop being detected.
 */
export function isAisCredentialError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /api\s*key/i.test(message) && /(not\s*valid|invalid|unauthoriz)/i.test(message);
}

/** A named strategic maritime chokepoint + its bounding box [[swLat,swLon],[neLat,neLon]]. */
export interface Chokepoint {
  name: string;
  bbox: [[number, number], [number, number]];
}

/** Strategic maritime chokepoints (the intel-relevant water) the AIS layer watches. */
export const CHOKEPOINTS: Chokepoint[] = [
  { name: "Strait of Hormuz", bbox: [[24, 54], [27, 58]] },
  { name: "Red Sea – Bab-el-Mandeb", bbox: [[12, 32], [31, 44]] }, // → Suez
  { name: "English Channel", bbox: [[48, -6], [52, 3]] },
  { name: "Malacca – Singapore", bbox: [[1, 98], [6, 105]] },
  { name: "Strait of Gibraltar", bbox: [[35.7, -6.2], [36.3, -5]] },
  { name: "Bosphorus", bbox: [[40.9, 28.8], [41.3, 29.2]] },
  { name: "Panama Canal", bbox: [[8, -80.5], [9.6, -79]] },
  { name: "Taiwan Strait", bbox: [[21.5, 119], [25.5, 122]] },
  { name: "Danish Straits", bbox: [[55, 10], [58, 13]] }, // Baltic approaches
];

/** The bounding boxes in the raw [[swLat,swLon],[neLat,neLon]] shape AISStream subscribes to. */
const CHOKEPOINT_BOXES: number[][][] = CHOKEPOINTS.map((c) => c.bbox);

/** Pure: which chokepoint a position falls in (first match), or undefined for open water. */
export function chokepointFor(lat: number, lon: number): string | undefined {
  for (const c of CHOKEPOINTS) {
    const [[swLat, swLon], [neLat, neLon]] = c.bbox;
    if (lat >= swLat && lat <= neLat && lon >= swLon && lon <= neLon) return c.name;
  }
  return undefined;
}

/** Cap on vessels returned (keeps a busy snapshot legible). */
export const AIS_CAP = 1200;
/** How long to accumulate position reports per refresh. */
const COLLECT_MS = 4500;

export const AISSTREAM_ATTRIBUTION = "Vessel positions © AISStream.io";

export interface AisVessel {
  MMSI?: number;
  ShipName?: string;
  latitude?: number | null;
  longitude?: number | null;
  Sog?: number | null; // speed over ground (kt)
  Cog?: number | null; // course over ground (deg)
  TrueHeading?: number | null;
  NavigationalStatus?: number | null;
  time_utc?: string;
}

/** AIS navigational-status code → label (the common ones). */
export function navStatusLabel(code: number | null | undefined): string {
  switch (code) {
    case 0: return "under way (engine)";
    case 1: return "at anchor";
    case 2: return "not under command";
    case 3: return "restricted manoeuvrability";
    case 4: return "constrained by draught";
    case 5: return "moored";
    case 6: return "aground";
    case 7: return "fishing";
    case 8: return "under way (sailing)";
    default: return "—";
  }
}

/** "YYYY-MM-DD HH:MM:SS.sss +0000 UTC" (AISStream) → ISO, or undefined. */
function aisTimeToIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Pure: AISStream vessel snapshots → SignalFeature[]. Skips vessels with no position. */
export function normalizeAis(vessels: AisVessel[]): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const v of vessels) {
    const lat = typeof v.latitude === "number" ? v.latitude : Number.NaN;
    const lon = typeof v.longitude === "number" ? v.longitude : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (!v.MMSI) continue;
    const name = (v.ShipName ?? "").trim() || `MMSI ${v.MMSI}`;
    const sog = typeof v.Sog === "number" ? v.Sog : null;
    const moving = sog != null && sog > 0.5;
    const cp = chokepointFor(lat, lon);
    out.push({
      id: `ais:${v.MMSI}`,
      lat,
      lon,
      title: name,
      signalId: "ais",
      color: moving ? "#0d9488" : "#64748b", // under way = teal, stationary = slate
      ts: aisTimeToIso(v.time_utc),
      props: {
        vessel: name,
        mmsi: v.MMSI,
        speed: sog != null ? `${sog.toFixed(1)} kt` : "—",
        // Numeric sibling of `speed` so the chokepoint board can aggregate honestly.
        ...(sog != null ? { speedKt: sog } : {}),
        course: typeof v.Cog === "number" ? `${Math.round(v.Cog)}°` : "—",
        heading: typeof v.TrueHeading === "number" && v.TrueHeading !== 511 ? `${v.TrueHeading}°` : "—",
        status: navStatusLabel(v.NavigationalStatus),
        ...(cp ? { chokepoint: cp } : {}),
      },
    });
  }
  // TWO truncations, and the second is the one that matters: collectAis() closes
  // the socket the moment it has AIS_CAP distinct vessels, so a saturated snapshot
  // is a sample of the traffic in the collection window, not a count of the ships
  // at the chokepoints. `available` is therefore a lower bound, and says so.
  return applyCap(out, AIS_CAP, {
    noun: "vessels",
    rule: "the first seen in the ~4.5s collection window — not a ranking",
    upstream: { limit: AIS_CAP, count: vessels.length },
  });
}

/** Open the AISStream socket, accumulate latest PositionReport per vessel, then close. */
async function collectAis(key: string, ms: number): Promise<AisVessel[]> {
  return new Promise((resolve) => {
    const seen = new Map<number, AisVessel>();
    let settled = false;
    const decoder = new TextDecoder();
    let ws: WebSocket;
    const done = () => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      resolve([...seen.values()]);
    };
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      resolve([]);
      return;
    }
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(done, ms);
    ws.onopen = () => {
      ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: CHOKEPOINT_BOXES, FilterMessageTypes: ["PositionReport"] }));
    };
    ws.onmessage = (e: MessageEvent) => {
      const txt = typeof e.data === "string" ? e.data : decoder.decode(e.data as ArrayBuffer);
      try {
        const m = JSON.parse(txt) as {
          error?: string;
          MessageType?: string;
          MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string };
          Message?: { PositionReport?: { Sog?: number; Cog?: number; TrueHeading?: number; NavigationalStatus?: number } };
        };
        // upstreamEvidence.ts wraps fetch() to catch 401/402/403s, which structurally
        // cannot see this — AIS speaks WebSocket. This is the one AISStream frame that
        // genuinely means "our credential was rejected" (not a timeout, not a closed
        // socket, not just zero PositionReports), so it is the only case that files a
        // refusal. Status 401 stands in for "invalid credential" — there is no real
        // HTTP status here, but the ledger's shape expects one and 401 is the honest
        // read of "Api Key Is Not Valid".
        if (typeof m.error === "string" && isAisCredentialError(m.error)) {
          recordCredentialRefusal("ais", 401, WS_HOST);
          clearTimeout(timer);
          done();
          return;
        }
        const mmsi = m.MetaData?.MMSI;
        if (m.MessageType !== "PositionReport" || !mmsi) return;
        const md = m.MetaData!, pr = m.Message?.PositionReport ?? {};
        seen.set(mmsi, {
          MMSI: mmsi, ShipName: md.ShipName, latitude: md.latitude, longitude: md.longitude,
          Sog: pr.Sog, Cog: pr.Cog, TrueHeading: pr.TrueHeading, NavigationalStatus: pr.NavigationalStatus,
          time_utc: md.time_utc,
        });
        if (seen.size >= AIS_CAP) { clearTimeout(timer); done(); }
      } catch { /* skip malformed frame */ }
    };
    ws.onerror = () => { clearTimeout(timer); done(); };
    ws.onclose = () => { clearTimeout(timer); done(); };
  });
}

export const AIS_SOURCE: SignalSource = {
  id: "ais",
  label: "Ships (AIS chokepoints)",
  group: "Maritime",
  color: "#0d9488",
  refreshMs: 60_000, // re-open the socket at most ~once a minute
  attribution: AISSTREAM_ATTRIBUTION,
  sourceUrl: "https://aisstream.io/", // real-time AIS stream (dossier source)
  async fetch() {
    const key = (process.env.AISSTREAM_API_KEY ?? "").trim();
    if (!key) return []; // dormant until the free key is set
    try {
      const vessels = await collectAis(key, COLLECT_MS);
      return normalizeAis(vessels);
    } catch {
      return [];
    }
  },
};
