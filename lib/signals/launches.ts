import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { markCoverage, withCoverage } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// The Space Devs — Launch Library 2 "upcoming launches". Keyless JSON; the
// canonical open feed of scheduled orbital + suborbital launches. Each launch is
// pinned to its launch PAD (pad.latitude/longitude). We surface the mission name,
// provider, rocket, scheduled time (net) and status.
//
// IMPORTANT — rate limits: LL2's production host (ll.thespacedevs.com) throttles
// aggressively (a few requests/hour for anonymous clients). So we (a) use the
// lighter `mode=normal` (the `mode=list` shape OMITS pad coordinates, confirmed
// live 2026-06-27), and (b) cache HARD via a long refreshMs + a module-level
// stale-on-error cache. Shapes confirmed live 2026-06-27.
//
// NO DEV-MIRROR FALLBACK (removed 2026-10-16). The adapter used to read
// lldev.thespacedevs.com when production refused. That host is a SNAPSHOT, not a
// mirror: on 2026-10-16 it said last_updated 2026-10-10 and listed 178 launches
// against production's 476, with USSF-481 still upcoming 17 minutes off its real
// time after it had flown. Its rows were then stamped `observed()` at "now", so a
// six-day-old schedule read as a live one. The stale-on-error cache below is the
// honest fallback: it keeps the last good rows and says when they were read.

//
// API 2.3.0 (moved 2026-10-16). 2.2.0 still answered, but The Space Devs' docs now
// list only 2.3.0 endpoints, so 2.2.0 can go without notice. 2.3.0 keeps the same
// fields this adapter reads (pad latitude/longitude now arrive as numbers) and adds
// `window_start` / `window_end`. One call per hour asks for 100 rows: about the
// next two to three months, inside the anonymous limit of 15 requests per hour
// (`/2.3.0/api-throttle/` said 15 per 3600 s on 2026-10-16). 100 rows of
// `mode=normal` measured 857 KB.

/** Page size asked of LL2. The agenda is a PAGE of the schedule, not the schedule. */
export const LAUNCHES_PAGE_LIMIT = 100;
const PROD = `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=${LAUNCHES_PAGE_LIMIT}&mode=normal`;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — launches move on the scale of hours/days

export const LAUNCHES_ATTRIBUTION = "Launch data © The Space Devs — Launch Library 2";

interface LL2Launch {
  id?: string;
  url?: string;
  name?: string;
  net?: string | null;
  status?: { name?: string | null } | null;
  launch_service_provider?: { name?: string | null } | null;
  rocket?: { configuration?: { name?: string | null } | null } | null;
  mission?: { name?: string | null; type?: string | null } | null;
  pad?: {
    name?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
    location?: { name?: string | null } | null;
  } | null;
}

/** Soft status palette: confirmed = green, TBD/hold = amber, failure/cancel = red. */
export function launchStatusColor(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("go") || s.includes("success")) return "#22c55e";
  if (s.includes("fail") || s.includes("cancel") || s.includes("hold")) return "#ef4444";
  if (s.includes("progress")) return "#0ea5e9";
  return "#a855f7"; // TBD / TBC / default — calm violet (Space group)
}

/**
 * Pure: LL2 results[] → SignalFeature[] (one point per launch pad).
 *
 * LL2 paginates. Its `count` is the TOTAL upcoming launches, so when it is present
 * we can publish an exact "N of M"; without it, a full page is treated as a lower
 * bound. Either way the agenda never claims to be the whole manifest.
 */
export function normalizeLaunches(
  json: { results?: LL2Launch[]; count?: number },
  limit = LAUNCHES_PAGE_LIMIT,
): SignalFeature[] {
  const results = json.results ?? [];
  const out: SignalFeature[] = [];
  for (const l of results) {
    const pad = l.pad;
    // pad coords arrive as strings ("28.5618571"); guard null before coercion.
    const lat = pad?.latitude == null ? Number.NaN : Number(pad.latitude);
    const lon = pad?.longitude == null ? Number.NaN : Number(pad.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue; // unplaced pad sentinel
    const id = (l.id ?? "").toString().trim();
    if (!id) continue;
    const status = l.status?.name ?? undefined;
    const provider = l.launch_service_provider?.name ?? undefined;
    const rocket = l.rocket?.configuration?.name ?? undefined;
    out.push({
      id: `launch:${id}`,
      lat,
      lon,
      title: l.name?.trim() || rocket || "Rocket launch",
      signalId: "launches",
      color: launchStatusColor(status),
      link: l.url,
      ts: l.net ?? undefined,
      props: {
        ...(provider ? { provider } : {}),
        ...(rocket ? { rocket } : {}),
        ...(status ? { status } : {}),
        ...(l.net ? { launchTime: l.net } : {}),
        ...(pad?.name ? { pad: pad.name } : {}),
        ...(pad?.location?.name ? { site: pad.location.name } : {}),
      },
    });
  }
  // LL2's own total, when it sent one, is an EXACT upstream count — better than a
  // page-saturation guess, so prefer it.
  const total = typeof json.count === "number" && Number.isFinite(json.count) ? json.count : null;
  if (total != null && total > results.length) {
    return withCoverage(out, {
      available: total,
      availableExact: true,
      capped: true,
      cap: limit,
      noun: "upcoming launches",
      rule: "the soonest — Launch Library 2 returns them in launch order",
    });
  }
  return markCoverage(out, {
    noun: "upcoming launches",
    rule: "the soonest — Launch Library 2 returns them in launch order",
    upstream: { limit, count: results.length },
  });
}

// --- Hard-cached upstream fetch (production only) ---------------------------
let cache: { features: SignalFeature[]; at: number } | null = null;

/** Test hook: forget the module cache so a test starts from a cold adapter. */
export function resetLaunchesCacheForTest(): void {
  cache = null;
}

async function tryFetch(url: string): Promise<SignalFeature[] | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null; // 429 etc. → the caller serves the last good rows
  const json = (await res.json()) as { results?: LL2Launch[]; count?: number };
  return normalizeLaunches(json);
}

export const LAUNCHES_SOURCE: SignalSource = {
  id: "launches",
  // The launch pad.
  precision: "facility",
  label: "Rocket launches",
  group: "Space",
  color: "#a855f7",
  refreshMs: CACHE_TTL_MS,
  attribution: LAUNCHES_ATTRIBUTION,
  kind: "schedule", // forward-looking, time-anchored → the countdown-agenda focus view
  async fetch() {
    // A cache hit is a real upstream read — stamped when it happened, not now.
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return observed(cache.features, cache.at);
    try {
      const features = await tryFetch(PROD);
      if (features) {
        cache = { features, at: Date.now() };
        return observed(features, cache.at);
      }
      // throttled → last good, else empty. Keep the rows and declare the
      // failure, stamped with when they were really read: `degraded()` would drop
      // the cache, `observed()` would claim a read that did not happen.
      return cache
        ? degradedWith(cache.features, "http error", cache.at)
        : degraded("http error");
    } catch {
      // Same last-good rule as the throttled path above.
      return cache
        ? degradedWith(cache.features, "fetch failed", cache.at)
        : degraded("fetch failed"); // dormant-safe
    }
  },
};
