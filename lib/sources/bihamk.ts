import { Camera, CameraArray, Source } from "@/lib/types";
import { decodeHtmlEntities, isBareIpHost } from "@/lib/sources/serbia.data";
import { BIHAMK_SITES, BIHAMK_SITES_BY_KEY, type BihamkSite } from "@/lib/sources/bihamk.data";

// Bosnia and Herzegovina — BIHAMK (Bosanskohercegovački auto-moto klub), the
// national automobile club, publishes 15 road cameras on its own portal at
// bihamk.ba/spi/kamere: nine border crossings, one mountain pass, and sites in
// Sarajevo and Tuzla. Still JPEGs on the club's own host. Keyless.
//
// WHY BIHAMK AND NOT ONE OF THE DIRECTORIES. The same reasoning as the two Serbian
// adapters, and it matters more here because BiH has more of them. kamere.app
// aggregates "99 cameras" for BiH by relaying other people's streams, and
// enovosti.ba, 033.ba and rtvmo.ba each republish the same pictures under their own
// banner. None of them operate a camera, so none of them can grant a right to the
// picture. BIHAMK does operate these — it installed them, it hosts them on
// video-nadzor.bihamk.ba, and it is who the attribution below names.
//
// WHAT IS READ FROM WHERE. The portal decides the camera LIST and the camera NAME;
// ./bihamk.data.ts decides the COORDINATE. Names are taken from the operator's own
// `alt` text, in the operator's own spelling (so "GP Bijača" keeps its č), because
// the alternative is us transliterating a foreign-language label and getting to be
// wrong about it. Three of the 15 have no defensible coordinate and are absent by
// construction — that file lists them by name and says why.
//
// AVAILABILITY IS DECIDED BY AGE, NOT BY STATUS CODE. Every one of the 15 answers
// HTTP 200 forever, including the ones that stopped updating: measured on
// 2026-08-20, Bijača's last frame was 20 HOURS old and Makljen's was 2h45m, while
// the live ones (Stup, Skenderija, Orašje, Šepak) were all inside 3 minutes. So a
// round of HEADs reads Last-Modified and the age decides `available`, exactly as
// lib/sources/cetsp.ts does for São Paulo and for exactly the same reason —
// counting 200s here would report 12 live Bosnian cameras and be wrong by at least
// two.
//
// To re-check the portal by hand:
//   curl -s https://bihamk.ba/spi/kamere | grep -o 'videosurveillence/[A-Z0-9]*\.jpg'

const PORTAL_URL = "https://bihamk.ba/spi/kamere";
/** The only host this adapter will emit an image URL for. */
const IMAGE_HOST = "video-nadzor.bihamk.ba";

/**
 * How old a frame may be and still count as a live camera.
 *
 * Deliberately the same 60 minutes as lib/sources/cetsp.ts. The two adapters face
 * the identical failure — a still server that keeps returning 200 long after the
 * camera behind it stopped — and separating "the operator paused for a bit" from
 * "this has been dead since yesterday" wants the same slack in both places. The
 * live BIHAMK cameras cycle in ~3 minutes, so this is 20× their cadence and still
 * an order of magnitude under the staleness it is here to catch.
 */
export const MAX_FRAME_AGE_MS = 60 * 60 * 1000;

export const BIHAMK_SOURCE: Source = {
  id: "bihamk",
  name: "BIHAMK — Bosanskohercegovački auto-moto klub",
  // No open-data licence is published for this portal. Saying so plainly is more
  // useful than inventing a licence name, and matches how cetsp and the Serbian
  // adapters record the same gap.
  license: "BIHAMK — public road-camera viewer (no stated licence)",
  attribution: "Live road-camera images © BIHAMK (Bosanskohercegovački auto-moto klub)",
  // The live cameras were measured cycling in ~3 minutes; 180s is that cadence, not
  // a round number chosen for looking tidy.
  refreshSeconds: 180,
  needsKey: false,
};

/** One camera as the portal publishes it, before it is joined to a coordinate. */
export interface BihamkPortalCamera {
  /** Image-filename stem, e.g. `BIJACA`. The join key into the gazetteer. */
  key: string;
  /** The operator's own label, e.g. `GP Bijača`. */
  name: string;
}

/** One camera's freshness probe. */
export interface BihamkProbe {
  key: string;
  lastModifiedMs: number | null;
}

export function imageUrl(key: string): string {
  return `https://${IMAGE_HOST}/videosurveillence/${key}.jpg`;
}

