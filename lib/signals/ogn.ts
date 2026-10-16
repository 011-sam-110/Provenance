import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, observed } from "@/lib/signals/outcome";

// Gliders and other FLARM / OGN-tracked aircraft, from the Open Glider Network.
//
// WHY A LAYER OF ITS OWN. Gliders, paragliders, hang gliders, tow planes and many
// light helicopters carry FLARM or an OGN tracker, not an ADS-B transponder, so the
// planes layer never sees them. OGN is a volunteer receiver network for those
// trackers, dense over Europe. Different aircraft, different radio, different
// network: a new layer, not an upstream of the planes one.
//
// THE FEED. `https://live.glidernet.org/lxml.php` is the endpoint OGN's own live map
// polls: one XML marker per device, the comma-separated fields read by that map's
// ogn.js (`gesmark`): lat, lon, competition id, registration, altitude (m), time,
// seconds since last fix, track, ground speed (km/h), climb (m/s), aircraft type,
// receiver, device id, hash. Probed 2026-10-16 from provenance-1: 200, 1,349 markers
// world-wide at 20:14 UTC, of which 650 were type 0 (unknown) and 586 type 9 (jet):
// OGN also relays ADS-B traffic now, hashed. Those are dropped here, since the planes
// layer draws ADS-B; so is type 8 ("plane"), where the same relay put a 713 km/h
// airliner-height aircraft. KEPT_TYPES below is what is left.
//
// TERMS (https://www.glidernet.org/ogn-data-usage/): "Data provided by OGN are under
// the licence ODbL." Redistribution must follow the device database's privacy choices
// and must not include data older than 24 hours. So:
//   - a device whose DDB entry says tracked = N is dropped (OGN's own map already
//     omits them: 0 of 65 matched devices on 2026-10-16, checked anyway);
//   - a device whose DDB entry says identified = N shows no registration or
//     competition id, and when the DDB cannot be read, NO device shows one;
//   - a device OGN does not know (device id 0) carries a hash, never a registration;
//   - nothing older than OGN's own online rule (600 s since the last fix) is drawn,
//     far inside the 24 hour limit.
// The DDB (https://ddb.glidernet.org/download/?j=1&t=1, 36,765 devices, 5.5 MB) is
// read at most once a day.

export const OGN_LXML_URL = "https://live.glidernet.org/lxml.php?a=0&b=90&c=-90&d=180&e=-180";
export const OGN_DDB_URL = "https://ddb.glidernet.org/download/?j=1&t=1";
export const OGN_ATTRIBUTION = "Glider and FLARM data © Open Glider Network (ODbL)";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/** OGN's own online rule (ogn.js: `ddf < 600`). */
export const MAX_FIX_AGE_S = 600;
export const DDB_TTL_MS = 24 * 60 * 60 * 1000;

/** OGN aircraft types, as ogn.js names them, that are kept. */
export const KEPT_TYPES: Readonly<Record<number, string>> = {
  1: "Glider / motor glider",
  2: "Tow plane",
  3: "Helicopter",
  4: "Parachute",
  5: "Drop plane",
  6: "Hang glider",
  7: "Paraglider",
  11: "Balloon",
  12: "Airship",
  13: "Drone",
};

export interface DdbEntry {
  tracked: boolean;
  identified: boolean;
}

/** Pure: the DDB download → device id → privacy choices. */
export function parseDdb(json: unknown): Map<string, DdbEntry> {
  const out = new Map<string, DdbEntry>();
  const devices = (json as { devices?: unknown })?.devices;
  if (!Array.isArray(devices)) return out;
  for (const d of devices as Record<string, unknown>[]) {
    const id = typeof d.device_id === "string" ? d.device_id.trim().toUpperCase() : "";
    if (!id) continue;
    out.set(id, { tracked: d.tracked !== "N", identified: d.identified !== "N" });
  }
  return out;
}

/** Pure: lxml.php's XML → the `a` attribute of every marker, split. */
export function parseLxml(xml: string): string[][] {
  const out: string[][] = [];
  for (const m of xml.matchAll(/<m\s+a="([^"]*)"\s*\/>/g)) out.push(m[1].split(","));
  return out;
}

