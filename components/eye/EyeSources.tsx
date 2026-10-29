"use client";
// The God's eye view's Sources: the console's own rail as a tray (SourcesTray), and the
// sources pinned to the bar (PinnedSources), with the drag that pins them (useSourcesBar).
//
// BUILT FROM THE CONSOLE'S COMPONENTS, NOT DRAWN AGAIN. The tray is a `.tn-rail` inside a
// `.tn-terminal` token scope (see eye.module.css and lib/eye/skin.ts: in this view it is
// always the console's dark mode). Its header is `.tn-rail-header` with the rail's
// `.tn-rail-tabs` and `.tn-rail-collapse`, its sections are the console's SourceSection and
// its rows are SourceRowView, the very markup the console's rail draws (a SourceRow in the
// console, a TrayRow here). Only PLACEMENT and the few pieces this view alone has (the pop-up
// on a phone, the section strip, the grip, the ghost) are in EyeSources.module.css, and every
// colour there is a `--tn-*` token.
//
// NOTHING HERE IMPORTS THE CONSOLE'S WIDGET, PLACEMENT, STATUS OR REGISTRY MODULES, or the
// catalogue: /eye loads this file in the browser. The rows arrive as a prop, built on the
// server (lib/eye/sourceRows.ts). tests/unit/eye-sources-bundle.test.ts holds the line.
//
// NO REACT STATE PER FRAME. A drag moves its ghost by `style.transform` from a ref. State
// changes when a source is lifted, when it is dropped, and when the slot under it changes.
//
// WITHOUT DRAGGING (WCAG 2.5.7): every row has a ＋ that pins it; a focused pin moves with
// Alt+Left / Alt+Right and unpins with Delete or Backspace; a right-click (or a touch held
// without moving) opens a small menu on the pin with the same three actions.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import SourceRowView from "@/components/shell/sources/SourceRowView";
import SourceSection from "@/components/shell/sources/SourceSection";
import type { SourceRowModel } from "@/lib/console/sources/sections";
import { dropIndex, type PinRect } from "@/lib/eye/pins";
import {
  filterSections,
  isRoadRow,
  rowIsOn,
  sectionsOf,
  toSectionModel,
  type EyeSourceRow,
  type SourcesAction,
  type SourcesState,
} from "@/lib/eye/sources";
import {
  CLOSE_SOURCES,
  DRAG_CANCELLED,
  DROPPED_NOTHING,
  FULL_MAP_LABEL,
  LONDON_ONLY,
  PIN_MOVE_LEFT,
  PIN_MOVE_RIGHT,
  PIN_UNPIN,
  SEARCH_PLACEHOLDER,
  SECTIONS_TAB,
  SHOW_ALL_TAB,
  drawnAsText,
  fullMapName,
  hereText,
  leftOutText,
  liftedText,
  movedPinText,
  noMatchText,
  pinCapText,
  pinName,
  pinnedText,
  sourcesName,
  switchName,
  unpinGhostText,
  unpinnedText,
} from "@/lib/eye/wording";
import styles from "./EyeSources.module.css";

/** The tray's id, for the button's aria-controls. */
export const TRAY_ID = "eye-sources";

export type TrayView = "sections" | "all";
/** Which view and section the tray was last on, kept for the visit and never saved. */
export interface TrayMemory {
  view: TrayView;
  section: string;
}

/** A press that moves this far lifts a source; one that does not is a click. */
const DRAG_PX = 5;
/** A touch held this long on a pin, and released without moving, opens its menu. */
const HOLD_MS = 450;
/** The bar's box is padded by this much when asking "is the pointer over it?". */
const BAR_PAD = 26;

/** The rail's close mark: inline SVG, as SourceCatalog draws it. */
function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden focusable="false">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ── The drag and the pin menu ─────────────────────────────────────────────────────────

