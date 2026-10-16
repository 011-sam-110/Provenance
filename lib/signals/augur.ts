// EUROCONTROL AUGUR — one public JSON document behind augur.eurocontrol.int's map,
// read for two layers:
//
//   • "GNSS INTERFERENCE <yyyymmdd>": EUROCONTROL's own daily measurement of GNSS
//     interference over Europe (High / Medium / Low MultiPolygons, plus a Coverage
//     polygon). It joins the `gpsJamming` layer (gpsjam.ts) as a second, independent
//     daily source, on the same H3 grid.
//   • "EGNOS & GNSS NOTAMs": the NOTAMs national air navigation service providers
//     issued, filtered to jamming / interference / spoofing warnings. They are the
//     `gnss-notams` layer (gnss-notams.ts).
//
// Keyless. No licence is stated on AUGUR (its disclaimer: "as-is, informational");
// the eurocontrol.int site terms allow redistribution with "© EUROCONTROL".
// robots.txt asks for a 10 s crawl delay; this module reads the document at most once
// every 6 hours and shares that one read between both layers.
//
// The document is a JSON ARRAY of layers whose ORDER is not promised (the audit found
// the interference layer at index 3), so layers are found by `name`, never by index.

export const AUGUR_URL = "https://augur.eurocontrol.int/map_layers/fixed_map_layers/";
export const AUGUR_ATTRIBUTION = "© EUROCONTROL AUGUR";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const TTL_MS = 6 * 60 * 60 * 1000;

type Ring = [number, number][];

export interface AugurLayer {
  type?: string;
  name?: string;
  time_scope?: string;
  features?: {
    id?: string;
    geometry?: { type?: string; coordinates?: unknown };
    properties?: { notams?: { notam_text?: string }[] } & Record<string, unknown>;
  }[];
}

export type InterferenceLevel = "High" | "Medium" | "Low";

export interface AugurInterference {
  /** The day as AUGUR states it, e.g. "15 Oct 2026". */
  day: string;
  /** One anchor point per polygon part, with its level. */
  parts: { lat: number; lon: number; level: InterferenceLevel }[];
}

/** Pure: find a layer by its name prefix. */
export function augurLayer(doc: unknown, prefix: string): AugurLayer | undefined {
  if (!Array.isArray(doc)) return undefined;
  return doc.find(
    (l): l is AugurLayer => !!l && typeof l === "object" && String((l as AugurLayer).name ?? "").startsWith(prefix),
  );
}

