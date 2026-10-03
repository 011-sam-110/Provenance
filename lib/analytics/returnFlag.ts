// The return flag. Can this browser tell a new visit from a return, without sending
// anything that says who the visitor is? PURE: no React, no window. Storage is injected
// so the node tests can drive it, like lib/shell/feedback.ts.
//
// WHAT IS KEPT: two local calendar dates, { first, last }, under tn.visit.v1.
// WHAT IS SENT: visit_kind (new | returning) and return_gap (a bucket), on every event of
// the tab. Once per browser per local day, one `visit` event. On the first visit of a
// calendar week, that event also carries cohort_week: the Monday of the week of `first`.
// `last` is never sent, and `first` is sent only as its week. Every browser that first came
// in the same week and came back after the same gap sends the same words, so PostHog can
// count returns, and say how many of one week's new browsers came back, but not whose.
//
// WHY AN EVENT AND NOT ONLY PROPERTIES. A property rides on every event of every tab, so
// counting browsers from it means guessing which tabs are one browser. Measured in PostHog
// on 2026-10-03: 96 of 2,513 tabs were used on two or more days, and a tab was classified
// once, so each of those returns was invisible. One event per browser per day is the unit
// itself. docs/analytics/retention-dashboard.md has the queries that count it.
//
// THE 13 MONTHS RUN FROM `first` AND A VISIT NEVER EXTENDS THEM. CNIL's
// audience-measurement exemption asks for that. localStorage has no expiry, so the cap
// is applied the next time the record is read: /privacy says "thrown away the next time
// you come", which is what this does, and must never say "deleted after 13 months".
//
// Spec: docs/superpowers/specs/2026-09-14-returning-visitors-design.md

import { loadPersisted, savePersisted } from "@/lib/shell/persist";

export const VISIT_KEY = "tn.visit.v1";
export const VISIT_VERSION = 1;
/** 13 months. /privacy states this figure, and a test pins it. */
export const MAX_LIFETIME_DAYS = 395;

export type ReturnGap = "same_day" | "next_day" | "2_7d" | "8_30d" | "over_30d";
export type VisitClass = { kind: "new" } | { kind: "returning"; gap: ReturnGap };
export interface VisitRecord {
  first: string;
  last: string;
}
/** A `type`, not an interface, so it is assignable to posthog-js's `Properties`. */
export type VisitProperties = { visit_kind: "new" | "returning"; return_gap: ReturnGap | "none" };
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The one event that counts a browser, once per local day. The dashboard reads it by this name. */
export const VISIT_EVENT = "visit";
/** A `type`, like VisitProperties. cohort_week is a Monday, YYYY-MM-DD, and is absent on
 *  every visit that is not the browser's first of a calendar week. */
export type VisitEventProperties = { cohort_week?: string };
export interface VisitStart {
  /** Registered on the tab, so each event the tab sends carries them. */
  properties: VisitProperties;
  /** What the `visit` event carries, or null when this browser was already counted today. */
  event: VisitEventProperties | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** The browser's own calendar date. "Came back the next day" means the visitor's day. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days since 1970-01-01, or null for anything that is not a real date. Built with
 *  Date.UTC from the parts, so a DST change cannot move a gap. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Round-trip check: rejects 2026-02-30, and years below 100 (which Date.UTC maps to 19xx).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / DAY_MS);
}

/** The Monday of the week a date is in, or null for anything that is not a real date. */
export function weekStart(date: string): string | null {
  const n = dayNumber(date);
  if (n === null) return null;
  // Day 0, 1970-01-01, was a Thursday, so n + 3 counts the days since a Monday.
  const monday = n - ((((n + 3) % 7) + 7) % 7);
  return new Date(monday * DAY_MS).toISOString().slice(0, 10);
}

export function gapBucket(days: number): ReturnGap {
  if (days <= 0) return "same_day";
  if (days === 1) return "next_day";
  if (days <= 7) return "2_7d";
  if (days <= 30) return "8_30d";
  return "over_30d";
}

