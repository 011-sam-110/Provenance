// The planner behind the full-catalogue webcam harvest. Pure: no network, no clock,
// no filesystem — every function here is decided by its arguments, so the part that
// governs how much of Windy we actually see is unit-testable without a key.
//
// WHY THIS EXISTS AT ALL. lib/sources/windy.ts fans out across 18 hand-written region
// boxes at 2 pages of 50 each, which is a 100-row ceiling per region no matter what
// the region holds. Its own comment records what that costs: the `w-europe` box holds
// 19,204 webcams, fetches 100 of them, and on the day it was measured returned 60
// Italian cameras and ZERO Belgian ones — in a box containing Brussels. Prod
// `/api/webcams` answered `count: 1567` on 2026-09-05 against a global inventory of
// 70,736. That is 2.2%, and which 2.2% is not chosen: it is whatever Windy returns
// first.
//
// THE MEASURED CONSTRAINT, and it is the whole design. Probed against the live API on
// 2026-09-05 with this repo's own key:
//
//     limit=100                 -> 400  {"message":["limit must not be greater than 50"]}
//     offset=1000  limit=50     -> 200  50 rows
//     offset=2000  limit=50     -> 400  {"message":"Offset is over API tier limit 1000!"}
//
// So ONE BOUNDING BOX YIELDS AT MOST 1,050 ROWS, EVER. Windy's pricing page confirms
// the tier split: free is capped at offset 1,000, Professional at 10,000 for €9,990 a
// year. Raising the ceiling is a purchase, not a code change.
//
// WHY WE SPLIT ON `total` AND NOT ON THE CEILING. The obvious approach — page a box
// until the API refuses, then subdivide — is what the competitor's seed script does,
// and it is keyed to THEIR tier (it only subdivides at offset 9,950, so on a
// free-tier key it never subdivides at all). It is also unnecessary: Windy returns a
// truthful `total` for any bbox in response to a ONE-ROW request, so a box can be
// asked how full it is for a single cheap call instead of being paged into a wall and
// having truncation inferred afterwards.
//
// That turns the harvest into an ordinary quadtree keyed on capacity. Measured live
// from the whole globe on 2026-09-05: 301 probe requests resolved the world into 208
// leaf boxes, every one within LEAF_CAPACITY, together holding 70,748 rows — the full
// catalogue, on the free tier. Leaf depths ran 1 to 8, with the dense band at 6-7.
//
// This is why lib/sources/windy.ts's standing comment ("splitting a dense bbox into
// smaller boxes is the tempting fix and it is the wrong one — the split has to be
// re-tuned every time Windy's inventory moves") does not bite here. That is true of a
// FIXED split, which is exactly why that file carries bespoke `brazil` and `belgium`
// entries. An adaptive split re-derives the density map itself on every plan, for 301
// requests, and needs no hand-tuning ever.

/** A Windy bounding box, in Windy's own argument order: north, east, south, west. */
export type Box = [north: number, east: number, south: number, west: number];

/** Rows per page. Measured hard cap — `limit=100` is a 400. */
export const WINDY_PAGE_LIMIT = 50;

/** Highest offset the free tier serves. Measured — `offset=2000` is a 400. */
export const WINDY_MAX_OFFSET = 1000;

/**
 * The most rows one bbox can ever yield: the last servable page starts AT the offset
 * ceiling and still returns a full page, so it is 1,000 + 50 and not 1,000. A box
 * holding more than this cannot be read completely and must be split.
 */
export const LEAF_CAPACITY = WINDY_MAX_OFFSET + WINDY_PAGE_LIMIT;

/**
 * How deep the quadtree may go before a box is accepted as-is and recorded as
 * truncated.
 *
 * The live run needed 8. This is 12 rather than 8 so that a future density spike
 * resolves itself instead of silently capping, and it is bounded rather than infinite
 * so a pathological box (every camera on one coordinate, which subdivision can never
 * separate) terminates instead of probing forever.
 */
export const MAX_DEPTH = 12;

/** The whole planet, and the root every path in this module is relative to. */
export const WORLD: Box = [90, 180, -90, -180];

