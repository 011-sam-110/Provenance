"use client";
// The areas block — draw one, and see the ones you have drawn.
//
// WAS THE "INSPECTOR" TAB. It is now a block INSIDE the Sources tab, sitting where
// the presets block used to, and the presets have taken its place as the rail's
// second tab. Sam asked for the swap and the reason it holds is traffic: drawing an
// area and then turning sources on for it is one continuous job, and it used to be
// split across two tabs — draw here, switch there, toggle, switch back to see what
// the area now says. Presets are a one-tap act you do occasionally, which is what a
// second tab is for.
//
// SOURCES ARE STILL NOT CONFIGURED HERE. The context switcher above the tabs points
// the rail at an area; the source list below then writes to it. Duplicating a source
// list in this block would give the user two places to change one thing.
//
// A ROW OPENS THE DOSSIER, it does not select. Selecting is the switcher's job now,
// and detail belongs in the dossier on the right, which already exists at 384px and
// already handles focus, escape and mobile. See lib/overlay-content.tsx.

import { areaSummary, useInspector } from "@/lib/shell/inspector";
import { AREA_CAP_MESSAGE, atAreaCap, drawArea } from "@/lib/shell/drawArea";
import { overlay } from "@/lib/overlay";
import RulesPanel from "@/components/shell/inspector/RulesPanel";
import { useAllRules } from "@/lib/notify/rules";
import { WORLD_AREA_ID } from "@/lib/notify/types";

export default function AreasPanel() {
  const state = useInspector();
  // ONE subscription, counted per row. A hook cannot be called once per area — the
  // list changes length — so the count is derived from the whole set here.
  const rules = useAllRules();
  // TWO ENTRY POINTS, ONE IMPLEMENTATION. The context switcher's menu can start
  // the same gesture, and `onFinish` is the part that must not drift between them
  // — without it a saved area silently becomes a console-wide filter. The whole
  // rule, and the reason it is load-bearing now, is in lib/shell/drawArea.ts.
  const capped = atAreaCap(state.areas.length);

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
              // The bbox CENTRE, not 0,0. FeedOverlay writes the object's lat/lon
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


      {/* IT STAYS, even though the context switcher's menu now offers the same
          action. This one sits directly under the "No areas yet…" empty state,
          which is where a first-time user is already looking; the menu entry is
          for someone who opened the switcher to point at an area and found they
          had none. Discovery and convenience are different jobs.

          REFUSES AT THE CAP rather than drawing over the oldest area — see
          atAreaCap. `disabled` and not merely `aria-disabled`, because unlike a
          menu item this is not inside a composite widget whose roving focus
          would be broken by skipping it, and the reason is stated in the label
          itself so the refusal is never a dead-looking click. */}
      <button
        type="button"
        className="tn-insp-draw"
        onClick={() => drawArea(state.areas.length)}
        disabled={capped}
        title={capped ? AREA_CAP_MESSAGE : undefined}
      >
        {capped ? `＋ Draw an area — ${AREA_CAP_MESSAGE}` : "＋ Draw an area"}
      </button>

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
