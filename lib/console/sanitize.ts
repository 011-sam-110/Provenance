import {
  createDefaultLayout, MAX_WIDGETS,
  type GridRect, type ShellLayout, type SegmentId, type StageId, type WidgetInstance,
} from "@/lib/console/types";
import { clampRailSize, railsFromRects } from "@/lib/terminal/rails";
import { sanitizeCamslotConfig } from "@/lib/console/widgets/camslot.model";

const SEGMENTS: SegmentId[] = ["left", "right", "bottom"];
const STAGES: StageId[] = ["map3d", "map2d", "clock"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * A rect only if the input is a complete, finite one — a half-written rect is
 * treated as absent. LEGACY ONLY: nothing in the modern type carries a rect, but
 * a `?c=` link minted by an older build, or a `tn.console.v1` blob written
 * before rails shipped, still can. `railsFromRects` (lib/terminal/rails.ts) is
 * the only thing that reads what this returns.
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

  interface Parsed {
    id: string; type: string; segment: SegmentId; order: number; height: number;
    rect: GridRect | null; collapsed: boolean; config: Record<string, unknown>;
  }
  const parsed: Parsed[] = [];
  for (const w of r.widgets as unknown[]) {
    if (parsed.length >= MAX_WIDGETS) break;
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    parsed.push({
      id: o.id,
      type: o.type,
      segment: SEGMENTS.includes(o.segment as SegmentId) ? (o.segment as SegmentId) : "left",
      order: num(o.order, parsed.length),
      height: clamp(num(o.height, 240), 120, 1200),
      rect: readRect(o.rect), // legacy only — see readRect
      collapsed: o.collapsed === true,
      config: readConfig(o.type, o.config),
    });
  }

  // Legacy stageRect, if the input carries one. `createDefaultLayout` no longer
  // has one to fall back to — a fresh layout has no rects at all, which is
  // exactly rule 1 of `railsFromRects`: no rect means trust the stored segment.
  const legacyStageRect = readRect(r.stageRect);
  const placements = railsFromRects(
    parsed.map((p) => ({ id: p.id, segment: p.segment, order: p.order, height: p.height, rect: p.rect })),
    legacyStageRect,
  );

  const widgets: WidgetInstance[] = parsed.map((p) => {
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

  const ids = new Set(widgets.map((w) => w.id));
  const focusedWidgetId =
    typeof r.focusedWidgetId === "string" && ids.has(r.focusedWidgetId) ? r.focusedWidgetId : null;

  return {
    segments,
    stage: r.stage as StageId,
    widgets,
    focusedWidgetId,
  };
}
