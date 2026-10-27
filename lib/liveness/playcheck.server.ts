/**
 * Starts the play check in a server process. Every API route that serves the `live`
 * flag calls `ensurePlayCheck(getRegistry)`; the first call starts the loop, the rest
 * return at once.
 *
 * WHY THE ROUTES START IT, AND NOT instrumentation.ts. Next bundles each route with its
 * own copy of lib/sources/registry, so a loop started from instrumentation would hold a
 * further copy of the 19,000-camera registry and fetch all 51 feeds again. Handing the
 * loop the getter of the route that is already serving the registry costs nothing extra.
 * It also means the deploy's health probe (which asks only /api/status) starts no checks.
 *
 * WHY THE RESULTS ARE NOT SAVED TO DISK. A restart or a deploy starts with no results,
 * and the warm-up (`playsNow` in playcheck.ts) keeps unchecked streams as video until
 * the first pass ends, so the map does not lose its video. Saving them would need a
 * file write from the served tree, and /privacy states "nothing this site serves writes
 * a file", held by tests/unit/discovery-admin-gate.test.ts. That sentence is a public
 * promise; changing it is the owner's decision, not a side effect of this feature. The
 * loop takes `load`/`save` hooks, so persistence is one wiring change once decided.
 */

import { fetchHlsUpstream } from "@/lib/proxy/hls-upstream";
import { startPlayCheckLoop, type LoopDeps } from "@/lib/liveness/playcheck";

/** Off for `next build`, for the unit tests, and when `PLAYCHECK=off` is set. */
export function playCheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.PLAYCHECK === "off") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.VITEST) return false;
  return true;
}

export function ensurePlayCheck(getCameras: LoopDeps["getCameras"]): void {
  if (!playCheckEnabled()) return;
  startPlayCheckLoop({
    getCameras,
    fetch: (url, referer) => fetchHlsUpstream(url, referer),
    now: Date.now,
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    log: (line) => console.log(line),
  });
}
