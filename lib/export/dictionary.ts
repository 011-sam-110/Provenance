// The data dictionary of an export: a plain text file that names each column of the
// CSV and each property of the GeoJSON and KML, says what it means, names the source
// of the data and gives the time of the export. Pure: values in, text out.
//
// It is a download of its own, beside CSV, GeoJSON and KML. One file that holds the
// data AND its dictionary would be a zip, and this repo has no zip writer.
//
// THE RULE OF THIS FILE: a meaning is written here only when the code that fills the
// column was read. A column with no entry gets NO_DESCRIPTION, which says so in plain
// words. Do not write a meaning from the name of a column: "magnitude" is a Richter
// figure in one export and a marker size in another.

import type { GeoPoint } from "@/lib/export";
import { exportFilename } from "@/lib/export";

/** What the file says for a column that has no entry below. */
export const NO_DESCRIPTION =
  "A field of the source, passed on as it was published. Provenance holds no description of it.";

/** What the file says when the caller gave no source. */
export const NO_SOURCE = "Not recorded in this export. The panel that you exported from names it.";

/** Meanings that hold in every export. */
const SHARED: Record<string, string> = {
  lat: "Latitude in decimal degrees, WGS 84. North is positive.",
  lon: "Longitude in decimal degrees, WGS 84. East is positive.",
  id: "The id of the record in Provenance. It starts with a short name of the feed and a colon.",
  precision:
    "How precise the place is: exact, facility, area or country. For area and country, lat and lon are an anchor for the mark, not the place of an event.",
};

const SIGNAL: Record<string, string> = {
  title: "The short label of the record: the title of its detail panel.",
  name: "The short label of the record: the title of its detail panel.",
  magnitude:
    "The figure that sets the size of the marker, on a scale of about 0 to 10. For earthquakes it is the magnitude that the source reports. On other layers it is a figure that the layer rescaled to that range, so do not compare it between layers.",
  value:
    "The layer's own measure of the record, in the layer's own unit, when the layer declares one. Else the same figure as magnitude. Empty when the record has neither.",
  ts: "The time of the observation or the event, ISO 8601, when the source gives one.",
  link: "The page of this record at the source, when the source has one.",
  rank: "The position of the record in the list of its layer. 1 is first.",
  country: "The country of the record, as the layer gives it.",
  region: "The region of the record, as the layer gives it.",
};

/**
 * One dictionary for each export. The key is the `kind` a caller passes, or the name
 * of the export when it passes none ("events", "locate" and "markets" arrive that way
 * from the widget menu).
 */
