import {
  createDefaultLayout, MAX_WIDGETS,
  type GridRect, type ShellLayout, type SegmentId, type StageId, type WidgetInstance,
} from "@/lib/console/types";
import { clampRailSize, railsFromRects } from "@/lib/terminal/rails";
import { clampRect } from "@/lib/terminal/layoutGrid";
import { seedWallRects } from "@/lib/console/reducers";
import { sanitizeCamslotConfig } from "@/lib/console/widgets/camslot.model";

const SEGMENTS: SegmentId[] = ["left", "right", "bottom"];
const STAGES: StageId[] = ["map3d", "map2d", "clock"];

/** One widget as read off untrusted input, before either mode decides what its
 *  `rect` means. Module-scoped so both placement paths below can take it. */
interface Parsed {
  id: string; type: string; segment: SegmentId; order: number; height: number;
  rect: GridRect | null; collapsed: boolean; config: Record<string, unknown>;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Widget types that no longer exist, and what a stored one loads as instead. */
const RETIRED_TYPES: Record<string, string> = { cameras: "camslot" };

/**
 * A rect only if the input is a complete, finite one — a half-written rect is
 * treated as absent.
 *
 * WHAT READS THIS DEPENDS ENTIRELY ON `mode`, and getting that wrong is silent:
 *
 *  • rails — the rect is LEGACY. It can only have come from a `?c=` link minted
 *    by an older build or a `tn.console.v1` blob written before rails shipped, and
 *    `railsFromRects` converts it into a rail placement and discards it. Unchanged
 *    from before this file learned about walls.
 *  • wall — the rect IS the widget's position and is KEPT. Running the rails
 *    migration over it here is the bug this branch exists to prevent: it does not
 *    throw and it does not warn, it just quietly turns a wall back into a stack on
 *    the next page load.
 */
function readRect(v: unknown): GridRect | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number };
}

/**
 * Per-type config coercion.
 *
 * Everything except `camslot` keeps the historic behaviour — an object passes
 * through untouched — because those configs are small scalars written by our own UI,
 * and validating them here would be a silent behaviour change across ~69 widget
 * types.
 *
 * `camslot` is different in kind. Its config carries a LIST that becomes image
 * requests and an iframe src, and it arrives from `?c=` links a stranger can author:
 * an `intervalMs` of 0 clamps to ~4ms in setInterval, which is a one-click DoS on
 * whoever opens the link. Sanitising it here means every share link is validated at
 * the one choke point they all pass through, instead of relying on each render path
 * to remember.
 */
