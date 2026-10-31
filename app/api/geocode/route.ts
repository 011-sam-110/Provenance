import { normalizePhoton } from "@/lib/geo/geocode";

export const dynamic = "force-dynamic";

// Keyless place search proxied through Photon (Komoot's OSM geocoder). Done
// server-side so we attach a descriptive User-Agent/Referer (good-citizen usage)
// and brief-cache results — the client debounces, this de-dupes repeats. Dormant-
// safe: any upstream failure returns an empty result set, never a 5xx, so a flaky
// community geocoder can never crash the search box.
const PHOTON = "https://photon.komoot.io/api";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const REFERER = "https://trafficnerd.app";
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

type CacheEntry = { at: number; body: { results: ReturnType<typeof normalizePhoton> } };
const cache = new Map<string, CacheEntry>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const hasCoord = lat != null && lon != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));

  // REVERSE mode — coordinates but no query: name the place under a dropped pin.
  // Dormant-safe (empty results on any failure); the caller keeps its coord label.
  // `lang=en` asks for English names ("Taichung", not its local spelling). Nothing else passes.
  // Without it Photon writes each country's own, which other callers rely on.
  if (q.length < 2 && hasCoord) {
    const english = url.searchParams.get("lang") === "en";
    const key = `rev|${english ? "en|" : ""}${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.body);
    const upstream = new URL(PHOTON_REVERSE);
    upstream.searchParams.set("lat", lat as string);
    upstream.searchParams.set("lon", lon as string);
    upstream.searchParams.set("limit", "1");
    if (english) upstream.searchParams.set("lang", "en");
    try {
      const res = await fetch(upstream, {
        headers: { Accept: "application/json", "User-Agent": UA, Referer: REFERER },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return Response.json({ results: [] });
      const body = { results: normalizePhoton(await res.json(), 1) };
      cache.set(key, { at: Date.now(), body });
      return Response.json(body);
    } catch {
      return Response.json({ results: [] });
    }
  }

  if (q.length < 2) return Response.json({ results: [] });

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 8, 1), 15);
  // Optional viewport bias (Photon proximity-ranks results around lat/lon).
  const biased = hasCoord;

  const key = `${q.toLowerCase()}|${limit}|${biased ? `${lat},${lon}` : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.body);

  const upstream = new URL(PHOTON);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", String(limit));
  if (biased) {
    upstream.searchParams.set("lat", lat as string);
    upstream.searchParams.set("lon", lon as string);
  }

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json", "User-Agent": UA, Referer: REFERER },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ results: [] });
    const json = await res.json();
    const body = { results: normalizePhoton(json, limit) };

    cache.set(key, { at: Date.now(), body });
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value; // Map preserves insertion order
      if (oldest !== undefined) cache.delete(oldest);
    }
    return Response.json(body);
  } catch {
    return Response.json({ results: [] });
  }
}
