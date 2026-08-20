import { Camera, CameraArray, Source } from "@/lib/types";
import { withH2Session, h2Request } from "@/lib/http/h2";

// Puerto Rico — ACT (Autoridad de Carreteras y Transportación), the island's
// highways and transportation authority, publishes its ITS camera layer on its own
// portal at its.act.pr.gov. 31 cameras across the San Juan metropolitan area, with
// the operator's OWN coordinates. Keyless.
//
// WHY THIS IS THE FIRST CARIBBEAN FEED AND WHY IT WAS EASY. Unlike the Balkan
// adapters, ACT publishes a latitude and a longitude per camera, so there is no
// gazetteer beside this file and no hand-matching: the pin is the operator's claim
// about its own hardware, which is the strongest provenance a coordinate can have.
//
// THE ENDPOINT IS AN ASP.NET PAGE METHOD, which is why this POSTs an empty JSON
// body to a `.aspx/Name` path and reads the answer out of the ASP.NET `d` envelope
// rather than GETting something REST-shaped. The portal's own map calls exactly
// this. There is a sibling `Default.aspx/GetVds` (vehicle detectors) that we do not
// read — it carries no camera.
//
// AVAILABILITY IS DECIDED BY AGE, NOT BY THE LIST. Every camera ACT lists is served
// by IIS forever whether or not the camera behind it still writes frames. Measured
// on 2026-08-20 across all 31: twenty-nine were under a minute old, "ISLET OF SAN
// JUAN ENTRANCE" was 209 HOURS old, and one more answered HTTP 500. So a round of
// HEADs reads Last-Modified and the age decides `available` — the same rule, and
// the same 60-minute threshold, as lib/sources/cetsp.ts and lib/sources/bihamk.ts.
// Presenting 31 live Puerto Rican cameras would be wrong by two.
//
// THIS ADAPTER DOES NOT USE `fetch`, and that is not a style choice. ACT's IIS
// emits a ` Permissions-Policy` header with a LEADING SPACE, which HTTP/1.1 reads
// as an obs-fold continuation and Node refuses outright — `fetch()` throws
// "Unexpected whitespace after header value" and returns nothing at all. curl
// tolerates it, so the endpoint probes clean by hand and then fails the moment the
// adapter runs. lib/http/h2.ts talks to this host over HTTP/2 instead, where the
// defect is not representable. Read that file before changing anything here.
//
// To re-check the feed by hand (curl is lenient where Node is not):
//   curl -s -X POST https://its.act.pr.gov/es/Default.aspx/GetCctv \
//        -H 'Content-Type: application/json' -d '{}'

const ENDPOINT = "https://its.act.pr.gov/es/Default.aspx/GetCctv";
const ORIGIN = "https://its.act.pr.gov";
/** The only host this adapter will emit an image URL for. */
const IMAGE_HOST = "its.act.pr.gov";

/**
 * How old a frame may be and still count as a live camera. Deliberately the same
 * 60 minutes as cetsp and bihamk — see either for the reasoning. The live ACT
 * cameras were measured under a minute old, so this is enormous slack against a
 * staleness measured in days.
 */
export const MAX_FRAME_AGE_MS = 60 * 60 * 1000;

/**
 * Puerto Rico's bounding box, generous enough to include Vieques, Culebra and Mona.
 *
 * This is NOT belt-and-braces on the operator's own numbers — it catches one
 * specific, silent failure. If the upstream ever swaps its latitude and longitude
 * fields, a San Juan camera becomes lat -66.07 / lon 18.38, which is a PERFECTLY
 * VALID coordinate that passes every range check in lib/types.ts and puts the pin
 * in the South Atlantic off Namibia. A plausible-but-wrong pin is the failure this
 * project keeps having to design against, so the box is here to make that loud.
 */
const PR_BBOX = { minLat: 17.8, maxLat: 18.6, minLon: -68.0, maxLon: -65.2 };

export const ACT_PR_SOURCE: Source = {
  id: "act-pr",
  name: "ACT — Autoridad de Carreteras y Transportación (Puerto Rico)",
  // No open-data licence is published for this portal. Saying so is more useful
  // than inventing a licence name.
  license: "ACT Puerto Rico — public ITS traffic-camera viewer (no stated licence)",
  attribution:
    "Live traffic images © Autoridad de Carreteras y Transportación (ACT), Estado Libre Asociado de Puerto Rico",
  refreshSeconds: 60,
  needsKey: false,
};

/** One row of the `d.Cctv` array, as ACT publishes it. */
export interface ActPrRow {
  Id?: number | string;
  /** Internal camera code, e.g. `26-0.7_02 MD-IPV`. */
  Name?: string;
  /** Human location label, e.g. `PR-26 Miramar`. */
  LocationEn?: string;
  LocationEs?: string;
  Latitude?: number | string;
  Longitude?: number | string;
  /** Site-relative, e.g. `/images/cameras/SJPR18-4-6.jpg`. */
  ImageUrl?: string;
}

