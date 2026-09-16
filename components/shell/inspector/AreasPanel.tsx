"use client";
// The areas block — the ones you have drawn, and what is armed on them.
//
// WAS THE "INSPECTOR" TAB. It is now a block INSIDE the Sources tab, sitting where
// the presets block used to, for the reason it moved: drawing an area and then
// turning sources on for it is one continuous job, and it used to be split across
// two tabs — draw here, switch there, toggle, switch back to see what the area now
// says.
//
// IT NO LONGER STARTS A DRAW. "＋ Draw an area" was this block's last button and it
// is gone, together with the matching row in the context switcher's menu: Sam moved
// the gesture onto the Inspector rail's toolbar on 2026-09-16, alongside the search
// box and the map settings. That makes this block a LIST — the areas, their source
// counts, their rules — which is what it had become anyway.
//
// SOURCES ARE STILL NOT CONFIGURED HERE. The context switcher above the tabs points
// the rail at an area; the source list below then writes to it. Duplicating a source
// list in this block would give the user two places to change one thing.
//
// A ROW OPENS THE DOSSIER, it does not select. Selecting is the switcher's job now,
// and detail belongs in the pane on the right, which already exists and already
// handles focus, escape and mobile. See lib/overlay-content.tsx.

import { areaSummary, useInspector } from "@/lib/shell/inspector";
import { overlay } from "@/lib/overlay";
import RulesPanel from "@/components/shell/inspector/RulesPanel";
import { useAllRules } from "@/lib/notify/rules";
import { WORLD_AREA_ID } from "@/lib/notify/types";

export default function AreasPanel() {
  const state = useInspector();
  // ONE subscription, counted per row. A hook cannot be called once per area — the
  // list changes length — so the count is derived from the whole set here.
  const rules = useAllRules();

  return (
    <div className="tn-insp">
      {/* THE SAME HEADING AS "AIR & SPACE", not a second, quieter one.
          It was `.tn-subhead` (12px) while every source section was
          `.tn-src-sec-head` (14px small caps), so the one block in this rail
          that is NOT a list of sources was also the one heading that did not
          look like a heading. Sam's words: "'AREAS' needs to be capital and
          bold a bit like 'AIR & SPACE'." Sharing the class is what makes that
          true permanently rather than until the next retune. */}
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
          <button
            key={a.id}
            type="button"
            className="tn-insp-row"
            data-editing={state.editing === a.id ? "" : undefined}
            onClick={() =>
              // The bbox CENTRE, not 0,0. The Inspector panel writes the object's lat/lon
              // straight into its GeoJSON export, so a placeholder would hand the
              // user a downloaded file claiming every area sits at Null Island.
              // A position we do have must never be shipped as one we invented.
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
            {/* "EDITING", NOT "LOADED". The pill used to mean "this is what the map is
                showing", which is no longer a thing an area can be — they all show at
                once. It now means "the toggles below land here", which is the only
                claim this row can still make. */}
            {state.editing === a.id ? <span className="tn-insp-pill">EDITING</span> : null}
            {/* An armed area has to say so on the row. A rule fires whether or not
                the area is the one being edited, so without this the only evidence
                that a watch exists is opening the area that happens to hold it. */}
            {rules.some((r) => r.areaId === a.id) ? (
              <span className="tn-insp-pill" title="Notification rules armed on this area">
                {rules.filter((r) => r.areaId === a.id).length} ▲
              </span>
            ) : null}
          </button>
        ))
      )}


      {/* THE DRAW BUTTON LEFT THIS BLOCK ON 2026-09-16, and so did the one inside
          the context switcher's menu. Sam moved the gesture onto the Inspector
          rail's own toolbar (components/shell/inspector/InspectorRail.tsx), beside
          the search box and the map settings — the three map controls he asked to
          have in one place — and asked for both of this tab's entry points to go
          rather than be duplicated. What this block still does is list the areas
          you have and open their dossiers; `drawArea` now has exactly one caller.

          The button was also this block's only connection to lib/shell/drawArea.ts,
          which is why the imports for it are gone rather than left warm. */}

      {/* "Alert me" IS THE CONTROL NOW, not a placeholder pill. It arms against
          whichever context the rail is pointed at — `editing === null` already means
          World everywhere else in this store (see editingSet), so the composer reads
          the same way rather than inventing a second idea of "current area". */}
      <RulesPanel
        areaId={state.editing ?? WORLD_AREA_ID}
        areaLabel={state.areas.find((a) => a.id === state.editing)?.label ?? "World"}
      />
    </div>
  );
}
