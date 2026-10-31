import type { Camera } from "@/lib/types";
import { isLiveCamera, liveGate, type LiveGate } from "@/lib/liveness/playcheck";
import { edgeCacheHeaders } from "@/lib/http/cache";
import { REGISTRY_TTL_MS } from "@/lib/sources/registry";
import { buildCoverage, buildPoints, snapCoverageBox, type CoveragePoints } from "@/lib/eye/coverage";

// The server half of GET /api/eye/coverage. The rules are pure, in lib/eye/coverage.ts. A route
// module may export only the names Next recognises (lib/cameras/body.ts says why), so the memo
// and the cache headers live here.

/**
 * The index body, held until the registry replaces its array or a play-check verdict changes the
 * gate: both are compared by identity, the same two keys as `camerasBody` (lib/cameras/body.ts
 * has the reasoning). The build reads every camera, about 150 ms measured on 46,480 rows, so a
 * visitor pays it once per registry refresh and not once per edge miss.
 */
let serialised: { from: Camera[]; live: LiveGate; body: string } | null = null;

export function coverageCellsBody(cams: Camera[], live: LiveGate = liveGate()): string {
  if (serialised && serialised.from === cams && serialised.live === live) return serialised.body;
  const body = JSON.stringify(buildCoverage(cams, (c) => isLiveCamera(c as Camera, live)));
  serialised = { from: cams, live, body };
  return body;
}

/** Test seam, matching `__resetCamerasBody`. */
export function __resetCoverageBody(): void {
  serialised = null;
}

/** The exact cameras in a box, grown outward to the grid first. */
export function coveragePointsBody(
  cams: Camera[],
  box: [number, number, number, number],
  live: LiveGate = liveGate(),
): CoveragePoints {
  return buildPoints(cams, snapCoverageBox(box), (c) => isLiveCamera(c as Camera, live));
}

/**
 * The registry's own cadence, like the camera list these rows are counted from, with the same
 * five minutes of stale-while-revalidate. The bodies hold counts and no age, so a cached copy
 * says nothing false about time.
 */
export function coverageCacheHeaders(): Record<string, string> {
  return edgeCacheHeaders(REGISTRY_TTL_MS, 300_000);
}
