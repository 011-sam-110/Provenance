"use client";
// The God's eye view's Sources tray: a pop-over beside the sidebar that switches this view's own
// sources and the console's other layers on and off, and pins them to the sidebar.
//
// EACH ROW SAYS WHO IT COMES FROM, NEVER HOW MANY (Sam's ask). The counts' ledger left the normal
// view, so the facts it held, the source, the cadence and how old the positions are, are the row's
// detail line (trayDetail in lib/eye/sources.ts), and the foot says when the vessels and aircraft
// last arrived, that no road speed is measured, and what this view leaves out.
//
// THE ROWS ARE THE CONSOLE'S (SourceSection, SourceRowView), so the two cannot drift apart in what
// a row holds. The look is EyeSources.module.css, which remaps the `--tn-*` tokens those rows read
// to the HUD's own palette. Nothing here sits in `.tn-terminal`: the frame's look is its own.
//
// NOTHING HERE IMPORTS THE CONSOLE'S WIDGET, PLACEMENT, STATUS OR REGISTRY MODULES, or the
// catalogue: /eye loads this file in the browser. The rows arrive as a prop, built on the
// server (lib/eye/sourceRows.ts). tests/unit/eye-sources-bundle.test.ts holds the line.
//
// PINNED SOURCES ARE SWITCH ROWS IN THE SIDEBAR (EyeHud.tsx). The ＋ pins and unpins them, in the
// order pressed. The bar's drag-to-reorder left with the bar: the sidebar's rows take no drag.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import SourceRowView from "@/components/shell/sources/SourceRowView";
import SourceSection from "@/components/shell/sources/SourceSection";
import type { SourceRowModel } from "@/lib/console/sources/sections";
import type { EyeClock } from "@/lib/eye/motion";
import {
  PIN_STATE_MAX,
  filterSections,
  isRoadRow,
  rowIsOn,
  sectionsOf,
  toSectionModel,
  trayDetail,
  type EyeSourceRow,
  type SourcesAction,
  type SourcesState,
} from "@/lib/eye/sources";
import {
  CLOSE_SOURCES,
  LONDON_ONLY,
  SEARCH_PLACEHOLDER,
  SECTIONS_TAB,
  SHOW_ALL_TAB,
  drawnAsText,
  leftOutText,
  noMatchText,
  pinCapText,
  pinName,
  pinnedText,
  refreshedText,
  sourcesName,
  switchName,
  unpinnedText,
  type LedgerRow,
} from "@/lib/eye/wording";
import { CloseGlyph } from "./HudIcons";
import { useClock } from "./hudHooks";
import styles from "./EyeSources.module.css";

/** The tray's id, for the sidebar row's aria-controls. */
export const TRAY_ID = "eye-sources";

