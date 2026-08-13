"use client";
// The Terminal's 24px footer: SEL badge · what is selected · the live ticker ·
// the keyboard hints.
//
// Three of those four are chrome. The SELECTION is not — it is the answer to
// "what did I just click?", and it is the only place that answer is written down
// (the map flies, the linked rows highlight, but neither of those says a name).
// So the selection block is the one part of this bar wired into the accessibility
// tree: role="status" aria-live="polite", announced when it changes. It is safe
// as a live region precisely because it changes only when the USER selects or
// clears — nothing in it churns on a timer, which is the failure tests/unit/
// shell-a11y.test.ts guards against elsewhere. The ticker beside it does churn,
// which is why TickerLine marks itself aria-hidden and owns its own clock.
//
// The three strings come from footerLine() in lib/terminal/selection, including
// the empty state ("NOTHING SELECTED" / "—" / "CLICK ANY ROW …"). They are not
// re-derived here: that function is pure and unit-tested, it guarantees three
// non-empty strings so the bar's slots never collapse and reflow, and it
// deliberately does NOT upper-case the title (the stylesheet does that, so a real
// name like "M 5.4 — 22 km SSE of Puerto Madero" survives intact).
//
// Props: none, by design. Everything is read from stores, so the footer can be
// dropped into either mode's grid without the shell threading state through it.
//
// ─────────────────────────────────────────────────────────────────────────────
// CSS THIS FILE NEEDS (integrator: add to app/globals.css under .tn-terminal).
// TickerLine.tsx lists the .tnx-ticker* rules and the om-ticker keyframe.
//
//   .tnx-footer      { flex:none; height:24px; display:flex; align-items:stretch;
//                      background:#080b0f; border-top:1px solid var(--tnx-line-strong);
//                      font-size:9.5px; color:var(--tnx-ink-faint); overflow:hidden; }
//   .tnx-sel-badge   { display:flex; align-items:center; padding:0 9px;
//                      background:var(--tnx-accent); color:var(--tnx-bg);
//                      font-weight:800; letter-spacing:0.1em; flex:none; }
//   .tnx-sel         { display:flex; align-items:center; gap:8px; padding:0 10px;
//                      min-width:0; border-right:1px solid var(--tnx-line);
//                      white-space:nowrap; }
//   .tnx-sel-title   { font-weight:700; color:var(--tnx-ink); max-width:38vw;
//                      overflow:hidden; text-overflow:ellipsis; }
//   .tnx-sel-coord   { color:var(--tnx-ink-dim); font-variant-numeric:tabular-nums; flex:none; }
//   .tnx-sel-meta    { color:var(--tnx-ink-faint); min-width:0; overflow:hidden;
//                      text-overflow:ellipsis; }
//   .tnx-keys        { display:flex; align-items:center; gap:7px; padding:0 10px;
//                      flex:none; border-left:1px solid var(--tnx-line);
//                      color:var(--tnx-ink-faint); white-space:nowrap; }
//   .tnx-keys-sep    { color:var(--tnx-ink-ghost); }
//   .tnx-keycap      { color:var(--tnx-ink-dim); font-weight:700; }
//
// Two notes for whoever writes those rules:
//  - #080b0f is the design's header/footer chrome colour and has no token in the
//    agreed --tnx-* set (which stops at --tnx-bg #06080b and --tnx-panel #0a0d12).
//    Either add a --tnx-chrome token or inline the hex in both places; do not
//    substitute --tnx-bg, which is a visibly different, darker value.
//  - globals.css sets --tn-ticker-h: 32px, and the MapLibre attribution control is
//    pinned to bottom: var(--tn-ticker-h). This footer is 24px. If the Terminal
//    shell replaces the old ticker, that variable has to follow it to 24px or the
//    licence attribution floats 8px off the bar it is supposed to sit above.
//    That file is the integrator's, so it is flagged here rather than edited.
// ─────────────────────────────────────────────────────────────────────────────

import TickerLine from "@/components/terminal/TickerLine";
import { footerLine, useTerminalSelection } from "@/lib/terminal/selection";

/**
 * The keyboard hints, in the order the shell binds them. Kept as data rather than
 * markup so the key and its verb cannot drift apart, and so a binding added to the
 * shell's keydown handler has one obvious place to be advertised.
 */
const KEY_HINTS: readonly { key: string; verb: string }[] = [
  { key: "W", verb: "wall" },
  { key: "C", verb: "console" },
  { key: "/", verb: "search" },
  { key: "ESC", verb: "clear" },
];

export default function TerminalFooter() {
  const sel = useTerminalSelection();
  const { title, coord, meta } = footerLine(sel);

  return (
    <footer className="tnx-footer">
      <span className="tnx-sel-badge">SEL</span>

      {/* The only announced surface in the footer — see the note at the top. */}
      <div className="tnx-sel" role="status" aria-live="polite">
        <span className="tnx-sel-title" title={title}>
          {title}
        </span>
        <span className="tnx-sel-coord">{coord}</span>
        <span className="tnx-sel-meta">{meta}</span>
      </div>

      <TickerLine />

      <div className="tnx-keys">
        {KEY_HINTS.map((h, i) => (
          <span key={h.key}>
            {i > 0 ? <span className="tnx-keys-sep">· </span> : null}
            <span className="tnx-keycap">{h.key}</span> {h.verb}
          </span>
        ))}
      </div>
    </footer>
  );
}