const num = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Pure: markers → features. `ddb` null means the device database could not be read:
 * every device is then shown without its registration or competition id.
 */
export function normalizeOgn(markers: readonly string[][], ddb: Map<string, DdbEntry> | null): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const f of markers) {
    if (f.length < 14) continue;
    const lat = num(f[0]);
    const lon = num(f[1]);
    if (lat == null || lon == null || lat <= -90 || lat >= 90 || lon < -180 || lon > 180) continue;
    const type = num(f[10]);
    const typeLabel = type == null ? undefined : KEPT_TYPES[type];
    if (!typeLabel) continue;
    const ageS = num(f[6]);
    if (ageS == null || ageS < 0 || ageS >= MAX_FIX_AGE_S) continue;

    const deviceId = f[12].trim().toUpperCase();
    const known = deviceId !== "" && deviceId !== "0";
    const entry = known ? ddb?.get(deviceId) : undefined;
    if (entry && !entry.tracked) continue;
    // Shown only for a device the DDB knows and lets us identify.
    const mayIdentify = known && ddb != null && (entry ? entry.identified : true);
    const registration = mayIdentify ? f[3].trim() : "";
    const cn = mayIdentify && !f[2].startsWith("_") ? f[2].trim() : "";

    const hash = f[13].trim();
    const id = `ogn:${hash || `${lat.toFixed(4)},${lon.toFixed(4)}`}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const altM = num(f[4]);
    const speed = num(f[8]);
    const climb = num(f[9]);
    const track = num(f[7]);
    out.push({
      id,
      lat,
      lon,
      title: `${registration || typeLabel}${registration ? ` — ${typeLabel}` : ""}`,
      signalId: "gliders",
      color: "#0d9488",
      props: {
        type: typeLabel,
        registration: registration || "—",
        ...(cn ? { competitionId: cn } : {}),
        altitude: altM == null ? "—" : `${Math.round(altM).toLocaleString()} m`,
        ...(altM != null ? { altitudeM: altM } : {}),
        speed: speed == null ? "—" : `${Math.round(speed)} km/h`,
        climb: climb == null ? "—" : `${climb.toFixed(1)} m/s`,
        heading: track == null ? "—" : `${Math.round(track)}°`,
        lastFix: `${Math.round(ageS)} s ago`,
        receiver: f[11].trim() || "—",
      },
    });
  }
  return out;
}

// The DDB, held for a day; the last good copy is kept when a refresh fails.
const DDB_KEY = Symbol.for("provenance.ogn.ddb.v1");
type DdbCache = { at: number; value: Map<string, DdbEntry> };
function ddbCache(): { current?: DdbCache } {
  const g = globalThis as unknown as Record<symbol, { current?: DdbCache } | undefined>;
  return (g[DDB_KEY] ??= {});
}

async function readDdb(now: number): Promise<Map<string, DdbEntry> | null> {
  const c = ddbCache();
  if (c.current && now - c.current.at < DDB_TTL_MS) return c.current.value;
  try {
    const res = await fetch(OGN_DDB_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const value = parseDdb(await res.json());
    if (!value.size) throw new Error("empty");
    c.current = { at: now, value };
    return value;
  } catch {
    return c.current?.value ?? null; // last good, else hide every registration
  }
}

export const GLIDERS_SOURCE: SignalSource = {
  id: "gliders",
  // A reported tracker position.
  precision: "exact",
  label: "Gliders & FLARM",
  group: "Aviation",
  color: "#0d9488",
  refreshMs: 60_000,
  attribution: OGN_ATTRIBUTION,
  metric: { field: "altitudeM", domain: [0, 6000], unit: " m" },
  async fetch() {
    const now = Date.now();
    try {
      const [res, ddb] = await Promise.all([
        fetch(OGN_LXML_URL, {
          headers: { "User-Agent": UA, Accept: "text/xml" },
          signal: AbortSignal.timeout(15_000),
        }),
        readDdb(now),
      ]);
      if (!res.ok) return degraded(`http ${res.status}`);
      return observed(normalizeOgn(parseLxml(await res.text()), ddb), now);
    } catch (err) {
      return degraded(err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable");
    }
  },
};
