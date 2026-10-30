// Every word the God's eye view's detail panel shows for a vessel, an aircraft or a road notice, as
// pure functions: components/eye/DetailPanel.tsx renders a model and writes nothing of
// its own. Pinned by tests/unit/eye-detail.test.ts.
//
// WHO SAID IT. A value is never stated as fact when somebody set it. A ship's crew sets
// its status, destination, ETA and draught by hand, so they sit in a group that says so;
// the flag is worked out from the MMSI, so its label says "from MMSI"; an aircraft's
// registration and type come from adsb.lol's database, not from the aircraft. A value a
// feed did not send is left out of a group, and shown as "Not sent" in the readout, where
// an empty place would otherwise look like a zero. A road notice is all TfL's: its
// headings say so ("TfL's description"), its footer is TfL's credit alone, and it names no
// company, because TfL names none.

import { flagFromMmsi } from "@/lib/eye/mid";
import { fmtClockUtc, fmtLat, fmtLon } from "@/lib/eye/wording";
import { vesselCredits, type Aircraft, type Vessel } from "@/lib/eye/traffic";
import { noticePaint, tflPlace, type StreetDisruption, type StreetPaint } from "@/lib/eye/streets";
import { utcStamp } from "@/lib/roads/notice";
import { TFL_CREDIT } from "@/lib/roads/tfl";

export { tflPlace };

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
  kind: "ship" | "plane" | "road";
  id: string;
  title: string;
  kindLine: string;
  /** A road notice's mark: how its street is painted on the map (lib/eye/streets.ts). */
  paint?: StreetPaint;
  /** The big figures. A null value is drawn as NOT_SENT. */
  readout: { label: string; value: string | null }[];
  /** A notice's own sentences, in the operator's words, drawn before the groups. */
  prose?: { heading: string; text: string }[];
  /** A group with no rows is left out. */
  groups: DetailGroup[];
  /** One sentence of the footer, about where the values come from. A road notice has none: its credit is enough. */
  note?: string;
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

/** The line over a road notice that TfL no longer lists: when TfL last changed it. */
export function noticeGoneText(lastChanged: number, now: number): string {
  return `Not in TfL's latest list. Last changed ${utcStamp(lastChanged, now)}.`;
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

// --- a road notice: TfL's own fields, as TfL wrote them ---------------------------------

/** "8 Oct", and " 2022" after it when the UTC year is not `now`'s. Null for text that is no date. */
export function dayMonthText(iso: string, now: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year === new Date(now).getUTCFullYear() ? "" : ` ${year}`}`;
}

/** "8 Oct 11:00": the day always, unlike utcStamp, which drops it for today. */
function dayTimeText(iso: string, now: number): string | null {
  const day = dayMonthText(iso, now);
  return day ? `${day} ${fmtClockUtc(Date.parse(iso), false)}` : null;
}

/** "8 Oct 11:00 UTC". */
function dateTimeText(iso: string, now: number): string | null {
  const t = dayTimeText(iso, now);
  return t ? `${t} UTC` : null;
}

/** A street's name without the postcode bracket TfL ends it with. */
export function streetLabel(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** "29 Oct 08:00 to 20:00 UTC" for a run inside one day, "31 Oct 08:00 to 2 Nov 16:00 UTC" across days. */
function scheduleText(s: { from: string; to: string }, now: number): string | null {
  const from = dayTimeText(s.from, now);
  const to = dayTimeText(s.to, now);
  if (!from || !to) return null;
  const a = new Date(Date.parse(s.from)).toISOString().slice(0, 10);
  const b = new Date(Date.parse(s.to)).toISOString().slice(0, 10);
  return a === b ? `${from} to ${fmtClockUtc(Date.parse(s.to), false)} UTC` : `${from} to ${to} UTC`;
}

/**
 * A road notice from TfL: its title and road, three figures, TfL's own sentences, and two
 * groups of what TfL sent (where, and the notice itself). Nothing is guessed: no company
 * is pulled out of the text, a field TfL left empty is left out, and a street's closure and
 * direction are TfL's own words for it.
 */
export function roadDetail(d: StreetDisruption, now: number, fetchedAt: number | null): DetailModel {
  const place = tflPlace(d.location);
  const changed = d.updated ? Date.parse(d.updated) : NaN;
  const updateAt = d.updateAt ? Date.parse(d.updateAt) : NaN;
  const runs = d.starts && d.ends ? { from: dateTimeText(d.starts, now), to: dateTimeText(d.ends, now) } : null;
  const times = (d.schedule ?? [])
    .slice()
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
    .map((s) => scheduleText(s, now))
    .filter((t): t is string => t !== null);
  return {
    kind: "road",
    id: d.id,
    paint: noticePaint(d),
    title: d.subCategory ?? d.category,
    kindLine: place.road || d.street || "Road not named",
    readout: [
      { label: "Severity", value: d.severity },
      { label: "From", value: d.starts ? dayMonthText(d.starts, now) : null },
      { label: "Until", value: d.ends ? dayMonthText(d.ends, now) : null },
    ],
    prose: [
      d.description ? { heading: "TfL's description", text: d.description } : null,
      d.update
        ? { heading: Number.isFinite(updateAt) ? `TfL's latest update, ${utcStamp(updateAt, now)}` : "TfL's latest update", text: d.update }
        : null,
    ].filter((p): p is { heading: string; text: string } => p !== null),
    groups: [
      {
        heading: "Where",
        rows: rows([
          row("Road", place.road),
          row(place.boroughs?.includes(",") ? "Boroughs" : "Borough", place.boroughs),
          row("Postcode areas", place.postcodes),
          ...(d.namedStreets ?? []).map((s) =>
            row(
              "Street named",
              streetLabel(s.name),
              `${s.closed ? "Closed" : "Open"}${s.direction ? `, ${s.direction.toLowerCase()}` : ""}`,
            ),
          ),
        ]),
      },
      {
        heading: "Notice",
        rows: rows([
          row("TfL reference", d.id),
          row("Status", d.status),
          row("Runs", runs?.from && runs.to ? `${runs.from} to ${runs.to}` : null),
          row("Works times", times.length > 0 ? times.join("; ") : null),
          d.provisional ? { label: "Dates", value: "Provisional", note: "as TfL marks them" } : null,
          row("Level of interest", d.interest),
          row("Last change", Number.isFinite(changed) ? `${utcStamp(changed, now)}, ${ageText(changed, now)}` : null),
          row("Fetched", fetchedAt != null ? `${utcStamp(fetchedAt, now)}, ${ageText(fetchedAt, now)}` : null),
        ]),
      },
    ].filter((g) => g.rows.length > 0),
    credit: TFL_CREDIT,
  };
}
