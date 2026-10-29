// Which Sources rail ids the pointer is lighting up on the map, and when that settles.
//
// The rail (a row, or a section heading) HOLDS a set of ids while the pointer or the
// focus is on it and lets go when it leaves. This store turns those holds into one
// settled list, which the map reads (lib/map/sourceHighlight.ts does the drawing).
// No React and no DOM, so the timing is testable with fake timers.
//
// ONE DEBOUNCE FOR BOTH EDGES. A change is applied only after `settleMs` with no newer
// change, whether it lights something or clears it. Sweeping down the list fires a
// release then a hold on every row; without this the map would flash at each row
// instead of settling on the last one. The same pause covers moving from a row onto
// the next with a gap between them.
//
// NEWEST HOLD WINS. A release only acts if its hold is still the newest. A row the
// pointer already left can release late (React runs the effect cleanup after the
// render), and it must not clear the row the pointer is on now.

export type HoverIds = readonly string[];

export interface SourceHoverStore {
  /** The ids the map is lighting now (settled, not pending). */
  get(): HoverIds;
  /** Light these ids. Returns the release, which is a no-op once a newer hold exists. */
  hold(ids: HoverIds): () => void;
  /** Called with the settled ids, only when they changed. Returns the unsubscribe. */
  subscribe(fn: (ids: HoverIds) => void): () => void;
}

export interface SourceHoverOptions {
  settleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The default settle pause, in ms. */
export const SETTLE_MS = 80;

const NONE: HoverIds = [];

function sameIds(a: HoverIds, b: HoverIds): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function createSourceHover(opts: SourceHoverOptions = {}): SourceHoverStore {
  const settleMs = opts.settleMs ?? SETTLE_MS;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let settled: HoverIds = NONE;
  let newest = 0;
  let timer: unknown = null;
  const subs = new Set<(ids: HoverIds) => void>();

  const schedule = (ids: HoverIds) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (sameIds(settled, ids)) return;
      settled = ids;
      for (const fn of [...subs]) fn(settled);
    }, settleMs);
  };

  return {
    get: () => settled,
    hold(ids) {
      const mine = ++newest;
      schedule([...ids]);
      return () => {
        if (mine !== newest) return; // a newer hold owns the light now
        schedule(NONE);
      };
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export const sourceHoverStore: SourceHoverStore = createSourceHover();

/**
 * The ids a section heading lights: the rows that are switched on and paint the map.
 * A widget-only row has no map layer, so it is never lit.
 */
export function litIdsForSection(
  rows: ReadonlyArray<{ id: string; widgetOnly?: boolean }>,
  isOn: (id: string) => boolean,
): string[] {
  return rows.filter((r) => !r.widgetOnly && isOn(r.id)).map((r) => r.id);
}