/**
 * Lift the camera list off the portal HTML.
 *
 * Pure and separately tested, because this is the part that silently rots: a
 * markup change upstream turns 15 cameras into 0, and a test that only exercised
 * `fetchRegistry` would need the network to notice.
 *
 * Only images on the club's own host count, and a bare-IP host is refused outright
 * (isBareIpHost) — the same guard the Serbian adapters use, for the same reason:
 * an unsecured camera behind an IP address is not a network anyone published, and
 * this project does not put those on a map.
 */
export function parsePortal(html: string): BihamkPortalCamera[] {
  const out: BihamkPortalCamera[] = [];
  const seen = new Set<string>();
  const re = /<img\s+alt="([^"]*)"\s+src="(https?:\/\/[^"]+\/videosurveillence\/([A-Za-z0-9_-]+)\.jpg[^"]*)"/g;
  for (const m of html.matchAll(re)) {
    const [, rawAlt, src, key] = m;
    if (seen.has(key)) continue;
    let host: string;
    try {
      host = new URL(src).hostname;
    } catch {
      continue;
    }
    if (host !== IMAGE_HOST || isBareIpHost(src)) continue;
    const name = decodeHtmlEntities(rawAlt).replace(/\s+/g, " ").trim();
    if (!name) continue;
    seen.add(key);
    out.push({ key, name });
  }
  return out;
}

/**
 * Join the portal's cameras to their coordinates and this round's freshness.
 *
 * Pure, so both rules that matter here — the age rule and the drop rule — are
 * testable without the network.
 *
 * A camera the portal publishes but the gazetteer cannot pin is DROPPED, not
 * pinned approximately. That is the opposite of what cetsp does with an unusable
 * probe (it keeps the camera and marks it unavailable), and the difference is
 * deliberate: an un-probed camera still has a true position, whereas an un-pinned
 * one has no honest place on a map at all. ./bihamk.data.ts names the three this
 * currently costs.
 */
export function normalizeBihamk(
  portal: readonly BihamkPortalCamera[],
  probes: readonly BihamkProbe[],
  now: number,
  sites: readonly BihamkSite[] = BIHAMK_SITES,
  maxAgeMs: number = MAX_FRAME_AGE_MS,
): Camera[] {
  const byKey = sites === BIHAMK_SITES ? BIHAMK_SITES_BY_KEY : new Map(sites.map((s) => [s.key, s]));
  const probeByKey = new Map(probes.map((p) => [p.key, p]));
  const out: Camera[] = [];
  for (const cam of portal) {
    const site = byKey.get(cam.key);
    if (!site) continue; // no defensible coordinate — see the file header
    const lm = probeByKey.get(cam.key)?.lastModifiedMs ?? null;
    // A future-dated header is a clock disagreement, not freshness — clamp to 0.
    const ageMs = lm === null ? null : Math.max(0, now - lm);
    out.push({
      id: `bihamk:${cam.key}`,
      source: "bihamk",
      country: "BA",
      region: "Bosnia and Herzegovina",
      name: cam.name,
      lat: site.lat,
      lon: site.lon,
      imageUrl: imageUrl(cam.key),
      mediaType: "jpeg",
      ...(site.direction ? { direction: site.direction } : {}),
      refreshSeconds: BIHAMK_SOURCE.refreshSeconds,
      license: BIHAMK_SOURCE.license,
      attribution: BIHAMK_SOURCE.attribution,
      available: ageMs !== null && ageMs <= maxAgeMs,
      ...(lm !== null ? { lastSampledAt: new Date(lm).toISOString() } : {}),
    });
  }
  return out;
}

/**
 * HEAD one still for its Last-Modified. HEAD rather than GET so a refresh costs
 * headers instead of ~12 × 55 KB of JPEG we would discard — the images themselves
 * are fetched by the client through /api/proxy.
 *
 * One camera failing must not fail the round, so every probe resolves.
 */
async function probeFrame(key: string): Promise<BihamkProbe> {
  try {
    const res = await fetch(imageUrl(key), {
      method: "HEAD",
      headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return { key, lastModifiedMs: null };
    const header = res.headers.get("last-modified");
    if (!header) return { key, lastModifiedMs: null };
    const parsed = Date.parse(header);
    return { key, lastModifiedMs: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return { key, lastModifiedMs: null };
  }
}

export async function fetchRegistry(): Promise<Camera[]> {
  const res = await fetch(PORTAL_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BIHAMK cameras: ${res.status}`);
  const portal = parsePortal(await res.text());
  // Probe only what we can actually place, so an unpinned camera costs no request.
  const pinned = portal.filter((c) => BIHAMK_SITES_BY_KEY.has(c.key));
  const probes = await Promise.all(pinned.map((c) => probeFrame(c.key)));
  return CameraArray.parse(normalizeBihamk(portal, probes, Date.now()));
}
