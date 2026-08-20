/**
 * Bosnia and Herzegovina — the gazetteer half of the BIHAMK camera adapter.
 *
 * WHY THIS FILE EXISTS. Same reason as lib/sources/serbia.data.ts: the operator
 * publishes a NAME and a PICTURE and no coordinate. BIHAMK's viewer is a list of
 * `<img alt="GP Bijača" src="https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg">`
 * behind a heading, with no map, no lat/lon and no station table. The pin has to
 * come from somewhere, and that somewhere has to be checkable by someone who
 * doesn't trust us.
 *
 * WHERE THE COORDINATES CAME FROM. OpenStreetMap. Every row below carries the OSM
 * element its number was read from, so it can be re-checked without repeating the
 * search. Border crossings came from an Overpass query for every
 * `barrier=border_control` element inside Bosnia and Herzegovina, matched to the
 * operator's own crossing name BY HAND; the three non-border sites were resolved
 * individually and are noted as such below. Data © OpenStreetMap contributors,
 * ODbL.
 *
 * WHY BY HAND, AND WHY THREE CAMERAS ARE MISSING. Automatic name matching is how
 * you put a pin 105 km into the wrong country (see the Đala/Bačka Palanka note in
 * serbia.data.ts). So each row was read individually, and anything that could not
 * be tied to a NAMED OSM element was dropped rather than guessed:
 *
 *   Prisika   - the operator calls it "GP Prisika (Aržano)". OSM has no element
 *               named Prisika at that crossing. The two candidates nearby are
 *               named for the CROATIAN side — "Granični prijelaz Aržano"
 *               (node/285487726) and "Granični prijelaz Aržano-Pazar"
 *               (node/10021268149) — and they sit 2.4 km apart, so picking one
 *               would be inventing both the name and the choice.
 *   Briješće  - OSM has TWO `highway=motorway_junction` nodes both named
 *               "Briješće" (node/3843858770 and node/3873169289), 1,057 m apart
 *               on the same road. The operator says only "Raskrsnica Briješće".
 *               A coin flip, so neither. (The "PROVING" in the operator's label
 *               is a firm, not a place: its office is node/2164981017, 3.5 km
 *               east of both junctions, so it disambiguates nothing.)
 *   Siporex   - labelled "RICO - Tuzla". Neither "RICO" nor "Siporex" resolves to
 *               any named OSM element in Tuzla — both are commercial names, not
 *               places. Nothing to pin to at all.
 *
 * That costs 3 of the 15 published cameras. A pin in the wrong place is a worse
 * product than a missing pin, and this is a map.
 *
 * ON THE TWO SITES THAT ARE NOT BORDER CROSSINGS OR PASSES. Skenderija is pinned
 * to the named SUBURB node, which is the level the operator names it at
 * ("Sarajevo-Skenderija") — neighbourhood precision, not a surveyed camera
 * position, and it is written down here so nobody later reads that pin as more
 * exact than it is. Stup is different and better: the operator's own label is
 * "Stupska petlja" and OSM carries a junction node of exactly that name, so that
 * row is as tight as a border crossing.
 *
 * WHY BROD IS TWO CAMERAS AND ONE COORDINATE. The operator publishes BROD1 and
 * BROD2 and — unlike Serbia's MUP, which numbers its streams and labels neither —
 * says which is which: "GP Brod - Ulaz u BiH" (entry) and "GP Brod - Izlaz iz BiH"
 * (exit). They are two views of one crossing, so they share node/1588412042 and
 * differ only in `direction`, which is read from the operator's wording rather
 * than inferred from the filename.
 *
 * To re-verify one row (Overpass QL):
 *   [out:json];node(<osm id>);out;
 */

/** One BIHAMK camera site, joined to the operator's image by `key`. */
export interface BihamkSite {
  /**
   * The filename stem inside the image URL, e.g. `BIJACA` in
   * `https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg`. This is the
   * JOIN KEY, not the display name — the name is read off the page at fetch time
   * so it stays the operator's own wording, in the operator's own spelling.
   */
  key: string;
  lat: number;
  lon: number;
  /** OSM element the coordinate was read from. */
  osm: string;
  /**
   * Direction of travel, where the OPERATOR states it. Only the two Brod cameras
   * do; everything else is left undefined rather than guessed from the view.
   */
  direction?: string;
}

/**
 * The 12 pinnable cameras of the 15 BIHAMK publishes.
 *
 * Nine are border crossings, one is a mountain pass and two are in Sarajevo. Every
 * crossing was checked to sit on the BOSNIAN side: Izačić is the row that needed
 * the most care, because the only OSM element carrying that name is the joint
 * "Granični prijelaz Izačić - Ličko Petrovo Selo" node, which is named for both
 * sides at once — it is the crossing itself rather than either country's post, and
 * the camera looks at that crossing, so it is the honest pin.
 */
export const BIHAMK_SITES: BihamkSite[] = [
  // ---- Border crossings (GP = granični prijelaz) ----
  { key: "BIJACA", lat: 43.123234, lon: 17.574934, osm: "node/2424868070" },
  { key: "BROD1", lat: 45.146224, lon: 18.005913, osm: "node/1588412042", direction: "Ulaz u BiH" },
  { key: "BROD2", lat: 45.146224, lon: 18.005913, osm: "node/1588412042", direction: "Izlaz iz BiH" },
  { key: "CRVENIGRM", lat: 43.161537, lon: 17.478455, osm: "node/6193942854" },
  { key: "DOLJANI", lat: 43.052744, lon: 17.675462, osm: "node/1914177733" },
  { key: "IZACIC", lat: 44.875152, lon: 15.764014, osm: "node/1415914966" },
  { key: "KAMENSKO", lat: 43.611217, lon: 16.976045, osm: "node/1983711904" },
  { key: "ORASJE", lat: 45.031283, lon: 18.70221, osm: "node/1836755294" },
  { key: "SEPAK", lat: 44.54285, lon: 19.180809, osm: "node/2538846007" },
  // ---- Mountain pass ----
  // natural=saddle, 1,123 m, on the M-16.2 between Prozor-Rama and Gornji Vakuf.
  { key: "MAKLJEN", lat: 43.844957, lon: 17.593759, osm: "node/311636728" },
  // ---- Sarajevo ----
  // place=suburb. Neighbourhood precision — see the note at the top of this file.
  { key: "SKENDERIJA", lat: 43.855159, lon: 18.413924, osm: "node/2043629667" },
  // junction=yes, named "Stupska petlja" — the operator's own words.
  { key: "STUP", lat: 43.842892, lon: 18.328838, osm: "node/7042316244" },
];

/** Site lookup by image-filename stem. */
export const BIHAMK_SITES_BY_KEY: ReadonlyMap<string, BihamkSite> = new Map(
  BIHAMK_SITES.map((s) => [s.key, s]),
);
