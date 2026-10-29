// Every word the God's eye view's detail panel shows for a vessel or an aircraft, as
// pure functions: components/eye/DetailPanel.tsx renders a model and writes nothing of
// its own. Pinned by tests/unit/eye-detail.test.ts.
//
// WHO SAID IT. A value is never stated as fact when somebody set it. A ship's crew sets
// its status, destination, ETA and draught by hand, so they sit in a group that says so;
// the flag is worked out from the MMSI, so its label says "from MMSI"; an aircraft's
// registration and type come from adsb.lol's database, not from the aircraft. A value a
// feed did not send is left out of a group, and shown as "Not sent" in the readout, where
// an empty place would otherwise look like a zero.

import { flagFromMmsi } from "@/lib/eye/mid";
import { fmtClockUtc, fmtLat, fmtLon } from "@/lib/eye/wording";
import { vesselCredits, type Aircraft, type Vessel } from "@/lib/eye/traffic";

export interface DetailRow {
  label: string;
  value: string;
  /** A line under the value, saying where it comes from or what it means. */
  note?: string;
}
export interface DetailGroup {
  heading: string;
  rows: DetailRow[];
}
export interface DetailModel {
  kind: "ship" | "plane";
  id: string;
  title: string;
  kindLine: string;
  /** The big figures. A null value is drawn as NOT_SENT. */
  readout: { label: string; value: string | null }[];
  /** A group with no rows is left out. */
  groups: DetailGroup[];
  note: string;
  credit: string;
}

export const NOT_SENT = "Not sent";

/** The words the panel itself adds around a model. */
export const PANEL_WORDS = { close: "Close", also: "Also here" } as const;

const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pad3 = (deg: number) => String(Math.round(deg) % 360).padStart(3, "0");
const feetText = (n: number) => `${n.toLocaleString("en-GB")} ft`;
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const rows = (list: (DetailRow | null)[]): DetailRow[] => list.filter((r): r is DetailRow => r !== null);
const row = (label: string, value: string | null | undefined, note?: string): DetailRow | null =>
  value ? { label, value, ...(note ? { note } : {}) } : null;

/** "just now" (under 5 s), "41 s ago", "3 min ago", "2 h ago". */
export function ageText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** The line over a panel whose mark is no longer in the latest report. */
export function staleText(lastHeard: number): string {
  return `Not in the latest report. Last heard ${fmtClockUtc(lastHeard, false)} UTC.`;
}

/** The "<n> m" beside a name in the Also here list. */
export function distanceText(metres: number): string {
  const m = Math.max(0, metres);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "10-28T22:30Z" to "28 Oct, 22:30 UTC"; AIS sends no year, and the note says so. */
export function etaText(eta: string): { value: string; note: string } | null {
  const m = /^(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})Z)?$/.exec(eta);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const date = `${Number(m[2])} ${MONTHS[month - 1]}`;
  return { value: m[3] ? `${date}, ${m[3]}:${m[4]} UTC` : date, note: "AIS sends no year" };
}

/** Where an aircraft's position came from, from adsb.lol's own type code. */
export function positionSourceText(code: string): string {
  switch (code) {
    case "adsb":
      return "ADS-B, the aircraft's own satellite fix";
    case "adsr":
      return "ADS-R, an ADS-B report relayed by a ground station";
    case "tisb":
      return "TIS-B, a ground radar track relayed";
    case "mlat":
      return "MLAT, worked out by receivers from signal timing";
    case "adsc":
      return "ADS-C, sent over a satellite link";
    default:
      return "Other";
  }
}

const draughtText = (m: number) => (m >= 25.5 ? "25.5 m or more" : `${m.toFixed(1)} m`);

function sizeText(v: Vessel): string | null {
  if (v.lengthM != null && v.beamM != null) return `${trim(v.lengthM)} × ${trim(v.beamM)} m`;
  if (v.lengthM != null) return `${trim(v.lengthM)} m long`;
  if (v.beamM != null) return `${trim(v.beamM)} m wide`;
  return null;
}

const position = (lat: number, lon: number) => `${fmtLat(lat)}, ${fmtLon(lon)}`;

