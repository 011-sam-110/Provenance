// One queue per upstream host, shared by every route in this process.
//
// WHY THIS EXISTS. adsb.lol limits requests per IP, and two features draw on that
// one allowance from the same box: the planes pull (`lib/sources/adsb.ts`) and the
// military-air layer (`lib/signals/military-air.ts`, every 20 s). Each paced its OWN
// requests and knew nothing of the other's. Measured from a residential IP on
// 2026-10-16: the type pull's batches A and B answered, one `/v2/mil` landed between
// them, and batches C and D then both got 429 at 2 s spacing. Prod showed the same
// loss in 3 of 5 snapshots that evening (the GA and helicopter batch missing). A
// lane makes every request to the host wait its turn, whichever feature sends it.
//
// GLOBALTHIS, NOT A MODULE VARIABLE. Next bundles each route handler separately, so
// a `let` here would be one lane per route: the planes route and the signals route
// would each think the host was idle. `Symbol.for` keys one shared record on the
// process, the same way lib/signals/outcome.ts keeps its side channel.
//
// The lane spaces request STARTS. It does not hold a request open, cap concurrency
// or retry: a 429 is still the caller's to handle.

/** Minimum spacing between two request starts to one host. Hosts not listed: none. */
export const HOST_GAP_MS: Readonly<Record<string, number>> = {
  // A burst of about three, then a slow refill (2026-10-16, see above). Two seconds
  // keeps a /v2/mil poll from landing on top of a type pull or its retry.
  "api.adsb.lol": 2_000,
  // adsb.fi's open-data terms allow one request per second.
  "opendata.adsb.fi": 1_100,
};

const KEY = Symbol.for("provenance.http.hostLane.v1");

function lanes(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  let m = g[KEY];
  if (!m) {
    m = new Map();
    g[KEY] = m;
  }
  return m;
}

/**
 * Pure: the slot a request asking at `now` gets. `nextFreeAt` is the earliest start
 * the lane allows (undefined = the host has not been asked yet).
 */
export function reserveSlot(
  nextFreeAt: number | undefined,
  now: number,
  gapMs: number,
): { waitMs: number; nextFreeAt: number } {
  const at = Math.max(now, nextFreeAt ?? Number.NEGATIVE_INFINITY);
  return { waitMs: at - now, nextFreeAt: at + Math.max(0, gapMs) };
}

/** Wait for this host's next slot. Resolves at once for a host with no gap. */
export async function takeTurn(host: string, gapMs: number = HOST_GAP_MS[host] ?? 0): Promise<void> {
  if (gapMs <= 0) return;
  const m = lanes();
  const slot = reserveSlot(m.get(host), Date.now(), gapMs);
  m.set(host, slot.nextFreeAt);
  if (slot.waitMs > 0) await new Promise<void>((r) => setTimeout(r, slot.waitMs));
}

/** `fetch`, after waiting for the URL's host lane. The production fetch for paced hosts. */
export async function laneFetch(url: string, init?: RequestInit): Promise<Response> {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Not a URL fetch can use either; let fetch raise its own error.
  }
  if (host) await takeTurn(host);
  return fetch(url, init);
}

/** Test seam. Forgets every reservation. */
export function resetLanes(): void {
  lanes().clear();
}