function ringCentre(ring: Ring): [number, number] | null {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  if (!pts.length) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  lon /= pts.length;
  lat /= pts.length;
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/**
 * Pure: the "GNSS INTERFERENCE" layer → one anchor per polygon part. Keeps High and
 * Medium only: Low held 4,376 parts on 2026-10-15 (most of the measured area) and is
 * what "some degradation somewhere" looks like, not jamming.
 */
export function parseAugurInterference(doc: unknown): AugurInterference | null {
  const layer = augurLayer(doc, "GNSS INTERFERENCE");
  if (!layer) return null;
  const parts: AugurInterference["parts"] = [];
  for (const f of layer.features ?? []) {
    const level: InterferenceLevel | null =
      f.id === "HighInterference" ? "High" : f.id === "MediumInterference" ? "Medium" : null;
    if (!level || f.geometry?.type !== "MultiPolygon" || !Array.isArray(f.geometry.coordinates)) continue;
    for (const poly of f.geometry.coordinates as Ring[][]) {
      const c = Array.isArray(poly) && Array.isArray(poly[0]) ? ringCentre(poly[0]) : null;
      if (c) parts.push({ lat: c[0], lon: c[1], level });
    }
  }
  return { day: String(layer.time_scope ?? "").trim(), parts };
}

export interface GnssNotam {
  /** FIR + NOTAM number, e.g. "EVRR 3951/26". Unique. */
  id: string;
  fir: string;
  number: string;
  lat: number;
  lon: number;
  radiusNm: number;
  /** ISO start / end; end undefined for PERM. */
  from: string;
  to?: string;
  /** The NOTAM's E) text, whitespace folded. */
  text: string;
}

/** "5546N02229E" → [lat, lon]. */
export function parseQCoord(s: string): [number, number] | null {
  const m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/.exec(s.trim());
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
  return [lat, lon];
}

/** "2610160800" (yymmddhhmm, UTC) → ISO. */
export function notamTime(s: string): string | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  return `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

const JAMMING = /JAMM|INTERFERENCE|SPOOF/i;

/**
 * Pure: the "EGNOS & GNSS NOTAMs" layer → the jamming / interference / spoofing
 * NOTAMs in force at `now`, one per FIR + number (AUGUR repeats a FIR-wide NOTAM on
 * every aerodrome in the FIR: 650 rows for 9 NOTAMs on 2026-10-16). The place is the
 * NOTAM's own Q-line centre and radius.
 */
export function parseGnssNotams(doc: unknown, now: number): GnssNotam[] {
  const layer = augurLayer(doc, "EGNOS & GNSS NOTAMs");
  const out = new Map<string, GnssNotam>();
  for (const f of layer?.features ?? []) {
    for (const n of f.properties?.notams ?? []) {
      const t = n.notam_text ?? "";
      if (!JAMMING.test(t)) continue;
      const q = /Q\)\s*([^\n]*)/.exec(t)?.[1]?.trim().split("/") ?? [];
      const fir = (q[0] ?? "").trim();
      const centre = q[7] ? parseQCoord(q[7]) : null;
      const radiusNm = Number(q[8]);
      const number = /E\)\s*(\d{4}\/\d{2})/.exec(t)?.[1] ?? /^\s*([A-Z]?\d{4}\/\d{2})/.exec(t)?.[1];
      const from = notamTime(/B\)\s*(\d{10})/.exec(t)?.[1] ?? "");
      const cRaw = /C\)\s*(\S+)/.exec(t)?.[1] ?? "";
      const to = /^PERM/i.test(cRaw) ? undefined : notamTime(cRaw);
      if (!fir || !centre || !Number.isFinite(radiusNm) || !number || !from) continue;
      if (Date.parse(from) > now || (to && Date.parse(to) < now)) continue;
      const id = `${fir} ${number}`;
      if (out.has(id)) continue;
      const e = t.indexOf("E)");
      const text = (e >= 0 ? t.slice(e + 2) : t).replace(/^\s*\d{4}\/\d{2}\s+NOTAM[NRC]\s*/, "").replace(/\s+/g, " ").trim();
      out.set(id, { id, fir, number, lat: centre[0], lon: centre[1], radiusNm, from, ...(to ? { to } : {}), text });
    }
  }
  return [...out.values()];
}

/** Pure: a circle of `radiusNm` nautical miles as a closed [lon, lat] ring. */
export function circleRing(lat: number, lon: number, radiusNm: number, steps = 48): [number, number][] {
  const R = 6371;
  const d = (radiusNm * 1.852) / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * (i % steps)) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([Math.round(((((λ2 * 180) / Math.PI + 540) % 360) - 180) * 1e4) / 1e4, Math.round(((φ2 * 180) / Math.PI) * 1e4) / 1e4]);
  }
  return ring;
}

// --- the one shared read ----------------------------------------------------------

let doc: { value: unknown; at: number } | null = null;
let inflight: Promise<{ value: unknown; at: number } | null> | null = null;

/**
 * The AUGUR document, read at most once per 6 h for both layers. Resolves to the last
 * good copy (with its read time) when a re-read fails, and to null when there has
 * never been one. Never rejects.
 */
export function readAugur(): Promise<{ value: unknown; at: number; ok: boolean } | null> {
  if (doc && Date.now() - doc.at < TTL_MS) return Promise.resolve({ ...doc, ok: true });
  if (!inflight) {
    inflight = fetch(AUGUR_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`http ${res.status}`);
        const value: unknown = await res.json();
        if (!Array.isArray(value)) throw new Error("not an array");
        doc = { value, at: Date.now() };
        return doc;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight.then((fresh) => (fresh ? { ...fresh, ok: true } : doc ? { ...doc, ok: false } : null));
}

/** Test-only. */
export function __resetAugur(): void {
  doc = null;
  inflight = null;
}
