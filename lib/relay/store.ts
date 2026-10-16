// lib/relay/store.ts
// The last good snapshot per relay feed, between a POST and the readers. PROCESS MEMORY.
//
// WHY NOT DISK. Two hard reasons, both checked on 2026-10-16, and either one alone is
// enough:
//   1. /privacy says "nothing this site serves writes a file", and
//      tests/unit/discovery-admin-gate.test.ts fails the build if any file under app/,
//      lib/ or components/ gains a way to write one. A relay that wrote snapshots would
//      make a published sentence false.
//   2. deploy/provenance.service runs the app under ProtectSystem=strict with ONE
//      writable path, the release's own .next. A write anywhere else fails at runtime on
//      the box, so a disk store would need a unit change as well as the two above.
// lib/news/scrapedStore.ts made the same call for the same reasons.
//
// WHAT A RESTART COSTS. The store is empty after a deploy. The sender asks first (a
// signed probe, see lib/relay/protocol.ts) and pushes whenever this side holds nothing
// or holds something older than its own last good copy, so an empty store refills on
// the sender's next run, from the sender's disk, WITHOUT a new upstream fetch. The gap
// is one timer interval. Readers must treat `null` as "no relay yet", never as an error.
//
// ONE STORE PER PROCESS, ON globalThis. Next bundles each route separately, so a plain
// module-level Map would give /api/relay/[feed] one copy and /api/satellites another,
// and the push would land where no reader looks. scrapedStore.ts documents the end-to-end
// test that caught exactly that.
import type { RelayData, RelayFeedId } from "@/lib/relay/feeds";

export interface RelaySnapshot<T = unknown> {
  data: T;
  /** When provenance-1 read the upstream. This is the data's age; use it for freshness. */
  fetchedAt: number;
  /** When this process accepted the push. */
  receivedAt: number;
}

export type PutOutcome = "stored" | "kept-newer";

const STORE = Symbol.for("provenance.relay.store");
const globalStore = globalThis as unknown as { [STORE]?: Map<string, RelaySnapshot> };

function state(): Map<string, RelaySnapshot> {
  const existing = globalStore[STORE];
  if (existing) return existing;
  const fresh = new Map<string, RelaySnapshot>();
  globalStore[STORE] = fresh;
  return fresh;
}

/**
 * Keep a validated snapshot. A push whose `fetchedAt` is OLDER than what is held is
 * refused as "kept-newer": a delayed retry must never roll a feed backwards. An equal
 * one replaces the held copy, so a re-push after a crash is idempotent.
 */
export function putRelay(feed: RelayFeedId, data: unknown, fetchedAt: number, receivedAt: number): PutOutcome {
  const held = state().get(feed);
  if (held && held.fetchedAt > fetchedAt) return "kept-newer";
  state().set(feed, { data, fetchedAt, receivedAt });
  return "stored";
}

/** The held snapshot for a feed, or null before the first push and after every restart. */
export function readRelay<F extends RelayFeedId>(feed: F): RelaySnapshot<RelayData<F>> | null {
  return (state().get(feed) as RelaySnapshot<RelayData<F>> | undefined) ?? null;
}

/** What the probe answers: times only, never data. */
export function relayHeld(feed: RelayFeedId): { fetchedAt: string; receivedAt: string } | null {
  const held = state().get(feed);
  if (!held) return null;
  return { fetchedAt: new Date(held.fetchedAt).toISOString(), receivedAt: new Date(held.receivedAt).toISOString() };
}

/** Tests only. */
export function resetRelayStore(): void {
  state().clear();
}
