"use client";
import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { createDefaultLayout, type ShellLayout, type SegmentId, type StageId, type GridRect } from "@/lib/console/types";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { activePresetStore } from "@/lib/console/activePreset";
import { writeBoardLayout } from "@/lib/console/boards";
import * as R from "@/lib/console/reducers";

const KEY = "tn.console.v1";
const VERSION = 1;

let state: ShellLayout = createDefaultLayout();
let seq = 0;
const listeners = new Set<() => void>();

/**
 * One write path, two destinations.
 *
 * `tn.console.v1` keeps holding the live layout exactly as it always did — that is
 * the path a page RELOAD restores through, and it already worked, so it is left
 * alone.
 *
 * The second write is the fix. Every change is also filed under the board that is
 * currently open, so switching tabs can bring a board back the way its owner left
 * it instead of rebuilding it from the template. See lib/console/boards.ts for the
 * bug this closes.
 *
 * The active-board id can legitimately be null — during the very first hydrate,
 * and for a layout arrived at from a `?c=` share link, which belongs to no board.
 * Writing those to an archive slot would invent a board the user never chose, so
 * they are skipped and live in the single slot alone.
 *
 * `archive: false` says "this change is not an edit of the board". Exactly one
 * caller needs it — `applyPreset`, laying a board's own template down as it opens
 * it. Without the opt-out, opening a board would immediately file the template as
 * that board's saved edits, "edited" would be true for every board the moment it
 * was viewed, and Reset would leave the board dirty the instant it finished.
 */
/**
 * ── THE GESTURE SUSPENSION ──────────────────────────────────────────────────
 *
 * A drag commits on every CELL CROSSING, which is tens of writes in one gesture.
 * Each of those used to run `writeBoardLayout`, and that function `JSON.parse`s
 * the ENTIRE saved-board archive, mutates one slot and stringifies it all back.
 * lib/console/types.ts names this itself as the reason MAX_WIDGETS is capped at
 * 200 rather than left unbounded:
 *
 *   "the DRAG PATH is the thing to watch: boards.ts re-parses its whole archive
 *    on every cell crossing of every drag."
 *
 * It has been dormant since #146 for the simple reason that nothing drags any
 * more. Restoring the wall makes it live again, so it is fixed here rather than
 * re-shipped.
 *
 * WHAT IS SUSPENDED IS PERSISTENCE, NEVER NOTIFICATION. Subscribers keep firing on
 * every commit — they have to, or the board would not repaint under the pointer.
 * Only the two storage writes are deferred, and they run once on release. A
 * gesture that never ends (a pointercancel that loses its handler, a crash
 * mid-drag) costs at most the changes since it began, which is the same exposure
 * a page closed mid-drag has always had.
 */
let gesture = 0;
let gestureArchived = false;

function persist(archive: boolean) {
  savePersisted(KEY, VERSION, state);
  const board = activePresetStore.get();
  if (archive && board) writeBoardLayout(board, state);
}

function emit(archive = true) {
  for (const l of listeners) l();
  if (gesture > 0) { gestureArchived = gestureArchived || archive; return; }
  persist(archive);
}
function nextId(): string { seq += 1; return `w${Date.now().toString(36)}${seq.toString(36)}`; }

export const shellLayoutStore = {
  get(): ShellLayout { return state; },
  set(l: ShellLayout) { state = l; emit(); },
  replace(l: ShellLayout, opts: { archive?: boolean } = {}) {
    const clean = sanitizeLayout(l);
    if (clean) { state = clean; emit(opts.archive !== false); }
  },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  hydrate() { const s = loadPersisted<ShellLayout>(KEY, VERSION); const clean = s ? sanitizeLayout(s) : null; if (clean) { state = clean; emit(); } },
  /** `segment` is required — the picker (or a caller standing in for it) always
   *  knows which rail a widget is going into; there is no free-drag drop point
   *  left to fall back to a guess from. */
  add(type: string, opts: { segment: SegmentId; config?: Record<string, unknown>; height?: number }) {
    if (R.isAtCapacity(state)) return { ok: false as const };
    const id = nextId();
    state = R.addWidget(state, type, id, opts); emit();
    return { ok: true as const, id };
  },
  remove(id: string) { state = R.removeWidget(state, id); emit(); },
  move(id: string, seg: SegmentId, idx: number) { state = R.moveWidget(state, id, seg, idx); emit(); },
  resizeWidget(id: string, h: number) { state = R.setWidgetHeight(state, id, h); emit(); },
  resizeWidth(id: string, span: number) { state = R.setWidgetWidth(state, id, span); emit(); },

  // ── Wall ──────────────────────────────────────────────────────────────────
  /** Move or resize one tile and settle the board around it. `prevRect` is what a
   *  live gesture passes so a tile dropped on a neighbour swaps rather than shoves. */
  placeItem(id: string, rect: GridRect, prevRect: GridRect | null = null) {
    state = R.setItemRect(state, id, rect, prevRect); emit();
  },
  /** Reset every tile to the wall arrangement, fitted to the window. */
  arrange(rows?: number) { state = R.arrangeBoard(state, rows); emit(); },
  /** Give any tile that lacks a rect one, without disturbing the placed ones. */
  seedWall(rows?: number) {
    const next = R.seedWallRects(state, rows);
    if (next !== state) { state = next; emit(); }
  },

  /** Bracket a pointer gesture. See THE GESTURE SUSPENSION above — this defers the
   *  two storage writes, never the subscriber notification. Re-entrant, so a
   *  handler that begins twice is not left permanently suspended by one end. */
  beginGesture() { gesture += 1; },
  endGesture() {
    if (gesture === 0) return;
    gesture -= 1;
    if (gesture > 0) return;
    const archive = gestureArchived;
    gestureArchived = false;
    persist(archive);
  },
  collapseWidget(id: string, c: boolean) { state = R.setWidgetCollapsed(state, id, c); emit(); },
  configure(id: string, patch: Record<string, unknown>) { state = R.setWidgetConfig(state, id, patch); emit(); },
  setSegment(seg: SegmentId, size: number) { state = R.setSegmentSize(state, seg, size); emit(); },
  collapseSegment(seg: SegmentId, c: boolean) { state = R.setSegmentCollapsed(state, seg, c); emit(); },
  stage(s: StageId) { state = R.setStage(state, s); emit(); },
  focus(id: string) { state = R.setFocus(state, id); emit(); },
  unfocus() { state = R.setFocus(state, null); emit(); },
};

export function useShellLayout(): ShellLayout {
  return useSyncExternalStore(shellLayoutStore.subscribe, shellLayoutStore.get, shellLayoutStore.get);
}
