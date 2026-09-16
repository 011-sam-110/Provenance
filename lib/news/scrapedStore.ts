// lib/news/scrapedStore.ts
// Where pushed stories live between a POST and a GET. Process memory, on purpose.
//
// WHY NOT DISK, AND DO NOT "FIX" THIS.
// `tests/unit/discovery-admin-gate.test.ts` pins that a grep for write syscalls over
// app/, lib/ and components/ returns exactly TWO files, both dev-only and both behind
// a production 404. The privacy page states, on that evidence, that "nothing this site
// serves writes a file". An ingest endpoint that wrote to disk would break the test AND
// make a published claim false, which is the exact failure that file exists to prevent.
// If this ever needs to survive a restart, copy the rollup pattern instead: something
// OUTSIDE the Next bundle (scripts/) writes, and a read-only module here reads — see
// lib/analytics/rollupRead.ts.
//
// WHAT A RESTART COSTS, AND WHY IT IS CHEAP.
// On restart the store is empty and `cursor()` returns "". The scraper reads that as
// "start from the beginning" and backfills, so the recovery path is the same code path
// as the first ever run — no special case, and nothing to remember to test.
//
// SINGLE PROCESS ASSUMPTION. Production is one long-lived next-server under systemd
// (deploy/provenance.service), so module state is shared by every request. This would
// NOT hold on a serverless host, where each instance would hold a different slice. If
// this app ever moves back to one, this module is the thing that breaks.
import type { ScrapedItem } from "@/lib/news/ingest";

/**
 * Retention. The host has 2 GB of RAM and also runs the app, so the cap is on item
 * count and, separately and much harder, on how many of them keep their article body.
 * Bodies are what clustering needs and they are ~4 KB each, so they are kept only for
 * the recent window clustering actually reads.
 */
export const MAX_ITEMS = 1_500;
export const MAX_TEXT_ITEMS = 400;

export interface IngestOutcome {
  /** Rows that were new or had changed since we last saw them. */
  accepted: number;
  /** Rows that arrived identical to what we hold — a safe, repeatable no-op. */
  unchanged: number;
  /** High-water mark the scraper should resume from. */
  cursor: string;
}

export interface StoreStats {
  items: number;
  withText: number;
  cursor: string;
  oldestTs: number;
  newestTs: number;
  updatedAt: number;
}

/** Module-level so every request in this process sees the same store. */
const items = new Map<string, ScrapedItem>();
let cursorHighWater = "";
let updatedAt = 0;

/** Newest first. The order everything downstream wants. */
function sorted(): ScrapedItem[] {
  return Array.from(items.values()).sort((a, b) => b.ts - a.ts);
}

/**
 * Drop the oldest rows past MAX_ITEMS, then strip article text past MAX_TEXT_ITEMS.
 * Stripping text is NOT deletion of the row: the headline stays linkable and stays in
 * the stream, it just stops contributing a body to clustering.
 */
function evict(): void {
  const order = sorted();
  for (const item of order.slice(MAX_ITEMS)) items.delete(item.id);
  for (const item of order.slice(MAX_TEXT_ITEMS, MAX_ITEMS)) {
    if (item.text !== null) items.set(item.id, { ...item, text: null });
  }
}

/**
 * Merge a validated batch. Idempotent on (id, textHash): re-posting an unchanged row
 * is counted as unchanged and costs nothing, so the scraper can retry a timed-out POST
 * without having to know whether the first one landed.
 */
export function ingestItems(batch: ScrapedItem[], nowMs: number): IngestOutcome {
  let accepted = 0;
  let unchanged = 0;

  for (const item of batch) {
    const held = items.get(item.id);
    // Prefer the scraper's own digest when it sends one: it covers fields we do not
    // keep, so it notices changes this side cannot see. Falling back to a field
    // comparison matters because `textHash` is NULL for every NYT row and every
    // no-text row — keyed on that alone, a corrected NYT headline could never land.
    const same =
      held !== undefined &&
      (item.itemHash !== null && held.itemHash !== null
        ? held.itemHash === item.itemHash
        : held.textHash === item.textHash &&
          held.title === item.title &&
          held.description === item.description &&
          held.url === item.url &&
          held.ts === item.ts);

    if (same) {
      unchanged += 1;
      // Still advance last-seen: the row is confirmed alive even though nothing in it
      // changed, and that is what keeps the cursor moving past a quiet story.
      if (item.lastSeenAt > held.lastSeenAt) items.set(item.id, { ...held, lastSeenAt: item.lastSeenAt });
    } else {
      // An update arriving without text must not erase text we already hold: the
      // scraper strips bodies from rows it has already sent, and a headline edit
      // would otherwise cost us the body that clustering was using.
      const text = item.text ?? held?.text ?? null;
      items.set(item.id, { ...item, text });
      accepted += 1;
    }
    if (item.lastSeenAt > cursorHighWater) cursorHighWater = item.lastSeenAt;
  }

  evict();
  updatedAt = nowMs;
  return { accepted, unchanged, cursor: cursorHighWater };
}

/** Newest-first snapshot. Callers must treat it as read-only. */
export function scrapedItems(limit = MAX_ITEMS): ScrapedItem[] {
  return sorted().slice(0, Math.max(0, limit));
}

/** "" before the first push, and after every restart. The scraper reads it as "backfill". */
export function scrapedCursor(): string {
  return cursorHighWater;
}

export function scrapedStats(): StoreStats {
  const order = sorted();
  return {
    items: order.length,
    withText: order.reduce((n, it) => n + (it.text ? 1 : 0), 0),
    cursor: cursorHighWater,
    oldestTs: order.length ? order[order.length - 1].ts : 0,
    newestTs: order.length ? order[0].ts : 0,
    updatedAt,
  };
}

/** Tests only. Module state would otherwise leak between cases in one vitest file. */
export function resetScrapedStore(): void {
  items.clear();
  cursorHighWater = "";
  updatedAt = 0;
}
