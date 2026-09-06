import {
  parsePointsParam,
  planBatches,
  fetchPointWeather,
  coordKey,
  type PointWeather,
  type Coord,
} from "@/lib/weather/pointWeather";
import { readOutcome } from "@/lib/signals/outcome";
import { edgeCacheControl } from "@/lib/http/cache";
import { cacheTtlMs } from "@/lib/signals/cacheTtl";

export const dynamic = "force-dynamic";

// Per-coordinate weather for camslot conditions tiles, modelled on /api/geocode's
// cache shape. Dormant-safe like every route in this house: an upstream failure
// degrades the response, it never throws a 5xx and never caches a failure (a cached
// outage keeps asserting itself after the outage ends).

const TTL_MS = 600_000; // matches WEATHER_SOURCE.refreshMs — Open-Meteo "current" advances ~every 15 min
const MAX_ENTRIES = 400;

type CacheEntry = { at: number; value: PointWeather };
const cache = new Map<string, CacheEntry>();

/** Cache key for one coordinate at one detail level. `|d` marks the richer entry. */
function cacheKey(c: Coord, detail: boolean): string {
  const base = coordKey(c.lat, c.lon);
  return detail ? `${base}|d` : base;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const coords = parsePointsParam(url.searchParams.get("points"));
    // `detail=1` adds wind, apparent temperature and today's sunrise/sunset — the camera
    // page's conditions grid. The console camera wall does not pass it, so it keeps
    // paying for the small request. See DETAIL_CURRENT_FIELDS.
    const detail = url.searchParams.get("detail") === "1";

    if (coords.length === 0) {
      return Response.json(
        { ok: true, observedAt: Date.now(), count: 0, points: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const now = Date.now();
    const hits: PointWeather[] = [];
    const misses: Coord[] = [];
    for (const c of coords) {
      // The cache key carries `detail`, because a base entry for a coordinate does not
      // satisfy a detail request for the same coordinate — it is missing exactly the
      // fields the caller asked for. Without this the first wall request to touch a
      // coordinate would starve every later camera page on it for the whole TTL.
      const entry = cache.get(cacheKey(c, detail));
      if (entry && now - entry.at < TTL_MS) hits.push(entry.value);
      else misses.push(c);
    }

    let ok = true;
    let degradedReason: string | undefined;
    const fresh: PointWeather[] = [];

    if (misses.length > 0) {
      const batches = planBatches(misses);
      // fetchPointWeather's inferred return type widens to PointWeather[] | unknown[]
      // (degraded<T>'s T has nothing to infer from at its call sites inside
      // pointWeather.ts) — cast at this boundary rather than editing that file.
      const results = await Promise.all(
        batches.map((batch) => fetchPointWeather(batch, detail) as Promise<PointWeather[]>),
      );
      for (const result of results) {
        const outcome = readOutcome(result);
        if (!outcome || !outcome.ok) {
          ok = false;
          degradedReason = outcome?.reason ?? degradedReason ?? "upstream failed";
        }
        for (const pw of result) {
          fresh.push(pw);
          cache.set(detail ? `${pw.key}|d` : pw.key, { at: now, value: pw });
          if (cache.size > MAX_ENTRIES) {
            const oldest = cache.keys().next().value; // Map preserves insertion order
            if (oldest !== undefined) cache.delete(oldest);
          }
        }
      }
    }

    const points = [...hits, ...fresh];

    if (!ok) {
      return Response.json(
        { ok: false, observedAt: now, count: points.length, points, degradedReason: degradedReason ?? "upstream failed" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, observedAt: now, count: points.length, points },
      { headers: { "Cache-Control": edgeCacheControl(cacheTtlMs(TTL_MS, points.length === 0), TTL_MS) } },
    );
  } catch (err) {
    console.warn("[point-weather] handler threw:", err);
    return Response.json(
      { ok: false, observedAt: Date.now(), count: 0, points: [], degradedReason: "handler threw" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