export type TrayView = "sections" | "all";
/** Which view and section the tray was last on, kept for the visit and never saved. */
export interface TrayMemory {
  view: TrayView;
  section: string;
}

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
  detail,
  onPin,
  dispatch,
}: {
  model: SourceRowModel;
  row: EyeSourceRow;
  on: boolean;
  pinned: boolean;
  /** One of TfL's three road rows, outside London: its switch has nothing to do. */
  roadOff: boolean;
  detail: string;
  onPin: () => void;
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
        title: pinName(row.label, pinned),
        onPress: onPin,
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
      extra={<span className={styles.detail}>{detail}</span>}
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

/** "Vessels and aircraft refreshed 12 s ago", counting while the tray is open and only then. */
function Refreshed({ at, clock }: { at: number; clock: EyeClock }) {
  const now = useClock(clock);
  return now != null ? <p>{refreshedText(at, now)}</p> : null;
}

export interface SourcesTrayProps {
  rows: readonly EyeSourceRow[];
  state: SourcesState;
  dispatch: (a: SourcesAction) => void;
  /** The facts behind the detail lines: the rows a film's ledger draws. */
  ledger: readonly LedgerRow[];
  refreshedAt?: number;
  clock: EyeClock;
  london: boolean;
  /** How many of the console's rows this view leaves out, by reason. */
  leftOut: { country: number; widget: number };
  memory: TrayMemory;
  setMemory: (m: TrayMemory) => void;
  onClose: (refocus: boolean) => void;
}

export function SourcesTray({ rows, state, dispatch, ledger, refreshedAt, clock, london, leftOut, memory, setMemory, onClose }: SourcesTrayProps) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const trayRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sections = useMemo(() => sectionsOf(rows), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const current = sections.find((s) => s.id === memory.section) ?? sections[0];
  const shown = useMemo(() => filterSections(sections, query), [sections, query]);
  const isOn = (id: string) => rowIsOn(state, id);

  // The tray stands under the title, however many lines the title takes. Measured when the tray
  // opens and when the window changes; never per frame.
  useLayoutEffect(() => {
    const tray = trayRef.current;
    const place = document.querySelector("[data-eye-place]");
    if (!tray || !place) return;
    const set = () => tray.style.setProperty("--tray-top", `${Math.max(120, Math.round(place.getBoundingClientRect().bottom + 8))}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

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

  const togglePin = (id: string) => {
    const row = byId.get(id);
    if (!row) return;
    if (state.pins.includes(id)) {
      dispatch({ type: "unpin", id });
      setMessage(unpinnedText(row.label));
    } else if (state.pins.length >= PIN_STATE_MAX) {
      setMessage(pinCapText(PIN_STATE_MAX));
    } else {
      dispatch({ type: "pin", id });
      setMessage(pinnedText(row.label));
    }
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
        detail={trayDetail(r, ledger, london)}
        onPin={() => togglePin(r.id)}
        dispatch={dispatch}
      />
    );
  };

  const sectionIds = sections.map((s) => s.id);
  const speed = ledger.find((l) => l.kind === "speed");
  const leftOutLine = leftOutText(leftOut);

  return (
    <aside
      ref={trayRef}
      id={TRAY_ID}
      className={styles.tray}
      role="dialog"
      aria-label={sourcesName()}
      data-eye-tray=""
      data-eye-keep=""
      data-view={memory.view}
    >
      <div className={styles.head}>
        <div className={styles.tabs} role="tablist" aria-label="Sources views" onKeyDown={(e) => arrow(e, ["sections", "all"], (id) => setView(id as TrayView))}>
          <button type="button" role="tab" className={styles.tab} aria-selected={memory.view === "sections"} aria-controls={`${TRAY_ID}-panel`} tabIndex={memory.view === "sections" ? 0 : -1} onClick={() => setView("sections")}>
            {SECTIONS_TAB}
          </button>
          <button type="button" role="tab" className={styles.tab} aria-selected={memory.view === "all"} aria-controls={`${TRAY_ID}-panel`} tabIndex={memory.view === "all" ? 0 : -1} onClick={() => setView("all")}>
            {SHOW_ALL_TAB}
          </button>
        </div>
        <button type="button" className={styles.close} aria-label={CLOSE_SOURCES} title={CLOSE_SOURCES} onClick={() => onClose(true)}>
          <CloseGlyph />
        </button>
      </div>

      {memory.view === "sections" ? (
        <div
          className={styles.strip}
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
              className={styles.tab}
              aria-selected={current?.id === s.id}
              aria-controls={`${TRAY_ID}-panel`}
              tabIndex={current?.id === s.id ? 0 : -1}
              onClick={() => setMemory({ ...memory, section: s.id })}
            >
              {s.short}
            </button>
          ))}
        </div>
      ) : (
        <input
          ref={searchRef}
          type="search"
          className={styles.search}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label="Search sources"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <div id={`${TRAY_ID}-panel`} role="tabpanel" className={styles.body}>
        {memory.view === "sections" ? (
          current && <SourceSection section={toSectionModel(current)} isOn={isOn} renderRow={renderRow} highlight={false} />
        ) : shown.length === 0 ? (
          <p className={styles.none}>{noMatchText(query.trim())}</p>
        ) : (
          shown.map((s) => <SourceSection key={s.id} section={toSectionModel(s)} isOn={isOn} renderRow={renderRow} highlight={false} />)
        )}
      </div>

      <div className={styles.foot}>
        {message && (
          <p className={styles.said} role="status">
            {message}
          </p>
        )}
        {refreshedAt != null && <Refreshed at={refreshedAt} clock={clock} />}
        {speed && (
          <p>
            {speed.label}: {speed.detail}
          </p>
        )}
        {leftOutLine && <p>{leftOutLine}</p>}
      </div>
    </aside>
  );
}
