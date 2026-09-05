"use client";
// RESTRICT RESULTS TO AREA, now inside the stage rail's Draw group.
//
// Lifted from components/console/AoiControl.tsx, which this replaces. Its header
// is worth carrying forward: the scope plumbing had existed since the shell was
// built and was UNREACHABLE, because the only control that could set a scope
// lived in a top bar the Terminal does not render. The feature was complete apart
// from any way to use it. Do not let it become unreachable again.
//
// TWO TOOLS, ONE FILTER. Area draws a ring vertex by vertex; Radius draws a circle
// from a centre. Both end as the same AOI scope — see the DrawTool note in
// lib/map/aoi.ts for why a radius is stored as a ring rather than as a second kind
// of scope. So this panel has one "set" state, not two, and Clear clears either.
//
// THE LABEL IS A SENTENCE, NOT A NOUN, AND THE ICON DOES NOT REPLACE IT. "Area"
// told a first-time reader nothing about which way the filter runs. Each tool
// button therefore carries its glyph AND its word, with the full sentence on the
// title and the accessible name — an icon-only pair here would have re-made the
// exact mistake this file's first version was written to fix, and there is no
// hover to explain a glyph on a phone.
//
// Three states, and they are mutually exclusive — idle, drawing, set. CLEAR IS
// RENDERED ONLY WHEN A SCOPE IS SET. A Clear button sitting beside a filter that
// is not set is a control that lies about the state of the app.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useScope } from "@/lib/shell/scope";
import {
  MIN_VERTICES,
  cancelDraw,
  clearAoi,
  formatRadius,
  startDraw,
  startRadius,
  useAoiDraw,
} from "@/lib/map/aoi";
import { getMapInstance } from "@/lib/map/instance";
import { areaPickStore } from "@/lib/console/widgets/camslot.area";
import { PolygonGlyph, RadiusGlyph } from "./RailIcons";

export default function DrawFlyout() {
  const scope = useScope();
  const drawing = useAoiDraw();
  // The camera picker borrows the same draw tool. While it owns the gesture this
  // group stays out of the way rather than narrating someone else's ring.
  //
  // One-group-open already makes two visible counters impossible, but the flag is
  // still needed: open Draw, start a ring, switch to Cameras — without this check
  // Cameras would narrate a gesture the user did not ask for. That is the exact
  // bug camslot.area.ts documents as measured on the live stage bar.
  const theirs = useSyncExternalStore(areaPickStore.subscribe, areaPickStore.get, () => false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  // One arm path for both tools. The failure messages are the tool's own, because
  // "The map is still loading" is the honest answer for either and inventing a
  // second wording per tool would be two strings to keep in step for no gain.
  const arm = useCallback((start: typeof startDraw) => {
    const map = getMapInstance();
    if (!map) return setNote("No map on the stage to draw on.");
    // No options, so the finished ring becomes the scope rather than being handed
    // to a caller — see the onFinish branch in lib/map/aoi.ts.
    if (!start(map)) setNote("The map is still loading.");
  }, []);

  const onArea = useCallback(() => arm(startDraw), [arm]);
  const onRadius = useCallback(() => arm(startRadius), [arm]);

  const drawingHere = drawing.active && !theirs;
  const hasScope = scope.mode === "aoi" && scope.polygon != null;

  // The live readout, per tool. A radius has no vertex count to report and a
  // polygon has no radius, so the two gestures narrate themselves rather than
  // sharing a phrase that would be wrong for one of them.
  const live =
    drawing.tool === "radius"
      ? drawing.center == null
        ? "Click the centre"
        : `${formatRadius(drawing.radiusKm ?? 0)} — click the edge`
      : drawing.vertices.length >= MIN_VERTICES
        ? `${drawing.vertices.length} points — Enter to close`
        : `${drawing.vertices.length}/${MIN_VERTICES} points`;

  return (
    <>
      {drawingHere ? (
        <>
          <span className="tnx-maprail-live" role="status" aria-live="polite">
            {live}
          </span>
          <button
            type="button"
            className="tnx-maprail-act"
            onClick={cancelDraw}
            title="Abandon this area (Esc)"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          {hasScope ? (
            <>
              {/* The scope's OWN label, not a count assembled here. A radius is
                  stored as a 64-point ring, so "Area · 64 pts" would be true of the
                  storage and a lie about the gesture. */}
              <span className="tnx-maprail-live">{scope.label}</span>
              <button
                type="button"
                className="tnx-maprail-act"
                onClick={clearAoi}
                title="Show the whole world again"
              >
                Clear
              </button>
              <span className="tnx-maprail-rule" aria-hidden="true" />
            </>
          ) : null}
          <button
            type="button"
            className="tnx-maprail-act tnx-maprail-act-icon"
            onClick={onArea}
            aria-label="Restrict results to a drawn area"
            title={
              hasScope
                ? "Draw a new area, replacing this one"
                : "Draw an area; the feeds narrow to what is inside it"
            }
          >
            <PolygonGlyph />
            <span>Area</span>
          </button>
          <button
            type="button"
            className="tnx-maprail-act tnx-maprail-act-icon"
            onClick={onRadius}
            aria-label="Restrict results to a radius"
            title={
              hasScope
                ? "Draw a new radius, replacing this area"
                : "Click a centre, then click to size the circle; the feeds narrow to what is inside it"
            }
          >
            <RadiusGlyph />
            <span>Radius</span>
          </button>
        </>
      )}

      {note ? (
        <span className="tnx-maprail-note" role="status" aria-live="polite">
          {note}
        </span>
      ) : null}
    </>
  );
}
