import type { GridRect, SegmentId, ShellLayout } from "@/lib/console/types";

// ── The Terminal's rail model ────────────────────────────────────────────────
//
// This replaces `lib/terminal/layoutGrid.ts`'s free twelve-column grid. There is
// no longer a board to lay out: the map is a fixed hero that fills whatever the
// three rails (left, right, bottom) do not take, and a widget's only position is
// which rail it is in and where in that rail's stack it sits. Everything here is
// pure and DOM-free — vitest runs in the node environment in this repo, so
// anything that needs a browser cannot be tested at all.

/** Below these a rail's header controls collide with each other (left/right) or
 *  a docked card reads as a sliver (bottom). Not measured — reasoned from a
 *  rail's header chrome (grip + icon + title + count + badge + fresh chip + ? +
 *  🔔 + ⤢ + ⋯) plus one readable table row at 13px. Check against the widest
 *  header in the browser. */
export const RAIL_MIN: Record<SegmentId, number> = { left: 220, right: 220, bottom: 140 };

/** Above these a rail starts crowding the map out rather than sharing the
 *  window with it. */
export const RAIL_MAX: Record<SegmentId, number> = { left: 720, right: 720, bottom: 640 };

/** The map never shrinks below this, however wide the rails ask to be. Below it
 *  the basemap's own controls (zoom, search, scope) start colliding. */
export const STAGE_MIN_PX = 360;

/** The wall never shrinks below this either, for the same reason in reverse: on a
 *  `mode: "wall"` board the tiles are the hero and the map is the dock, so it is
 *  the WALL that has to keep a floor. Same number, because it is the same
 *  question about how narrow a pane can get before its own controls collide. */
export const WALL_MIN_PX = STAGE_MIN_PX;

/**
 * The map dock's width on a wall board.
 *
 * NOT `railSizes`, and the difference is the whole reason this exists. A rail is
 * 0 when it holds no widgets — a rule that is right for rails and would close
 * this dock permanently, because the dock holds the STAGE and never holds a
 * widget at all.
 *
 * `collapsed` is the open/closed flag, used for exactly what its name says
 * rather than repurposed: a closed dock is a collapsed right rail. It is
 * `setSegmentCollapsed`'s first product caller — that reducer and
 * `store.collapseSegment` have existed with no caller since before the rails
 * reskin.
 */
export function dockSize(l: ShellLayout, container: { w: number; h: number }): number {
  if (l.segments.right.collapsed) return 0;
  const want = clampRailSize("right", l.segments.right.size);
  return Math.max(0, Math.min(want, container.w - WALL_MIN_PX));
}

/** Arrow-key resize step for a rail splitter, in px. */
export const RAIL_STEP = 16;
/** Shift+arrow resize step — a coarse jump for covering distance fast. */
export const RAIL_STEP_COARSE = 64;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Round and clamp a rail size into its own [RAIL_MIN, RAIL_MAX]. Never returns
 *  a value strictly between 0 and RAIL_MIN — 0 is a distinct state (empty,
 *  collapsed or solo) that only `effectiveRailSize` computes, never this. */
export function clampRailSize(rail: SegmentId, px: number): number {
  const min = RAIL_MIN[rail];
  const max = RAIL_MAX[rail];
  // NaN and non-numbers fall back to the minimum, because they carry NO
  // information about what was wanted. The INFINITIES are not junk in the same
  // sense and are deliberately not lumped in with them: they say "as far as it
  // goes" in a direction, so they clamp naturally to max and min respectively.
  // Treating +Infinity as "junk, therefore the narrowest possible rail" is the
  // opposite of what it asked for, and it is the kind of surprise that only
  // shows up in a persisted layout nobody can reproduce by hand.
  const junk = typeof px !== "number" || Number.isNaN(px);
  const n = junk ? min : Math.round(px);
  return clamp(n, min, max);
}

/**
 * Shrink a left/right pair so their sum fits `budget`, taking it off the WIDER
 * rail first.
 *
 * A rail is never left sitting between 0 and its own minimum — that state has
 * no rendering (a rail narrower than its header controls is not a smaller rail,
 * it is a broken one). So the reduction has two moves per side, in order: shave
 * it down toward its minimum, and if that minimum still does not fit the
 * budget, drop it to exactly 0 rather than stall between the two. The wider
 * side always takes the first cut, which is what keeps two unequal rails
 * converging rather than the narrower one hitting zero while the wider one is
 * untouched.
 */
function fitWidthPair(left: number, right: number, budget: number): [number, number] {
  const b = Math.max(0, budget);
  if (left + right <= b) return [left, right];

  const sizes: Record<"left" | "right", number> = { left, right };
  const order: Array<"left" | "right"> = left >= right ? ["left", "right"] : ["right", "left"];

  for (const key of order) {
    const over = sizes.left + sizes.right - b;
    if (over <= 0) break;
    const min = RAIL_MIN[key];
    const room = Math.max(0, sizes[key] - min);
    sizes[key] -= Math.min(room, over);
    // Still over budget even at this rail's floor: it cannot be shown partially,
    // so it goes to 0 and the other side gets its turn in the next iteration.
    if (sizes.left + sizes.right > b && sizes[key] <= min) sizes[key] = 0;
  }
  // Budget itself smaller than either floor allows (a pathological container):
  // nothing left to give but zero.
  if (sizes.left + sizes.right > b) { sizes.left = 0; sizes.right = 0; }
  return [Math.max(0, sizes.left), Math.max(0, sizes.right)];
}