/**
 * Split a box into four, in a FIXED order: NE, NW, SE, SW.
 *
 * The order is load-bearing, not cosmetic — `boxPath` encodes a leaf's identity as the
 * sequence of indices taken from the root, and `boxFromPath` walks the same sequence
 * back. Reordering these would silently re-point every committed tile at a different
 * patch of the planet.
 */
export function splitBox(box: Box): [Box, Box, Box, Box] {
  const [n, e, s, w] = box;
  const midLat = (n + s) / 2;
  const midLon = (e + w) / 2;
  return [
    [n, e, midLat, midLon], // 0 NE
    [n, midLon, midLat, w], // 1 NW
    [midLat, e, s, midLon], // 2 SE
    [midLat, midLon, s, w], // 3 SW
  ];
}

/**
 * A leaf's stable identity: the path of quadrant indices from the world root, e.g.
 * `r30122013`. Short, filename-safe, self-describing, and — unlike a coordinate string
 * — it cannot drift through floating-point formatting between the generator and the
 * reader.
 */
export function boxPath(indices: readonly number[]): string {
  return "r" + indices.join("");
}

/** Reconstruct a box from its path, so a tile file is self-locating. */
export function boxFromPath(path: string): Box | null {
  if (!/^r[0-3]*$/.test(path)) return null;
  let box = WORLD;
  for (const ch of path.slice(1)) {
    box = splitBox(box)[Number(ch) as 0 | 1 | 2 | 3];
  }
  return box;
}

/**
 * The offsets needed to read a box holding `total` rows.
 *
 * Bounded by WINDY_MAX_OFFSET, so this NEVER plans a request the API will refuse —
 * an over-capacity box returns the offsets that are servable rather than throwing,
 * because `planLeaves` records such a box as truncated and the harvest should still
 * collect the readable part of it.
 */
export function pageOffsets(total: number): number[] {
  const offsets: number[] = [];
  for (let o = 0; o < total && o <= WINDY_MAX_OFFSET; o += WINDY_PAGE_LIMIT) offsets.push(o);
  return offsets;
}

/** Requests needed to page a leaf once. */
export function leafRequestCost(total: number): number {
  return pageOffsets(total).length;
}

/** A box the plan has decided is readable (or is as small as we will make it). */
export interface Leaf {
  /** Path key from the world root — see `boxPath`. */
  k: string;
  box: Box;
  /** Windy's own count for this box at plan time. */
  total: number;
  depth: number;
  /**
   * True when `total` still exceeded LEAF_CAPACITY at MAX_DEPTH. The harvest reads the
   * first LEAF_CAPACITY rows and this flag says the rest exist and were not read —
   * the same truncation-honesty contract lib/signals/coverage.ts enforces elsewhere.
   */
  truncated?: boolean;
}

/** Does this box need splitting before it can be read completely? */
export function needsSplit(total: number, depth: number, maxDepth = MAX_DEPTH): boolean {
  return total > LEAF_CAPACITY && depth < maxDepth;
}

/**
 * Turn probe results into a leaf plan.
 *
 * Written as a generator over a caller-supplied `probe` so the network stays outside
 * this module: a test drives it with a synthetic density function and asserts the tree
 * it produces, with no key and no requests.
 *
 * `probe` returns Windy's `total` for a box, or a negative number if the probe failed.
 * A failed probe is DROPPED rather than assumed empty — recording it as 0 would bake a
 * transient error into the committed plan as "there is nothing here", which is the
 * silent-deletion failure mode registry.ts's mergeResults exists to prevent.
 */
