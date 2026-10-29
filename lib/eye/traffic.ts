// The God's eye view's vessels and aircraft, the pure half: what each tag says, where
// a vessel's one-minute line ends, and the ledger rows. Pinned by
// tests/unit/eye-traffic.test.ts.
//
// EVERY MARK IS A REPORT. Vessels come from /api/eye/vessels (AISStream's whole-world
// stream on the server, Digitraffic, and BarentsWatch once its client is set; the
// console's chokepoint-only /api/signals/ais is not read here) and aircraft from
// /api/planes (adsb.lol). A mark sits where its last report put it and jumps when the
// next report lands: nothing is animated between reports, because an in-between
// position is a place nobody reported. The one-minute line shows where a vessel is
// heading at its reported speed and course; it is drawn as a line, not as a position.

import { destinationPoint } from "@/lib/cinematic/verbs";
import { AISSTREAM_ATTRIBUTION, type StreamState } from "@/lib/signals/ais";
import { DIGITRAFFIC_CREDIT } from "@/lib/signals/aisDigitraffic";
import { BARENTSWATCH_CREDIT } from "@/lib/signals/aisBarentswatch";
import { ADSB_ATTRIBUTION } from "@/lib/sources/adsb";
import { ofNearby, type LedgerRow } from "@/lib/eye/wording";

/** One /api/signals/ais feature, as the view reads it. */
export interface AisFeatureLike {
  id: string;
  lat: number;
  lon: number;
  title?: string;
  ts?: string;
  props?: {
    vessel?: string;
    speedKt?: number;
    course?: string;
    heading?: string;
    shipType?: string;
    source?: string;
    mmsi?: number;
    /** The adapter's navigational status in words, or "—" for none. */
    status?: string;
    destination?: string;
    callSign?: string;
    imo?: number;
    lengthM?: number;
    beamM?: number;
    draughtM?: number;
    /** "MM-DD" or "MM-DDTHH:MMZ", UTC. */
    eta?: string;
  };
}

/** One /api/planes row, as the view reads it. */
export interface PlaneLike {
  id: string;
  lat: number;
  lon: number;
  altKm?: number;
  heading?: number;
  label?: string;
  meta?: {
    callsign?: string;
    typeCode?: string;
    onGround?: boolean;
    registration?: string;
    velocityMs?: number | null;
    verticalRateMs?: number | null;
    squawk?: string;
    typeDescription?: string;
    typeLabel?: string;
    categoryTrusted?: boolean;
    /** Which network heard it; absent means adsb.lol. */
    network?: string;
    posSource?: string;
    posAgeS?: number;
    emergency?: string;
    selAltFt?: number;
  };
}

export interface Vessel {
  id: string;
  lat: number;
  lon: number;
  name: string;
  knots: number | null;
  course: number | null;
  moving: boolean;
  type?: string;
  /** Which feed heard it: AISStream, Digitraffic or BarentsWatch. */
  source: string;
  /** Where the chevron points: the course while under way, else the bow. */
  rot: number;
  /** Where the one-minute line ends, or null when there is no course to draw. */
  ahead: [number, number] | null;
  /** The bow's direction as the ship reports it, apart from its course. */
  heading: number | null;
  /** When the ship's last report was made, epoch ms (the feature's own time). */
  reportedAt: number | null;
  mmsi?: number;
  /** Its navigational status in words, as the crew's transponder set it. */
  status?: string;
  destination?: string;
  callSign?: string;
  imo?: number;
  lengthM?: number;
  beamM?: number;
  draughtM?: number;
  eta?: string;
}

export interface Aircraft {
  id: string;
  lat: number;
  lon: number;
  callsign: string;
  feet: number | null;
  typeCode?: string;
  rot: number;
  /** The ICAO address, from the id `plane:<hex>`. */
  hex: string;
  knots: number | null;
  /** Feet a minute, to the nearest 10. */
  fpm: number | null;
  registration?: string;
  typeDescription?: string;
  squawk?: string;
  network: "adsb.lol" | "adsb.fi";
  /** The kind of aircraft ("Airliner"), and whether the aircraft broadcast it (else estimated). */
  classLabel?: string;
  classTrusted: boolean;
  posSource?: string;
  posAgeS?: number;
  emergency?: string;
  selAltFt?: number;
}