export function vesselDetail(v: Vessel, now: number): DetailModel {
  const eta = v.eta ? etaText(v.eta) : null;
  const flag = flagFromMmsi(v.mmsi);
  return {
    kind: "ship",
    id: v.id,
    title: v.name,
    kindLine: v.type ? cap(v.type) : "Type not sent",
    readout: [
      { label: "Speed", value: v.knots != null ? `${v.knots.toFixed(1)} kn` : null },
      { label: "Course", value: v.course != null ? `${pad3(v.course)}°` : null },
      { label: "Heading", value: v.heading != null ? `${pad3(v.heading)}°` : null },
    ],
    groups: [
      {
        heading: "Voyage, as set by the crew",
        rows: rows([
          row("Status", v.status ? cap(v.status) : null),
          row("Destination", v.destination),
          eta ? { label: "ETA", value: eta.value, note: eta.note } : null,
          row("Draught", v.draughtM != null ? draughtText(v.draughtM) : null),
        ]),
      },
      {
        heading: "Ship, as its AIS is set up",
        rows: rows([
          row("Size", sizeText(v)),
          row("MMSI", v.mmsi != null ? String(v.mmsi) : null),
          row("IMO", v.imo != null ? String(v.imo) : null),
          row("Call sign", v.callSign),
          row("Flag (from MMSI)", flag),
        ]),
      },
      {
        heading: "Report",
        rows: rows([
          row("Position", position(v.lat, v.lon)),
          row("Last report", v.reportedAt != null ? `${fmtClockUtc(v.reportedAt)} UTC, ${ageText(v.reportedAt, now)}` : null),
          row("Heard by", v.source),
        ]),
      },
    ].filter((g) => g.rows.length > 0),
    note: "Each value is what the ship's AIS transponder sent. The mark sits where its last report put it.",
    credit: vesselCredits([v])[0],
  };
}

/** The squawk codes that mean something on their own. */
const SQUAWK_NOTES: Readonly<Record<string, string>> = {
  "7500": "the code for a hijack",
  "7600": "the code for radio failure",
  "7700": "the code for an emergency",
};

function verticalText(fpm: number): string {
  if (fpm === 0) return "0 ft/min";
  return `${fpm > 0 ? "+" : MINUS}${Math.abs(fpm).toLocaleString("en-GB")} ft/min`;
}

function aircraftKindLine(a: Aircraft): string {
  const type = a.typeDescription ?? a.typeCode;
  const cls = a.classLabel ? `${a.classLabel.toLowerCase()}${a.classTrusted ? "" : " (estimated)"}` : null;
  if (type && cls) return `${type}, ${cls}`;
  if (type) return type;
  if (cls) return cap(cls);
  return "Type not sent";
}

export function aircraftDetail(a: Aircraft, now: number, pulledAt: number | null): DetailModel {
  const lol = a.network === "adsb.lol";
  const emergency = a.emergency ? cap(a.emergency.replace(/_/g, " ")) : null;
  return {
    kind: "plane",
    id: a.id,
    title: a.callsign,
    kindLine: aircraftKindLine(a),
    readout: [
      { label: "Altitude", value: a.feet != null ? feetText(a.feet) : null },
      { label: "Ground speed", value: a.knots != null ? `${a.knots} kn` : null },
      { label: "Track", value: `${pad3(a.rot)}°` },
      { label: "Vertical speed", value: a.fpm != null ? verticalText(a.fpm) : null },
    ],
    groups: [
      {
        heading: "Transponder, as set in the cockpit",
        rows: rows([
          row("Squawk", a.squawk, a.squawk ? SQUAWK_NOTES[a.squawk] : undefined),
          row("Emergency", emergency, "as sent"),
          row("Selected altitude", a.selAltFt != null ? feetText(a.selAltFt) : null),
        ]),
      },
      {
        heading: `Aircraft, from ${a.network}'s database`,
        rows: rows([
          row("Registration", a.registration),
          row("Type", a.typeCode),
          row("ICAO address", a.hex.toUpperCase()),
        ]),
      },
      {
        heading: "Report",
        rows: rows([
          row("Position", position(a.lat, a.lon)),
          row("Position from", a.posSource ? positionSourceText(a.posSource) : null),
          row(
            "Pulled",
            pulledAt != null ? `${fmtClockUtc(pulledAt, false)} UTC, ${ageText(pulledAt, now)}` : null,
            pulledAt != null && a.posAgeS != null ? `position ${a.posAgeS} s old at the pull` : undefined,
          ),
          row("Heard by", a.network),
        ]),
      },
    ].filter((g) => g.rows.length > 0),
    note: `Altitude, speed, track and squawk are what the aircraft's transponder sent. Registration and type come from ${a.network}'s aircraft database.`,
    credit: lol ? "Aircraft © adsb.lol contributors (ODbL)" : "Aircraft © adsb.fi (non-commercial use)",
  };
}
