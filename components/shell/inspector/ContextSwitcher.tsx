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

import { useEffect, useId, useRef, useState } from "react";
import { areaSummary, editingArea, inspectorStore, useInspector } from "@/lib/shell/inspector";

export default function ContextSwitcher() {
  const state = useInspector();
  const area = editingArea(state);
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
