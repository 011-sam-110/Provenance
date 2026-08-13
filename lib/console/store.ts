"use client";
import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { createDefaultLayout, type GridRect, type ShellLayout, type SegmentId, type StageId } from "@/lib/console/types";
import { sanitizeLayout } from "@/lib/console/sanitize";
import * as R from "@/lib/console/reducers";

const KEY = "tn.console.v1";
const VERSION = 1;

let state: ShellLayout = createDefaultLayout();
let seq = 0;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); savePersisted(KEY, VERSION, state); }
function nextId(): string { seq += 1; return `w${Date.now().toString(36)}${seq.toString(36)}`; }

export const shellLayoutStore = {
  get(): ShellLayout { return state; },
  set(l: ShellLayout) { state = l; emit(); },
  replace(l: ShellLayout) { const clean = sanitizeLayout(l); if (clean) { state = clean; emit(); } },
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
  placeItem(id: string, rect: GridRect) { state = R.setItemRect(state, id, rect); emit(); },
  /** Re-seed every position from CONSOLE or WALL. */
  arrange(mode: "console" | "wall") { state = R.arrangeBoard(state, mode); emit(); },
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
