"use client";
import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { createDefaultLayout, type GridRect, type ShellLayout, type SegmentId, type StageId } from "@/lib/console/types";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { activePresetStore } from "@/lib/console/activePreset";
import { writeBoardLayout } from "@/lib/console/boards";
import { visibleRows } from "@/lib/terminal/rowBudget";
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
function emit(archive = true) {
  for (const l of listeners) l();
  savePersisted(KEY, VERSION, state);
  const board = activePresetStore.get();
  if (archive && board) writeBoardLayout(board, state);
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
  add(type: string, opts: { segment?: SegmentId; config?: Record<string, unknown>; height?: number; width?: number } = {}) {
    if (R.isAtCapacity(state)) return { ok: false as const };
    const id = nextId();
    state = R.addWidget(state, type, id, opts); emit();
    return { ok: true as const, id };
  },
  remove(id: string) { state = R.removeWidget(state, id); emit(); },
  move(id: string, seg: SegmentId, idx: number) { state = R.moveWidget(state, id, seg, idx); emit(); },
  resizeWidget(id: string, h: number) { state = R.setWidgetHeight(state, id, h); emit(); },
  resizeWidth(id: string, span: number) { state = R.setWidgetWidth(state, id, span); emit(); },
  /** Move or resize a grid item — a widget, or STAGE_ID for the map. The single
   *  write path for every drag, resize and keyboard nudge. */
  placeItem(id: string, rect: GridRect, prevRect: GridRect | null = null) { state = R.setItemRect(state, id, rect, prevRect); emit(); },
  /** Re-seed every position from CONSOLE or WALL, fitted to the window. */
  arrange(mode: "console" | "wall") { state = R.arrangeBoard(state, mode, visibleRows()); emit(); },
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
