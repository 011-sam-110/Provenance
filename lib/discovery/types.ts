/**
 * Camera auto-discovery — the shared vocabulary.
 *
 * The premise of this subsystem is that adding a camera network should not require
 * writing an adapter. Every bespoke adapter in `lib/sources/` exists because someone
 * read one operator's JSON by hand and typed out the field names; twelve of them do
 * the same four things with different key spellings. So the shape below is that work
 * turned into DATA: an endpoint, a path to the rows, and which key holds the latitude.
 * `lib/sources/discovered.ts` reads these descriptors and produces `Camera[]`, so a
 * new network is a committed descriptor, not a new module.
 *
 * WHAT THIS SUBSYSTEM DELIBERATELY DOES NOT DO: decide. Discovery proposes; a human
 * admits. The sniffer in `sniff.ts` is a heuristic over other people's data and it
 * WILL mis-assign a column eventually — a `y` that is a projected metre, a `name`
 * that is really a road number, an `image` field holding a placeholder graphic. None
 * of those are detectable from the JSON alone, which is precisely why every candidate
 * lands in a review queue and nothing reaches the registry without a recorded human
 * verdict. See `docs/CAMERA_DISCOVERY.md`.
 */

/** Which key of an upstream row carries each field the registry needs. */
export interface FieldMapping {
  /** Dot-path to a stable per-camera identifier. Must be unique within the feed. */
  id: string;
  /** Dot-path to the operator's own display name for the site. */
  name: string;
  /** Dot-path to latitude in WGS84 degrees. */
  lat: string;
  /** Dot-path to longitude in WGS84 degrees. */
  lon: string;
  /** Dot-path to a still-image URL, if the feed publishes one. */
  imageUrl?: string;
  /** Dot-path to a video/HLS URL, if the feed publishes one. */
  streamUrl?: string;
  /** Dot-path to a road name or reference. Optional in `Camera`, so optional here. */
  road?: string;
  /** Dot-path to a region/area label. */
  region?: string;
  /** Dot-path to a direction of view ("NB", "looking north"). */
  direction?: string;
}

/** How the response body is shaped, which decides how rows are extracted. */
export type FeedFormat =
  /** A JSON body containing an array of flat row objects somewhere inside it. */
  | "json"
  /** RFC 7946 GeoJSON: `features[]`, each with `properties` and `geometry.coordinates`. */
  | "geojson"
  /** An ArcGIS FeatureServer query response: `features[]` with `attributes` + `geometry.x/y`. */
  | "arcgis";

/**
 * Everything `lib/sources/discovered.ts` needs to turn one endpoint into cameras.
 *
 * `license` and `attribution` are REQUIRED and are never invented. Where an operator
 * publishes no licence the honest string is the one `cetsp` uses — naming the operator
 * and saying plainly that no licence is stated — not a plausible-looking licence name.
 */
export interface FeedDescriptor {
  /** Registry key. Also the `source` field and the `id` prefix of every camera. */
  key: string;
  /** The operator's own name for itself, in the operator's own wording. */
  name: string;
  /** ISO-3166 alpha-2 of the country the cameras are in. */
  country: string;
  /** The URL fetched each refresh. */
  endpoint: string;
  format: FeedFormat;
  /**
   * Dot-path to the row array inside the response, or omitted when the body IS the
   * array. Ignored for `geojson`/`arcgis`, whose row locations are fixed by spec.
   */
  rowsPath?: string;
  mapping: FieldMapping;
  license: string;
  attribution: string;
  /** How often the operator actually refreshes, in seconds. Measured, not assumed. */
  refreshSeconds: number;
  /** The operator's public page for this camera network, for attribution links. */
  homepage?: string;
  /** Extra request headers some operators require (a `Referer`, an `Accept`). */
  headers?: Record<string, string>;
}

/** Where a candidate came from, so a reviewer can re-walk the same path. */
export interface Provenance {
  /** Which probe surfaced it: "ckan", "arcgis-hub", "seed", "vendor-fingerprint". */
  probe: string;
  /** The catalogue/portal/search endpoint that named it, verbatim. */
  discoveredVia: string;
  /** The publishing organisation as the catalogue records it, if it records one. */
  publisher?: string;
  /** The licence string the catalogue records. Copied, never normalised or improved. */
  catalogueLicense?: string;
  /** ISO timestamp of the discovery run. */
  foundAt: string;
}

/** One gate's verdict on a candidate. `fail` blocks admission; `warn` does not. */
export interface GateResult {
  gate: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

/** A camera pulled off the candidate feed for a human to look at. */
export interface SampleCamera {
  nativeId: string;
  name: string;
  lat: number;
  lon: number;
  imageUrl?: string;
  streamUrl?: string;
  road?: string;
}

/**
 * A proposed feed, everything known about it, and nothing decided.
 *
 * `confidence` is the sniffer's own opinion of its column assignment (0..1). It is an
 * ordering hint for the review queue and NOTHING ELSE — a 0.98 still requires a human
 * verdict, because the failure this subsystem actually fears (a confident, wrong pin)
 * scores high by construction.
 */
export interface Candidate {
  /** Stable across runs so verdicts survive re-discovery. Derived from the endpoint. */
  id: string;
  descriptor: FeedDescriptor;
  provenance: Provenance;
  gates: GateResult[];
  /** How many rows the probe parsed into valid cameras out of how many it saw. */
  parsed: { rows: number; valid: number };
  samples: SampleCamera[];
  confidence: number;
}

/** A human's decision about one camera inside a candidate feed. */
export interface CameraVerdict {
  candidateId: string;
  nativeId: string;
  verdict: "good" | "bad-image" | "bad-pin" | "not-a-camera" | "unsure";
  /** ISO timestamp of the decision. */
  at: string;
  /** Free-text note from the reviewer. Never leaves the repo. */
  note?: string;
}

/** A human's decision about a whole feed. This is the gate the registry honours. */
export interface FeedVerdict {
  candidateId: string;
  verdict: "admit" | "reject" | "hold";
  at: string;
  /** Why. Required for `reject` and `hold` so the queue does not re-propose blindly. */
  reason?: string;
}

/** The on-disk review state. One file, committed, diffable in a PR. */
export interface ReviewLedger {
  feeds: FeedVerdict[];
  cameras: CameraVerdict[];
}

/**
 * A descriptor that has been through review and carries the record of it.
 *
 * This is what ships. The review metadata is not decoration — it is the answer to
 * "who said this network was fine, when, and on the strength of how many cameras",
 * and without it an admitted feed is indistinguishable from one somebody pasted in.
 */
export interface AdmittedFeed extends FeedDescriptor {
  review: {
    /** Who took the decision. A person, or the agent session that stood in for one. */
    by: string;
    /** ISO date of the admission. */
    at: string;
    /** How many individual cameras were looked at before admitting the feed. */
    sampled: number;
    /** How many of those were judged good. */
    good: number;
    /** What the reviewer wants the next reader to know. */
    note?: string;
  };
  /**
   * Native ids a reviewer rejected: a dead picture, a pin in the wrong place, a
   * caravan park where a motorway should be. Blocked per camera rather than by
   * dropping the feed, because one bad camera is not a bad network.
   */
  blocked?: string[];
}
