/**
 * Descriptor + response body -> `Camera[]`.
 *
 * This is the half of discovery that runs BOTH offline (in `scripts/discover-cameras.mjs`,
 * to produce the samples a human reviews) and at runtime (in `lib/sources/discovered.ts`,
 * to serve the admitted feeds). Sharing one function is the point: the cameras a
 * reviewer approved and the cameras production serves are produced by the same code,
 * so an approval cannot mean something different from what ships.
 *
 * Every row is validated against `CameraSchema` before it counts, and a row that fails
 * is DROPPED and TALLIED rather than repaired. A repaired row is a row nobody
 * reviewed.
 */

import { CameraSchema, type Camera } from "@/lib/types";
import type { FeedDescriptor } from "@/lib/discovery/types";
import { extractRows, getPath } from "@/lib/discovery/sniff";
// The house rule for bare-IP hosts lives with the Serbian gazetteer because that is
// where it was first needed. It is a rule about every source, not about Serbia, so it
// is imported rather than re-implemented — two copies of an exclusion rule is how one
// of them silently stops matching.
import { isBareIpHost } from "@/lib/sources/serbia.data";

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

/**
 * Make a feed-relative URL absolute against the endpoint it came from.
 *
 * Returns null for anything that will not resolve, and for any host that is a bare IP
 * address. An unsecured box on IP:port is somebody's leaked camera rather than a
 * published feed, and a discovery pipeline that admits those turns this product from
 * infrastructure transparency into a leaked-camera index. The rule is applied here,
 * once, on the way in — not as a hand-maintained exclusion list that silently stops
 * covering a source when the source grows.
 */
export function resolveMediaUrl(raw: unknown, endpoint: string): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  let abs: string;
  try {
    abs = new URL(s, endpoint).toString();
  } catch {
    return undefined;
  }
  if (!/^https?:/i.test(abs)) return undefined; // rtsp:// is not fetchable from a browser
  if (isBareIpHost(abs)) return undefined;
  return abs;
}

export interface NormalizeResult {
  cameras: Camera[];
  /** Rows seen in the body, before any validation. */
  rows: number;
  /** Why rows were dropped, so a low yield is explainable instead of mysterious. */
  dropped: {
    noId: number;
    noName: number;
    badCoord: number;
    noMedia: number;
    duplicateId: number;
    schema: number;
  };
}

/**
 * Turn one response body into cameras under a descriptor's mapping.
 *
 * `country` comes from the descriptor and not from the data. Feeds spell their own
 * country inconsistently ("UK", "GB", "United Kingdom", "England") and `CameraSchema`
 * requires exactly two characters, so the value that reaches the registry is the one a
 * human wrote on the descriptor when they admitted the feed.
 */
export function normalizeFeed(descriptor: FeedDescriptor, body: unknown): NormalizeResult {
  const rows = extractRows(body, descriptor.format, descriptor.rowsPath);
  const m = descriptor.mapping;
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  const dropped: NormalizeResult["dropped"] = {
    noId: 0,
    noName: 0,
    badCoord: 0,
    duplicateId: 0,
    noMedia: 0,
    schema: 0,
  };

  for (const row of rows) {
    const nativeId = str(getPath(row, m.id));
    if (!nativeId) {
      dropped.noId++;
      continue;
    }
    if (seen.has(nativeId)) {
      dropped.duplicateId++;
      continue;
    }
    const name = str(getPath(row, m.name));
    if (!name) {
      dropped.noName++;
      continue;
    }
    const lat = num(getPath(row, m.lat));
    const lon = num(getPath(row, m.lon));
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      dropped.badCoord++;
      continue;
    }
    // Null Island. A row at exactly 0,0 is a missing coordinate that survived every
    // type check, and it is the one wrong pin that appears on every map that has one.
    if (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9) {
      dropped.badCoord++;
      continue;
    }
    const imageUrl = m.imageUrl ? resolveMediaUrl(getPath(row, m.imageUrl), descriptor.endpoint) : undefined;
    const streamUrl = m.streamUrl ? resolveMediaUrl(getPath(row, m.streamUrl), descriptor.endpoint) : undefined;
    if (!imageUrl && !streamUrl) {
      dropped.noMedia++;
      continue;
    }

    const candidate = {
      id: descriptor.key + ":" + nativeId,
      source: descriptor.key,
      country: descriptor.country,
      region: m.region ? str(getPath(row, m.region)) : undefined,
      name,
      lat,
      lon,
      road: m.road ? str(getPath(row, m.road)) : undefined,
      direction: m.direction ? str(getPath(row, m.direction)) : undefined,
      imageUrl,
      streamUrl,
      mediaType: imageUrl && streamUrl ? "both" : streamUrl ? "video" : "jpeg",
      refreshSeconds: descriptor.refreshSeconds,
      license: descriptor.license,
      attribution: descriptor.attribution,
      available: true,
    };

    const parsed = CameraSchema.safeParse(candidate);
    if (!parsed.success) {
      dropped.schema++;
      continue;
    }
    seen.add(nativeId);
    cameras.push(parsed.data);
  }

  return { cameras, rows: rows.length, dropped };
}
