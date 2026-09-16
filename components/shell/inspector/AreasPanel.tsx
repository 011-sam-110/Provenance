"use client";
// The DRAW tool's panel — the areas you have, and the button that starts another.
//
// IT MOVED HERE FROM THE SOURCES TAB (2026-09-16), and the move is Sam's second pass
// at this surface. The block is now the body of the Inspector rail's Draw tool, so
// "what areas do I have" and "draw another one" are in the same place — which they
// were not while the list lived on the Sources tab and the only way in was a button
// at the bottom of it. The rail carries the entry point on BOTH tabs; this panel
// holds the state.
//
// AND THE RAIL BUTTON NO LONGER STARTS A DRAW. It opens this panel; the gesture
// starts from the button below. Sam's words: "when you click the draw area button on
// the inspector, it shouldnt just automatically start drawing an area. A user should
// click draw area on that page." That is also what keeps the panel's promise honest —
// a click that immediately started a map interaction from a page nobody had read yet
// was a click with no undo.
//
// SOURCES ARE STILL NOT CONFIGURED HERE. The context switcher at the top of the
// Sources tab points the rail at an area; the source list below then writes to it.
// Duplicating a source list in this panel would give the user two places to change
// one thing.
//
// A ROW OPENS THE DOSSIER, it does not select. Selecting is the switcher's job, and
// detail belongs in this panel, which already handles focus, escape and mobile. See
// lib/overlay-content.tsx.
//
// ONE IMPLEMENTATION, ONE CALL SITE. `drawArea` used to be called from here AND from
// the context switcher's menu AND from the rail; the menu row and the rail's direct
// arm are both gone, so this button is now the only door. `onFinish` inside
// lib/shell/drawArea.ts is the part that must never drift — without it a saved area
// silently becomes a console-wide filter.