interface Lifted {
  id: string;
  from: "row" | "pin";
  label: string;
  color: string;
  touch: boolean;
  /** The pointer is over the bar (its box padded by BAR_PAD). */
  over: boolean;
  /** The place it would take among the other pins, or null off the bar. */
  slot: number | null;
}

interface PinMenu {
  id: string;
  /** Fixed-position anchor, measured when the menu opened. */
  at: { left?: number; right?: number; top?: number; bottom?: number };
}

export interface SourcesBar {
  lifted: Lifted | null;
  /** True from lift to drop: Escape then belongs to the drag. */
  activeRef: React.MutableRefObject<boolean>;
  ghostRef: React.RefObject<HTMLDivElement | null>;
  /** The polite live region's text: lift, drop, cap, cancel. */
  message: string;
  say: (m: string) => void;
  /** Bumped when a pin is refused, to shake the bar once. */
  shake: number;
  /** A press on a source's row. Mouse or pen lifts after DRAG_PX; a touch lifts only from the grip. */
  rowDown: (e: React.PointerEvent<HTMLElement>, id: string, fromGrip: boolean) => void;
  /** A press on a pin: DRAG_PX lifts it; a held touch released in place opens its menu. */
  pinDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  menu: PinMenu | null;
  openMenu: (id: string, anchor: HTMLElement) => void;
  closeMenu: (refocus: boolean) => void;
  /** Pin `id` from a ＋, or say the bar is full. */
  pinFromButton: (id: string) => void;
}