export const EXPORT_DICTIONARIES: Record<string, Record<string, string>> = {
  signal: SIGNAL,

  events: {
    tier: "Severity tier, S0 (lowest) to S4. Provenance derives it from the magnitude of the source on a shared 0 to 10 scale: from 2 it is S1, from 4 S2, from 6 S3, from 8 S4. It is a display aid, not a figure of the source.",
    type: "The kind of event: quake, fire, disaster, cyclone, flood, storm, volcano, conflict or other.",
    title: "The title of the event, word for word from the source.",
    place: "A place name, best effort: the place field of the source when it has one, else the end of the title. It can be a region or a part of a sentence.",
    metric: "The measures that the source gives for this event, as one line of text.",
    magnitude: "The magnitude in the unit of the source. Filled only where the unit is known, which today is earthquakes.",
    unit: "The unit of the magnitude column.",
    threat:
      "Filled when the modelled reach of the event touches a place that you saved as an asset in this browser: the distance to the nearest one, and its name. Else empty.",
    occurredAt: "The time of the event, ISO 8601 in UTC. Empty when the source gives none.",
  },

  aviation: {
    callsign: "The callsign that the aircraft transmits. When it transmits none, its 24-bit address in hexadecimal.",
    type: "The class of aircraft that Provenance shows for it.",
    altKm: "Altitude in kilometres, converted from the feet in the feed.",
    speedKt: "Ground speed in knots.",
    headingDeg: "Track over the ground, in degrees clockwise from north.",
    verticalRateMs: "Rate of climb (positive) or descent, in metres per second, converted from feet per minute.",
    registration: "The registration (tail number), when the feed has it.",
    region: "The continent of the position, from a coarse box test by Provenance. A dash when no box matches.",
    squawk: "The transponder code, when the feed has it.",
  },

  satellites: {
    name: "The name of the object.",
    norad: "The NORAD catalogue number of the object.",
    category: "The group that Provenance lists the object under.",
    altKm: "Height above the surface of the Earth in kilometres at the time of the export, computed in the browser from the orbit elements.",
    periodMin: "The time of one orbit in minutes, from the mean motion in the orbit elements.",
    lat: "Latitude of the point on the ground below the object at the time of the export. Decimal degrees, WGS 84.",
    lon: "Longitude of the point on the ground below the object at the time of the export. Decimal degrees, WGS 84.",
  },

  cables: {
    cable: "The name of the cable system.",
    rfsYear: "The year the cable was, or is planned to be, ready for service.",
    lengthKm: "The length of the cable in kilometres, as the source lists it.",
    capacity: "The design capacity. The source does not publish it, so expect a dash.",
    owners: "The owners of the cable, as the source lists them.",
    suppliers: "The suppliers of the cable, as the source lists them.",
    status: "The status of the cable, as the source states it.",
    region: "The region that the layer files the cable under. \"Unclassified\" when it has none.",
    landingPoints: "The number of landing points of the cable.",
    countries: "The countries of the cable, as the layer lists them.",
    lat: "Latitude of the anchor point that carries the label of the cable. It is one point of the cable, not an end. Decimal degrees, WGS 84.",
    lon: "Longitude of the anchor point that carries the label of the cable. It is one point of the cable, not an end. Decimal degrees, WGS 84.",
  },

  schedule: {
    mission: "The name of the scheduled item.",
    name: "The name of the scheduled item.",
    when: "The scheduled time, ISO 8601.",
    countdown: "The time left to the scheduled time at the moment of the export, as text.",
    provider: "The launch provider, as the source names it.",
    rocket: "The rocket, as the source names it.",
    site: "The launch site, as the source names it.",
    status: "The status, as the source states it.",
  },

  ais: {
    vessel: "The name that the vessel transmits.",
    name: "The name that the vessel transmits.",
    mmsi: "The Maritime Mobile Service Identity: the number that the vessel transmits as its id.",
    chokepoint: "The strait or chokepoint that Provenance placed the vessel in, when it is in one.",
    speed: "Speed over the ground, as text with its unit (knots).",
    course: "Course over the ground, as text in degrees.",
    status: "The navigational status that the vessel transmits.",
  },

  locate: {
    rank: "The order of the estimate. 1 is the estimate with the highest confidence.",
    place: "The name of the estimated place.",
    country: "The country of the estimated place, when the model gave one.",
    confidence: "The confidence that the model states for the estimate, from 0 to 1. It is not a measured accuracy.",
    lat: "Latitude of the estimate in decimal degrees, WGS 84. It is an estimate from a photo, not a measurement.",
    lon: "Longitude of the estimate in decimal degrees, WGS 84. It is an estimate from a photo, not a measurement.",
  },

  markets: {
    section: "The group that the row is listed under.",
    name: "The name of the instrument.",
    symbol: "The ticker symbol, when the row has one.",
    value: "The value as the panel shows it, as text.",
    num: "The same value as a plain number, when there is one.",
    changePct:
      "Change in percent. It is not one period for every row: a crypto row is the move of the last 24 hours, a row from Yahoo Finance is the move against the previous close.",
  },

  dossier: {
    kind: "The kind of object: camera, satellite, plane, webcam, signal, country or area.",
    label: "The title of the detail panel.",
    signalId: "The id of the map layer that the record belongs to.",
    props: "The fields of the record as the layer holds them, as one JSON object.",
    attribution: "The credit line of the source.",
    sourceLabel: "The name of the map layer.",
    link: "The page of this record at the source, when the source has one.",
    sourceUrl: "The page of the dataset at the provider.",
    ts: "The time of the observation or the event, ISO 8601, when the source gives one.",
    geometry: "The line or the area of the record. Coordinates are in GeoJSON order: longitude, then latitude.",
  },
};

