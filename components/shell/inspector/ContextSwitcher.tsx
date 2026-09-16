"use client";
// WHICH CONTEXT THE SOURCES RAIL IS WRITING TO. The load-bearing control of this
// whole feature.
//
// With several source contexts, a toggle in the Sources tab writes whichever one is
// selected. A user who flips Aircraft without knowing whether they changed the globe
// or the Kharkiv area has been handed a control that lies about its effect — and this
// codebase has shipped and then fixed two variants of that bug already. So this line
// is rendered above BOTH tabs, not inside one of them, and it is never hidden.
//
// IT WAS A LABEL AND IS NOW A SWITCHER, which is a change the contexts model had to
// earn. While areas were exclusive, switching context took the globe off the map, so
// the only safe controls to offer were "load this one" (from the area's own dossier,
// deliberate) and "✕ back to World". Areas are additive now — every one of them draws
// whatever this says — so switching is invisible on the map and there is no longer a
// reason to make the user go and find an area's dossier to point the rail at it.
// Picking a context here is picking a pen.
//
// A MENU, NOT A <select>. The rows carry a glyph and a source count each, a native
// <option> can hold neither, and the list is capped at AREA_CAP + 1 so it never grows
// past a scrollable popover. Keyboard behaviour is the WAI-APG menu-button pattern:
// the trigger opens on Enter/Space/Down, Escape closes and returns focus, arrows move
// through the rows, and every row is a real button so Tab still works if a screen
// reader user prefers it.
//
// IT ALSO CARRIES THE ONLY WAY OUT OF A DRAWN AREA, and that is load-bearing rather
// than convenient. The map rail's "Restrict results to an area" flyout held the single
// `clearAoi` call in the product; an `aoi` scope is persisted and SURVIVES A RELOAD
// (lib/shell/scope.ts `coerceSavedScope`, which justified keeping it on the grounds
// that the map rail could clear it). With that gone and no replacement, anyone who
// ever drew one stays filtered for good with nothing on screen saying why. Sam asked
// for the escape hatch here — "clear path should be put in the 'editing x' part.
// There can be an option with an x next to the area that can close it."
//
// WHEN IT SHOWS is `needsClearArea` in lib/shell/clearArea.ts, and it is deliberately
// an OR over two separate models. See that file; the short version is that the scope
// and the Inspector's areas are different things, and the stranded user is the one
// whose scope is filtered while the rail points at World.
//
// IT DOES NOT DELETE THE AREA. Removing an area throws away the sources configured on
// it and already has a home with room to confirm — the area's dossier, AreaDetail's
// "Remove". This control returns you to an unfiltered World, which is what it says.

