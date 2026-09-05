"use client";
// The Settings slide-over (opened from the top-right gear), in three tabs.
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

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTabId>(SETTINGS_TABS[0].id);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

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
      stripRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
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

  // ARROW KEYS BELONG TO THE STRIP, AND ONLY THE STRIP.
  //
  // Do not be tempted to move this onto `window` alongside the Escape effect above. It
  // would appear to work — an armed shortcut chip stops propagation and React would block
  // it at the root — but it would equally fire for ← pressed inside the Telegram bot-token
  // field or the Discord webhook field, hijacking the caret. That is exactly the bug class
  // ConsoleShell's text-field guard exists for, and a tab strip has no business
  // re-litigating it.
  //
  // Automatic activation (the arrow moves focus AND selection) is right here: switching is
  // instant and local, so the alternative — arrow to move, Enter to commit — would just be
  // an extra keystroke for nothing.
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabId(SETTINGS_TABS, tab, e.key);
    if (!next) return; // not ours: let Tab and Escape through untouched
    // Captured synchronously — React nulls currentTarget once the handler returns, and the
    // focus() below runs after setTab.
    const strip = e.currentTarget;
    e.preventDefault();
    select(next);
    const i = SETTINGS_TABS.findIndex((t) => t.id === next);
    strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus();
  };

  return (
    <div className="tn-settings-scrim" onClick={onClose}>
      {/* role="dialog" is load-bearing beyond a11y: ConsoleShell's global keydown handler
          bails on any mounted [role="dialog"], which is what stops ";" and Escape firing
          shell shortcuts while someone is typing in here. */}
      <aside className="tn-settings" role="dialog" aria-modal="true" aria-label="Settings"
        onClick={(e) => e.stopPropagation()}>
        <header className="tn-settings-head">
          <h2 className="tn-settings-title">Settings</h2>
          <button type="button" className="tn-settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </header>

        <div className="tn-settings-tabs" role="tablist" aria-label="Settings sections"
          ref={stripRef} onKeyDown={onTabKey}>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tn-settings-tab-${t.id}`}
              className="tn-settings-tab"
              aria-selected={t.id === tab}
              aria-controls="tn-settings-panel"
              // Roving tabindex: the strip is ONE tab stop, so Tab moves into the panel
              // rather than walking three buttons first.
              tabIndex={t.id === tab ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ONE PANEL ID, SHARED BY ALL THREE TABS. The inactive panels are unmounted, so
            per-tab ids would leave two of the three aria-controls dangling at all times.
            All three tabs do genuinely control this one region; aria-labelledby is the
            half that swings to name whichever tab is selected.
            tabIndex={0} because this is the scroll container, and a keyboard user has to
            be able to scroll it. */}
        <div
          className="tn-settings-body"
          id="tn-settings-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`tn-settings-tab-${tab}`}
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
