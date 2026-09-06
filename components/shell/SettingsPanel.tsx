"use client";
// The Settings slide-over (opened from the top-right gear), in three tabs down a left rail.
//
// THE RAIL IS A COLUMN OF THE DRAWER, NOT A STRIP INSIDE IT. Main / Display / Shortcuts
// shipped as a segmented pill across the top, which is the right shape for two or three
// peers you flick between and the wrong one for a nav: it read as a filter over one page
// rather than as three places, and it spent the drawer's scarcest axis — width — on
// something a column gives away for free. The drawer grew 384px → 536px to pay for the
// rail out of its own width rather than out of the panel's: the panel measures 349px
// against the old 347px, both read out of a live browser, so not one field, hint or
// key-cap row got tighter.
//
// THE FOUR CELLS ARE A GRID, AND THE REASON IS ALIGNMENT. The rail's title cell and the
// panel's header sit side by side with a divider between them; as a flex row they would
// need a shared magic height, and the first time one of them grew the divider would step.
// As `grid-template-rows: auto 1fr` the header row is simply as tall as the taller of the
// two, so they cannot disagree. It also buys the responsive layout outright: below 520px
// the same four cells re-address to a title+✕ row, a horizontal strip, then the panel,
// with no element moving in the DOM and the title never leaving the rail.
//
// It was one scroll of six unrelated sections, which put the two things people actually
// open it for — rebinding a key, switching board — underneath a wall of integration
// fields that get set once and never touched again. Main / Display / Shortcuts is a pure
// REGROUP: every control still drives the store it always drove, nothing was added except
// the read-only key reference on the Shortcuts tab, and nothing was duplicated.
//
// This file is now the shell only — scrim, dialog, head, tab strip, panel host. Each tab's
// body lives in components/shell/settings/, following components/shell/sources/ and
// components/console/maprail/: one directory, one file per part. The point is the import
// list. This used to pull seventeen symbols from eleven modules with nothing to say which
// section owned which; now each tab file's imports describe what that tab does.
//
// A REAL TABLIST, unlike the header's board tabs. TerminalHeader's BoardTabs deliberately
// uses aria-pressed and not role="tab", because "a tablist with no tabpanel is a promise
// the DOM does not keep" — those tabs rearrange the whole workspace. These ones swap the
// contents of exactly one region that is right there in the DOM, so the ARIA tab pattern
// is the honest description and it comes with the keyboard behaviour users expect.

import { useEffect, useRef, useState } from "react";
import { SETTINGS_TABS, nextTabId, type SettingsTabId } from "@/lib/shell/settingsTabs";
import MainTab from "./settings/MainTab";
import DisplayTab from "./settings/DisplayTab";
import ShortcutsTab from "./settings/ShortcutsTab";

/**
 * Which way the rail is actually running, read back off the rail itself.
 *
 * `aria-orientation` has to match what a sighted user sees, and what they see flips at a
 * CSS breakpoint this component cannot see. Writing `520` into a matchMedia here would put
 * the number in two files and guarantee that one day only one of them moves. So the rail
 * publishes its own axis as `--tn-settings-axis` — set once on the rule, overridden once in
 * the @media block — and this reads it back. The stylesheet stays the single source of
 * truth, and a future change to the breakpoint needs no edit here at all.
 *
 * Vertical is the assumed answer before the first measurement so that server output and
 * the first client paint agree; the effect then corrects it if the drawer opened narrow.
 */
