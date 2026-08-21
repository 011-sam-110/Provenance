/**
 * Admission gates: the checks a candidate feed has to survive before a human is asked
 * to look at it, and the flags that human is shown when they do.
 *
 * The distinction between `fail` and `warn` is the whole design. A `fail` is a rule
 * this project has already settled and does not want re-litigated per feed — an
 * aggregator relaying somebody else's video cannot license it to us, so no amount of
 * "but the pictures look great" should admit one. A `warn` is a fact the reviewer
 * needs and the code cannot rule on: coordinates outside the declared country might be
 * a mis-mapped column or might be a border crossing, and only a person looking at the
 * picture can say which.
 *
 * The gates deliberately do NOT include "does the image load". That is a live network
 * fact that goes stale between the discovery run and the review, so it is measured in
 * the review UI, at the moment of review, against the real URL.
 *
 * Pure. No fetch. Every gate is a function of the candidate and the existing registry.
 */

import type { Camera } from "@/lib/types";
import type { FeedDescriptor, GateResult, SampleCamera } from "@/lib/discovery/types";
import { isBareIpHost } from "@/lib/sources/serbia.data";
import { COUNTRY_BOXES, haversineMetres } from "@/lib/discovery/geo";

export { COUNTRY_BOXES, haversineMetres };

/**
 * Hosts that relay other people's streams. Admission is refused rather than warned.
 *
 * The reasoning is licensing, not quality: a directory that republishes an operator's
 * video does not hold the rights to it, so it cannot pass those rights on and it
 * cannot be attributed honestly. kameresrbije.rs says so on its own privacy page. Its
 * robots.txt permitting the camera LIST is crawl permission for the list, not a
 * licence for the video — a distinction that cost a full review cycle to settle on
 * 2026-08-18 and is written down here so it is settled once.
 *
 * Windy is on this list even though the product carries a Windy layer: that layer is
 * keyed, attributed to Windy, and kept out of the camera registry on purpose. A Windy
 * URL arriving through DISCOVERY would be a second, unattributed copy.
 */
export const RELAY_HOSTS = [
  "windy.com",
  "webcamtaxi.com",
  "earthcam.com",
  "insecam.org",
  "opentopia.com",
  "skylinewebcams.com",
  "kameresrbije.rs",
  "trafficland.com",
  "worldcams.tv",
  "livecamsworld.com",
  "webcams.travel",
] as const;

/**
 * Hosts that publish other people's datasets without being their author.
 *
 * These are not relays — an ArcGIS Online feature service IS the agency's own data,
 * served on infrastructure the agency rents. But the media-origin check assumes the
 * endpoint host identifies the publisher, and on these it identifies Esri. The first
 * live run warned about all five candidates for the same wrong reason: "pictures come
 * from cwwp2.dot.ca.gov but the feed is published on services3.arcgis.com". That reads
 * as suspicion of Caltrans's own camera server, when the picture host is in fact the
 * BEST evidence of who the operator is.
 */
export const PLATFORM_HOSTS = ["arcgis.com", "socrata.com", "data.gov", "opendata.arcgis.com"] as const;

