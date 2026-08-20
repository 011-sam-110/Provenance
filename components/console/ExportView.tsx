"use client";
// "Can I export a report or a screenshot of what I'm looking at?" — the control
// that answers yes.
//
// It sits in the map control cluster rather than a menu because the thing it
// exports IS the map view: the scope, the moment and the feeds that were
// answering. Two separate actions, not one combined download, because they are
// used for different things — the image goes in a slide, the report goes in a
// document with its sources intact.
//
// The failure handling is the load-bearing part. A WebGL canvas that has already
// been composited reads back as a blank image with no error (see lib/map/capture),
// so the honest outcomes are: a file, or a message saying why there isn't one.
// A silently-empty PNG that downloads fine is the failure mode this product
// exists not to have.

import { useCallback, useEffect, useRef, useState } from "react";
import { captureMapPng, captureFilename, downloadBlob } from "@/lib/map/capture";
import { getMapInstance } from "@/lib/map/instance";
import { buildSitrep } from "@/lib/export/view";
import { downloadText } from "@/lib/export";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "note"; text: string };

/** Pure: the message for each capture failure. Distinct causes, distinct fixes. */
export function captureMessage(reason: string): string {
  switch (reason) {
    case "no-map":
      return "No map on the stage to capture.";
    case "no-canvas":
      return "The map has not finished drawing yet.";
    case "blank":
      return "The map returned an empty frame — try again once it has settled.";
    case "timeout":
      return "The map did not redraw in time.";
    default:
      return "The browser refused to read the map canvas.";
  }
}

export default function ExportView() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const note = useCallback((text: string) => {
    setStatus({ kind: "note", text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus({ kind: "idle" }), 4000);
  }, []);

  const onReport = useCallback(() => {
    try {
      const { filename, markdown } = buildSitrep();
      downloadText(filename, "text/markdown", markdown); // downloadText appends the charset
      note("Report saved.");
    } catch {
      note("Could not build the report.");
    }
  }, [note]);

  const onImage = useCallback(async () => {
    setStatus({ kind: "busy" });
    const at = Date.now();
    const result = await captureMapPng(getMapInstance());
    if (!result.ok) return note(captureMessage(result.reason));
    downloadBlob(captureFilename(at), result.blob);
    note(`Image saved (${result.width}x${result.height}).`);
  }, [note]);

  return (
    <div className="tn-export" role="group" aria-label="Export this view">
      <button
        type="button"
        className="tn-export-btn"
        onClick={onReport}
        title="Download a sourced report of what this view is showing"
      >
        Report
      </button>
      <button
        type="button"
        className="tn-export-btn"
        onClick={onImage}
        disabled={status.kind === "busy"}
        title="Download a PNG of the map as drawn right now"
      >
        {status.kind === "busy" ? "…" : "Image"}
      </button>
      {/* Announced politely so a screen-reader user learns the outcome; the
          visual note is the same string, so there is one truth, not two. */}
      <span className="tn-export-note" role="status" aria-live="polite">
        {status.kind === "note" ? status.text : ""}
      </span>
    </div>
  );
}
