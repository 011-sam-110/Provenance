// The return flag. Can this browser tell a new visit from a return, without sending
// anything that says who the visitor is? PURE: no React, no window. Storage is injected
// so the node tests can drive it, like lib/shell/feedback.ts.
//
// WHAT IS KEPT: two local calendar dates, { first, last }, under tn.visit.v1.
// WHAT IS SENT: visit_kind (new | returning) and return_gap (a bucket). Never the dates.
// Every browser that came back within a week sends the same two words, so PostHog can
// count returns but cannot tell whose they are.
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

export function gapBucket(days: number): ReturnGap {
  if (days <= 0) return "same_day";
  if (days === 1) return "next_day";
  if (days <= 7) return "2_7d";
  if (days <= 30) return "8_30d";
  return "over_30d";
}

/** The whole decision. Anything that does not read as a sane record is a NEW visit and
 *  starts over; a corrupt record is never guessed at. */
export function classifyVisit(record: unknown, today: string): { visit: VisitClass; next: VisitRecord } {
  const fresh = { visit: { kind: "new" } as VisitClass, next: { first: today, last: today } };
  const t = dayNumber(today);
  if (t === null || !record || typeof record !== "object") return fresh;

  const { first, last } = record as Partial<Record<keyof VisitRecord, unknown>>;
  if (typeof first !== "string" || typeof last !== "string") return fresh;

  const f = dayNumber(first);
  const l = dayNumber(last);
  // first > last is corrupt; last > today means the clock moved back. Both start over.
  if (f === null || l === null || f > l || l > t) return fresh;
  if (t - f >= MAX_LIFETIME_DAYS) return fresh;

  return { visit: { kind: "returning", gap: gapBucket(t - l) }, next: { first, last: today } };
}

export function visitProperties(visit: VisitClass): VisitProperties {
  return visit.kind === "new"
    ? { visit_kind: "new", return_gap: "none" }
    : { visit_kind: "returning", return_gap: visit.gap };
}

/**
 * Classify this tab's visit once. `registered` is the tab's current `visit_kind` super
 * property. posthog-js keeps it in sessionStorage, so it survives a reload in the same
 * tab. When it is already set, this returns null and touches no storage. Otherwise a
 * reload would turn a new visit into returning/same_day.
 *
 * Call this only for a browser that may be counted: Beacon.tsx reaches it after
 * armedConfig() has passed.
 */
export function beginVisit(opts: { registered: unknown; now: Date; storage?: StorageLike }): VisitProperties | null {
  if (opts.registered === "new" || opts.registered === "returning") return null;
  const record = loadPersisted<unknown>(VISIT_KEY, VISIT_VERSION, opts.storage);
  const { visit, next } = classifyVisit(record, localDay(opts.now));
  savePersisted<VisitRecord>(VISIT_KEY, VISIT_VERSION, next, opts.storage);
  return visitProperties(visit);
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
