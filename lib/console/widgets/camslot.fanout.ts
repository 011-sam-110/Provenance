// Turning a drawn area into a wall of tiles.
//
// The existing send path (camslot.send.ts) puts a whole basket into ONE camera
// wall that rotates through up to sixty streams. That is right for "I clicked
// four cameras, put them somewhere". It is wrong for "monitor this area", where
// the answer is a grid you can watch at a glance.
//
// Everything here is pure so the rules are testable in the node environment the
// rest of tests/unit uses — there is no React testing library in this repo, so a
// rule that lives in a component cannot be tested at all.

import { orderByDistanceFrom, type LatLon } from "@/lib/console/widgets/camslot.arm";
import type { PickedCamera } from "@/lib/console/widgets/camslot.pick";
import type { StreamRef } from "@/lib/console/widgets/camslot.model";

/**
 * Tiles a monitored area fills.
 *
 * Nine because `arrangeWall` tiles uniform 4-of-12-column cards three across, so
 * nine is exactly three full bands and the grid has no ragged last row. It is a
 * parameter rather than a constant at the call site so a narrower board can ask
 * for fewer, but nine is the shape the board was measured for: at 1440px with the
 * 400px dock open a 3-across tile is ~344px, clearing the camslot overlay's
 * 300x170 full-readout threshold.
 */
export const WALL_TILES = 9;

export interface FanOutTile {
  /** The tile's header. A place or a count — never "Camera wall", which is what
   *  four identical untitled tiles used to read as. */
  name: string;
  streams: StreamRef[];
}

/**
 * Wall order: every live camera first, then everything else, each group nearest
 * the centre of the area first.
 *
 * LIVE-FIRST IS LOAD-BEARING, NOT A TIE-BREAK. Caltrans D11 is 72.5% live, so a
 * real circle over San Diego catches both kinds. Ordering by distance alone would
 * scatter stills through the nine tiles, and a board asked for live video would
 * open showing JPEGs. Stills still get in — they fill whatever capacity is left —
 * but they never displace a live camera.
 */
export function orderForWall(picks: readonly PickedCamera[], centre: LatLon): PickedCamera[] {
  const live = orderByDistanceFrom(picks.filter((p) => p.live === true), centre);
  const rest = orderByDistanceFrom(picks.filter((p) => p.live !== true), centre);
  return [...live, ...rest];
}

/**
 * Deal an area's cameras across the wall.
 *
 * ROUND-ROBIN, NOT CONTIGUOUS CHUNKS. Consecutive cameras in a feed are usually
 * consecutive on one road, so chunking would put a whole interchange in tile one
 * and a different road entirely in tile two. Dealing them out gives each tile a
 * spread across the area, which is what makes nine tiles read as coverage rather
 * than as four views of the same junction.
 */
export function planFanOut(
  picks: readonly PickedCamera[],
  centre: LatLon,
  tiles: number = WALL_TILES,
): FanOutTile[] {
  const ordered = orderForWall(picks, centre);
  if (ordered.length === 0) return [];

  // Never more tiles than cameras: nine tiles of which five are empty is not a
  // smaller wall, it is a broken one.
  const count = Math.max(1, Math.min(Math.floor(tiles), ordered.length));
  const buckets: PickedCamera[][] = Array.from({ length: count }, () => []);
  ordered.forEach((p, i) => buckets[i % count].push(p));

  return buckets.map((bucket) => ({
    // A tile holding one camera is named after it, because that is the most
    // useful thing the header could say. A tile holding several cannot be, so it
    // states what it is instead of picking one of its cameras and implying the
    // others are not there.
    name: bucket.length === 1 ? bucket[0].label : `${bucket.length} cameras`,
    streams: bucket.map((p) => p.ref),
  }));
}