function readConfig(type: unknown, raw: unknown): Record<string, unknown> {
  if (type === "camslot") return sanitizeCamslotConfig(raw) as unknown as Record<string, unknown>;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/** Coerce arbitrary/untrusted input into a valid ShellLayout, or null if unrecoverable.
 *  Guarantees: all three segment keys present; sizes clamped per rail via
 *  `clampRailSize`; each widget has a valid segment, a dense per-rail `order`
 *  starting at 0, a clamped height [120,1200], and an object config; total
 *  widgets <= MAX_WIDGETS. */
export function sanitizeLayout(raw: unknown): ShellLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.widgets)) return null;
  if (typeof r.stage !== "string" || !STAGES.includes(r.stage as StageId)) return null;
  if (!r.segments || typeof r.segments !== "object") return null;

  const base = createDefaultLayout();
  const segsIn = r.segments as Record<string, unknown>;
  const segments = {} as ShellLayout["segments"];
  for (const id of SEGMENTS) {
    const s = segsIn[id] && typeof segsIn[id] === "object" ? (segsIn[id] as Record<string, unknown>) : {};
    segments[id] = {
      size: clampRailSize(id, num(s.size, base.segments[id].size)),
      collapsed: s.collapsed === true,
    };
  }

  const parsed: Parsed[] = [];
  for (const w of r.widgets as unknown[]) {
    if (parsed.length >= MAX_WIDGETS) break;
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    // The `cameras` widget was retired in favour of `camslot`. An unmigrated type is
    // not an error anyone can see: WidgetFrame renders null for an unregistered type,
    // so a board or a ?c= link written before the swap would show a HOLE where a tile
    // used to be — it keeps its place in the grid, reports nothing, and cannot be
    // clicked. Renaming it here lands it on camslot's empty state instead.
    // `type` and not `o.type` is passed to readConfig below, and that is the
    // load-bearing half: it routes the old `{}` through sanitizeCamslotConfig, so a
    // migrated tile IS a freshly-added one rather than merely resembling one.
    const type = RETIRED_TYPES[o.type] ?? o.type;
    parsed.push({
      id: o.id,
      type,
      segment: SEGMENTS.includes(o.segment as SegmentId) ? (o.segment as SegmentId) : "left",
      order: num(o.order, parsed.length),
      height: clamp(num(o.height, 240), 120, 1200),
      rect: readRect(o.rect), // legacy only — see readRect
      collapsed: o.collapsed === true,
      config: readConfig(type, o.config),
    });
  }

  // An ABSENT mode reads as "rails", and that default is the whole compatibility
  // story: every layout already in localStorage, every archived board and every
  // `?c=` link minted before walls existed lands here and takes the identical path
  // it took before. No layout VERSION bump, so no saved board is wiped to add a
  // field.
  const mode = r.mode === "wall" ? "wall" : "rails";

  const widgets: WidgetInstance[] =
    mode === "wall" ? wallWidgets(parsed) : railWidgets(parsed, readRect(r.stageRect));

  const ids = new Set(widgets.map((w) => w.id));
  const focusedWidgetId =
    typeof r.focusedWidgetId === "string" && ids.has(r.focusedWidgetId) ? r.focusedWidgetId : null;

  const layout: ShellLayout = {
    segments,
    stage: r.stage as StageId,
    widgets,
    focusedWidgetId,
    mode,
  };

  // Repair, not decoration. A wall tile with no rect is MOUNTED BUT NEVER DRAWN —
  // it holds its config and its fetches and shows nothing — which reads as data
  // loss and is impossible to diagnose from the screen. Tiles can legitimately
  // arrive that way: a rails `?c=` link opened on a wall board, or a rect that
  // failed readRect's completeness check.
  return mode === "wall" ? seedWallRects(layout) : layout;
}

/** RAILS — unchanged. The rect is legacy input and `railsFromRects` converts it
 *  into a rail placement, which is what every stored layout expects today.
 *
 *  `createDefaultLayout` has no stageRect to fall back to — a fresh layout has no
 *  rects at all, which is exactly rule 1 of `railsFromRects`: no rect means trust
 *  the stored segment. */
function railWidgets(parsed: Parsed[], legacyStageRect: GridRect | null): WidgetInstance[] {
  const placements = railsFromRects(
    parsed.map((p) => ({ id: p.id, segment: p.segment, order: p.order, height: p.height, rect: p.rect })),
    legacyStageRect,
  );
  return parsed.map((p) => {
    // `railsFromRects` is total — every id handed in comes back with a placement.
    const placed = placements.get(p.id)!;
    return {
      id: p.id,
      type: p.type,
      segment: placed.segment,
      order: placed.order,
      height: placed.height,
      collapsed: p.collapsed,
      config: p.config,
    };
  });
}

/** WALL — the rect is kept and clamped onto the board.
 *
 *  `segment` / `order` / `height` are still densified and kept valid even though
 *  nothing on a wall reads them for placement. That is what makes a mode change a
 *  no-op rather than a migration in either direction: `railsFromRects` can derive
 *  a rail placement from these the moment a board goes back to rails. */
function wallWidgets(parsed: Parsed[]): WidgetInstance[] {
  const seen = new Map<SegmentId, number>();
  return parsed.map((p) => {
    const order = seen.get(p.segment) ?? 0;
    seen.set(p.segment, order + 1);
    return {
      id: p.id,
      type: p.type,
      segment: p.segment,
      order,
      height: p.height,
      collapsed: p.collapsed,
      config: p.config,
      ...(p.rect ? { rect: clampRect({ ...p.rect }) } : {}),
    };
  });
}