function useRailAxis(ref: React.RefObject<HTMLElement | null>, open: boolean) {
  const [axis, setAxis] = useState<"vertical" | "horizontal">("vertical");
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const el = ref.current;
      if (!el) return;
      const v = getComputedStyle(el).getPropertyValue("--tn-settings-axis").trim();
      setAxis(v === "horizontal" ? "horizontal" : "vertical");
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [ref, open]);
  return axis;
}

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTabId>(SETTINGS_TABS[0].id);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const axis = useRailAxis(railRef, open);
  const active = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0];

  // ALWAYS OPENS ON THE FIRST TAB, AND THIS EFFECT IS WHY IT HAS TO BE EXPLICIT.
  // TerminalHeader mounts this component unconditionally and only passes `open` — the
  // component never unmounts, so a bare useState would be sticky for the session and then
  // reset on reload, which is the worst of both: the user cannot predict it and cannot
  // rely on it. Landing on Main every time is also what lets the e2e suite and
  // scripts/shoot-surfaces.mjs assert what they see first instead of racing whatever the
  // previous test left behind.
  useEffect(() => {
    if (open) setTab(SETTINGS_TABS[0].id);
  }, [open]);

  // Focus in, and focus back out again. The drawer had no focus management at all: it
  // opened and left focus on the gear behind it. Same shape as PlacementPicker, which the
  // repo's own comments name as the reference — capture on open, restore in the cleanup,
  // so closing by Escape, by the ✕ and by the scrim all funnel through one path.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      railRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const select = (next: SettingsTabId) => {
    setTab(next);
    // Unmounting the old panel does not carry its scroll position, and without this a
    // switch from the long Main tab to the short Shortcuts tab can leave the body scrolled
    // to a position that looks like an empty drawer.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  // ARROW KEYS BELONG TO THE RAIL, AND ONLY THE RAIL.
  //
  // Do not be tempted to move this onto `window` alongside the Escape effect above. It
  // would appear to work — an armed shortcut chip stops propagation and React would block
  // it at the root — but it would equally fire for ← pressed inside the Telegram bot-token
  // field or the Discord webhook field, hijacking the caret. That is exactly the bug class
  // ConsoleShell's text-field guard exists for, and a tablist has no business re-litigating
  // it. It is also why nextTabId can afford to answer to ←/→ as well as ↑/↓: scoped here,
  // neither axis can reach a caret.
  //
  // Automatic activation (the arrow moves focus AND selection) is right here: switching is
  // instant and local, so the alternative — arrow to move, Enter to commit — would just be
  // an extra keystroke for nothing.
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabId(SETTINGS_TABS, tab, e.key);
    if (!next) return; // not ours: let Tab and Escape through untouched
    // Captured synchronously — React nulls currentTarget once the handler returns, and the
    // focus() below runs after setTab.
    const rail = e.currentTarget;
    e.preventDefault();
    select(next);
    const i = SETTINGS_TABS.findIndex((t) => t.id === next);
    rail.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus();
  };

  return (
    <div className="tn-settings-scrim" onClick={onClose}>
      {/* role="dialog" is load-bearing beyond a11y: ConsoleShell's global keydown handler
          bails on any mounted [role="dialog"], which is what stops ";" and Escape firing
          shell shortcuts while someone is typing in here. */}
      <aside className="tn-settings" role="dialog" aria-modal="true" aria-label="Settings"
        onClick={(e) => e.stopPropagation()}>
        {/* Cell 1 — the rail's own head. The drawer's title belongs to the rail's column,
            which is what makes the rail read as a sidebar rather than as a control that
            happens to be tall. */}
        <div className="tn-settings-railhead">
          <h2 className="tn-settings-title">Settings</h2>
        </div>

        {/* Cell 2 — the panel's head. It holds the ✕ and the blurb for the tab in view.
            The blurb is here rather than in the rail because a nav item should be a name;
            the sentence about what the name governs belongs beside the thing it governs. */}
        <header className="tn-settings-head">
          <p className="tn-settings-blurb" id="tn-settings-blurb">{active.blurb}</p>
          <button type="button" className="tn-settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </header>

        {/* Cell 3 — the rail. It IS the tablist; a wrapper around one would add a node that
            owns nothing. `--tn-settings-axis` is read back off this element by useRailAxis
            above, so the aria-orientation below is whatever the stylesheet actually did. */}
        <div className="tn-settings-rail" role="tablist" aria-label="Settings sections"
          aria-orientation={axis} ref={railRef} onKeyDown={onTabKey}>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tn-settings-tab-${t.id}`}
              className="tn-settings-tab"
              aria-selected={t.id === tab}
              aria-controls="tn-settings-panel"
              // Roving tabindex: the rail is ONE tab stop, so Tab moves into the panel
              // rather than walking three buttons first.
              tabIndex={t.id === tab ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Cell 4 — ONE PANEL ID, SHARED BY ALL THREE TABS. The inactive panels are
            unmounted, so per-tab ids would leave two of the three aria-controls dangling at
            all times. All three tabs do genuinely control this one region; aria-labelledby
            is the half that swings to name whichever tab is selected, and aria-describedby
            hands a screen reader the same one-line orientation the header shows.
            tabIndex={0} because this is the scroll container, and a keyboard user has to
            be able to scroll it. */}
        <div
          className="tn-settings-body"
          id="tn-settings-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`tn-settings-tab-${tab}`}
          aria-describedby="tn-settings-blurb"
          ref={bodyRef}
        >
          {tab === "main" && <MainTab />}
          {tab === "display" && <DisplayTab />}
          {tab === "shortcuts" && <ShortcutsTab />}
        </div>
      </aside>
    </div>
  );
}
