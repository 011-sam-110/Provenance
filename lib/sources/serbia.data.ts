/**
 * Serbia — the gazetteer half of the two Serbian camera adapters.
 *
 * WHY THIS FILE EXISTS. Neither Serbian operator publishes a coordinate. The MUP
 * portal is a list of `toggleCamera(uuid, url1, url2)` calls behind a crossing
 * name; kamere.toll4all.com is a list of `<div class="cam-item" poster= src=>`
 * behind a station name. Both give us a NAME and a STREAM and nothing else, so
 * the pin has to come from somewhere, and that somewhere has to be checkable.
 *
 * WHERE THE COORDINATES CAME FROM. OpenStreetMap, via Overpass: every
 * `barrier=border_control` and `barrier=toll_booth` element inside Serbia's
 * bounding box, then matched to the operator's name BY HAND. Each row carries
 * the OSM element it was read from, so the number can be re-checked without
 * repeating the search. Data (c) OpenStreetMap contributors, ODbL.
 *
 * WHY BY HAND, AND WHY FOUR STATIONS ARE MISSING. The first pass matched names
 * automatically and it was wrong in exactly the way
 * lib/console/livecams/brazil.data.ts warns about: a lossy fold of "Djala" to
 * "ala" matched the crossing at BACKA PALANKA, 105 km away on a different
 * border. So every row below was read individually and cross-checked against
 * the neighbouring country the operator files it under, and anything that could
 * not be pinned to a NAMED OSM element was dropped rather than guessed:
 *
 *   Leskovac - OSM has TWO plazas, "Leskovac centar" and "Leskovac jug", 15 km
 *              apart. toll4all says only "Leskovac". A coin flip, so neither.
 *   Vrcin    - no toll plaza of that name in OSM. The nearest is "Beograd" on
 *              the A1, which is plausibly the same plaza under another name,
 *              and "plausibly" is not the same claim.
 *   Ruma     - an UNNAMED pair of toll booths sits where the A3 passes south of
 *              Ruma. Almost certainly it. Almost is not a coordinate.
 *   Vrba     - same shape: an unnamed booth 1.7 km from the village.
 *
 * That costs 8 of the 38 toll cameras. A pin in the wrong place is a worse
 * product than a missing pin, and this is a map.
 *
 * WHAT IS DELIBERATELY NOT HERE: `road`. The motorway ref is derivable from the
 * OSM parent way, but the query to establish all 31 of them would not return
 * inside a sane timeout, and `Camera.road` is optional. An unverified "A1" would
 * be the same class of mistake as an unverified pin.
 *
 * To re-verify one row (Overpass QL):
 *   [out:json];node(<osm id>);out center tags;
 */

/** A border crossing the MUP portal carries cameras for. */
export interface SerbiaBorderSite {
  /**
   * The path segment inside the MUP stream URL, e.g. `MaliZvornik` in
   * `https://kamere.mup.gov.rs:4443/MaliZvornik/malizvornik1.m3u8`. This is the
   * join key, NOT the display name: the name is read from the portal at fetch
   * time so it stays the operator's own wording.
   */
  key: string;
  /** ISO-3166 alpha-2 of the country on the far side. A cross-check, not output. */
  neighbour: string;
  lat: number;
  lon: number;
  /** OSM element the coordinate was read from. */
  osm: string;
}

/**
 * The 16 crossings on the MUP portal, every one verified to sit on the SERBIAN
 * side. Horgos is the row that needed real work: the only OSM element carrying
 * that name is the disused "Horgos 2 / Roszke 2" crossing on a primary road,
 * while the cameras are on the motorway crossing 600 m west. The row below is
 * the border-control node on way/693685273, tagged `ref=A1` — the Serbian
 * motorway — and not the Hungarian `ref=M5` node facing it.
 */
export const SERBIA_BORDER_SITES: SerbiaBorderSite[] = [
  // to Hungary
  { key: "Horgos", neighbour: "HU", lat: 46.1733, lon: 19.97584, osm: "node/951312138" },
  { key: "Kelebija", neighbour: "HU", lat: 46.16701, lon: 19.56142, osm: "node/974126073 +3" },
  { key: "Djala", neighbour: "HU", lat: 46.15743, lon: 20.11424, osm: "node/1614974595" },
  // to Montenegro
  { key: "Gostun", neighbour: "ME", lat: 43.18574, lon: 19.76036, osm: "node/289875181 +4" },
  { key: "Jabuka", neighbour: "ME", lat: 43.33753, lon: 19.47772, osm: "node/292103237 +1" },
  { key: "Spiljani", neighbour: "ME", lat: 42.91046, lon: 20.34124, osm: "node/295259158 +1" },
  // to Croatia
  { key: "Batrovci", neighbour: "HR", lat: 45.04726, lon: 19.1066, osm: "node/293933070 +4" },
  { key: "Sid", neighbour: "HR", lat: 45.1548, lon: 19.17521, osm: "node/3993798980 +1" },
  // to Romania
  { key: "Vatin", neighbour: "RO", lat: 45.22914, lon: 21.27667, osm: "node/1395848797 +2" },
  // to Bosnia and Herzegovina
  { key: "Kotroman", neighbour: "BA", lat: 43.76266, lon: 19.47016, osm: "node/2395001508 +2" },
  { key: "MaliZvornik", neighbour: "BA", lat: 44.40363, lon: 19.12604, osm: "node/1091326565" },
  { key: "SremskaRaca", neighbour: "BA", lat: 44.91655, lon: 19.30386, osm: "node/1909037501 +1" },
  { key: "Trbusnica", neighbour: "BA", lat: 44.54074, lon: 19.18475, osm: "node/426042899 +1" },
  // to Bulgaria
  { key: "Gradina", neighbour: "BG", lat: 42.99858, lon: 22.8313, osm: "node/1027943649 +3" },
  { key: "VrskaCuka", neighbour: "BG", lat: 43.85028, lon: 22.37892, osm: "node/1643958767 +2" },
  // to North Macedonia
  { key: "Presevo", neighbour: "MK", lat: 42.23979, lon: 21.70243, osm: "way/697622826" },
];