/** Above this a vessel is under way; at or below it, stopped (the console's own line). */
export const MOVING_KNOTS = 0.5;
/** Metres a second in one knot, and in one foot a minute: the adapter's own units, undone. */
const KNOT_MS = 0.514444;
const FPM_MS = 0.00508;
/** AIS sends 102.3 kn for "speed not available". */
const NO_SPEED_KNOTS = 102.2;
/** One knot is 1,852 m an hour. */
export const METRES_PER_KNOT_MINUTE = 1852 / 60;

/** "028°" (or "—") to a number of degrees; AIS's 360 means "not available". */
export function readDegrees(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  if (!/\d/.test(s) || !Number.isFinite(n) || n < 0 || n >= 360) return null;
  return n;
}

/** [lon, lat] a vessel reaches in one minute at its reported speed and course. */
export function oneMinuteAhead(lat: number, lon: number, courseDeg: number, knots: number): [number, number] {
  const p = destinationPoint(lat, lon, courseDeg, (knots * METRES_PER_KNOT_MINUTE) / 1000);
  return [p.lon, p.lat];
}

export function toVessel(f: AisFeatureLike): Vessel | null {
  if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return null;
  const p = f.props ?? {};
  const kn = typeof p.speedKt === "number" && p.speedKt >= 0 && p.speedKt < NO_SPEED_KNOTS ? p.speedKt : null;
  const course = readDegrees(p.course);
  const heading = readDegrees(p.heading);
  const moving = kn != null && kn > MOVING_KNOTS;
  const reported = f.ts ? Date.parse(f.ts) : Number.NaN;
  const status = p.status && p.status !== "\u2014" ? p.status : undefined;
  return {
    id: f.id,
    lat: f.lat,
    lon: f.lon,
    name: (p.vessel ?? f.title ?? "").trim() || "Vessel",
    knots: kn,
    course,
    moving,
    ...(p.shipType ? { type: p.shipType } : {}),
    source: p.source ?? "AISStream",
    rot: (moving ? course : heading) ?? course ?? heading ?? 0,
    ahead: moving && course != null ? oneMinuteAhead(f.lat, f.lon, course, kn!) : null,
    heading,
    reportedAt: Number.isFinite(reported) ? reported : null,
    ...(typeof p.mmsi === "number" ? { mmsi: p.mmsi } : {}),
    ...(status ? { status } : {}),
    ...(p.destination ? { destination: p.destination } : {}),
    ...(p.callSign ? { callSign: p.callSign } : {}),
    ...(typeof p.imo === "number" ? { imo: p.imo } : {}),
    ...(typeof p.lengthM === "number" ? { lengthM: p.lengthM } : {}),
    ...(typeof p.beamM === "number" ? { beamM: p.beamM } : {}),
    ...(typeof p.draughtM === "number" ? { draughtM: p.draughtM } : {}),
    ...(p.eta ? { eta: p.eta } : {}),
  };
}

