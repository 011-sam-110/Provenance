/**
 * The generic camera adapter: one module that serves every network discovery has
 * found and a human has admitted.
 *
 * WHY THIS EXISTS. The other fourteen adapters in this directory are the same four
 * steps written fourteen times — fetch a URL, find the rows, rename the columns,
 * validate. What differs between them is DATA, not behaviour, so it lives in
 * `discovered.data.ts` as a descriptor per network and this file is the behaviour,
 * once. Adding a camera network is a committed row and a review record; it is not a
 * new module, an import and a line in the SOURCES table.
 *
 * WHAT IT REFUSES TO DO. It will not serve a descriptor that has no review record —
 * the type makes that unrepresentable, and `discovered.data.ts` is the only file that
 * constructs one. So there is no path from "the crawler found a JSON endpoint" to
 * "the map shows a pin" that does not pass through a person looking at the picture.
 * That is the point of the whole subsystem and it is enforced here rather than by
 * convention.
 *
 * Failure behaviour matches every other adapter: a feed that throws, times out or
 * answers with the wrong shape resolves to `[]`, and `registry.ts` keeps its
 * last-good cameras rather than emptying the region.
 */

import type { Camera } from "@/lib/types";
import type { AdmittedFeed } from "@/lib/discovery/types";
import { normalizeFeed } from "@/lib/discovery/normalize";
import { ADMITTED_FEEDS } from "@/lib/sources/discovered.data";

/** Every admitted network, for the registry, the coverage denominator and the docs. */
export const DISCOVERED_FEEDS: readonly AdmittedFeed[] = ADMITTED_FEEDS;

/**
 * Distinct countries the admitted feeds cover. Derived, never typed — the same rule
 * the rest of this directory follows, and the reason `claude-md-counts.test.ts` can
 * check a documented country count against reality.
 */
export function discoveredCountries(): string[] {
  return [...new Set(ADMITTED_FEEDS.map((f) => f.country))].sort();
}

/** Fetch and normalise ONE admitted network. Never throws; `[]` on any failure. */
export async function fetchDiscoveredFeed(feed: AdmittedFeed): Promise<Camera[]> {
  let body: unknown;
  try {
    const res = await fetch(feed.endpoint, {
      headers: {
        Accept: "application/json",
        // Identify ourselves to the operator the same way every other adapter does.
        // An operator who wants to block this should be able to, by name.
        "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/Provenance)",
        ...feed.headers,
      },
      // Matches the registry's own refresh window; a shorter one just re-fetches
      // something the registry will not ask for again yet.
      next: { revalidate: Math.max(60, Math.floor(feed.refreshSeconds / 2)) },
    });
    if (!res.ok) return [];
    body = await res.json();
  } catch {
    return [];
  }

  const { cameras } = normalizeFeed(feed, body);
  if (!feed.blocked?.length) return cameras;
  // A reviewer rejected these individually. Blocking by native id rather than by
  // position means an upstream reorder cannot silently un-block one.
  const blocked = new Set(feed.blocked.map((id) => feed.key + ":" + id));
  return cameras.filter((c) => !blocked.has(c.id));
}

/**
 * One `CameraFeed`-shaped entry per admitted network, for `registry.ts`.
 *
 * Deliberately NOT one entry for all of them. `registry.ts` keys its last-good map by
 * feed, so a single shared entry would mean one network's outage discards every other
 * discovered network's cameras at the same moment — the exact failure the last-good
 * mechanism exists to prevent.
 */
export function discoveredCameraFeeds(): Array<{ key: string; fetch: () => Promise<Camera[]> }> {
  return ADMITTED_FEEDS.map((feed) => ({
    key: feed.key,
    fetch: () => fetchDiscoveredFeed(feed),
  }));
}
