/**
 * The twelve feeds that never ask their upstream for a stream, and how to ask.
 *
 * WHY THIS LIST EXISTS. `isLiveStreamUrl` means "this stream URL matches one of four
 * rules in lib/proxy/hls-allowlist.ts", so the product can only ever call a camera live
 * if some adapter parsed a stream URL for it in the first place. A grep on 2026-09-07
 * found that only five of the seventeen adapters read a stream field at all —
 * caltrans, scdot, serbia-borders, serbia-tolls and tfl — and four of those five are
 * the four feeds that are already live. The fifth, tfl, parses an MP4 clip.
 *
 * So the headroom is not "streams stuck behind a narrow allowlist". It is these twelve,
 * where nobody has ever looked. This table is the question, not the answer: every URL
 * here is copied from the adapter that already uses it, so a finding can be traced back
 * to the same endpoint the product reads in production.
 *
 * `pages` is the second level of the search. Many operator portals publish only
 * coordinates through their API and put the stream in the page that plays it, so a
 * feed that looks stream-free at level 1 may not be. Where this project knows a real
 * viewer page it is named; otherwise the portal root is used, because that is where
 * player configuration usually lives. A feed with no pages listed is reported as
 * "level 2 not attempted", never as "no stream".
 */

export interface FeedRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** How to read the response. `json` is parsed and walked; `text` is regex-scanned. */
  as: "json" | "text";
}

export interface SilentFeed {
  /** The registry key, so a finding maps onto a real feed. */
  key: string;
  label: string;
  /** Level 1: the endpoint the production adapter already reads. */
  requests: FeedRequest[];
  /** Level 2: pages that might carry a player. */
  pages: string[];
  /** Anything a reader needs to not misread the result for this feed. */
  note?: string;
}

const UA = "TrafficNerd/2.0 liveness (+https://github.com/011-sam-110/Provenance)";

const json = (url: string): FeedRequest => ({
  url,
  as: "json",
  headers: { Accept: "application/json", "User-Agent": UA },
});

const text = (url: string): FeedRequest => ({
  url,
  as: "text",
  headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": UA },
});

/**
 * For endpoints that are not HTML and reject an HTML Accept header.
 *
 * TripCheck answers `406 Not Acceptable` to `Accept: text/html` on its inventory .js,
 * and a 406 recorded as "no stream found" would have written off Oregon on the strength
 * of our own request header. The adapter that reads this endpoint in production does
 * not send an HTML Accept either.
 */
const anyType = (url: string): FeedRequest => ({
  url,
  as: "text",
  headers: { Accept: "*/*", "User-Agent": UA },
});

export const SILENT_FEEDS: SilentFeed[] = [
  {
    key: "castlerock",
    label: "Castle Rock 511 platform",
    // Two systems rather than all ten. Every 511 site here runs the SAME Castle Rock
    // platform, so "does this platform expose a stream field" is answered by one
    // system, and asking ten costs ten times the requests to answer the same question.
    // If either answers differently from the other, that itself is the finding.
    requests: [
      {
        url: "https://fl511.com/List/GetData/Cameras",
        method: "POST",
        as: "json",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "User-Agent": UA,
        },
        body: "draw=1&start=0&length=100",
      },
      {
        url: "https://511on.ca/List/GetData/Cameras",
        method: "POST",
        as: "json",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "User-Agent": UA,
        },
        body: "draw=1&start=0&length=100",
      },
    ],
    pages: ["https://fl511.com/map", "https://511on.ca/map"],
    note: "13,180 cameras and 65% of the registry. The single highest-value answer here.",
  },
  {
    key: "tripcheck",
    label: "Oregon DOT TripCheck",
    requests: [anyType("https://tripcheck.com/Scripts/map/data/cctvinventory.js")],
    pages: ["https://tripcheck.com/", "https://tripcheck.com/map"],
    note: "Level 1 is a JS file, so it is scanned as text rather than parsed as JSON.",
  },
  {
    key: "drivebc",
    label: "DriveBC",
    requests: [json("https://www.drivebc.ca/api/webcams/")],
    pages: ["https://www.drivebc.ca/"],
  },
  {
    key: "digitraffic",
    label: "Fintraffic Digitraffic weathercams",
    requests: [json("https://tie.digitraffic.fi/api/weathercam/v1/stations")],
    pages: ["https://www.digitraffic.fi/", "https://liikennetilanne.fintraffic.fi/"],
  },
  {
    key: "nzta",
    label: "NZTA Waka Kotahi",
    requests: [json("https://trafficnz.info/service/traffic/rest/4/cameras/all")],
    pages: ["https://www.journeys.nzta.govt.nz/"],
  },
  {
    key: "trafficscotland",
    label: "Traffic Scotland",
    requests: [text("https://www.traffic.gov.scot/tsis/cameras")],
    pages: ["https://www.traffic.gov.scot/"],
  },
  {
    key: "iceland",
    label: "Vegagerdin (Iceland)",
    requests: [json("https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1")],
    pages: ["https://www.vegagerdin.is/", "https://umferdin.is/"],
  },
  {
    key: "estonia",
    label: "Transpordiamet (Estonia)",
    requests: [
      json(
        "https://tarktee.transpordiamet.ee/tarktee/rest/services/tram/road_cameras/MapServer/0/query?where=1=1&outFields=*&outSR=4326&f=json",
      ),
    ],
    pages: ["https://tarktee.transpordiamet.ee/"],
  },
  {
    key: "cetsp",
    label: "CET Sao Paulo",
    requests: [text("https://cameras.cetsp.com.br/View/Cam.aspx")],
    pages: ["https://cameras.cetsp.com.br/View/Cam.aspx"],
    note: "The adapter reads a hand-built table; View/Cam.aspx is the operator own viewer.",
  },
  {
    key: "bihamk",
    label: "BIHAMK (Bosnia and Herzegovina)",
    requests: [text("https://bihamk.ba/spi/kamere")],
    pages: ["https://bihamk.ba/spi/kamere"],
    note: "Level 1 IS the portal HTML, so level 2 adds nothing here and is not counted twice.",
  },
  {
    key: "act-pr",
    label: "ACT Puerto Rico",
    requests: [
      {
        url: "https://its.act.pr.gov/es/Default.aspx/GetCctv",
        method: "POST",
        as: "json",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
        body: "{}",
      },
    ],
    pages: ["https://its.act.pr.gov/es/Default.aspx"],
    note: "HTTP/2 transport required upstream; a malformed-header failure here is OUR bug, not a missing stream.",
  },
  {
    key: "tfl",
    label: "Transport for London JamCams",
    requests: [json("https://api.tfl.gov.uk/Place/Type/JamCam")],
    pages: ["https://tfl.gov.uk/traffic/status/"],
    note: "The one adapter that DOES parse a stream field, listed because what it parses is an MP4 clip rather than a live stream. Included to confirm that reading rather than assume it.",
  },
];

/** Every feed key this measurement covers, for the report to assert completeness. */
export const SILENT_FEED_KEYS = SILENT_FEEDS.map((f) => f.key);