export function isPlatformHost(host: string): boolean {
  return PLATFORM_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

/** Registrable-ish host suffix match, so a subdomain of a relay is also a relay. */
export function isRelayHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return RELAY_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export interface GateInput {
  descriptor: FeedDescriptor;
  samples: SampleCamera[];
  parsed: { rows: number; valid: number };
  /** The licence string the catalogue recorded, if any. */
  catalogueLicense?: string;
  /** Cameras already in the registry, for the overlap check. May be empty offline. */
  existing?: Pick<Camera, "id" | "source" | "lat" | "lon">[];
  /**
   * Every feed key the registry is supposed to contain, so the overlap gate can tell
   * "checked and found nothing" from "had nothing to check against".
   *
   * Without it a clean pass is unfalsifiable: `existing` being non-empty proves only
   * that SOME feed answered, and a feed that did not answer contributes no cameras and
   * no error. See the overlap block below for the run this cost.
   */
  expectedSources?: string[];
}

const pass = (gate: string, detail: string): GateResult => ({ gate, status: "pass", detail });
const warn = (gate: string, detail: string): GateResult => ({ gate, status: "warn", detail });
const fail = (gate: string, detail: string): GateResult => ({ gate, status: "fail", detail });

/** How close two cameras have to be to be treated as probably the same camera. */
export const DUPLICATE_RADIUS_M = 60;

export function runGates(input: GateInput): GateResult[] {
  const { descriptor, samples, parsed } = input;
  const out: GateResult[] = [];

  // 1. Relay. Checked on the endpoint AND on every media host, because a candidate can
  //    be published by an operator and still serve a relayed picture.
  const relayHits = new Set<string>();
  if (isRelayHost(descriptor.endpoint)) relayHits.add(new URL(descriptor.endpoint).hostname);
  for (const s of samples) {
    for (const u of [s.imageUrl, s.streamUrl]) {
      if (u && isRelayHost(u)) {
        try {
          relayHits.add(new URL(u).hostname);
        } catch {
          /* unparseable urls are handled by the media-host gate */
        }
      }
    }
  }
  out.push(
    relayHits.size
      ? fail("relay", "Relays another operator's video: " + [...relayHits].join(", "))
      : pass("relay", "No known relay host on the endpoint or the media URLs."),
  );

  // 2. Bare-IP media hosts. normalizeFeed() already drops these, so a hit here means
  //    the feed is PARTLY made of them and the yield gate will not explain why.
  const bareIp = samples.filter((s) => [s.imageUrl, s.streamUrl].some((u) => u && isBareIpHost(u)));
  out.push(
    bareIp.length
      ? fail("media-host", bareIp.length + " sampled media URLs are on a bare IP address.")
      : pass("media-host", "All sampled media URLs are on named hosts."),
  );

  // 3. Yield. A parser that understands a feed converts nearly all of it.
  const yieldPct = parsed.rows > 0 ? parsed.valid / parsed.rows : 0;
  out.push(
    parsed.valid === 0
      ? fail("yield", "No row in " + parsed.rows + " became a valid camera.")
      : yieldPct < 0.5
        ? warn(
            "yield",
            "Only " + parsed.valid + " of " + parsed.rows + " rows parsed (" +
              Math.round(yieldPct * 100) + "%) — the column mapping is probably partly wrong.",
          )
        : pass("yield", parsed.valid + " of " + parsed.rows + " rows parsed (" + Math.round(yieldPct * 100) + "%)."),
  );

  // 4. Licence. Never a fail: plenty of legitimate operators publish cameras with no
  //    licence statement at all, and the honest response is to SAY that on the source,
  //    the way the cetsp adapter does. It is a fail only if someone invents one later.
  out.push(
    input.catalogueLicense
      ? pass("licence", "Catalogue states: " + input.catalogueLicense)
      : warn("licence", "No licence stated upstream. The descriptor must say so, not guess one."),
  );

  // 5. Transport. Mixed content is a real product break, not a style note: an http
  //    image inside an https page is blocked by the browser and the camera renders as
  //    a dead tile with no error anyone sees.
  const insecure = samples.filter((s) => [s.imageUrl, s.streamUrl].some((u) => u?.startsWith("http://")));
  out.push(
    insecure.length
      ? warn(
          "transport",
          insecure.length + " sampled media URLs are plain http and will be blocked as mixed content.",
        )
      : pass("transport", "All sampled media URLs are https."),
  );

  // 6. Country fit.
  const box = COUNTRY_BOXES[descriptor.country.toUpperCase()];
  if (!box) {
    out.push(warn("country-fit", "No bounding box on file for " + descriptor.country + " — not checked."));
  } else {
    const [minLat, minLon, maxLat, maxLon] = box;
    const outside = samples.filter(
      (s) => s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon,
    );
    out.push(
      outside.length === 0
        ? pass("country-fit", "Every sampled coordinate falls inside " + descriptor.country + ".")
        : outside.length >= samples.length * 0.5
          ? fail(
              "country-fit",
              outside.length + " of " + samples.length + " sampled coordinates are outside " +
                descriptor.country + " — the lat/lon columns are probably swapped.",
            )
          : warn(
              "country-fit",
              outside.length + " of " + samples.length + " sampled coordinates fall outside " +
                descriptor.country + ". Border sites do this legitimately; check them.",
            ),
    );
  }

  // 7. Overlap with what is already served. Re-adding a network under a second key
  //    double-counts every camera in the coverage figures, and that figure is quoted.
  const existing = input.existing ?? [];
  if (existing.length && samples.length) {
    const near = samples.filter((s) =>
      existing.some((e) => haversineMetres(s.lat, s.lon, e.lat, e.lon) < DUPLICATE_RADIUS_M),
    );
    const bySource = new Map<string, number>();
    for (const s of samples) {
      const hit = existing.find((e) => haversineMetres(s.lat, s.lon, e.lat, e.lon) < DUPLICATE_RADIUS_M);
      if (hit) bySource.set(hit.source, (bySource.get(hit.source) ?? 0) + 1);
    }
    const worst = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0];
    // WHICH FEEDS THIS SNAPSHOT ACTUALLY SPEAKS FOR.
    //
    // A live run passed an ArcGIS mirror of Caltrans District 4 with "no sampled
    // camera is already served". All twelve samples were within 50 m of a camera this
    // product already serves and eleven had byte-identical image URLs — the registry
    // read simply had no `caltrans` cameras in it that round, because a feed that
    // fails resolves to `[]` rather than throwing. `existing.length` was non-zero, so
    // the gate ran and reported a global absence it could not observe.
    //
    // A pass may only speak for the feeds in the snapshot. When any known feed is
    // missing the answer is "not checked", which is a warn, not a pass.
    const present = new Set(existing.map((e) => e.source));
    const absent = (input.expectedSources ?? []).filter((k) => !present.has(k));
    out.push(
      near.length === 0
        ? absent.length
          ? warn(
              "overlap",
              "No sampled camera matches one already served, but " + absent.length +
                " feed(s) were missing from the registry snapshot (" + absent.join(", ") +
                "), so this is not a clean check — a duplicate of those would look identical to this.",
            )
          : pass("overlap", "No sampled camera sits within " + DUPLICATE_RADIUS_M + " m of one already served.")
        : near.length >= samples.length * 0.8
          ? fail(
              "overlap",
              near.length + " of " + samples.length + " sampled cameras are already served, mostly by " +
                (worst?.[0] ?? "an existing feed") + ". This is the same network under a second key.",
            )
          : warn(
              "overlap",
              near.length + " of " + samples.length + " sampled cameras sit within " + DUPLICATE_RADIUS_M +
                " m of one already served (" + (worst?.[0] ?? "unknown") + ").",
            ),
    );
  }

  // 8. Media-host split. Not a verdict, a question worth asking: an endpoint on one
  //    domain serving pictures from another is either an ordinary CDN or a relay
  //    wearing an operator's clothes, and the two are indistinguishable from here.
  const endpointHost = safeHost(descriptor.endpoint);
  const mediaHosts = new Set<string>();
  for (const s of samples) for (const u of [s.imageUrl, s.streamUrl]) if (u) mediaHosts.add(safeHost(u));
  mediaHosts.delete("");
  if (isPlatformHost(endpointHost)) {
    // The dataset is hosted for the agency rather than by it, so the endpoint host says
    // nothing about the operator and the picture host says almost everything.
    out.push(
      mediaHosts.size
        ? warn(
            "media-origin",
            "The dataset is hosted on " + endpointHost + " for " + descriptor.name +
              ", so the endpoint host does not identify the operator. The pictures come from " +
              [...mediaHosts].join(", ") + " — that is the host to judge.",
          )
        : warn("media-origin", "No media host to check."),
    );
  } else {
    const foreign = [...mediaHosts].filter((h) => !sharesRegistrableRoot(h, endpointHost));
    out.push(
      foreign.length
        ? warn(
            "media-origin",
            "Pictures come from " + foreign.join(", ") + " but the feed is published on " + endpointHost +
              ". Confirm that is the operator's own CDN and not a relay.",
          )
        : pass("media-origin", "Pictures are served from the publishing domain."),
    );
  }

  return out;
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Do two hosts plausibly belong to the same organisation?
 *
 * Compares the last two labels, which is wrong for `.co.uk`-style suffixes, so those
 * are handled by comparing three labels when the second-to-last is a known
 * second-level suffix. This is a heuristic feeding a WARNING, not a rule feeding a
 * block — a full public-suffix list is a dependency, and this repo's ten runtime
 * dependencies are load bearing on the /privacy page's "no database" claim.
 */
export function sharesRegistrableRoot(a: string, b: string): boolean {
  if (!a || !b) return false;
  const root = (h: string) => {
    const parts = h.split(".");
    if (parts.length <= 2) return h;
    const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "gob", "gouv"]);
    const take = secondLevel.has(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-take).join(".");
  };
  return root(a) === root(b);
}

/** A candidate is admissible for review when no gate failed. */
export function isAdmissible(gates: GateResult[]): boolean {
  return !gates.some((g) => g.status === "fail");
}