/** One camera's freshness probe. */
export interface ActPrProbe {
  id: string;
  lastModifiedMs: number | null;
}

/**
 * Absolute image URL for a row's site-relative `ImageUrl`, or null if the row
 * points anywhere except ACT's own host.
 *
 * Exported because the host rule is the interesting part: a relative path is
 * resolved against ACT's origin, and an ABSOLUTE one is only accepted if it
 * already points at that origin. Without the second half, an upstream change that
 * started emitting third-party URLs would be republished by us under ACT's
 * attribution — which is the exact thing the source policy exists to prevent.
 */
export function resolveImageUrl(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(s, ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST) return null;
  return url.toString();
}

/**
 * Turn ACT's rows plus this round's probes into cameras. Pure, so both rules that
 * matter — the bbox guard and the age rule — are testable without the network.
 */
export function normalizeActPr(
  rows: readonly ActPrRow[],
  probes: readonly ActPrProbe[],
  now: number,
  maxAgeMs: number = MAX_FRAME_AGE_MS,
): Camera[] {
  const probeById = new Map(probes.map((p) => [p.id, p]));
  const out: Camera[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const nativeId = (r.Id ?? "").toString().trim();
    if (!nativeId || seen.has(nativeId)) continue;
    const lat = Number(r.Latitude);
    const lon = Number(r.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < PR_BBOX.minLat || lat > PR_BBOX.maxLat) continue;
    if (lon < PR_BBOX.minLon || lon > PR_BBOX.maxLon) continue;
    const image = resolveImageUrl(r.ImageUrl);
    if (!image) continue;
    // The operator's human label where it has one; its internal code is the
    // fallback, never the first choice, because "26-0.1_01 MD-IPV" is not a place.
    const label = r.LocationEn?.trim() || r.Name?.trim();
    if (!label) continue;
    seen.add(nativeId);
    const lm = probeById.get(nativeId)?.lastModifiedMs ?? null;
    // A future-dated header is a clock disagreement, not freshness — clamp to 0.
    const ageMs = lm === null ? null : Math.max(0, now - lm);
    // Route ref read out of the operator's own label, never guessed. Twenty of the
    // 31 carry one; the rest leave `road` undefined rather than invent it.
    const road = label.match(/\bPR-\d+\b/)?.[0];
    out.push({
      id: `act-pr:${nativeId}`,
      source: "act-pr",
      country: "PR",
      region: "Puerto Rico",
      name: label,
      lat,
      lon,
      ...(road ? { road } : {}),
      imageUrl: image,
      mediaType: "jpeg",
      refreshSeconds: ACT_PR_SOURCE.refreshSeconds,
      license: ACT_PR_SOURCE.license,
      attribution: ACT_PR_SOURCE.attribution,
      available: ageMs !== null && ageMs <= maxAgeMs,
      ...(lm !== null ? { lastSampledAt: new Date(lm).toISOString() } : {}),
    });
  }
  return out;
}

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

/**
 * HEAD one still for its Last-Modified. HEAD rather than GET so a refresh costs
 * headers instead of ~31 × 100 KB of JPEG we would discard.
 *
 * One camera failing must not fail the round, so every probe resolves — this is
 * not hypothetical here, one ACT camera answers HTTP 500 today.
 */
async function probeFrame(
  session: Parameters<typeof h2Request>[0],
  id: string,
  path: string,
): Promise<ActPrProbe> {
  try {
    const res = await h2Request(session, path, {
      method: "HEAD",
      headers: { "user-agent": UA },
      timeoutMs: 8_000,
    });
    if (res.status < 200 || res.status >= 300) return { id, lastModifiedMs: null };
    const header = res.headers["last-modified"];
    if (!header) return { id, lastModifiedMs: null };
    const parsed = Date.parse(header);
    return { id, lastModifiedMs: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return { id, lastModifiedMs: null };
  }
}

export async function fetchRegistry(): Promise<Camera[]> {
  // One h2 session carries the listing AND every freshness probe — 32 requests
  // multiplexed over one TLS handshake instead of 32 of them.
  return withH2Session(ORIGIN, async (session) => {
    const res = await h2Request(session, "/es/Default.aspx/GetCctv", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", accept: "application/json", "user-agent": UA },
      body: "{}",
      timeoutMs: 15_000,
    });
    if (res.status !== 200) throw new Error(`ACT Puerto Rico cameras: ${res.status}`);
    const json = JSON.parse(res.body.toString("utf8")) as {
      d?: { Success?: boolean; Cctv?: ActPrRow[] };
    };
    const rows = json?.d?.Cctv ?? [];
    const probes = await Promise.all(
      rows.flatMap((r) => {
        const id = (r.Id ?? "").toString().trim();
        const url = resolveImageUrl(r.ImageUrl);
        if (!id || !url) return [];
        const u = new URL(url);
        return [probeFrame(session, id, `${u.pathname}${u.search}`)];
      }),
    );
    return CameraArray.parse(normalizeActPr(rows, probes, Date.now()));
  });
}