export function useSourcesBar(args: {
  rows: readonly EyeSourceRow[];
  state: SourcesState;
  cap: number;
  portrait: boolean;
  dispatch: (a: SourcesAction) => void;
  /** The controls bar: what a drop must land on. */
  barRef: React.RefObject<HTMLElement | null>;
}): SourcesBar {
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(0);
  const [menu, setMenu] = useState<PinMenu | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);
  const latest = useRef(args);
  latest.current = args;
  const cleanup = useRef<(() => void) | null>(null);

  const say = (m: string) => setMessage(m);
  const refuse = () => {
    setMessage(pinCapText(latest.current.cap));
    setShake((n) => n + 1);
  };

  /**
   * Start a drag from a press. The move and up listeners go on `window`, as in
   * components/shell/sources/useRailDrag.ts. The pointer is captured only when the source
   * is LIFTED, not on the press, so that a click on a row's label still reaches the label.
   */
  function begin(e: React.PointerEvent<HTMLElement>, id: string, from: "row" | "pin", immediate: boolean) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const a = latest.current;
    const row = a.rows.find((r) => r.id === id);
    if (!row) return;
    cleanup.current?.();

    const touch = e.pointerType === "touch";
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let x = startX;
    let y = startY;
    let isLifted = false;
    let held = false;
    let pinRects: PinRect[] = [];
    let draggedIndex: number | undefined;
    let overNow = false;
    let slotNow: number | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;

    // The ghost follows the pointer above a finger and beside a mouse, by transform only.
    const placeGhost = () => {
      const g = ghostRef.current;
      if (!g) return;
      g.style.transform = touch ? `translate3d(${x - 56}px, ${y - 82}px, 0)` : `translate3d(${x + 14}px, ${y + 12}px, 0)`;
    };
    const measure = () => {
      const bar = latest.current.barRef.current?.getBoundingClientRect();
      const over =
        !!bar && x >= bar.left - BAR_PAD && x <= bar.right + BAR_PAD && y >= bar.top - BAR_PAD && y <= bar.bottom + BAR_PAD;
      const slot = over ? dropIndex(x, pinRects, draggedIndex) : null;
      if (over === overNow && slot === slotNow) return;
      overNow = over;
      slotNow = slot;
      setLifted((l) => (l ? { ...l, over, slot } : l));
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      setMessage(DRAG_CANCELLED);
      end();
    };

    const lift = () => {
      isLifted = true;
      clearTimeout(holdTimer);
      // The pins are measured BEFORE the bar opens up for the drop, and kept: the slot is
      // worked out against where they were, so it cannot flicker as the bar reflows.
      pinRects = [...document.querySelectorAll<HTMLElement>("[data-pin]")].map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      const visible = latest.current.state.pins.slice(0, latest.current.cap);
      const at = visible.indexOf(id);
      draggedIndex = at >= 0 ? at : undefined;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* the pointer is already gone */
      }
      // While a source is carried nothing under the pointer may be selected.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      activeRef.current = true;
      setLifted({ id, from, label: row.label, color: row.color, touch, over: false, slot: null });
      setMessage(liftedText(row.label));
      window.addEventListener("keydown", onKey, true);
      placeGhost();
      measure();
    };

    const drop = () => {
      const now = latest.current;
      const pins = now.state.pins;
      if (from === "row") {
        if (!overNow || slotNow == null) {
          setMessage(DROPPED_NOTHING);
          return;
        }
        if (pins.includes(id)) {
          now.dispatch({ type: "pin", id, at: slotNow });
          setMessage(movedPinText(row.label, slotNow + 1, pins.length));
          return;
        }
        if (pins.length >= now.cap) {
          refuse();
          return;
        }
        now.dispatch({ type: "pin", id, at: slotNow });
        setMessage(pinnedText(row.label, slotNow + 1, pins.length + 1));
        return;
      }
      if (!overNow) {
        now.dispatch({ type: "unpin", id });
        setMessage(unpinnedText(row.label));
        return;
      }
      if (slotNow != null) {
        now.dispatch({ type: "pin", id, at: slotNow });
        setMessage(movedPinText(row.label, slotNow + 1, pins.length));
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!isLifted) {
        if (Math.hypot(x - startX, y - startY) < DRAG_PX) return;
        // A finger that began off the grip is scrolling the list, not carrying a source.
        if (touch && from === "row" && !immediate) {
          end();
          return;
        }
        lift();
      }
      placeGhost();
      measure();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (isLifted) {
        measure();
        drop();
        // The release is also a click on the element that holds the pointer: swallow it, or
        // dropping a pin would switch its layer.
        const swallow = (c: Event) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 60);
      } else if (held) {
        openMenuFor(id, el);
      }
      end();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end();
    };

    function end() {
      clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (isLifted) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
      try {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      } catch {
        /* gone */
      }
      if (isLifted) {
        activeRef.current = false;
        setLifted(null);
      }
      cleanup.current = null;
    }
    cleanup.current = end;

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (immediate) lift();
    else if (touch && from === "pin") holdTimer = setTimeout(() => (held = true), HOLD_MS);
  }

  useEffect(() => () => cleanup.current?.(), []);

  function openMenuFor(id: string, anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const at = latest.current.portrait
      ? { left: Math.max(8, Math.min(r.left, window.innerWidth - 172)), bottom: window.innerHeight - r.top + 6 }
      : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 };
    setMenu({ id, at });
  }

  // The menu closes on a press anywhere off it.
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest("[data-pin-menu]")) setMenu(null);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [menu]);

  return {
    lifted,
    activeRef,
    ghostRef,
    message,
    say,
    shake,
    rowDown: (e, id, fromGrip) => begin(e, id, "row", fromGrip),
    pinDown: (e, id) => begin(e, id, "pin", false),
    menu,
    openMenu: openMenuFor,
    closeMenu: (refocus) => {
      const id = menu?.id;
      setMenu(null);
      if (refocus && id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pin="${CSS.escape(id)}"]`)?.focus());
    },
    pinFromButton: (id) => {
      const a = latest.current;
      const row = a.rows.find((r) => r.id === id);
      if (!row) return;
      if (a.state.pins.includes(id)) {
        a.dispatch({ type: "unpin", id });
        setMessage(unpinnedText(row.label));
        return;
      }
      if (a.state.pins.length >= a.cap) {
        refuse();
        return;
      }
      a.dispatch({ type: "pin", id });
      setMessage(pinnedText(row.label, a.state.pins.length + 1, a.state.pins.length + 1));
    },
  };
}

// ── The tray ───────────────────────────────────────────────────────────────────────────

/**
 * One row of the tray: the console's row drawing (SourceRowView) with this view's meanings.
 * The popover opens on the pointer (mouse and pen), on keyboard focus and on a tap of the
 * label, as the console's does, and hangs under the row. It takes no pointer events
 * (`.tn-src-pop`), so it is never what the pointer lands on while moving down the list.
 */
function TrayRow({
  model,
  row,
  on,
  pinned,
  roadOff,
  count,
  portrait,
  bar,
  dispatch,
}: {
  model: SourceRowModel;
  row: EyeSourceRow;
  on: boolean;
  pinned: boolean;
  /** One of TfL's three road rows, outside London: its switch has nothing to do. */
  roadOff: boolean;
  count: number | undefined;
  portrait: boolean;
  bar: SourcesBar;
  dispatch: (a: SourcesAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  return (
    <SourceRowView
      row={model}
      on={on}
      rowProps={{
        // Mouse and pen only: a finger's enter and leave arrive before its click.
        onPointerEnter: (e) => {
          if (e.pointerType !== "touch") setOpen(true);
        },
        onPointerLeave: (e) => {
          if (e.pointerType !== "touch") setOpen(false);
        },
      }}
      slot={{
        placed: pinned,
        pressed: pinned,
        ariaLabel: pinName(row.label, pinned),
        onPress: () => bar.pinFromButton(row.id),
      }}
      onToggle={() => dispatch({ type: "toggle", id: row.id })}
      toggleLabel={switchName(row.label)}
      toggleDisabled={roadOff}
      open={open}
      popoverId={popId}
      labelProps={{
        // Keyboard focus only: a tap focuses the button before its click, which would shut
        // again what the focus opened.
        onFocus: (e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        },
        onBlur: () => setOpen(false),
        onClick: () => setOpen((o) => !o),
      }}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".tn-src-add, .tn-src-toggle")) return;
        const grip = !!target.closest(".tn-src-grip");
        // A finger off the grip scrolls the list (the rows are touch-action: pan-y).
        if (e.pointerType === "touch" && !grip) return;
        bar.rowDown(e, row.id, grip);
      }}
      grip={portrait}
      extra={on && count != null ? <span className={styles.here}>{hereText(count)}</span> : undefined}
      pop={
        open ? (
          <div className="tn-src-pop" id={popId} role="tooltip">
            <div className="tn-src-pop-attr">{row.credit}</div>
            <div className="tn-src-pop-hint">{roadOff ? LONDON_ONLY : drawnAsText(row.precision)}</div>
          </div>
        ) : null
      }
    />
  );
}

export interface SourcesTrayProps {
  rows: readonly EyeSourceRow[];
  state: SourcesState;
  dispatch: (a: SourcesAction) => void;
  /** What each row has in the scene now, by row id: the "N here" after a switched-on label. */
  counts: Readonly<Record<string, number>>;
  london: boolean;
  portrait: boolean;
  /** How many sources the console's rail lists, and how many of the rest this view leaves out. */
  sourceCount: number;
  leftOut: { country: number; widget: number };
  memory: TrayMemory;
  setMemory: (m: TrayMemory) => void;
  bar: SourcesBar;
  /** The console at the spot on screen NOW, with its Sources rail open; read when the link is used. */
  getSourcesHref: () => string;
  /** The controls bar, for the pop-up on a phone to sit above. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: (refocus: boolean) => void;
}

export function SourcesTray({
  rows,
  state,
  dispatch,
  counts,
  london,
  portrait,
  sourceCount,
  leftOut,
  memory,
  setMemory,
  bar,
  getSourcesHref,
  anchorRef,
  onClose,
}: SourcesTrayProps) {
  const [query, setQuery] = useState("");
  const trayRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sections = useMemo(() => sectionsOf(rows), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const current = sections.find((s) => s.id === memory.section) ?? sections[0];
  const shown = useMemo(() => filterSections(sections, query), [sections, query]);
  const isOn = (id: string) => rowIsOn(state, id);

  // On a phone the pop-up sits 8 px above the bar, wherever the bar's top is (it grows
  // with the credits under it). Measured when the tray opens, when the bar's size changes
  // and when the window does; never per frame.
  useLayoutEffect(() => {
    const tray = trayRef.current;
    const anchor = anchorRef.current;
    if (!tray || !anchor) return;
    const set = () => tray.style.setProperty("--tray-bottom", `${Math.round(window.innerHeight - anchor.getBoundingClientRect().top + 8)}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(anchor);
    window.addEventListener("resize", set);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", set);
    };
  }, [anchorRef, portrait]);

  // Focus goes into the tray when it opens: the search field in Show all, the section in Sections.
  useEffect(() => {
    if (memory.view === "all") searchRef.current?.focus({ preventScroll: true });
    else trayRef.current?.querySelector<HTMLElement>('[data-strip] [aria-selected="true"]')?.focus({ preventScroll: true });
    // Only when the tray opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = (view: TrayView) => {
    setMemory({ ...memory, view });
    if (view === "all") requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
  };

  // Left and Right move between the tabs of a strip, and focus follows.
  const arrow = (e: React.KeyboardEvent<HTMLElement>, ids: readonly string[], pick: (id: string) => void) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    pick(ids[next]);
    requestAnimationFrame(() => e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus());
  };

  const refreshHref = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = getSourcesHref();
  };

  const renderRow = (m: SourceRowModel) => {
    const r = byId.get(m.id);
    if (!r) return null;
    return (
      <TrayRow
        model={m}
        row={r}
        on={isOn(r.id)}
        pinned={state.pins.includes(r.id)}
        roadOff={isRoadRow(r.id) && !london}
        count={counts[r.id]}
        portrait={portrait}
        bar={bar}
        dispatch={dispatch}
      />
    );
  };

  const sectionIds = sections.map((s) => s.id);

  return (
    <div className={`tn-terminal ${styles.scope}`}>
      <aside
        ref={trayRef}
        id={TRAY_ID}
        className={`tn-rail ${styles.tray}`}
        role="dialog"
        aria-label={sourcesName()}
        data-eye-tray=""
        data-view={memory.view}
      >
        <div className="tn-rail-header">
          <div className="tn-rail-tabs" role="tablist" aria-label="Sources views" onKeyDown={(e) => arrow(e, ["sections", "all"], (id) => setView(id as TrayView))}>
            <button type="button" role="tab" className="tn-rail-tab" aria-selected={memory.view === "sections"} aria-controls={`${TRAY_ID}-panel`} tabIndex={memory.view === "sections" ? 0 : -1} onClick={() => setView("sections")}>
              {SECTIONS_TAB}
            </button>
            <button type="button" role="tab" className="tn-rail-tab" aria-selected={memory.view === "all"} aria-controls={`${TRAY_ID}-panel`} tabIndex={memory.view === "all" ? 0 : -1} onClick={() => setView("all")}>
              {SHOW_ALL_TAB}
            </button>
          </div>
          <button type="button" className="tn-rail-collapse" aria-label={CLOSE_SOURCES} title={CLOSE_SOURCES} onClick={() => onClose(true)}>
            <CloseGlyph />
          </button>
        </div>

        {memory.view === "sections" ? (
          <div
            className={`tn-rail-tabs ${styles.strip}`}
            role="tablist"
            aria-label="Sections"
            data-strip=""
            onKeyDown={(e) => arrow(e, sectionIds, (id) => setMemory({ ...memory, section: id }))}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className="tn-rail-tab"
                aria-selected={current?.id === s.id}
                aria-controls={`${TRAY_ID}-panel`}
                tabIndex={current?.id === s.id ? 0 : -1}
                onClick={() => setMemory({ ...memory, section: s.id })}
              >
                {s.short}
                <span className={styles.stripN}>{s.rows.length}</span>
              </button>
            ))}
          </div>
        ) : (
          <input
            ref={searchRef}
            type="search"
            className={`tn-cat-search ${styles.search}`}
            placeholder={SEARCH_PLACEHOLDER}
            aria-label="Search sources"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        <div id={`${TRAY_ID}-panel`} role="tabpanel" className={`tn-rail-panes ${styles.body}`}>
          {memory.view === "sections" ? (
            current && <SourceSection section={toSectionModel(current)} isOn={isOn} renderRow={renderRow} highlight={false} />
          ) : shown.length === 0 ? (
            <p className="tn-rail-foot">{noMatchText(query.trim(), sourceCount)}</p>
          ) : (
            shown.map((s) => <SourceSection key={s.id} section={toSectionModel(s)} isOn={isOn} renderRow={renderRow} highlight={false} />)
          )}
        </div>

        <div className={`tn-rail-foot ${styles.foot}`}>
          <a
            href="/app?sources=open"
            aria-label={fullMapName(sourceCount)}
            onPointerDown={refreshHref}
            onFocus={refreshHref}
            onClick={refreshHref}
          >
            {FULL_MAP_LABEL}
          </a>
          <span>{leftOutText(sourceCount, leftOut)}</span>
        </div>
      </aside>
    </div>
  );
}