export async function planLeaves(
  probe: (box: Box) => Promise<number>,
  opts: { maxDepth?: number; budget?: number; onProgress?: (used: number, found: number) => void } = {},
): Promise<{ leaves: Leaf[]; probes: number; failed: number; worldTotal: number }> {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const budget = opts.budget ?? Number.POSITIVE_INFINITY;

  const leaves: Leaf[] = [];
  let probes = 0;
  let failed = 0;

  const worldTotal = await probe(WORLD);
  probes++;
  if (worldTotal < 0) return { leaves, probes, failed: 1, worldTotal: 0 };

  const queue: { box: Box; total: number; path: number[] }[] = [
    { box: WORLD, total: worldTotal, path: [] },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const depth = node.path.length;

    if (node.total === 0) continue;
    if (!needsSplit(node.total, depth, maxDepth)) {
      leaves.push({ k: boxPath(node.path), box: node.box, total: node.total, depth });
      continue;
    }
    if (probes + 4 > budget) {
      // Out of probe budget with this box still over capacity. Keep it as a truncated
      // leaf rather than dropping it: reading its first 1,050 rows beats reading none,
      // and the flag says so out loud.
      leaves.push({ k: boxPath(node.path), box: node.box, total: node.total, depth, truncated: true });
      continue;
    }

    const kids = splitBox(node.box);
    const totals = await Promise.all(kids.map((b) => probe(b)));
    probes += 4;
    for (let i = 0; i < 4; i++) {
      const t = totals[i];
      if (t < 0) {
        failed++;
        continue;
      }
      queue.push({ box: kids[i], total: t, path: [...node.path, i] });
    }
    opts.onProgress?.(probes, leaves.length);
  }

  // Deepest-first, so the committed plan reads densest-area-first and a diff shows the
  // interesting boxes at the top rather than an ocean quadrant.
  leaves.sort((a, b) => b.depth - a.depth || a.k.localeCompare(b.k));
  return { leaves, probes, failed, worldTotal };
}

// --- the rolling refresh -----------------------------------------------------------

/**
 * What the store knows about one leaf between runs.
 *
 * `fetchedAt` is the whole mechanism: 0 means never read, and the cursor always takes
 * the oldest first, so an initial fill happens before any refresh and no leaf can be
 * starved by a neighbour.
 */
export interface LeafState extends Leaf {
  /** Epoch ms of the last successful page of this leaf. 0 = never. */
  fetchedAt: number;
  /** Rows kept after the last successful page. */
  rows?: number;
}

/**
 * Choose which leaves this cycle reads, oldest first, within a request budget.
 *
 * WHY A ROLLING CURSOR RATHER THAN ONE BIG HARVEST. Reading the whole catalogue costs
 * ~1,524 paging requests on top of the plan's ~301 probes. Windy documents no daily
 * quota and returns no rate-limit headers, so the honest position is that the ceiling
 * is unknown — and the safe way to spend an unknown budget is slowly and at a constant
 * rate rather than in one burst that could trip a limit nobody has published.
 *
 * So each cycle spends a small fixed budget on the stalest leaves. Coverage climbs
 * monotonically to the whole catalogue and then keeps rolling as a refresh, and the
 * request rate stays flat. At the default cadence and budget the full catalogue is
 * covered in roughly half a day and every leaf is re-read daily, at about one request
 * a minute.
 *
 * A leaf too expensive to fit the remaining budget is SKIPPED, not truncated: the next
 * cycle sees it as still the stalest and takes it with a full budget. Truncating it
 * here would let an expensive leaf be permanently half-read.
 */
export function selectLeavesForCycle(
  leaves: readonly LeafState[],
  budget: number,
): { picked: LeafState[]; cost: number } {
  const order = [...leaves].sort((a, b) => a.fetchedAt - b.fetchedAt || a.k.localeCompare(b.k));
  const picked: LeafState[] = [];
  let cost = 0;
  for (const leaf of order) {
    const c = leafRequestCost(leaf.total);
    if (cost + c > budget) {
      if (picked.length === 0 && c > budget) {
        // Budget smaller than the cheapest available leaf. Take it anyway — otherwise
        // the cycle does nothing at all and coverage never moves.
        picked.push(leaf);
        cost += c;
      }
      break;
    }
    picked.push(leaf);
    cost += c;
  }
  return { picked, cost };
}

/** How many cycles at this budget before every leaf has been read once. */
export function cyclesToFullCoverage(leaves: readonly LeafState[], budget: number): number {
  const totalCost = leaves.reduce((sum, l) => sum + leafRequestCost(l.total), 0);
  return budget > 0 ? Math.ceil(totalCost / budget) : Number.POSITIVE_INFINITY;
}

/** Fraction of the catalogue that has been read at least once. */
export function coverageRatio(leaves: readonly LeafState[]): number {
  const all = leaves.reduce((s, l) => s + l.total, 0);
  if (all === 0) return 0;
  const seen = leaves.reduce((s, l) => (l.fetchedAt > 0 ? s + (l.rows ?? l.total) : s), 0);
  return Math.min(1, seen / all);
}
