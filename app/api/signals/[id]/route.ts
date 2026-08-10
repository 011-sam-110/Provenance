import { getSignal } from "@/lib/signals/registry";
import { describeCoverage, readCoverage } from "@/lib/signals/coverage";
import type { SignalFeature } from "@/lib/signals/types";

export const dynamic = "force-dynamic";
// Most adapters are a single fast upstream call. A few (e.g. submarine cables,
// which enriches ~700 keyless per-cable JSONs on a cold, 24h-cached load) need a
// wider ceiling; this is a MAX, so cheap layers are unaffected.
export const maxDuration = 60;

// Generic signals proxy: GET /api/signals/<id> → getSignal(id).fetch().
//
// Dormant-safe by construction:
//   • unknown id            → 404
//   • upstream fetch failure → the adapter resolves to [] (never throws), so we
//     respond {count:0, features:[]} — never a 5xx.
// A short per-id server cache (keyed to the source's own refreshMs) shields the
// upstream from bursts when several clients toggle the same layer.
//
// TRUNCATION HONESTY. Several adapters can only draw the top N of what upstream
// offered (fire-active keeps 1,500 of tens of thousands of VIIRS pixels; gpsJamming
// keeps 400 cells; conflict keeps 300 places). `count` alone made those caps read
// as measurements. When an adapter declares coverage (lib/signals/coverage.ts) the
// response carries it — how many were available, how many are here, whether a cap
// was applied, and a plain-English note — so no consumer has to guess.
//
// `coverage` is present ONLY when the adapter declared it. Its ABSENCE means "not
// declared", never "nothing was truncated" — do not render "complete" off a
// missing record.

interface Cached {
  at: number;
  features: SignalFeature[];
}
const cache = new Map<string, Cached>();

/** `{count, features}` plus the adapter's coverage record when it declared one. */
function payload(features: SignalFeature[]) {
  const coverage = readCoverage(features);
  return {
    count: features.length,
    ...(coverage ? { coverage: describeCoverage(coverage) } : {}),
    features,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = getSignal(id);
  if (!source) return new Response("unknown signal", { status: 404 });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < source.refreshMs) {
    return Response.json(payload(hit.features));
  }

  let features: SignalFeature[] = [];
  try {
    features = await source.fetch();
  } catch {
    // Belt-and-braces: a misbehaving adapter must never surface as a 5xx.
    features = hit?.features ?? [];
  }
  cache.set(id, { at: Date.now(), features });
  return Response.json(payload(features));
}
