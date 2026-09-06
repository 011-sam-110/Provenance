"use client";
// The Shortcuts tab: the keys that are yours, then the keys that are not.
//
// The rebindable half moved here verbatim from SettingsPanel. The Fixed half is new, and
// is the reason this is a tab rather than three rows in a scroll: Escape's behaviour and
// the palette's arrow keys were documented nowhere the user could find them — the palette
// printed its four in its own footer, which you can only read once you have already
// opened the palette.
//
// NOTHING HERE IS TYPED TWICE. Both blocks render from lib/shell/keymap.ts: KEY_ACTIONS
// for the rebindable rows, FIXED_KEYS for the reference, and that same FIXED_KEYS is what
// CommandPalette's footer now maps over.

import { useState } from "react";
import { FIXED_KEYS, KEY_ACTIONS, keymapStore, useKeymap } from "@/lib/shell/keymap";
import ShortcutRow from "./ShortcutRow";

/** The read-only half, grouped by where the key applies. */
function FixedGroup({ where, title }: { where: "console" | "palette"; title: string }) {
  const rows = FIXED_KEYS.filter((k) => k.where === where);
  if (rows.length === 0) return null;
  return (
    <>
      <h4 className="tn-settings-subhead">{title}</h4>
      {rows.map((k) => (
        <div className="tn-settings-row" key={`${where}-${k.keys}-${k.short}`}>
          <span className="tn-settings-label">{k.label}</span>
          {/* A SPAN, NOT A BUTTON. These caps cannot be changed, and a cap you can focus
              and click but which does nothing is the same trap as a dead key. The dashed
              edge (.is-fixed) is the visible half of that promise. */}
          <span className="tn-keymap-chip is-fixed">{k.keys}</span>
        </div>
      ))}
    </>
  );
}

export default function ShortcutsTab() {
  const keymap = useKeymap();
  const [keyErr, setKeyErr] = useState<string | null>(null);

  return (
    <>
      <section className="tn-settings-sec">
        <h3 className="tn-settings-sec-title">Yours</h3>
        {KEY_ACTIONS.map((a) => (
          <ShortcutRow
            key={a.id}
            action={a.id}
            label={a.label}
            hint={a.hint}
            chords={keymap[a.id]}
            onError={setKeyErr}
          />
        ))}
        {keyErr ? (
          <p className="tn-settings-note tn-keymap-err" role="alert">{keyErr}</p>
        ) : (
          <p className="tn-settings-note">
            Click a shortcut, then press the keys you want. Escape cancels. Taking a key
            from another action moves it rather than sharing it.
          </p>
        )}
        <div className="tn-settings-row">
          <span className="tn-settings-label">Defaults</span>
          <button
            type="button"
            className="tn-settings-seg-btn"
            onClick={() => { keymapStore.reset(); setKeyErr(null); }}
          >
            Restore
          </button>
        </div>
      </section>

      <section className="tn-settings-sec">
        <h3 className="tn-settings-sec-title">Fixed</h3>
        <p className="tn-settings-hint">
          Not rebindable — these are how you get out of things, so the console keeps them.
        </p>
        <FixedGroup where="console" title="On the map" />
        <FixedGroup where="palette" title="In the command palette" />
      </section>
    </>
  );
}
