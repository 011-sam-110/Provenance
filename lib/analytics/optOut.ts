// Who is not counted. PURE, apart from two small readers of the browser environment that
// fail closed to "unknown". Every rule here decides whether posthog-js is fetched at all:
// Beacon.tsx calls shouldCount() before either dynamic import, so a browser that is not
// counted loads nothing, sends nothing and stores nothing (other than its own objection).
//
// WHY AN OPT-OUT OF OUR OWN. UK PECR Schedule A1 para 5 (in force since 5 Feb 2026) exempts
// statistics storage only with "a simple means of objecting", and the ICO says you "must
// not solely rely on browser settings". Do Not Track alone is therefore not enough.
//
// WHY GERMANY. §25 TDDDG has no analytics exemption. On 2026-09-14 Sam chose not to load
// the beacon for a browser in a German time zone. It is a crude proxy, and deliberately so:
// it needs no request and no header, and it keeps every page cacheable.
//
// Spec: docs/superpowers/specs/2026-09-14-returning-visitors-design.md

import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { forgetVisit, type StorageLike } from "@/lib/analytics/returnFlag";

export const OPT_OUT_KEY = "tn.analytics.optout.v1";
export const OPT_OUT_VERSION = 1;

export const EXCLUDED_TIME_ZONES: readonly string[] = ["Europe/Berlin", "Europe/Busingen"];

export interface PrivacyNavigator {
  doNotTrack?: string | null;
  /** Not in TypeScript's DOM lib yet. */
  globalPrivacyControl?: boolean;
}

export interface CountingInput {
  configured: boolean;
  optedOut: boolean;
  signal: boolean;
  timeZone: string | undefined;
}

export type CountingState = "not_configured" | "signal" | "excluded_zone" | "opted_out" | "counted";

/** Do Not Track ("1", or "yes" in old Firefox) or Global Privacy Control. */
export function privacySignal(nav: PrivacyNavigator | undefined, win?: { doNotTrack?: string | null }): boolean {
  const dnt = nav?.doNotTrack ?? win?.doNotTrack;
  return dnt === "1" || dnt === "yes" || nav?.globalPrivacyControl === true;
}

export function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The reason this browser is or is not counted, in a fixed priority order. The /privacy
 *  control shows it, so a visitor is told WHY and not just WHETHER. */
export function countingState(i: CountingInput): CountingState {
  if (!i.configured) return "not_configured";
  if (i.signal) return "signal";
  if (i.timeZone !== undefined && EXCLUDED_TIME_ZONES.includes(i.timeZone)) return "excluded_zone";
  if (i.optedOut) return "opted_out";
  return "counted";
}

export function shouldCount(i: CountingInput): boolean {
  return countingState(i) === "counted";
}

export function isOptedOut(storage?: StorageLike): boolean {
  return loadPersisted<boolean>(OPT_OUT_KEY, OPT_OUT_VERSION, storage) === true;
}

/** Record the objection and delete the visit dates in the same step. */
export function optOut(storage?: StorageLike): void {
  savePersisted<boolean>(OPT_OUT_KEY, OPT_OUT_VERSION, true, storage);
  forgetVisit(storage);
}

export function optIn(storage?: StorageLike): void {
  try {
    const s = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    s?.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage blocked: nothing was stored */
  }
}