import { useEffect, useId, useRef, useState } from "react";
import { areaSummary, editingArea, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { clearAoi } from "@/lib/map/aoi";
import { useScope } from "@/lib/shell/scope";
import { clearAreaLabel, needsClearArea } from "@/lib/shell/clearArea";

/**
 * The ✕, drawn rather than typed.
 *
 * Same reasoning as SourceCatalog's own CloseGlyph, which this cannot import
 * without making the pair circular: a "✕" text character renders at whatever
 * weight the first font in the stack happens to carry it at — the rail's mono
 * stack does not carry it — so it arrives thin, small and vertically off-centre.
 * Two strokes at a stated weight cannot drift.
 */
function ClearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default function ContextSwitcher() {
  const state = useInspector();
  const area = editingArea(state);
  const scope = useScope();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  // Close on an outside press or on Escape, and hand focus back on the way out.
  // Both listeners are bound only while the menu is open: a document-level keydown
  // that lived for the life of the rail would swallow Escape from every other panel
  // in the shell, which is the bug ConsoleShell's own handler documents at length.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (id: string | null) => {
    inspectorStore.edit(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const showClear = needsClearArea(state.editing, scope.mode);

  /**
   * Both halves, because both can be true at once and a control that undid one
   * of them would leave the console still filtered while looking cleared.
   *
   * `clearAoi()` drops the console-wide scope back to World — that is the
   * persisted filter. `inspectorStore.edit(null)` points the rail back at World
   * so the toggles below stop writing into an area the user has just left. It
   * does NOT touch the area's own sources, and it does not delete the area.
   */
  const clear = () => {
    clearAoi();
    inspectorStore.edit(null);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Arrow keys walk the rendered rows rather than an index into state, so the World
  // row and the areas are one list without a special case for the offset.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(".tn-ctxbar-opt") ?? [],
    );
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  return (
    <div className="tn-ctxbar-wrap" ref={rootRef}>
      <div className="tn-ctxbar-row">
        <button
          ref={triggerRef}
          type="button"
          className="tn-ctxbar"
          data-area={area ? "" : undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          // The accessible name states the EFFECT, not the state. "World" alone read
          // out is a place; what the user needs to know before touching a toggle is
          // where the toggle will land.
          aria-label={`Editing ${area ? area.label : "World"}. Change which context the sources below apply to.`}
        >
          <span className="tn-ctxbar-glyph" aria-hidden>{area ? "▣" : "⌂"}</span>
          <span className="tn-ctxbar-lead" aria-hidden>Editing</span>
          <span className="tn-ctxbar-name">{area ? area.label : "World"}</span>
          <span className="tn-ctxbar-caret" aria-hidden>▾</span>
        </button>

        {/* A SEPARATE BUTTON, NOT A SPAN INSIDE THE TRIGGER. Nesting it would be
            invalid HTML, and — the part that matters in use — a click on the ✕
            would bubble into the trigger and open the menu it had just closed.
            As a sibling it is its own tab stop, reached with one Tab from the
            switcher, so this escape hatch is keyboard-reachable without the menu
            ever being opened. */}
        {showClear ? (
          <button
            type="button"
            className="tn-ctxbar-clear"
            onClick={clear}
            aria-label={clearAreaLabel(area ? area.label : null)}
            title={clearAreaLabel(area ? area.label : null)}
          >
            <ClearGlyph />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="tn-ctxbar-menu" id={listId} role="menu" onKeyDown={onListKey}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={area === null}
            className="tn-ctxbar-opt"
            onClick={() => pick(null)}
          >
            <span className="tn-ctxbar-glyph" aria-hidden>⌂</span>
            <span className="tn-insp-main">
              <span className="tn-insp-label">World</span>
              <span className="tn-insp-sub">Draws everywhere</span>
            </span>
          </button>

          {state.areas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === state.editing}
              className="tn-ctxbar-opt"
              onClick={() => pick(a.id)}
            >
              <span className="tn-ctxbar-glyph" aria-hidden>▣</span>
              <span className="tn-insp-main">
                <span className="tn-insp-label">{a.label}</span>
                <span className="tn-insp-sub">{areaSummary(a)}</span>
              </span>
            </button>
          ))}

          {/* THE "DRAW AN AREA" ROW IS GONE FROM THIS MENU (2026-09-16), together
              with the button that used to sit under the areas list. Both were the
              only doors into the gesture from this tab; Sam moved it to the
              Inspector rail's toolbar, beside the search box and the map settings.

              It was added here for a real gap — opening this menu to point the rail
              at an area, finding you have none, and having to close it and hunt for
              a dashed button further down the rail. That gap is why the rail button
              now sits at the top of the panel the switcher is on, permanently, with
              a label on hover: the same distance to travel, and no longer something
              you can only reach by opening a menu to look for it. */}

          {/* Stated rather than left to be inferred from the map. It is the one thing
              about this model that is not visible from the control itself, and the
              question it answers — "have I just turned the globe off?" — is the exact
              report that produced the model. */}
          <p className="tn-ctxbar-foot">
            Every area draws at once. Switching only changes where the toggles below
            are written.
          </p>
        </div>
      ) : null}
    </div>
  );
}
