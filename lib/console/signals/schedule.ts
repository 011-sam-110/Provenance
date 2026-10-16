// Pure helpers for the SCHEDULE focus view (kind:"schedule") — countdown text and
// day bucketing for time-anchored feeds (rocket launches today). Deterministic:
// `now` is always passed in, day maths are done in UTC, and the one locale-formatted
// heading pins timeZone:"UTC" + a fixed locale so it never drifts with the runtime.
// No fabrication: a missing/invalid `ts` yields an honest "Unscheduled" state.

export type CountdownState = "past" | "imminent" | "soon" | "scheduled" | "unknown";

export interface Countdown {
  /** Short human label, e.g. "T- 2d 3h", "T- 18m", "in progress", "Unscheduled". */
  label: string;
  state: CountdownState;
  /** Signed ms from now to the scheduled time (negative = already elapsed); null if unknown. */
  ms: number | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Date precision (LL2 `net_precision`) lives beside the adapter that reads it, so
// lib/signals never imports from lib/console; the view re-exports it from here.
export { precisionRank, isVagueSchedule, netLabel } from "@/lib/signals/schedulePrecision";
import { isVagueSchedule, netLabel, precisionRank } from "@/lib/signals/schedulePrecision";

/** Time from `now` to a scheduled ISO time as a human countdown. */
export function countdown(ts: string | undefined | null, now: number, precision?: string | null): Countdown {
  if (!ts) return { label: "Unscheduled", state: "unknown", ms: null };
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return { label: "Unscheduled", state: "unknown", ms: null };
  // A date class has no countdown: "T- 76d 4h" to a Year placeholder is invented.
  if (isVagueSchedule(precision)) return { label: netLabel(ts, precision), state: "unknown", ms: null };
  const ms = t - now;
  if (ms <= 0) {
    // LL2 keeps a launch in "upcoming" through its window; treat the last 2h as live.
    if (ms > -2 * HOUR) return { label: "in progress", state: "imminent", ms };
    return { label: "launched", state: "past", ms };
  }
  const mins = Math.floor(ms / MIN);
  if (mins < 60) return { label: `T- ${mins}m`, state: mins <= 15 ? "imminent" : "soon", ms };
  const hrs = Math.floor(ms / HOUR);
  if (hrs < 24) return { label: `T- ${hrs}h ${Math.floor((ms % HOUR) / MIN)}m`, state: hrs < 6 ? "soon" : "scheduled", ms };
  const days = Math.floor(ms / DAY);
  return { label: `T- ${days}d ${Math.floor((ms % DAY) / HOUR)}h`, state: "scheduled", ms };
}

/** Whole-day offset (UTC) between a scheduled time and now: 0 today, 1 tomorrow, -1 yesterday. */
export function dayOffsetUTC(t: number, now: number): number {
  return Math.floor(t / DAY) - Math.floor(now / DAY);
}

/**
 * Day-group heading for a scheduled ISO time: Today / Tomorrow / Earlier / a UTC
 * date. A Day-precision row keeps its date heading (the date is known); anything
 * coarser is headed by its class ("NET Q4 2026"), never by LL2's placeholder date.
 */
export function scheduleHeading(ts: string | undefined | null, now: number, precision?: string | null): string {
  if (!ts) return "Unscheduled";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "Unscheduled";
  if (precisionRank(precision) > 2) return netLabel(ts, precision);
  const off = dayOffsetUTC(t, now);
  if (off < 0) return "Earlier";
  if (off === 0) return "Today";
  if (off === 1) return "Tomorrow";
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Absolute clock label for a row, e.g. "14:30 UTC". "" when the time is unknown or only a date class. */
export function scheduleClock(ts: string | undefined | null, precision?: string | null): string {
  if (!ts || isVagueSchedule(precision)) return "";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const hh = String(new Date(t).getUTCHours()).padStart(2, "0");
  const mm = String(new Date(t).getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
