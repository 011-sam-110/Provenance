// A tile with nothing working borrows a camera from the tile with the most.
//
// THE FAULT (2026-10-23, the downtown Los Angeles wall). A drawn area deals its
// cameras out round-robin, two to four a tile, and when every camera in one tile is
// benched that tile goes blank — "This webcam is not answering", or the empty state —
// while the tile next to it rotates through four working cameras. The area HAS
// pictures; one ninth of the wall just is not showing any of them.
//
// THIS IS A DISPLAY DECISION, NOT A BOARD EDIT, and that is the whole design.
// It is computed on every render from two things that are already there: each tile's
// own streams (its config) and the bench (camslot.health.ts). Nothing is written. A
// borrow written into config would be wrong three ways at once:
//   - `layoutSignature()` (boards.ts) fingerprints every widget's config, so a borrow
//     would light the board's "customised" dot on a board nobody touched, the trap
//     `clearedWall()` in camslot.apply.ts is written around.
//   - the bench is an observation about the last five minutes. A camera that comes
//     back would stay moved, because nothing would move it back.
//   - a reload would restore the moved camera and forget why it moved.
// Derived instead, the plan simply changes when the bench does: a camera that comes
// back off the bench after RETRY_AFTER_MS is its own tile's again on the next render,
// and the lent one goes home.
//
// ONLY ON A WALL BUILT FROM A DRAWN AREA. Every tile there is a share of one area the
// user asked for, so a camera moved between tiles is still inside it. On a board
// composed by hand each tile is somebody's choice — "London", "Madrid" — and filling
// one with another's camera would put on screen a place the tile does not name. The
// caller decides which board it is; this file only knows the rule.
//
// Pure, so the rule is testable in node like the rest of the camslot rules.

import type { StreamRef } from "@/lib/console/widgets/camslot.model";

export interface WallTile {
  id: string;
  /** The tile's own streams, from its config, in its own order. */
  streams: readonly StreamRef[];
}

export interface TileView {
  /** What the tile rotates through: its own working streams, or the one it borrowed. */
  streams: StreamRef[];
  /** The stream this tile is showing for another tile, or null. */
  borrowed: StreamRef | null;
  /** How many of its own streams are on other tiles right now. */
  lent: number;
}

/**
 * Plan what every tile on a wall shows.
 *
 * THE RULE. A tile whose own streams are all down takes ONE working camera from the
 * tile with the most working cameras. In board order, so the plan is the same on
 * every render and every tile computes the same one:
 *  - a lender must keep at least one working camera, so it needs two or more. A
 *    wall where no tile has two keeps its blank tile: moving a picture from one tile
 *    to another would just move the blank;
 *  - counts are taken AFTER each loan, so several blank tiles spread their loans over
 *    the fullest tiles instead of all emptying the same one;
 *  - ties go to the tile earlier on the board;
 *  - the lender gives up its LAST working stream. Its rotation starts where it always
 *    did, so the camera it is showing right now is the least likely to be the one
 *    that leaves;
 *  - a YouTube stream is never lent. An embed takes seconds to start and can open on
 *    an advert, which is why a playlist holding one does not rotate at all.
 *  - a tile with no streams of its own is somebody's empty slot, not a dead one. It
 *    borrows nothing, so its "Add a camera" stays where they left it.
 *
 * `works` is the bench's verdict for one stream right now.
 */
export function refillWall(tiles: readonly WallTile[], works: (s: StreamRef) => boolean): Map<string, TileView> {
  const working = tiles.map((t) => t.streams.filter(works));
  const borrowed: (StreamRef | null)[] = tiles.map(() => null);
  const lent = tiles.map(() => 0);

  tiles.forEach((t, i) => {
    if (t.streams.length === 0 || working[i].length > 0) return;
    let lender = -1;
    working.forEach((w, j) => {
      if (j === i || w.length < 2 || !w.some((s) => s.k !== "yt")) return;
      if (lender < 0 || w.length > working[lender].length) lender = j;
    });
    if (lender < 0) return;
    const from = working[lender];
    let k = from.length - 1;
    while (from[k].k === "yt") k--;
    const [taken] = from.splice(k, 1);
    working[i] = [taken];
    borrowed[i] = taken;
    lent[lender] += 1;
  });

  const plan = new Map<string, TileView>();
  tiles.forEach((t, i) => plan.set(t.id, { streams: working[i], borrowed: borrowed[i], lent: lent[i] }));
  return plan;
}

/**
 * What a tile says about a loan, or null. The bench's own note (camslot.health.ts)
 * already says why the tile's cameras are skipped; this only says where the picture
 * on screen came from, or where one of the tile's cameras went. Without it a tile
 * counting four cameras that rotates through three, or that shows a camera its own
 * list does not hold, would contradict itself with nothing on screen to say why.
 */
export function refillNote(view: Pick<TileView, "borrowed" | "lent">): string | null {
  if (view.borrowed) return "Showing a camera lent by another tile.";
  if (view.lent === 1) return "1 camera here is lent to a tile with none working.";
  if (view.lent > 1) return `${view.lent} cameras here are lent to tiles with none working.`;
  return null;
}
