// "Open this spot elsewhere": the same coordinates in other tools, so a place can be
// checked against satellite and street sources in one click. Pure: coordinates in,
// addresses out. Links only. Nothing from these services is embedded or fetched.
//
// EVERY ADDRESS FORM BELOW WAS CHECKED, NOT GUESSED (2026-10-08). When one of these
// services changes its address form the link still opens, on the wrong place or on
// nothing, and no test can see it. So each builder says how its form was checked.
// Check it the same way before you change it.
//
// The plan named Sentinel Hub EO Browser. It is gone: its address now answers "EO
// Browser has been deprecated" with no map, and that page itself sends public-data
// users to Copernicus Browser. The link goes there.

import type { SignalGeometry, SignalPrecision } from "@/lib/signals/types";
import { isCountryScopedSignal } from "@/lib/map/hitTest";

/**
 * What the coordinates of a feature stand for.
 *   - "point"   the place of the thing itself.
 *   - "area"    a polygon, or a place that is a region, a zone or a city. The
 *               coordinates are the point that stands for it.
 *   - "line"    a line (a cable). The coordinates are its anchor point.
 *   - "country" a country figure. The coordinates are the centre of the country.
 */
export type SpotKind = "point" | "area" | "line" | "country";

export interface ElsewhereLink {
  label: string;
  href: string;
  /** A fact the reader needs before the click. Shown as the link's tooltip. */
  hint?: string;
}

/** Decimal places kept in every address: 5 places is about 1.1 m on the ground. */
export const COORD_DECIMALS = 5;

/**
 * Web-map zoom for each kind. An exact place opens close. A centre opens wide enough
 * to show the area or the country, because a close view of a centre reads as a place.
 */
const ZOOM: Record<SpotKind, number> = { point: 15, area: 9, line: 9, country: 5 };

/** Google Earth camera distance in metres at zoom 15. It doubles for each zoom step out. */
const EARTH_DISTANCE_M_AT_15 = 1500;

/**
 * Pure: a usable coordinate pair, or null.
 * Refuses a value that is not a finite number and a latitude outside -90..90: there
 * is no such place. A longitude outside -180..180 is the same meridian one turn
 * round (a map that wraps the world gives these), so it is wrapped, not refused.
 */
export function normaliseSpot(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  const wrapped = lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon: wrapped };
}

/**
 * Pure: one coordinate as plain decimal text. Rounded to COORD_DECIMALS, no trailing
 * zeros, never an exponent ("1e-7") and never "-0": a service reads these literally.
 */
export function formatCoord(n: number): string {
  const rounded = Number(n.toFixed(COORD_DECIMALS));
  return String(rounded === 0 ? 0 : rounded);
}

/** Pure: "lat, lon" for the copy button, or null for a pair that is not a coordinate. */
export function coordsText(lat: unknown, lon: unknown): string | null {
  const spot = normaliseSpot(lat, lon);
  return spot ? `${formatCoord(spot.lat)}, ${formatCoord(spot.lon)}` : null;
}

/**
 * Pure: the links for one place. Returns [] for a pair that is not a coordinate.
 *
 * For a "point" the services that can show a marker get one. For a centre ("area",
 * "line", "country") no link sets a marker and each view opens wide: a marker on a
 * centre is a claim that something is at that point.
 */
