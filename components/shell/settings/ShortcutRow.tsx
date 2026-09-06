"use client";
// One rebindable shortcut, and the reason it is not a text field.
//
// Lifted out of SettingsPanel.tsx when the drawer became tabbed, for the same reason
// SourceRow.tsx sits beside SourceCatalog.tsx: the rationale below is the interesting
// part of this control and it was buried at line 26 of a 357-line file.

import { useState } from "react";
import { chordOf, formatChord, isMac, keymapStore, type KeyAction } from "@/lib/shell/keymap";

/**
 * PRESS-TO-BIND, NOT A TEXT FIELD. Typing "ctrl+q" into a box means parsing prose and
 * means the user can write a chord their keyboard cannot produce. Listening for the
 * real keydown is the only way the stored value is guaranteed to be a chord that
 * actually arrives — and it is captured on THIS element, so arming one row cannot
 * swallow keys meant for the rest of the app.
 *
 * The button says what it is doing ("Press a key…") and Escape cancels, because a
 * control that silently eats the next keystroke is a trap.
 *
 * THE ESCAPE BELOW IS ALSO WHAT KEEPS THE DRAWER OPEN WHILE ARMED. SettingsPanel closes
 * on a `window` keydown; this handler's stopPropagation is what stops that listener ever
 * seeing the Escape that cancels arming. That is real React behaviour — a synthetic
 * stopPropagation stops the native event too — but it is load-bearing and was undocumented,
 * so: do not remove the stopPropagation thinking it is redundant with preventDefault.
 *
 * The tab strip added above cannot interfere. Its arrow handler lives on the tablist
 * element, and this chip is inside `.tn-settings-body`, which is the tablist's SIBLING —
 * a keydown here bubbles chip → row → body → aside and never passes through the strip.
 */
export default function ShortcutRow({
  action, label, hint, chords, onError,
}: {
  action: KeyAction; label: string; hint: string; chords: string[];
  onError: (m: string | null) => void;
}) {
  const [arming, setArming] = useState<number | null>(null);
  const mac = isMac();

  return (
    <div className="tn-settings-row tn-keymap-row">
      <span className="tn-settings-label" title={hint}>{label}</span>
      <div className="tn-keymap-chords">
        {chords.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            className="tn-settings-seg-btn tn-keymap-chip"
            aria-pressed={arming === i}
            aria-label={arming === i ? `Press a key for ${label}` : `${label}: ${formatChord(c, mac)}. Click to change.`}
            onClick={() => { onError(null); setArming(arming === i ? null : i); }}
            onKeyDown={(e) => {
              if (arming !== i) return;
              // Everything, including Tab and Enter — while armed, this row owns the
              // keyboard. Escape is the way out and is never bound.
              e.preventDefault();
              e.stopPropagation();
              if (e.key === "Escape") { setArming(null); return; }
              const chord = chordOf(e);
              if (!chord) return; // a bare modifier: keep waiting for the real key
              const r = keymapStore.bind(action, i, chord);
              if (!r.ok) { onError(r.reason); return; }
              onError(null);
              setArming(null);
            }}
          >
            {arming === i ? "Press a key…" : formatChord(c, mac)}
          </button>
        ))}
      </div>
    </div>
  );
}