/** A rail's raw configured size — 0 if it holds no widgets or is user-collapsed.
 *  This is HALF of the "empty rails take no space" contract; the other half
 *  (the left/right width budget against the stage) lives in `fitWidthPair`. */
function rawRailSize(l: ShellLayout, rail: SegmentId): number {
  if (l.segments[rail].collapsed) return 0;
  if (!l.widgets.some((w) => w.segment === rail)) return 0;
  return clampRailSize(rail, l.segments[rail].size);
}

/**
 * Every rail's actual on-screen size right now.
 *
 * A rail is 0 when it is empty, user-collapsed, or `solo` is on — and NEVER for
 * any other reason. This is deliberately computed here and only here: an
 * auto-written `collapsed: true` would need auto-clearing the moment the rail
 * gains a widget again, and the instant that auto-clear disagrees with a
 * `collapsed` the user set by hand, the collapse control undoes itself behind
 * their back. Keeping emptiness a pure function of `widgets` means it can never
 * drift from what is actually on screen.
 */
export function railSizes(
  l: ShellLayout,
  container: { w: number; h: number },
  solo: boolean,
): { left: number; right: number; bottom: number } {
  if (solo) return { left: 0, right: 0, bottom: 0 };
  const left0 = rawRailSize(l, "left");
  const right0 = rawRailSize(l, "right");
  const bottom = rawRailSize(l, "bottom");
  const [left, right] = fitWidthPair(left0, right0, container.w - STAGE_MIN_PX);
  return { left, right, bottom };
}

/** One rail's effective size. See `railSizes` for the contract. */
export function effectiveRailSize(
  l: ShellLayout,
  rail: SegmentId,
  container: { w: number; h: number },
  solo: boolean,
): number {
  return railSizes(l, container, solo)[rail];
}

/** Convert a splitter's pointer position into that rail's size. Each rail hangs
 *  off one fixed edge of `box` (the workspace's content box), and its size is
 *  the pointer's distance from that edge. */
export function railSizeFromPointer(
  rail: SegmentId,
  pointer: { x: number; y: number },
  box: { left: number; right: number; top: number; bottom: number },
): number {
  const raw =
    rail === "left" ? pointer.x - box.left :
    rail === "right" ? box.right - pointer.x :
    box.bottom - pointer.y; // bottom rail hangs off the workspace's bottom edge
  return clampRailSize(rail, raw);
}

/** The three rail sizes as CSS custom properties, ready to spread onto the
 *  workspace's style object. */
export function railVars(
  l: ShellLayout,
  container: { w: number; h: number },
  solo: boolean,
): { "--tn-lw": string; "--tn-rw": string; "--tn-bh": string } {
  const sizes = railSizes(l, container, solo);
  return {
    "--tn-lw": `${sizes.left}px`,
    "--tn-rw": `${sizes.right}px`,
    "--tn-bh": `${sizes.bottom}px`,
  };
}

/**
 * Split `total` between items in proportion to their weights, exactly.
 *
 * Moved unchanged from the deleted `lib/terminal/layoutGrid.ts` — `presets.ts`'s
 * `compose()` still spends this vocabulary on px heights instead of grid rows.
 * The drift from rounding is absorbed by the LARGEST item rather than left on
 * the end, because a column that comes to total+1 reintroduces exactly the
 * clipped-last-card bug this file's ancestor existed to remove, and the largest
 * item is the one that can least notice losing or gaining one unit.
 *
 * Nothing is ever dropped. If the caller asks for more items than fit at `min`
 * the result honestly overflows instead of silently losing one — a missing card
 * is worse than a tight one.
 */
