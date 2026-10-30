"use client";
// The map clock's picker: which airports the clock bar shows. Opens UPWARD from the bar's
// gear (components/console/WorldClock.tsx owns the gear, the open state and the outside
// press). Three things in it: your clocks (each with an x), a search box over the
// 113-airport list (lib/console/clockZones.ts), and "Reset to default".
//
// role="group", NOT role="dialog", and for the reason AreaColorPicker.tsx gives: ConsoleShell's
// global keydown handler early-returns while any [role="dialog"] is mounted, so a dialog
// would switch off "/" and the Escape ladder app-wide for as long as this was open. It is a
// non-modal panel over a map the person can still drag, so it says so. Escape is ours, and
// the Inspector rail's capture-phase Escape handler has to know: that is `data-owns-escape`
// on the root (the documented stand-down, see InspectorRail.tsx's ladder). Without it, Escape
// here would also close the Inspector panel behind.
//
// THE SEARCH BOX IS A COMBOBOX. Focus stays in the input; Up and Down move an "active"
// option that aria-activedescendant names; Enter adds it. Options already in the bar are
// shown as "Added" and the arrows skip them, because landing on a row Enter cannot act on
// is a dead stop. At eight clocks every + is disabled and the arrows have nowhere to land.
//
// ORDER IS NEVER STORED. Rows are sorted west to east by the current offset here exactly as
// the bar sorts them, so the two always agree and there is no reordering to build.
//
// Copy: sentence case, and no em or en dash in any visible string.

import { useEffect, useMemo, useRef, useState } from "react";
import { clockStore } from "@/lib/console/clockStore";
import {
  DEFAULT_CLOCK_CODES,
  MAX_CLOCKS,
  addName,
  clockAirport,
  clockLocalTime,
  offsetLabel,
  orderWestToEast,
  removeName,
  sameClockSet,
  searchClocks,
  utcOffsetMinutes,
  type ClockAirport,
} from "@/lib/console/clockZones";

/** The time and the UTC offset a row prints. A zone Intl cannot resolve never gets here. */
function facts(a: ClockAirport, now: Date): { time: string; offset: string } {
  try {
    return { time: clockLocalTime(a.zone, now).time, offset: offsetLabel(utcOffsetMinutes(a.zone, now)) };
  } catch {
    return { time: "--:--", offset: "" };
  }
}