// ── The pins ───────────────────────────────────────────────────────────────────────────

export interface PinnedSourcesProps {
  rows: readonly EyeSourceRow[];
  state: SourcesState;
  dispatch: (a: SourcesAction) => void;
  cap: number;
  london: boolean;
  bar: SourcesBar;
}

/** The pins, in the controls bar. */
export function PinnedSources({ rows, state, dispatch, cap, london, bar }: PinnedSourcesProps) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const visible = state.pins.slice(0, cap).filter((id) => byId.has(id));
  const { lifted } = bar;
  const pinsRef = useRef<HTMLDivElement>(null);

  // A refused pin shakes the bar once; with reduced motion it only says so, in words.
  useEffect(() => {
    if (bar.shake === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pinsRef.current?.animate?.(
      [{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }],
      { duration: 320, easing: "ease-in-out" },
    );
  }, [bar.shake]);

  // Where the lifted source would land: a bar on the pin it would go before (or after the last).
  const others = visible.filter((id) => !(lifted?.from === "pin" && lifted.id === id) && !(lifted?.from === "row" && lifted.id === id));
  const dropMark = (id: string): "before" | "after" | undefined => {
    if (!lifted?.over || lifted.slot == null) return undefined;
    const at = others.indexOf(id);
    if (at < 0) return undefined;
    if (at === lifted.slot) return "before";
    if (at === others.length - 1 && lifted.slot >= others.length) return "after";
    return undefined;
  };

  return (
    <>
      {(visible.length > 0 || lifted) && (
        <div
          ref={pinsRef}
          className={styles.pins}
          role="group"
          aria-label="Pinned sources"
          data-dragging={lifted ? "" : undefined}
          data-over={lifted?.over || undefined}
        >
          {visible.map((id) => {
            const row = byId.get(id)!;
            const on = rowIsOn(state, id);
            const roadOff = isRoadRow(id) && !london;
            return (
              <button
                key={id}
                type="button"
                data-pin={id}
                data-lifted={lifted?.from === "pin" && lifted.id === id ? "" : undefined}
                data-drop={dropMark(id)}
                className={`tn-rail-fab ${styles.fab} ${styles.pin}`}
                style={{ ["--c" as string]: row.color }}
                aria-pressed={on}
                aria-disabled={roadOff || undefined}
                title={roadOff ? LONDON_ONLY : undefined}
                onClick={() => {
                  if (!roadOff) dispatch({ type: "toggle", id });
                }}
                onPointerDown={(e) => bar.pinDown(e, id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  bar.openMenu(id, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  const at = visible.indexOf(id);
                  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                    e.preventDefault();
                    const delta = e.key === "ArrowLeft" ? -1 : 1;
                    const to = Math.max(0, Math.min(visible.length - 1, at + delta));
                    dispatch({ type: "move", id, delta });
                    bar.say(movedPinText(row.label, to + 1, state.pins.length));
                    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pin="${CSS.escape(id)}"]`)?.focus());
                  } else if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    dispatch({ type: "unpin", id });
                    bar.say(unpinnedText(row.label));
                    // The next pin takes focus, or the Sources button when none is left.
                    const next = visible[at + 1] ?? visible[at - 1];
                    requestAnimationFrame(() =>
                      (next ? document.querySelector<HTMLElement>(`[data-pin="${CSS.escape(next)}"]`) : document.querySelector<HTMLElement>("[data-sources-button]"))?.focus(),
                    );
                  }
                }}
              >
                <span className={styles.pinDot} aria-hidden />
                {row.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The pin menu, the drag ghost and the live region. Fixed-position or hidden, so they
 * live in the bar OUTSIDE the phone's scrolling strip, which would clip them.
 */
export function PinChrome({ rows, state, dispatch, cap, bar }: Pick<PinnedSourcesProps, "rows" | "state" | "dispatch" | "cap" | "bar">) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const visible = state.pins.slice(0, cap).filter((id) => byId.has(id));
  const { lifted, menu } = bar;
  const menuRow = menu ? byId.get(menu.id) : undefined;
  const menuAt = menu ? visible.indexOf(menu.id) : -1;

  return (
    <>
      {menu && menuRow && (
        <div
          className={`tn-src-pop ${styles.menu}`}
          role="menu"
          aria-label={menuRow.label}
          data-pin-menu=""
          data-eye-bar=""
          style={menu.at}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const at = items.indexOf(document.activeElement as HTMLElement);
            items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
          ref={(el) => {
            // Focus lands on the first item as the menu opens.
            if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-disabled={menuAt <= 0 || undefined}
            onClick={() => {
              if (menuAt <= 0) return;
              dispatch({ type: "move", id: menuRow.id, delta: -1 });
              bar.say(movedPinText(menuRow.label, menuAt, state.pins.length));
              bar.closeMenu(true);
            }}
          >
            {PIN_MOVE_LEFT}
          </button>
          <button
            type="button"
            role="menuitem"
            aria-disabled={menuAt < 0 || menuAt >= visible.length - 1 || undefined}
            onClick={() => {
              if (menuAt < 0 || menuAt >= visible.length - 1) return;
              dispatch({ type: "move", id: menuRow.id, delta: 1 });
              bar.say(movedPinText(menuRow.label, menuAt + 2, state.pins.length));
              bar.closeMenu(true);
            }}
          >
            {PIN_MOVE_RIGHT}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              dispatch({ type: "unpin", id: menuRow.id });
              bar.say(unpinnedText(menuRow.label));
              bar.closeMenu(false);
              requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-sources-button]")?.focus());
            }}
          >
            {PIN_UNPIN}
          </button>
        </div>
      )}

      <div ref={bar.ghostRef} className={styles.ghost} hidden={!lifted} aria-hidden>
        {lifted && (
          <>
            <span className={styles.pinDot} style={{ ["--c" as string]: lifted.color }} />
            {lifted.from === "pin" && !lifted.over ? unpinGhostText(lifted.label) : lifted.label}
          </>
        )}
      </div>
      <span className="tn-sr-only" role="status" aria-live="polite">
        {bar.message}
      </span>
    </>
  );
}