export function elsewhereLinks(lat: unknown, lon: unknown, kind: SpotKind = "point"): ElsewhereLink[] {
  const spot = normaliseSpot(lat, lon);
  if (!spot) return [];
  const la = formatCoord(spot.lat);
  const lo = formatCoord(spot.lon);
  const zoom = ZOOM[kind];
  const exact = kind === "point";
  const earthDistance = EARTH_DISTANCE_M_AT_15 * 2 ** (15 - zoom);

  return [
    {
      // Checked by loading it: `@-33.8568,151.2153,0a,1500d,35y,0h,0t,0r` opened on the
      // Sydney Opera House and the status bar read "Camera: 1,500 m" at those
      // coordinates. Google publishes no document for this form. `a` is the ground
      // altitude, `d` the camera distance in metres, `y` the field of view, then
      // heading, tilt and roll. Only the 1,500 m distance was loaded.
      label: "Google Earth",
      href: `https://earth.google.com/web/@${la},${lo},0a,${earthDistance}d,35y,0h,0t,0r`,
    },
    {
      // Checked against Google's own document "Maps URLs"
      // (developers.google.com/maps/documentation/urls/get-started). Search:
      // `/maps/search/?api=1&query=<lat>%2C<lng>`. Display a map, no marker:
      // `/maps/@?api=1&map_action=map&center=<lat>%2C<lng>&zoom=<0..21>`.
      label: "Google Maps",
      href: exact
        ? `https://www.google.com/maps/search/?api=1&query=${la}%2C${lo}`
        : `https://www.google.com/maps/@?api=1&map_action=map&center=${la}%2C${lo}&zoom=${zoom}`,
    },
    {
      // Checked by loading it: `?zoom=14&lat=-33.8568&lng=151.2153` kept those three
      // values in the address after the app started and asked for map tile
      // 14/15073/9831, which is the tile that holds the point.
      label: "Copernicus Browser",
      href: `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${la}&lng=${lo}`,
    },
    {
      // Checked against the OpenStreetMap wiki page "Browsing": the hash
      // `#map=<zoom>/<lat>/<lon>` sets the view, `mlat` and `mlon` set the red marker.
      label: "OpenStreetMap",
      href: exact
        ? `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=${zoom}/${la}/${lo}`
        : `https://www.openstreetmap.org/#map=${zoom}/${la}/${lo}`,
    },
    {
      // Checked two ways. Wikimapia's own script (`/js/application.js`,
      // `URLHash.parseHash` and `getSupportedOptions`) reads and writes exactly
      // `#lang=…&lat=…&lon=…&z=…&m=…`, and `m=w` is its own map. Loaded: the app asked
      // for tile x=15073 y=9831 zoom=14 for the test point.
      // The hint is a fault of theirs, measured in Chromium: the first visit of a
      // browser session gets a cookie check page, and with a fragment in the address
      // that page does not move on by itself.
      label: "Wikimapia",
      href: `https://wikimapia.org/#lang=en&lat=${la}&lon=${lo}&z=${zoom}&m=w`,
      hint: "If Wikimapia opens on a blank page, reload it one time.",
    },
  ];
}

/**
 * Pure: what a signal's coordinates stand for, read from typed facts only.
 *
 * Three facts are typed. A feature with a `geometry` is a line or an area, and its
 * lat/lon is "a representative centroid" (lib/signals/types.ts). The precision level
 * of the feature says "area" or "country" when its lat/lon is an anchor and not the
 * place of the thing (lib/signals/precision.ts); the caller resolves it with
 * `precisionOfObject` and passes it in. A signal id in COUNTRY_SCOPED_SIGNALS has its
 * marker "on the country centroid" (lib/map/hitTest.ts).
 *
 * The function keeps no list of layer names of its own. With no precision passed, a
 * layer that puts one marker per country on a centroid reads as "point".
 */
export function spotKindOf(meta: Record<string, unknown> | undefined, precision?: SignalPrecision): SpotKind {
  const geometry = meta?.geometry as SignalGeometry | undefined;
  const type = geometry && typeof geometry === "object" ? geometry.type : undefined;
  // The shape is the more exact fact: a cable is a line whatever level its layer has.
  if (type === "LineString" || type === "MultiLineString") return "line";
  if (precision === "country") return "country";
  if (type === "Polygon" || type === "MultiPolygon" || precision === "area") return "area";
  if (isCountryScopedSignal(meta?.signalId as string | undefined)) return "country";
  return "point";
}

export interface SpotWording {
  /** The heading of the row. */
  heading: string;
  /** One sentence under the heading. Absent for an exact place. */
  note?: string;
  /** The label of the copy button. */
  copy: string;
}

/** What the row says for each kind. A centre is never called a spot. */
export const SPOT_WORDING: Record<SpotKind, SpotWording> = {
  point: { heading: "Open this spot elsewhere", copy: "Copy coordinates" },
  area: {
    heading: "Open the centre of this area elsewhere",
    note: "This is an area. The links open the point that stands for it, which is not the place of an event.",
    copy: "Copy centre coordinates",
  },
  line: {
    heading: "Open the anchor point of this line elsewhere",
    note: "This is a line. The links open one point on or near it, which is not the place of an event.",
    copy: "Copy anchor coordinates",
  },
  country: {
    heading: "Open the centre of this country elsewhere",
    note: "This is a country figure. The links open the centre of the country, which is not the place of an event.",
    copy: "Copy centre coordinates",
  },
};