export function toAircraft(p: PlaneLike): Aircraft | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.meta?.onGround) return null;
  const m = p.meta ?? {};
  const callsign = (m.callsign || p.label || m.registration || "").trim() || "Aircraft";
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return {
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    callsign,
    feet: typeof p.altKm === "number" && Number.isFinite(p.altKm) ? Math.round((p.altKm * 3280.84) / 50) * 50 : null,
    ...(m.typeCode ? { typeCode: m.typeCode } : {}),
    rot: typeof p.heading === "number" && Number.isFinite(p.heading) ? p.heading : 0,
    hex: p.id.replace(/^plane:/, ""),
    knots: finite(m.velocityMs) ? Math.round(m.velocityMs / KNOT_MS) : null,
    fpm: finite(m.verticalRateMs) ? Math.round(m.verticalRateMs / FPM_MS / 10) * 10 : null,
    ...(m.registration ? { registration: m.registration } : {}),
    ...(m.typeDescription ? { typeDescription: m.typeDescription } : {}),
    ...(m.squawk ? { squawk: m.squawk } : {}),
    network: m.network === "adsb.fi" ? "adsb.fi" : "adsb.lol",
    ...(m.typeLabel ? { classLabel: m.typeLabel } : {}),
    classTrusted: m.categoryTrusted === true,
    ...(m.posSource ? { posSource: m.posSource } : {}),
    ...(finite(m.posAgeS) ? { posAgeS: m.posAgeS } : {}),
    ...(m.emergency ? { emergency: m.emergency } : {}),
    ...(finite(m.selAltFt) ? { selAltFt: m.selAltFt } : {}),
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "PEARL OF LONDON" / "Passenger · 4.4 kn · 028°". Names stay as AIS sends them. */
export function vesselTag(v: Vessel): { title: string; meta: string } {
  const parts: string[] = [];
  if (v.type) parts.push(cap(v.type));
  if (v.moving && v.knots != null) {
    parts.push(`${v.knots.toFixed(1)} kn`);
    if (v.course != null) parts.push(`${String(Math.round(v.course) % 360).padStart(3, "0")}°`);
  } else if (v.knots != null) {
    parts.push("Stopped");
  } else {
    parts.push("Speed not sent");
  }
  return { title: v.name, meta: parts.join(" · ") };
}

/** "BAW123" / "8,450 ft · A320". */
export function aircraftTag(a: Aircraft): { title: string; meta: string } {
  const parts = [a.feet != null ? `${a.feet.toLocaleString("en-GB")} ft` : "Altitude not sent"];
  if (a.typeCode) parts.push(a.typeCode);
  return { title: a.callsign, meta: parts.join(" · ") };
}

/** Each feed's own credit, for the feeds these vessels came from. */
export function vesselCredits(vessels: readonly Pick<Vessel, "source">[]): string[] {
  const by: Record<string, string> = {
    AISStream: AISSTREAM_ATTRIBUTION,
    Digitraffic: DIGITRAFFIC_CREDIT,
    BarentsWatch: BARENTSWATCH_CREDIT,
  };
  const out: string[] = [];
  for (const v of vessels) {
    const c = by[v.source] ?? by.AISStream;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The last words of the vessel row: how the stream is, said as it is. */
const STREAM_WORDS: Record<StreamState, string> = {
  live: "AIS heard in the last 20 min",
  warming: "AIS stream started under 2 min ago, still filling",
  down: "AISStream not answering, showing what was heard in the last 20 min",
  off: "AISStream not connected",
};

/**
 * The vessel row: every vessel drawn inside the view (not only the ones with a tag),
 * how many of those have a name tag, how many move, and how the stream is. There is no
 * "of N nearby" here: the view asks for the boats around what is on screen, so the
 * count is what a reader can see.
 */
export function vesselLedgerRow(inView: readonly Vessel[], named: number, stream: StreamState = "live"): LedgerRow {
  const n = inView.length;
  const moving = inView.filter((v) => v.moving).length;
  const parts = [...(n > 0 ? [`${named} named`, `${moving} moving`] : []), STREAM_WORDS[stream]];
  return {
    kind: "ship",
    count: n,
    label: n === 1 ? "vessel" : "vessels",
    detail: parts.join(" · "),
    short: n === 1 ? "vessel" : "vessels",
  };
}

/**
 * The aircraft credit, for the map's attribution control: the console's own, with
 * both names and both licences, less its first word. A reel filmed from this view is
 * a recording, and here the one "Live" is the chip of a stream that is playing.
 */
export const AIRCRAFT_CREDIT = ADSB_ATTRIBUTION.replace(/^Live aircraft/, "Aircraft");

/**
 * The aircraft row says what the count is: a share of a worldwide SAMPLE (the route
 * keeps 3,000 of what adsb.lol hears, spread by area), so "0 aircraft" here can mean
 * "none in the sample", never "the sky is empty". And how old the positions are.
 */
export function aircraftLedgerRow(n: number, nearby: number, opts: { sampled: boolean; ageMs: number | null }): LedgerRow {
  const detail = [...ofNearby(n, nearby), "adsb.lol (ODbL)"];
  if (opts.sampled) detail.push("from a worldwide sample, not every aircraft");
  if (opts.ageMs != null && opts.ageMs >= 120_000) detail.push(`positions ${Math.round(opts.ageMs / 60_000)} min old`);
  return {
    kind: "plane",
    count: n,
    label: "aircraft",
    detail: detail.join(" · "),
    short: "aircraft",
  };
}

/** Inside the view's bounds, padded so a mark just off screen is kept for a turn. */
export function inBounds(
  lat: number,
  lon: number,
  b: { west: number; south: number; east: number; north: number },
  padDeg: number,
): boolean {
  return lat >= b.south - padDeg && lat <= b.north + padDeg && lon >= b.west - padDeg && lon <= b.east + padDeg;
}
