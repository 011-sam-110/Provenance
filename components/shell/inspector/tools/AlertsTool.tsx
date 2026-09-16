"use client";
// The Notifications tool — what the console should tell you about, and where.
//
// IT WAS A SECTION INSIDE THE DRAW PANEL, for one round. Sam's report was "i cant see
// the alerts and bell", which is the whole argument for this file existing: he had
// asked for the bell to have "its own little area", the area was built inside another
// tool's panel, and a control you have to open a different tool to find is a control
// that is not there. It is a rail button of its own now.
//
// THE BODY IS RulesPanel, UNCHANGED — the same composer WidgetFrame's bell opens and
// the same one the Draw panel used to embed. This file exists to give it a panel, not
// to fork it: a second copy of the composer would be a second place for a rule to be
// armed from, and the two would drift the first time a trigger was added.
//
// WHAT IT IS ARMED ON IS THE CONTEXT THE RAIL IS POINTED AT, exactly as it was when
// this lived beside the areas list — `editing === null` already means World
// everywhere else in this store (see editingSet in lib/shell/inspector.ts), so the
// composer reads the same way rather than inventing a second idea of "current area".
// RulesPanel prints that context (and the count of armed rules) in its own header, so
// "which area am I about to alert on" is answered without leaving the panel.

import { useInspector } from "@/lib/shell/inspector";
import RulesPanel from "@/components/shell/inspector/RulesPanel";
import ToolSection from "@/components/shell/inspector/ToolSection";
import { WORLD_AREA_ID } from "@/lib/notify/types";

export default function AlertsTool() {
  const state = useInspector();
  const area = state.areas.find((a) => a.id === state.editing) ?? null;

  return (
    <>
      {/* NO BELL IN THIS HEADING, deliberately. The mark is on the rail button that
          opened the panel, and repeating it here would be the same glyph twice in one
          eye-line — the heading names the section, the button names the tool. */}
      <ToolSection title="Alerts">
        <RulesPanel
          areaId={state.editing ?? WORLD_AREA_ID}
          areaLabel={area?.label ?? "World"}
        />
      </ToolSection>

      <p className="tn-insp-tool-foot">
        An alert fires while the console is open — there is no server watching for you.
        Browser notifications need the permission the first one asks for, and the
        global switch for all of them is in Settings.
      </p>
    </>
  );
}