/** A motorway toll plaza kamere.toll4all.com carries cameras for. */
export interface SerbiaTollPlaza {
  /**
   * The station name exactly as the operator prints it, with the direction word
   * (`Ulaz` = entry, `Izlaz` = exit) removed. This is the join key.
   */
  station: string;
  lat: number;
  lon: number;
  /** OSM element the coordinate was read from. */
  osm: string;
}

/**
 * 15 of the 19 plazas on kamere.toll4all.com. See the header for the four that
 * are missing and why. Every row here matched a NAMED OSM toll_booth element.
 */
export const SERBIA_TOLL_PLAZAS: SerbiaTollPlaza[] = [
  { station: "Dimitrovgrad", lat: 43.02192, lon: 22.73643, osm: "node/4422069471" },
  { station: "Niš Jug", lat: 43.32757, lon: 21.81582, osm: "node/1637060629" },
  { station: "Niš Sever", lat: 43.34961, lon: 21.85813, osm: "node/1542578669" },
  { station: "Novi Sad Jug", lat: 45.28786, lon: 19.89044, osm: "node/2321341081" },
  { station: "Obrenovac", lat: 44.57129, lon: 20.19029, osm: "node/6738774623" },
  { station: "Pakovraće", lat: 43.90299, lon: 20.26156, osm: "node/7834692260" },
  { station: "Požarevac", lat: 44.58001, lon: 20.98246, osm: "node/6769000141" },
  { station: "Preševo", lat: 42.30264, lon: 21.70968, osm: "node/5521636563" },
  { station: "Prilipac", lat: 43.8205, lon: 20.09095, osm: "node/12957447628" },
  { station: "Smederevo", lat: 44.58996, lon: 20.95723, osm: "node/6638460804" },
  { station: "Stara Pazova", lat: 45.00648, lon: 20.20132, osm: "node/4138894601" },
  { station: "Subotica", lat: 46.02106, lon: 19.734, osm: "node/5265308125" },
  { station: "Šabac", lat: 44.80839, lon: 19.71923, osm: "node/11257279967" },
  { station: "Šid", lat: 45.04832, lon: 19.19241, osm: "node/611035828" },
  { station: "Šimanovci", lat: 44.88212, lon: 20.11373, osm: "node/32403710" },
];

/**
 * Decode the HTML entities the two Serbian portals actually emit, so a name
 * reaches the map the way the operator wrote it.
 *
 * The two portals escape DIFFERENTLY, which is why this handles both forms.
 * MUP uses named entities and only for its s-caron (`Horgo&scaron;`,
 * `&Scaron;id`) while leaving the c-caron in `Rača` and the d-stroke in `Đala`
 * as literal UTF-8. toll4all uses numeric entities and for every diacritic it
 * has: `Ni&#353;`, `Pakovra&#263;e`, `Po&#382;arevac`. So this covers the named
 * pair, both numeric forms, and the five entities any HTML can carry, and
 * deliberately stops there rather than pulling in a parser for two pages whose
 * escaping we have measured.
 */
export function decodeHtmlEntities(s: string): string {
  const NAMED: Record<string, string> = {
    scaron: "š",
    Scaron: "Š",
    // The rest of the region's Latin-Extended-A set. Added when BIHAMK was wired
    // up (lib/sources/bihamk.ts), which shares this decoder: Bosnian crossing
    // names carry č, ć, ž and đ, and an undecoded "&ccaron;" would ship a camera
    // labelled "Bija&ccaron;a". Note these are the CARON forms — ç (&ccedil;) is
    // French and does not appear in any of these languages, so it is deliberately
    // not in this map.
    ccaron: "č",
    Ccaron: "Č",
    cacute: "ć",
    Cacute: "Ć",
    zcaron: "ž",
    Zcaron: "Ž",
    dstrok: "đ",
    Dstrok: "Đ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED[name] ?? m);
}

/**
 * Reject a URL whose host is a bare IP literal rather than a resolvable name.
 *
 * This is a RULE, not a hand-written exclusion list, because the thing it guards
 * against recurs. The directory that pointed at these operators
 * (kameresrbije.rs) also lists a handful of MJPEG boxes on bare `IP:port`
 * addresses — an unsecured camera that has leaked, not a feed anyone published.
 * Indexing those into a searchable map is a different product from showing
 * public road infrastructure, and the difference belongs in code so it survives
 * the next time a source list grows.
 *
 * Both adapters run every URL through this before emitting a camera, so a
 * future edit that pastes in a raw-IP stream drops it instead of shipping it.
 */
export function isBareIpHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return true; // unparseable is not a domain we can stand behind either
  }
  // URL() wraps IPv6 literals in brackets.
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}
