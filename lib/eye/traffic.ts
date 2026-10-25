// The God's eye view's vessels and aircraft, the pure half: what each tag says, where
// a vessel's one-minute line ends, and the ledger rows. Pinned by
// tests/unit/eye-traffic.test.ts.
//
// EVERY MARK IS A REPORT. Vessels come from /api/signals/ais (the long-lived AISStream
// socket on the server, whose English Channel box covers the Thames) and aircraft from
// /api/planes (adsb.lol). A mark sits where its last report put it and jumps when the
// next report lands: nothing is animated between reports, because an in-between
// position is a place nobody reported. The one-minute line shows where a vessel is
// heading at its reported speed and course; it is drawn as a line, not as a position.

import { destinationPoint } from "@/lib/cinematic/verbs";
import { AISSTREAM_ATTRIBUTION } from "@/lib/signals/ais";
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
  meta?: { callsign?: string; typeCode?: string; onGround?: boolean; registration?: string };
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
}

export interface Aircraft {
  id: string;
  lat: number;
  lon: number;
  callsign: string;
  feet: number | null;
  typeCode?: string;
  rot: number;
}

/** Above this a vessel is under way; at or below it, stopped (the console's own line). */
export const MOVING_KNOTS = 0.5;
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
  };
}

export function toAircraft(p: PlaneLike): Aircraft | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.meta?.onGround) return null;
  const callsign = (p.meta?.callsign || p.label || p.meta?.registration || "").trim() || "Aircraft";
  return {
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    callsign,
    feet: typeof p.altKm === "number" && Number.isFinite(p.altKm) ? Math.round((p.altKm * 3280.84) / 50) * 50 : null,
    ...(p.meta?.typeCode ? { typeCode: p.meta.typeCode } : {}),
    rot: typeof p.heading === "number" && Number.isFinite(p.heading) ? p.heading : 0,
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

/** The vessel row: vessels tagged on screen, of how many nearby, and how many of those move. */
export function vesselLedgerRow(inView: readonly Vessel[], nearby: number): LedgerRow {
  const moving = inView.filter((v) => v.moving).length;
  const n = inView.length;
  const parts = [...ofNearby(n, nearby), ...(n > 0 ? [`${moving} moving`] : []), "AIS heard in the last 20 min"];
  return {
    kind: "ship",
    count: n,
    label: n === 1 ? "vessel" : "vessels",
    detail: parts.join(" · "),
    short: n === 1 ? "vessel" : "vessels",
  };
}

/** The aircraft credit, for the map's attribution control. */
export const AIRCRAFT_CREDIT = ADSB_ATTRIBUTION;

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