export function splitSpan(weights: readonly number[], total: number, min: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const floor = Math.max(0, min);

  // Not even the floor fits. Everything gets the floor and the result honestly
  // overflows — a missing card is worse than a tight one.
  if (n * floor >= total) return safe.map(() => floor);

  // ── THE FLOOR HAS TO BE PAID FOR OUT OF THE OTHER ITEMS' SHARE ─────────────
  // A single proportional pass plus one drift correction is not enough, and the
  // failure it produced was real rather than theoretical. The Hazards board is
  // seven cards weighted 3,2,2,1,1,1,1 into an 820px window. One pass gives the
  // four ones a 75px share, which the floor lifts to 120 — so 180px appears out
  // of nowhere and the total comes to 1002. Absorbing all of that into the
  // largest card alone drove it from 224px to its own floor and STILL left the
  // column at 891px, overflowing a window it could have fitted: the correct
  // answer pins the four small cards at 120 (480px) and shares the remaining
  // 340px among the other three.
  //
  // So pinning is iterative. Each pass allocates the budget that is left after
  // the already-pinned items have taken their floor, and anything that still
  // comes out below the floor is pinned in turn. It terminates because every
  // pass either pins at least one more item or stops.
  const out = new Array<number>(n).fill(floor);
  const pinned = new Array<boolean>(n).fill(false);

  for (;;) {
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (!pinned[i]) free.push(i);
    if (free.length === 0) break;

    let taken = 0;
    for (let i = 0; i < n; i++) if (pinned[i]) taken += floor;
    const budget = total - taken;
    const sum = free.reduce((a, i) => a + safe[i], 0);

    let pinnedMore = false;
    for (const i of free) {
      const share = Math.round((budget * safe[i]) / sum);
      if (share < floor) {
        pinned[i] = true;
        out[i] = floor;
        pinnedMore = true;
      } else {
        out[i] = share;
      }
    }
    if (!pinnedMore) break;
  }

  // Whatever rounding is left lands on the LARGEST item, which is the one that
  // can least notice gaining or losing a pixel. Never below the floor.
  const drift = total - out.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let biggest = 0;
    for (let i = 1; i < n; i++) if (out[i] > out[biggest]) biggest = i;
    out[biggest] = Math.max(floor, out[biggest] + drift);
  }
  return out;
}

// ── Migration off rectangles ──────────────────────────────────────────────────

/** The pieces of a widget the migration needs: its legacy authoring fields, plus
 *  a legacy `rect` if one survived. Not `WidgetInstance` itself — that type no
 *  longer carries `rect`, precisely because nothing should read it once this
 *  runs. */
export interface LegacyWidgetLike {
  id: string;
  segment: SegmentId;
  order: number;
  height: number;
  rect?: GridRect | null;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Migrate a widget list off grid rectangles onto rail placements. Total (every
 * input id comes back with a placement) and deterministic (same input, same
 * output — no `Math.random`, no `Date.now`).
 *
 * Rule, per widget, in order:
 *
 *  1. No `rect` → trust the stored `segment`. This is every pre-rect share link
 *     and every preset: they were always authored in segment/order/height and
 *     never had a rect to begin with.
 *  2. Has a `rect`, and `stageRect` is known → derive the rail from GEOMETRY,
 *     never from `w.segment`. Nothing has kept `segment` truthful since free
 *     dragging shipped — a card dragged from the left rail to under the map
 *     still claimed `segment: "left"`. Geometry is what the user could see:
 *     entirely left of the stage → left; entirely right → right; anything else
 *     (including straddling an edge) → bottom.
 *
 * Within a derived rail, widgets are ordered by reading order (y then x) for
 * the geometry-derived ones and by their own `order` for the segment-trusted
 * ones, then reindexed densely from 0 — so the guarantee holding sanitize's
 * output ("per-rail order is exactly 0..n-1") is met unconditionally.
 *
 * `height` is `rect.h * 25` clamped `[120,1200]` when a rect is present — 25 is
 * `ROW_PX` (24) + `GAP_PX` (1) from the old grid, the exact inverse of
 * `setWidgetHeight`'s `Math.round(px / 25)`, so a round trip through the two is
 * lossless for any height that started as a whole row count.
 */
export function railsFromRects(
  widgets: readonly LegacyWidgetLike[],
  stageRect: GridRect | null,
): Map<string, { segment: SegmentId; order: number; height: number }> {
  interface Derived { id: string; segment: SegmentId; sortY: number; sortX: number; height: number; fallback: number }

  const derived: Derived[] = widgets.map((w, i) => {
    const rect = w.rect;
    if (rect && stageRect) {
      const rx = num(rect.x, 0);
      const ry = num(rect.y, 0);
      const rw = num(rect.w, 0);
      const sx = num(stageRect.x, 0);
      const sw = num(stageRect.w, 0);
      const segment: SegmentId =
        rx + rw <= sx ? "left" :
        rx >= sx + sw ? "right" :
        "bottom";
      const rh = num(rect.h, 5);
      return { id: w.id, segment, sortY: ry, sortX: rx, height: clamp(Math.round(rh * 25), 120, 1200), fallback: i };
    }
    const segRaw = w.segment;
    const segment: SegmentId = segRaw === "left" || segRaw === "right" || segRaw === "bottom" ? segRaw : "left";
    return {
      id: w.id, segment,
      // No geometry to sort by — fall back to the widget's own order, placed
      // after anything that DID carry geometry (Infinity sorts last).
      sortY: Number.POSITIVE_INFINITY, sortX: num(w.order, i),
      height: clamp(num(w.height, 240), 120, 1200),
      fallback: i,
    };
  });

  const bySegment = new Map<SegmentId, Derived[]>([["left", []], ["right", []], ["bottom", []]]);
  for (const d of derived) bySegment.get(d.segment)!.push(d);

  const out = new Map<string, { segment: SegmentId; order: number; height: number }>();
  for (const [segment, list] of bySegment) {
    const ordered = [...list].sort(
      (a, b) => a.sortY - b.sortY || a.sortX - b.sortX || a.fallback - b.fallback,
    );
    ordered.forEach((d, order) => out.set(d.id, { segment, order, height: d.height }));
  }
  return out;
}
