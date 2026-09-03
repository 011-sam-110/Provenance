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
    const hits: PointWeather[] = [];
    const misses: Coord[] = [];
    for (const c of coords) {
      const entry = cache.get(coordKey(c.lat, c.lon));
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
        batches.map((batch) => fetchPointWeather(batch) as Promise<PointWeather[]>),
      );
      for (const result of results) {
        const outcome = readOutcome(result);
        if (!outcome || !outcome.ok) {
          ok = false;
          degradedReason = outcome?.reason ?? degradedReason ?? "upstream failed";
        }
        for (const pw of result) {
          fresh.push(pw);
          cache.set(pw.key, { at: now, value: pw });
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
