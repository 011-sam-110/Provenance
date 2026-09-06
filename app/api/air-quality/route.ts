import { parsePointsParam, coordKey, type Coord } from "@/lib/weather/pointWeather";
import { fetchAirQuality, type AirQuality } from "@/lib/weather/airQuality";
import { readOutcome } from "@/lib/signals/outcome";
import { edgeCacheControl } from "@/lib/http/cache";
import { cacheTtlMs } from "@/lib/signals/cacheTtl";

export const dynamic = "force-dynamic";

// Per-coordinate air quality for the camera page's conditions grid, shaped exactly like
// /api/point-weather so the two can be called side by side and read the same way.
//
// It is a SEPARATE route rather than a flag on point-weather because it is a separate
// upstream host (see lib/weather/airQuality.ts). Two routes means one host being down
// costs one card, not both.
//
// Dormant-safe: an upstream failure degrades the response, never a 5xx, and a failure is
// never cached — a cached outage keeps asserting itself long after the outage ends.

// CAMS publishes hourly, so a shorter TTL would re-fetch a value that had not moved.
const TTL_MS = 3_600_000;
const MAX_ENTRIES = 400;

type CacheEntry = { at: number; value: AirQuality };
const cache = new Map<string, CacheEntry>();

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const coords = parsePointsParam(url.searchParams.get("points"));

    if (coords.length === 0) {
      return Response.json(
        { ok: true, observedAt: Date.now(), count: 0, points: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const now = Date.now();
    const hits: AirQuality[] = [];
    const misses: Coord[] = [];
    for (const c of coords) {
      const entry = cache.get(coordKey(c.lat, c.lon));
      if (entry && now - entry.at < TTL_MS) hits.push(entry.value);
      else misses.push(c);
    }

    let ok = true;
    let degradedReason: string | undefined;
    const fresh: AirQuality[] = [];

    if (misses.length > 0) {
      // `fetchAirQuality`'s inferred return widens to AirQuality[] | unknown[] the same
      // way fetchPointWeather's does (degraded<T> has nothing to infer T from at its call
      // sites) — cast at this boundary rather than editing that file.
      const result = (await fetchAirQuality(misses)) as AirQuality[];
      const outcome = readOutcome(result);
      if (!outcome || !outcome.ok) {
        ok = false;
        degradedReason = outcome?.reason ?? "upstream failed";
      }
      for (const aq of result) {
        fresh.push(aq);
        cache.set(aq.key, { at: now, value: aq });
        if (cache.size > MAX_ENTRIES) {
          const oldest = cache.keys().next().value; // Map preserves insertion order
          if (oldest !== undefined) cache.delete(oldest);
        }
      }
    }

    const points = [...hits, ...fresh];

    if (!ok) {
      return Response.json(
        {
          ok: false,
          observedAt: now,
          count: points.length,
          points,
          degradedReason: degradedReason ?? "upstream failed",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, observedAt: now, count: points.length, points },
      { headers: { "Cache-Control": edgeCacheControl(cacheTtlMs(TTL_MS, points.length === 0), TTL_MS) } },
    );
  } catch (err) {
    console.warn("[air-quality] handler threw:", err);
    return Response.json(
      { ok: false, observedAt: Date.now(), count: 0, points: [], degradedReason: "handler threw" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
