import { fetchWebcamById } from "@/lib/sources/windy";
import { edgeCacheControl } from "@/lib/http/cache";

export const dynamic = "force-dynamic";

// Resolves a Windy webcam id to its coordinates when the id is missing from the
// cached ~2% webcam directory /api/webcams serves (that directory is a fixed
// region-bbox sample — see lib/sources/windy.ts — so a real webcam like
// windy:1606332744 (Madrid) can be named by a tile without being in the sample).
// Dormant-safe: an unrecognised id, a missing WINDY_WEBCAMS_API_KEY, or any upstream
// failure all resolve to a null coordinate, never a 4xx/5xx and never a guessed
// location.

const ID_RE = /^(windy:)?\d{1,20}$/;
const TTL_MS = 6 * 60 * 60 * 1000; // a webcam's position is static
const MAX_ENTRIES = 500;

type Place = { id: string; lat: number | null; lon: number | null };
type CacheEntry = { at: number; value: Place };
const cache = new Map<string, CacheEntry>();

function placeCacheControl(place: Place): string {
  return place.lat !== null && place.lon !== null ? edgeCacheControl(TTL_MS, TTL_MS) : "no-store";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = (url.searchParams.get("id") ?? "").trim();

    if (!ID_RE.test(raw)) {
      return Response.json({ id: "", lat: null, lon: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const id = raw.startsWith("windy:") ? raw : `windy:${raw}`;

    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return Response.json(hit.value, { headers: { "Cache-Control": placeCacheControl(hit.value) } });
    }

    const webcam = await fetchWebcamById(id);
    const value: Place = { id, lat: webcam?.lat ?? null, lon: webcam?.lon ?? null };

    cache.set(id, { at: Date.now(), value });
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value; // Map preserves insertion order
      if (oldest !== undefined) cache.delete(oldest);
    }

    return Response.json(value, { headers: { "Cache-Control": placeCacheControl(value) } });
  } catch (err) {
    console.warn("[webcam-place] handler threw:", err);
    return Response.json({ id: "", lat: null, lon: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