import { useState } from "react";
import { areaSummary, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { AREA_CAP_MESSAGE, atAreaCap, drawArea } from "@/lib/shell/drawArea";
import { useAoiDraw } from "@/lib/map/aoi";
import { overlay } from "@/lib/overlay";
import RulesPanel from "@/components/shell/inspector/RulesPanel";
import { PencilGlyph } from "@/components/shell/inspector/ToolIcons";
import { useAllRules } from "@/lib/notify/rules";
import { WORLD_AREA_ID } from "@/lib/notify/types";

/**
 * How long an area name may be. Not a database limit — a LAYOUT one.
 *
 * The name is printed on the row, in the context switcher's trigger, in its menu and
 * in the dossier header. Those four are all single-line and ellipsised, so an
 * unbounded name cannot break the layout — it just becomes unreadable everywhere at
 * once, which is worse. 60 characters is more than the longest honest label ("Drawn
 * area (5 points)" is 21) and short enough to stay legible in the narrowest one.
 */
const MAX_NAME = 60;

export default function AreasPanel() {
  const state = useInspector();
  // ONE subscription, counted per row. A hook cannot be called once per area — the
  // list changes length — so the count is derived from the whole set here.
  const rules = useAllRules();
  const drawing = useAoiDraw();
  const capped = atAreaCap(state.areas.length);

  // WHICH ROW IS BEING RENAMED, and the text in it. One at a time: two open fields in
  // a list of forty is a state nobody asked for, and the second one would have to
  // decide what committing it means.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (id: string, label: string) => {
    setDraft(label);
    setRenaming(id);
  };

  /**
   * Commit, or put it back. AN EMPTY NAME REVERTS rather than saving: the label is the
   * only thing identifying the row in the list, in the context switcher and in the
   * dossier header, so a blank one leaves four unclickable blanks behind. Same rule as
   * AreaDetail's field — the two are the same edit in two places.
   */
  const commitRename = (id: string, original: string) => {
    const next = draft.trim();
    setRenaming(null);
    if (!next || next === original) return;
    inspectorStore.rename(id, next);
  };

  return (
    <div className="tn-insp">
      {/* THE SAME HEADING AS "AIR & SPACE", not a second, quieter one. It was
          `.tn-subhead` (12px) while every source section was `.tn-src-sec-head`
          (14px small caps), so the one block in this rail that is NOT a list of
          sources was also the one heading that did not look like a heading. Sam's
          words: "'AREAS' needs to be capital and bold a bit like 'AIR & SPACE'."
          Sharing the class is what makes that true permanently rather than until the
          next retune. */}
      <h3 className="tn-src-sec-head">
        <span className="tn-src-sec-name">Areas</span>
        <span className="tn-src-sec-n tn-num">{state.areas.length}</span>
      </h3>

      {state.areas.length === 0 ? (
        <p className="tn-rail-foot">
          No areas yet. Draw one on the map to give it its own sources — they show
          inside it, and the globe keeps everything it already had.
        </p>
      ) : (
        state.areas.map((a) => (
          // A DIV, NOT A BUTTON, since the pencil joined it. Two buttons cannot nest,
          // and the alternative — an absolutely positioned pencil inside a button —
          // would have made the label's own hit area depend on paint order. So the row
          // is a box with two real controls in it, and the label is the big one.
          <div
            key={a.id}
            className="tn-insp-row"
            data-editing={state.editing === a.id ? "" : undefined}
          >
            {renaming === a.id ? (
              <input
                className="tn-insp-rename"
                // THE RAIL'S ESCAPE HANDLER STANDS DOWN FOR THIS, and the attribute
                // is how it knows — see the ladder in InspectorRail.tsx. Escape in a
                // field being edited means "put it back", not "close the panel".
                data-area-rename=""
                value={draft}
                autoFocus
                maxLength={MAX_NAME}
                aria-label={`Rename ${a.label}`}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(a.id, a.label)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(a.id, a.label);
                  } else if (e.key === "Escape") {
                    // Both halves, in this order: stop the key reaching the console's
                    // own ladder (which would clear the map selection behind the
                    // panel), then put the old name back.
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="tn-insp-row-main"
                  onClick={() =>
                    // The bbox CENTRE, not 0,0. The Inspector panel writes the object's
                    // lat/lon straight into its GeoJSON export, so a placeholder would
                    // hand the user a downloaded file claiming every area sits at Null
                    // Island. A position we do have must never be shipped as one we
                    // invented.
                    overlay.open({
                      kind: "area",
                      id: a.id,
                      label: a.label,
                      lat: (a.bbox[1] + a.bbox[3]) / 2,
                      lon: (a.bbox[0] + a.bbox[2]) / 2,
                    })
                  }
                >
                  <span className="tn-insp-glyph" aria-hidden>▣</span>
                  <span className="tn-insp-main">
                    <span className="tn-insp-label">{a.label}</span>
                    <span className="tn-insp-sub">{areaSummary(a)}</span>
                  </span>
                  {/* "EDITING", NOT "LOADED". The pill used to mean "this is what the
                      map is showing", which is no longer a thing an area can be — they
                      all show at once. It now means "the toggles land here", which is
                      the only claim this row can still make. */}
                  {state.editing === a.id ? <span className="tn-insp-pill">EDITING</span> : null}
                  {/* An armed area has to say so on the row. A rule fires whether or
                      not the area is the one being edited, so without this the only
                      evidence that a watch exists is opening the area that holds it. */}
                  {rules.some((r) => r.areaId === a.id) ? (
                    <span className="tn-insp-pill" title="Notification rules armed on this area">
                      {rules.filter((r) => r.areaId === a.id).length} ▲
                    </span>
                  ) : null}
                </button>
                {/* ALWAYS VISIBLE, never a hover reveal — the same rule the ＋ on a
                    source row and the rail's own buttons follow. It is also the only
                    way to rename, so hiding it until the pointer arrives would put the
                    product's one naming control behind a gesture that a touch screen
                    does not have. */}
                <button
                  type="button"
                  className="tn-insp-row-edit"
                  aria-label={`Rename ${a.label}`}
                  title="Rename this area"
                  onClick={() => startRename(a.id, a.label)}
                >
                  <PencilGlyph />
                </button>
              </>
            )}
          </div>
        ))
      )}

      {/* THE GESTURE STARTS HERE, and this is the only button that starts it.
          REFUSES AT THE CAP rather than drawing over the oldest area — see
          atAreaCap. `disabled` and not merely `aria-disabled`, because this is not
          inside a composite widget whose roving focus would be broken by skipping
          it, and the reason is stated in the label itself so the refusal is never a
          dead-looking click.

          THE ARMED STATE IS SHOWN HERE TOO, now that the button is the way in: a
          click that leaves the panel looking identical and moves the whole gesture
          onto the map is the "did that work?" report this rail keeps answering. The
          banner over the map is still the narration that cannot be dismissed —
          this is the receipt on the control that was clicked. */}
      <button
        type="button"
        className="tn-insp-draw"
        data-armed={drawing.active ? "" : undefined}
        aria-pressed={drawing.active}
        onClick={() => drawArea(state.areas.length)}
        disabled={capped}
        title={capped ? AREA_CAP_MESSAGE : undefined}
      >
        {capped
          ? `＋ Draw an area — ${AREA_CAP_MESSAGE}`
          : drawing.active
            ? "Drawing — click the map to place corners"
            : "＋ Draw an area"}
      </button>

      {/* "Alert me" IS THE CONTROL NOW, not a placeholder pill. It arms against
          whichever context the rail is pointed at — `editing === null` already means
          World everywhere else in this store (see editingSet), so the composer reads
          the same way rather than inventing a second idea of "current area".

          UNDER ITS OWN HEADING, because it is the one thing in this panel that is not
          the areas list: "what areas do I have" above, "tell me when something happens
          in this one" below. Same heading class as "Areas", so the two read as two
          sections of one panel rather than as a list and whatever follows it. */}
      <h3 className="tn-src-sec-head">
        <span className="tn-src-sec-name">Alerts</span>
      </h3>
      <RulesPanel
        areaId={state.editing ?? WORLD_AREA_ID}
        areaLabel={state.areas.find((a) => a.id === state.editing)?.label ?? "World"}
      />
    </div>
  );
}