/** A stored record with both dates real and in order, or null. */
function readRecord(record: unknown): (VisitRecord & { f: number; l: number }) | null {
  if (!record || typeof record !== "object") return null;
  const { first, last } = record as Partial<Record<keyof VisitRecord, unknown>>;
  if (typeof first !== "string" || typeof last !== "string") return null;
  const f = dayNumber(first);
  const l = dayNumber(last);
  // first > last is corrupt.
  if (f === null || l === null || f > l) return null;
  return { first, last, f, l };
}

/** The whole decision. Anything that does not read as a sane record is a NEW visit and
 *  starts over; a corrupt record is never guessed at.
 *
 *  cohortWeek is the week of the FIRST visit, and it is set only on a browser's first visit
 *  of a calendar week. So a count of visits that carry it is a count of browsers for that
 *  week, and no visit in between says which week the browser first came. */
export function classifyVisit(
  record: unknown,
  today: string,
): { visit: VisitClass; next: VisitRecord; cohortWeek: string | null } {
  const fresh = {
    visit: { kind: "new" } as VisitClass,
    next: { first: today, last: today },
    cohortWeek: weekStart(today),
  };
  const t = dayNumber(today);
  const r = readRecord(record);
  // last > today means the clock moved back. It starts over, like a corrupt record.
  if (t === null || !r || r.l > t) return fresh;
  if (t - r.f >= MAX_LIFETIME_DAYS) return fresh;

  return {
    visit: { kind: "returning", gap: gapBucket(t - r.l) },
    next: { first: r.first, last: today },
    cohortWeek: weekStart(r.last) === weekStart(today) ? null : weekStart(r.first),
  };
}

export function visitProperties(visit: VisitClass): VisitProperties {
  return visit.kind === "new"
    ? { visit_kind: "new", return_gap: "none" }
    : { visit_kind: "returning", return_gap: visit.gap };
}

/**
 * Classify this tab's visit, at most once per local day. Returns what to register on the
 * tab and what the `visit` event carries, or null when there is nothing to do.
 *
 * `registered` is the tab's current `visit_kind` super property. posthog-js keeps it in
 * sessionStorage, so it survives a reload in the same tab. A registered tab is left alone
 * for the rest of the day it was classified on, and no storage is touched. Otherwise a
 * reload would turn a new visit into returning/same_day.
 *
 * A REGISTERED TAB IS CLASSIFIED AGAIN WHEN THE DAY CHANGES. A console tab left open is
 * the most loyal visitor there is. Until 2026-10-04 it was classified once and stayed
 * "new" for as long as it lived. The stored `last` day is the test, so two tabs open across
 * midnight give one visit: the first one shown moves `last`, and the second finds today.
 *
 * A HIDDEN PAGE IS NOT A VISIT. A tab the browser restores in the background was loaded,
 * not looked at. Beacon.tsx calls this again when the page is shown.
 *
 * Call this only for a browser that may be counted: Beacon.tsx reaches it after
 * armedConfig() has passed.
 */
export function beginVisit(opts: {
  registered: unknown;
  now: Date;
  storage?: StorageLike;
  visible?: boolean;
}): VisitStart | null {
  if (opts.visible === false) return null;
  const today = localDay(opts.now);
  const record = loadPersisted<unknown>(VISIT_KEY, VISIT_VERSION, opts.storage);

  if (opts.registered === "new" || opts.registered === "returning") {
    const r = readRecord(record);
    const t = dayNumber(today);
    // Today, or a stored day ahead of the clock: a traveller who went west. Starting that
    // tab over would throw the first date away, so it waits for the clock to catch up.
    if (r && t !== null && r.l >= t) return null;
  }

  const { visit, next, cohortWeek } = classifyVisit(record, today);
  savePersisted<VisitRecord>(VISIT_KEY, VISIT_VERSION, next, opts.storage);
  // A second tab on a day this browser was already counted sends no event.
  const counted = visit.kind === "new" || visit.gap !== "same_day";
  return {
    properties: visitProperties(visit),
    event: counted ? (cohortWeek ? { cohort_week: cohortWeek } : {}) : null,
  };
}

/** Delete the visit dates. Used by the opt-out. */
export function forgetVisit(storage?: StorageLike): void {
  try {
    const s = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    s?.removeItem(VISIT_KEY);
  } catch {
    /* storage blocked: there is nothing stored to forget */
  }
}
