import type { AircraftSnapshot } from "@/lib/sources/opensky";
import { describeCoverage } from "@/lib/signals/coverage";

// The body of GET /api/planes.
//
// WHY IT IS NOT IN THE ROUTE FILE: a Next route module may export ONLY the names Next
// recognises, so anything with a test seam lives here. Same reason as
// `lib/cameras/body.ts`; `tests/unit/route-export-contract.test.ts` enforces it.
//
// WHY IT EXISTS AT ALL: this is the most-rebuilt body the deployment serves. The Caddy
// log for 2026-09-07..11 has 33,181 `/api/planes` requests at 1.27 MB each, and every
// one of them ran `JSON.stringify` over ~3,000 aircraft to produce bytes identical to
// the last request's until the 240 s upstream tick moved. `/api/cameras` had had a memo
// since it was written; this route had none. Pulling the body out is what lets
// `lib/http/originCache.ts` hold one.

/**
 * `fetchedAt` IS THE FIELD THAT MAKES THIS BODY CACHEABLE, and it is the point of the
 * change that introduced it.
 *
 * The route already carried `staleness.ageMs`, which is a RELATIVE age: "this reading
 * is 120 s old". Held in a cache for 20 s, that sentence is wrong by 20 s, and it is
 * wrong in the direction that flatters us. The route's own comment said as much — "do
 * not raise it to save invocations without also making the age absolute".
 *
 * `fetchedAt` is the absolute instant the positions were pulled, so a consumer
 * subtracts it from its own clock and gets the true age no matter how long the body sat
 * in a cache. It is additive: `staleness` is unchanged and still carries the server's
 * own verdict, which is why the TTL stays at its documented 20 s rather than moving to
 * the five minutes the cameras body can take. Absolute age is what a longer tick would
 * need, and this field is the half of it that can ship without a client change.
 */
export function planesBody(snapshot: AircraftSnapshot): string {
  const { planes, coverage, staleness, source, fetchedAt } = snapshot;
  return JSON.stringify({
    count: planes.length,
    ...(source ? { source } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(coverage ? { coverage: describeCoverage(coverage) } : {}),
    ...(staleness ? { staleness } : {}),
    planes,
  });
}