// The three other views of a map layer export the same base columns as "signal".
EXPORT_DICTIONARIES.directory = SIGNAL;
EXPORT_DICTIONARIES.forecast = {
  ...SIGNAL,
  value: "The figure of the layer's forecast index for this record. Empty when the layer declares no index.",
};

export interface DictionaryInput {
  /** The name of the export, as in its file names (exportFilename). */
  name: string;
  /** Which entry of EXPORT_DICTIONARIES describes it. Absent: the entry called `name`. */
  kind?: string;
  /** The rows of the CSV file. */
  rows?: Record<string, unknown>[];
  /** The points of the GeoJSON and KML files. */
  geo?: GeoPoint[];
  /** The credit line of the data. */
  source?: string;
  /** The time of the export, in milliseconds. */
  at: number;
  /** Meanings that only the caller knows (a column named after a layer's own field). */
  extra?: Record<string, string>;
}

/**
 * Pure: every key of a list of objects, in the order of first appearance.
 * `written` leaves out a key that no object gives a value: JSON drops an undefined
 * property, so the GeoJSON and the KML never hold it. The CSV does hold a column for
 * such a key, so its section keeps it.
 */
function keysOf(items: (Record<string, unknown> | undefined | null)[], written = false): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const [k, v] of Object.entries(item ?? {})) if (!written || v !== undefined) seen.add(k);
  }
  return Array.from(seen);
}

/** Pure: the meaning of one column of one export. */
export function describeColumn(column: string, kind: string, extra?: Record<string, string>): string {
  return extra?.[column] ?? EXPORT_DICTIONARIES[kind]?.[column] ?? SHARED[column] ?? NO_DESCRIPTION;
}

function section(heading: string, columns: string[], kind: string, extra?: Record<string, string>): string[] {
  const out = ["", `${heading} (${columns.length})`, ""];
  for (const c of columns) out.push(c, `    ${describeColumn(c, kind, extra)}`);
  return out;
}

/** Pure: the data dictionary of one export, as plain text. */
export function toDataDictionary(input: DictionaryInput): string {
  const kind = input.kind ?? input.name;
  const rows = input.rows ?? [];
  const geo = (input.geo ?? []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const csvColumns = keysOf(rows);
  const geoProperties = keysOf(geo.map((p) => p.properties), true);
  const base = exportFilename(input.name, input.at);
  const files = [rows.length > 0 ? ".csv" : "", geo.length > 0 ? ".geojson" : "", geo.length > 0 ? ".kml" : ""].filter(Boolean);

  const records = [
    rows.length > 0 ? `${rows.length} in the CSV` : "",
    geo.length > 0 ? `${geo.length} in the GeoJSON and the KML` : "",
  ].filter(Boolean);

  const lines = [
    "PROVENANCE DATA DICTIONARY",
    "",
    `Export:              ${input.name}`,
    `Time of the export:  ${new Date(input.at).toISOString()} (UTC)`,
    `Source of the data:  ${input.source?.trim() || NO_SOURCE}`,
    `Files it describes:  ${files.length > 0 ? `${base}${files.join(", ")}` : "none: the export was empty"}`,
    `Records:             ${records.length > 0 ? records.join(", ") : "none"}`,
    "",
    "The files hold what the panel showed at the time of the export. Filters of the panel apply.",
    "A file name carries the minute of its own download, so it can differ from the name above by a minute.",
  ];

  if (csvColumns.length > 0) lines.push(...section("COLUMNS OF THE CSV FILE", csvColumns, kind, input.extra));

  if (geo.length > 0) {
    lines.push(
      "",
      "POSITION IN THE GEOJSON AND THE KML",
      "",
      "Each record is one point. Coordinates are decimal degrees, WGS 84.",
      "GeoJSON writes [longitude, latitude]. KML writes longitude,latitude.",
      "The KML names each placemark from the first of these properties that the record has:",
      "name, title, label, callsign, cable, place, vessel, mission, id.",
    );
    if (geoProperties.length > 0) {
      lines.push(...section("PROPERTIES OF THE GEOJSON AND THE KML", geoProperties, kind, input.extra));
    }
  }

  return lines.join("\r\n") + "\r\n";
}