export default function ClockPicker({
  id,
  codes,
  now,
  onClose,
}: {
  /** Referenced by the gear's aria-controls. */
  id: string;
  /** The chosen codes, any order. */
  codes: readonly string[];
  now: Date;
  /** `refocus` is true when the gear should take focus back (Escape). */
  onClose: (refocus: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const removeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const refocusRemoveAt = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const searchId = `${id}-search`;
  const listboxId = `${id}-results`;
  const noteId = `${id}-note`;

  // Focus lands in the search box, which is what the person opened this to use.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const chosen = useMemo(
    () => orderWestToEast(codes.flatMap((c) => clockAirport(c) ?? []), now),
    [codes, now],
  );
  const full = chosen.length >= MAX_CLOCKS;
  const onlyOne = chosen.length <= 1;
  const atDefault = sameClockSet(codes, DEFAULT_CLOCK_CODES);

  const matches = useMemo(() => searchClocks(query, codes, now), [query, codes, now]);
  // The rows an arrow key or Enter can act on. None at eight clocks.
  const selectable = useMemo(() => (full ? [] : matches.filter((m) => !m.added)), [full, matches]);
  const active = selectable.find((m) => m.code === activeCode) ?? selectable[0] ?? null;
  const showList = query.trim() !== "" && matches.length > 0;
  const showEmpty = query.trim() !== "" && matches.length === 0;

  // Keep the active option on screen when the arrows move it past the list's edge.
  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-code="${active.code}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // After an x removes a row its button is gone, and focus would fall to the page. Put it on
  // the x that took the place of the one removed (or the last one), so a keyboard person can
  // keep pressing Enter down the list.
  useEffect(() => {
    const at = refocusRemoveAt.current;
    if (at === null) return;
    refocusRemoveAt.current = null;
    const target = chosen[Math.min(at, chosen.length - 1)];
    const btn = target ? removeRefs.current.get(target.code) : undefined;
    (btn && !btn.disabled ? btn : inputRef.current)?.focus();
  }, [chosen]);

  const add = (code: string) => {
    if (full) return;
    clockStore.add(code);
    setQuery("");
    setActiveCode(null);
    inputRef.current?.focus();
  };

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Ours: the rail stands down for it (see the header), so this is the only handler that
    // acts, and it must not reach the console's own ladder either.
    e.preventDefault(); // a type="search" input would otherwise clear itself first
    e.stopPropagation();
    onClose(true);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (selectable.length === 0) return;
      e.preventDefault();
      const at = active ? selectable.findIndex((m) => m.code === active.code) : -1;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = selectable[(at + step + selectable.length) % selectable.length];
      setActiveCode(next.code);
    } else if (e.key === "Enter") {
      if (!active) return;
      e.preventDefault();
      add(active.code);
    }
  };

  return (
    <div
      className="tn-wc-picker"
      id={id}
      role="group"
      aria-label="Choose clocks"
      data-owns-escape=""
      onKeyDown={onRootKeyDown}
    >
      <div className="tn-wc-pk-head">
        <span className="tn-wc-pk-title">Clocks</span>
        <span className="tn-wc-pk-count tn-num">
          {chosen.length} of {MAX_CLOCKS}
        </span>
      </div>

      <ul className="tn-wc-pk-rows" aria-label="Your clocks">
        {chosen.map((a, i) => {
          const f = facts(a, now);
          return (
            <li className="tn-wc-pk-row" key={a.code}>
              <span className="tn-wc-pk-code">{a.code}</span>
              <span className="tn-wc-pk-place">
                <b>{a.city}</b> <span>{a.country}</span>
              </span>
              <span className="tn-wc-pk-off tn-num">{f.offset}</span>
              <span className="tn-wc-pk-time tn-num">{f.time}</span>
              <button
                type="button"
                className="tn-wc-pk-btn tn-wc-pk-x"
                aria-label={removeName(a)}
                title={onlyOne ? "At least one clock stays" : undefined}
                disabled={onlyOne}
                ref={(el) => {
                  if (el) removeRefs.current.set(a.code, el);
                  else removeRefs.current.delete(a.code);
                }}
                onClick={() => {
                  refocusRemoveAt.current = i;
                  clockStore.remove(a.code);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M7 7l10 10M17 7L7 17" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="tn-wc-pk-add">
        <label className="tn-wc-pk-label" htmlFor={searchId}>
          Add a clock
        </label>
        <input
          ref={inputRef}
          id={searchId}
          className="tn-wc-pk-input"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listboxId : undefined}
          aria-activedescendant={showList && active ? `${id}-opt-${active.code}` : undefined}
          aria-describedby={full ? noteId : undefined}
          placeholder="City, airport code or country"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveCode(null);
          }}
          onKeyDown={onInputKeyDown}
        />
        {full && (
          <p className="tn-wc-pk-note" id={noteId}>
            {MAX_CLOCKS} clocks is the most. Remove one to add another.
          </p>
        )}

        {showList && (
          <ul className="tn-wc-pk-results" id={listboxId} role="listbox" aria-label="Matching airports" ref={listRef}>
            {matches.map((m) => {
              const f = facts(m, now);
              const isActive = active?.code === m.code;
              return (
                <li
                  key={m.code}
                  id={`${id}-opt-${m.code}`}
                  className="tn-wc-pk-row tn-wc-pk-opt"
                  role="option"
                  aria-selected={isActive}
                  data-code={m.code}
                  data-active={isActive ? "" : undefined}
                  data-added={m.added ? "" : undefined}
                  // The input keeps focus through a click, so Enter and the arrows still work.
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerMove={() => {
                    if (!m.added && !full) setActiveCode(m.code);
                  }}
                  onClick={() => {
                    if (!m.added && !full) add(m.code);
                  }}
                >
                  <span className="tn-wc-pk-code">{m.code}</span>
                  <span className="tn-wc-pk-place">
                    <b>{m.city}</b> <span>{m.country}</span>
                  </span>
                  <span className="tn-wc-pk-off tn-num">{f.offset}</span>
                  <span className="tn-wc-pk-time tn-num">{f.time}</span>
                  {m.added ? (
                    <span className="tn-wc-pk-added">Added</span>
                  ) : (
                    <button
                      type="button"
                      className="tn-wc-pk-btn tn-wc-pk-plus"
                      aria-label={addName(m)}
                      disabled={full}
                      // Out of the tab order: focus stays in the combobox, and a screen
                      // reader still reaches this through its own virtual cursor.
                      tabIndex={-1}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 6v12M6 12h12" />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {showEmpty && (
          <p className="tn-wc-pk-empty" role="status">
            No airport matches &quot;{query.trim()}&quot;. Try a city or a country.
          </p>
        )}
      </div>

      <div className="tn-wc-pk-foot">
        <button
          type="button"
          className="tn-wc-pk-reset"
          disabled={atDefault}
          onClick={() => {
            clockStore.reset();
            setQuery("");
            setActiveCode(null);
            inputRef.current?.focus();
          }}
        >
          Reset to default
        </button>
        <span className="tn-wc-pk-hint">Clocks run west to east</span>
      </div>
    </div>
  );
}
