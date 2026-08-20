/**
 * The two pieces of geography both the sniffer and the gates need, in one place so
 * neither imports the other.
 */

/** Metres between two WGS84 points. Haversine; good to well under a metre at this scale. */
export function haversineMetres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Rough WGS84 bounding boxes, as [minLat, minLon, maxLat, maxLon].
 *
 * These are deliberately generous and deliberately incomplete. A bounding box is not a
 * border — France's box contains Switzerland — so the only claim any of them supports
 * is "that coordinate is nowhere near where you said it is". That is the mistake worth
 * catching: a swapped lat/lon column puts a British camera network in the Indian
 * Ocean, not two towns over. An unlisted country returns no opinion rather than a
 * guess, and every caller has to handle `undefined` for exactly that reason.
 *
 * US and CA cover the contiguous mainland only. Alaska, Hawaii and the far north are
 * omitted knowingly: including them widens the box across a third of the planet and
 * costs the check the only thing it is good at. A camera in Anchorage will be flagged
 * for a human, which is the correct outcome for a box this crude.
 */
export const COUNTRY_BOXES: Record<string, [number, number, number, number]> = {
  GB: [49.8, -8.7, 61.0, 2.0],
  IE: [51.3, -10.7, 55.5, -5.3],
  US: [24.4, -125.0, 49.4, -66.9],
  CA: [41.6, -141.1, 60.1, -52.6],
  NZ: [-47.5, 166.3, -34.0, 178.6],
  AU: [-43.7, 112.9, -10.0, 153.7],
  IS: [63.2, -24.6, 66.6, -13.4],
  EE: [57.5, 21.7, 59.7, 28.2],
  FI: [59.7, 19.0, 70.1, 31.6],
  NO: [57.9, 4.5, 71.2, 31.2],
  SE: [55.3, 10.9, 69.1, 24.2],
  DK: [54.5, 8.0, 57.8, 15.2],
  NL: [50.7, 3.3, 53.6, 7.3],
  BE: [49.4, 2.5, 51.5, 6.4],
  DE: [47.2, 5.8, 55.1, 15.1],
  FR: [41.3, -5.2, 51.2, 9.6],
  ES: [35.9, -9.4, 43.8, 3.4],
  PT: [36.9, -9.6, 42.2, -6.1],
  IT: [35.4, 6.6, 47.1, 18.6],
  CH: [45.8, 5.9, 47.9, 10.5],
  AT: [46.3, 9.5, 49.1, 17.2],
  PL: [49.0, 14.1, 54.9, 24.2],
  CZ: [48.5, 12.0, 51.1, 18.9],
  RS: [42.2, 18.8, 46.2, 23.0],
  BR: [-33.8, -74.0, 5.3, -34.8],
  JP: [24.0, 122.9, 45.6, 153.0],
  ZA: [-34.9, 16.4, -22.1, 32.9],
  SG: [1.15, 103.6, 1.48, 104.1],
};

export function countryBox(country: string | undefined): [number, number, number, number] | undefined {
  return country ? COUNTRY_BOXES[country.toUpperCase()] : undefined;
}

export function insideBox(lat: number, lon: number, box: [number, number, number, number]): boolean {
  return lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
}

/**
 * Which country a set of coordinates is in, when nobody said.
 *
 * ArcGIS Hub and Socrata are multi-country catalogues and neither records a country
 * per dataset, so a candidate from them arrives with no hint at all — and `country` is
 * not cosmetic here: `CameraSchema` requires two characters, it prefixes nothing but
 * it drives the country-fit gate, the map's own filters and the coverage tables. A
 * literal "??" shipping into the registry would be a camera in no country.
 *
 * The rule is deliberately narrow. A box must contain nearly every sample, and where
 * several do — the US and Canadian boxes overlap across the whole northern border, and
 * France's contains Switzerland — the SMALLEST is taken, because a box that contains
 * the points and less of everything else is the better fit. That is a heuristic and it
 * can be wrong at a border, so the caller records that the country was inferred rather
 * than read, and the reviewer sees a picture of an American interstate next to the
 * letters US and can say so.
 *
 * Returns null rather than a guess when no box fits, which leaves the candidate
 * without a country and its country-fit gate saying it did not check.
 */
export function inferCountry(points: Array<{ lat: number; lon: number }>): string | null {
  if (points.length === 0) return null;
  const need = points.length * 0.95;
  const fits: Array<{ code: string; area: number }> = [];
  for (const [code, box] of Object.entries(COUNTRY_BOXES)) {
    const hits = points.filter((p) => insideBox(p.lat, p.lon, box)).length;
    if (hits >= need) fits.push({ code, area: (box[2] - box[0]) * (box[3] - box[1]) });
  }
  if (fits.length === 0) return null;
  fits.sort((a, b) => a.area - b.area || a.code.localeCompare(b.code));
  return fits[0].code;
}
