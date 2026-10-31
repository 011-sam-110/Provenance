// The words for a plane's line, in the plane's panel. Pure and held by a test
// (tests/unit/plane-full-history.test.ts) that bans "since take-off" and any claim to be
// complete: a line starts when our pull first heard the plane, and a stretch we hold no position
// for stays a gap. That is a receiver out of range, or the served sample leaving the plane out for
// a while, so the words do not name only one of them.

import type { StoredLineState } from "@/lib/planes/fullTrail";

/** A time of day in this browser's own zone. */
function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A plane's line, as words. */
export function lineWords(line: StoredLineState): string {
  if (line.status === "loading") return "Loading its line from when we first heard it.";
  if (line.status === "failed") return "Its stored line did not load. The line in this tab stays.";
  const from = line.from ?? line.track.firstHeardAt;
  if (from === null) return "We hold no line for it yet. Its line runs from when this tab first heard it.";
  const gaps = "Gaps are where we have no position for it.";
  return line.track.trimmed
    ? `Its line is the last 12 hours we heard, from ${clock(from)}. ${gaps}`
    : `Its line runs from when we first heard it, at ${clock(from)}. ${gaps}`;
}
