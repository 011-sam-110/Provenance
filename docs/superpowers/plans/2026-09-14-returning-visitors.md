# Returning Visitors and Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the PostHog beacon tell a new visit from a return, and count five named usage actions,
without sending any identifier. Also add an opt-out that works without browser settings.

**Architecture:**
- Three pure modules under `lib/analytics/`:
  - `returnFlag.ts`: two local dates and a gap bucket.
  - `optOut.ts`: one arming rule that covers opt-out, DNT, GPC and German time.
  - `track.ts`: enumerated usage events.
- `components/analytics/Beacon.tsx` routes every `import("posthog-js")` through the arming rule. In
  posthog-js's `loaded` callback it registers `visit_kind` and `return_gap` as session-scoped super
  properties.
- A small client control on /privacy sets the opt-out flag and reloads the page.

**Tech Stack:** Next.js 15 App Router, TypeScript, posthog-js 1.428.1, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-14-returning-visitors-design.md`. Read it first.

## Global Constraints

- **Worktree:** `C:\Users\sampo\Desktop\pv-wt\return-flag`, branch `feat/return-flag`. Never edit
  `C:\Users\sampo\Desktop\TrafficNerd-V2`, which has another branch checked out.
- **Storage keys, exact:** `tn.visit.v1` and `tn.analytics.optout.v1`. Both are written through
  `lib/shell/persist.ts` (envelope `{ v, d }`).
- **PostHog config:** `persistence` stays `"sessionStorage"`. Add `person_profiles: "identified_only"`.
  Never call `opt_out_capturing()`, because its marker can only be localStorage or a cookie.
- **Event properties are enumerated values only:** no free text, no coordinates, no camera or object
  ids, no area names.
- **German exclusion:** time zones `Europe/Berlin` and `Europe/Busingen` do not load the beacon (Sam,
  2026-09-14).
- **Lifetime:** `MAX_LIFETIME_DAYS = 395` (13 months), counted from `first`. Visits never extend it.
- **Tests:** vitest, node environment, files in `tests/unit/**/*.test.ts`. There is no React testing
  library and there are no component tests.
- **Copy:**
  - /privacy visible copy has no literal em or en dash characters (`tests/unit/privacy-page.test.ts`).
  - Write plain, short sentences.
  - Never write "World Monitor".
- **Git:**
  - Stage explicit paths only, never `git add -A`.
  - Commits carry solo attribution, with NO `Co-Authored-By` trailer (repo CLAUDE.md).
  - Write PR text as Sampo, in first person.
- **Gate:** `npx tsc --noEmit && npm test`. Do not run `next build` locally (about 1 GB of RAM is
  free). The build evidence is the `Vercel` commit status on the PR head.

---

### Task 1: The visit record (`lib/analytics/returnFlag.ts`)

**Files:**
- Create: `lib/analytics/returnFlag.ts`
- Test: `tests/unit/return-flag.test.ts`

**Interfaces:**
- Consumes: `loadPersisted`, `savePersisted` from `@/lib/shell/persist`.
- Produces:
  - `VISIT_KEY = "tn.visit.v1"`, `VISIT_VERSION = 1`, `MAX_LIFETIME_DAYS = 395`
  - `type ReturnGap = "same_day" | "next_day" | "2_7d" | "8_30d" | "over_30d"`
  - `type VisitClass = { kind: "new" } | { kind: "returning"; gap: ReturnGap }`
  - `interface VisitRecord { first: string; last: string }`
  - `type VisitProperties = { visit_kind: "new" | "returning"; return_gap: ReturnGap | "none" }`
  - `type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">`
  - `localDay(now: Date): string`
  - `dayNumber(date: string): number | null`
  - `gapBucket(days: number): ReturnGap`
  - `classifyVisit(record: unknown, today: string): { visit: VisitClass; next: VisitRecord }`
  - `visitProperties(visit: VisitClass): VisitProperties`
  - `beginVisit(opts: { registered: unknown; now: Date; storage?: StorageLike }): VisitProperties | null`
  - `forgetVisit(storage?: StorageLike): void`

- [ ] **Step 1: Install dependencies in the worktree**

The worktree has no `node_modules`. Its `package-lock.json` is byte-identical to the main
checkout's (sha1 `4743369a…`), and C: has about 105 GB free.

Run: `cd /c/Users/sampo/Desktop/pv-wt/return-flag && npm ci`
Expected: ends with `added N packages`, and exit code 0.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/return-flag.test.ts`:

```ts
// The return flag: can a browser tell a new visit from a return without sending
// anything that identifies it? These pin the bucket edges, the 13-month cap and the
// rule that a corrupt record is a new visit, never a crash and never a guess.

import { describe, it, expect } from "vitest";
import {
  beginVisit,
  classifyVisit,
  dayNumber,
  forgetVisit,
  gapBucket,
  localDay,
  MAX_LIFETIME_DAYS,
  VISIT_KEY,
  visitProperties,
} from "@/lib/analytics/returnFlag";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    map,
    writes,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const stored = (d: unknown) => JSON.stringify({ v: 1, d });

describe("gap buckets", () => {
  it.each([
    [0, "same_day"],
    [1, "next_day"],
    [2, "2_7d"],
    [7, "2_7d"],
    [8, "8_30d"],
    [30, "8_30d"],
    [31, "over_30d"],
    [400, "over_30d"],
  ] as const)("%i days is %s", (days, bucket) => {
    expect(gapBucket(days)).toBe(bucket);
  });
});

describe("day arithmetic", () => {
  it("counts across a year boundary", () => {
    expect(dayNumber("2027-01-01")! - dayNumber("2026-12-31")!).toBe(1);
  });

  it("counts across a leap day", () => {
    expect(dayNumber("2028-03-01")! - dayNumber("2028-02-28")!).toBe(2);
  });

  it("rejects dates that do not exist", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-9-14", "0099-01-01", "yesterday", ""]) {
      expect(dayNumber(bad), bad).toBeNull();
    }
  });

  it("uses the browser's local calendar day, not UTC", () => {
    expect(localDay(new Date(2026, 8, 14, 0, 5))).toBe("2026-09-14");
    expect(localDay(new Date(2026, 8, 14, 23, 55))).toBe("2026-09-14");
  });

  it("keeps the lifetime at 13 months, because /privacy says 13 months", () => {
    expect(MAX_LIFETIME_DAYS).toBe(395);
  });
});

describe("classifyVisit", () => {
  const today = "2026-09-14";
  const t = dayNumber(today)!;
  const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
  const fresh = { visit: { kind: "new" }, next: { first: today, last: today } };

  it("calls a browser with no record new, and starts the record today", () => {
    expect(classifyVisit(null, today)).toEqual(fresh);
  });

  it("calls a return returning, with the gap measured from the LAST visit", () => {
    expect(classifyVisit({ first: "2026-08-01", last: "2026-09-10" }, today)).toEqual({
      visit: { kind: "returning", gap: "2_7d" },
      next: { first: "2026-08-01", last: today },
    });
  });

  it("keeps the first date, so visits cannot extend the 13 months", () => {
    expect(classifyVisit({ first: "2026-01-01", last: "2026-09-13" }, today).next.first).toBe("2026-01-01");
  });

  it("still counts a return 394 days after the first visit", () => {
    const record = { first: iso(t - (MAX_LIFETIME_DAYS - 1)), last: iso(t - 1) };
    expect(classifyVisit(record, today).visit).toEqual({ kind: "returning", gap: "next_day" });
  });

  it("resets to new 395 days after the first visit, even after a visit yesterday", () => {
    const record = { first: iso(t - MAX_LIFETIME_DAYS), last: iso(t - 1) };
    expect(classifyVisit(record, today)).toEqual(fresh);
  });

  it.each([
    ["a bare string", "2026-09-10"],
    ["a missing last date", { first: "2026-09-10" }],
    ["numbers", { first: 1, last: 2 }],
    ["an impossible date", { first: "2026-02-30", last: "2026-09-10" }],
    ["first after last", { first: "2026-09-12", last: "2026-09-10" }],
    ["a last visit in the future", { first: "2026-09-10", last: "2026-09-20" }],
  ])("resets %s to new", (_label, record) => {
    expect(classifyVisit(record, today)).toEqual(fresh);
  });
});

describe("beginVisit", () => {
  const now = new Date(2026, 8, 14, 12, 0);

  it("classifies, saves the next record and returns the properties to register", () => {
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({
      visit_kind: "returning",
      return_gap: "next_day",
    });
    expect(JSON.parse(s.map.get(VISIT_KEY)!)).toEqual({ v: 1, d: { first: "2026-09-01", last: "2026-09-14" } });
  });

  it("does not touch storage when this tab already registered a class", () => {
    // Without this, a reload in the same tab would turn a new visit into returning/same_day.
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-14" }) });
    expect(beginVisit({ registered: "new", now, storage: s })).toBeNull();
    expect(beginVisit({ registered: "returning", now, storage: s })).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it("treats an old envelope version as no record", () => {
    const s = memoryStorage({ [VISIT_KEY]: JSON.stringify({ v: 0, d: { first: "2026-09-01", last: "2026-09-13" } }) });
    expect(beginVisit({ registered: undefined, now, storage: s })).toEqual({ visit_kind: "new", return_gap: "none" });
  });

  it("sends none as the gap of a new visit, so a breakdown has no blank bucket", () => {
    expect(visitProperties({ kind: "new" })).toEqual({ visit_kind: "new", return_gap: "none" });
  });

  it("forgetVisit deletes the record", () => {
    const s = memoryStorage({ [VISIT_KEY]: stored({ first: "2026-09-01", last: "2026-09-13" }) });
    forgetVisit(s);
    expect(s.map.has(VISIT_KEY)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/return-flag.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/analytics/returnFlag"`.

- [ ] **Step 4: Write the implementation**

Create `lib/analytics/returnFlag.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/return-flag.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/returnFlag.ts tests/unit/return-flag.test.ts
git commit -m "Add the return flag: two local dates, a gap bucket, a 13-month cap"
```

---

### Task 2: The arming rule and the opt-out (`lib/analytics/optOut.ts`)

**Files:**
- Create: `lib/analytics/optOut.ts`
- Test: `tests/unit/analytics-opt-out.test.ts`

**Interfaces:**
- Consumes: `forgetVisit`, `type StorageLike` from `@/lib/analytics/returnFlag`, and
  `loadPersisted`/`savePersisted` from `@/lib/shell/persist`.
- Produces:
  - `OPT_OUT_KEY = "tn.analytics.optout.v1"`, `OPT_OUT_VERSION = 1`
  - `EXCLUDED_TIME_ZONES: readonly string[]`
  - `interface PrivacyNavigator { doNotTrack?: string | null; globalPrivacyControl?: boolean }`
  - `interface CountingInput { configured: boolean; optedOut: boolean; signal: boolean; timeZone: string | undefined }`
  - `type CountingState = "not_configured" | "signal" | "excluded_zone" | "opted_out" | "counted"`
  - `privacySignal(nav: PrivacyNavigator | undefined, win?: { doNotTrack?: string | null }): boolean`
  - `currentTimeZone(): string | undefined`
  - `countingState(i: CountingInput): CountingState`
  - `shouldCount(i: CountingInput): boolean`
  - `isOptedOut(storage?: StorageLike): boolean`
  - `optOut(storage?: StorageLike): void`
  - `optIn(storage?: StorageLike): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics-opt-out.test.ts`:

```ts
// Who is NOT counted. UK PECR Schedule A1 asks for a simple, free way to object that does
// not rely only on browser settings, and Sam chose on 2026-09-14 not to load the beacon
// in German time zones. Every rule here decides whether posthog-js is even fetched.

import { describe, it, expect } from "vitest";
import {
  countingState,
  isOptedOut,
  optIn,
  optOut,
  OPT_OUT_KEY,
  privacySignal,
  shouldCount,
} from "@/lib/analytics/optOut";
import { VISIT_KEY } from "@/lib/analytics/returnFlag";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const base = { configured: true, optedOut: false, signal: false, timeZone: "Europe/London" };

describe("browser privacy signals", () => {
  it("reads Do Not Track as 1 or yes, from navigator or window", () => {
    expect(privacySignal({ doNotTrack: "1" })).toBe(true);
    expect(privacySignal({ doNotTrack: "yes" })).toBe(true);
    expect(privacySignal({ doNotTrack: null }, { doNotTrack: "1" })).toBe(true);
    expect(privacySignal({ doNotTrack: "0" })).toBe(false);
    expect(privacySignal({ doNotTrack: null })).toBe(false);
  });

  it("reads Global Privacy Control", () => {
    expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignal({ globalPrivacyControl: false })).toBe(false);
  });

  it("is false with no navigator at all", () => {
    expect(privacySignal(undefined)).toBe(false);
  });
});

describe("shouldCount", () => {
  it("counts a configured browser that has not objected", () => {
    expect(shouldCount(base)).toBe(true);
  });

  it("does not count without a key, after an opt-out, or with a browser signal", () => {
    expect(shouldCount({ ...base, configured: false })).toBe(false);
    expect(shouldCount({ ...base, optedOut: true })).toBe(false);
    expect(shouldCount({ ...base, signal: true })).toBe(false);
  });

  it.each(["Europe/Berlin", "Europe/Busingen"])("does not count a browser set to %s", (timeZone) => {
    expect(shouldCount({ ...base, timeZone })).toBe(false);
  });

  it.each(["Europe/Vienna", "Europe/Zurich", undefined])("counts a browser set to %s", (timeZone) => {
    // An unreadable time zone must not block counting on its own.
    expect(shouldCount({ ...base, timeZone })).toBe(true);
  });
});

describe("countingState", () => {
  it("names the reason in a fixed priority order", () => {
    expect(countingState({ ...base, configured: false })).toBe("not_configured");
    expect(countingState({ ...base, signal: true, optedOut: true })).toBe("signal");
    expect(countingState({ ...base, timeZone: "Europe/Berlin", optedOut: true })).toBe("excluded_zone");
    expect(countingState({ ...base, optedOut: true })).toBe("opted_out");
    expect(countingState(base)).toBe("counted");
  });
});

describe("the opt-out", () => {
  it("records the choice and deletes the visit dates", () => {
    const s = memoryStorage({ [VISIT_KEY]: JSON.stringify({ v: 1, d: { first: "2026-09-01", last: "2026-09-13" } }) });
    optOut(s);
    expect(isOptedOut(s)).toBe(true);
    expect(s.map.has(VISIT_KEY)).toBe(false);
  });

  it("can be undone", () => {
    const s = memoryStorage();
    optOut(s);
    optIn(s);
    expect(isOptedOut(s)).toBe(false);
    expect(s.map.has(OPT_OUT_KEY)).toBe(false);
  });

  it("reads a damaged value as not opted out instead of throwing", () => {
    expect(isOptedOut(memoryStorage({ [OPT_OUT_KEY]: "{bad" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/analytics-opt-out.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/analytics/optOut"`.

- [ ] **Step 3: Write the implementation**

Create `lib/analytics/optOut.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/analytics-opt-out.test.ts tests/unit/return-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/optOut.ts tests/unit/analytics-opt-out.test.ts
git commit -m "Add the counting rule: opt-out, Do Not Track, GPC and German time zones"
```

---

### Task 3: Usage events (`lib/analytics/track.ts`)

**Files:**
- Create: `lib/analytics/track.ts`
- Test: `tests/unit/usage-events.test.ts`

**Interfaces:**
- Consumes: `type WorldObjectKind` from `@/lib/world` (type-only import).
- Produces:
  - ```ts
    type UsageEvent =
      | { name: "object_opened"; kind: WorldObjectKind }
      | { name: "board_switched"; board: string }
      | { name: "layer_toggled"; layer: string }
      | { name: "share_link_copied"; what: "view" | "layout" }
      | { name: "alert_armed" }
    ```
  - `interface BeaconClient { capture(event: string, properties?: Record<string, string>): unknown }`
  - `eventProperties(e: UsageEvent): Record<string, string> | null`
  - `bindBeacon(next: BeaconClient | null): void`
  - `track(e: UsageEvent): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/usage-events.test.ts`:

```ts
// The usage events. The privacy promise is that each one carries an enumerated value and
// never a place, a name or anything typed. These tests pin the allowlist per event and
// the slug rule that turns free text into a dropped event instead of a sent one.

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindBeacon, eventProperties, track, type UsageEvent } from "@/lib/analytics/track";

afterEach(() => bindBeacon(null));

const ALLOWED: Record<UsageEvent["name"], string[]> = {
  object_opened: ["kind"],
  board_switched: ["board"],
  layer_toggled: ["layer"],
  share_link_copied: ["what"],
  alert_armed: [],
};

const SAMPLES: UsageEvent[] = [
  { name: "object_opened", kind: "camera" },
  { name: "board_switched", board: "streets" },
  { name: "board_switched", board: "custom" },
  { name: "layer_toggled", layer: "cable-landings" },
  { name: "share_link_copied", what: "view" },
  { name: "alert_armed" },
];

describe("usage event properties", () => {
  it.each(SAMPLES)("$name sends only its allowlisted keys", (e) => {
    const props = eventProperties(e);
    expect(props).not.toBeNull();
    expect(Object.keys(props!).sort()).toEqual([...ALLOWED[e.name]].sort());
  });

  it("drops anything that is not a short slug, so free text cannot ride along", () => {
    expect(eventProperties({ name: "layer_toggled", layer: "My house at 51.5,-0.1" })).toBeNull();
    expect(eventProperties({ name: "board_switched", board: "my secret board" })).toBeNull();
    expect(eventProperties({ name: "layer_toggled", layer: "a".repeat(41) })).toBeNull();
  });

  it("drops an object kind the world model does not have", () => {
    expect(eventProperties({ name: "object_opened", kind: "toString" as never })).toBeNull();
  });

  it("drops a share kind outside view and layout", () => {
    expect(eventProperties({ name: "share_link_copied", what: "email" as never })).toBeNull();
  });
});

describe("track", () => {
  it("does nothing before the beacon binds", () => {
    expect(() => track({ name: "alert_armed" })).not.toThrow();
  });

  it("captures through the bound client", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    track({ name: "object_opened", kind: "plane" });
    expect(capture).toHaveBeenCalledWith("object_opened", { kind: "plane" });
  });

  it("does not capture a dropped event", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    track({ name: "layer_toggled", layer: "Not A Slug" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("stops when unbound", () => {
    const capture = vi.fn();
    bindBeacon({ capture });
    bindBeacon(null);
    track({ name: "alert_armed" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("never lets a failing client break the app", () => {
    bindBeacon({
      capture: () => {
        throw new Error("blocked");
      },
    });
    expect(() => track({ name: "alert_armed" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/usage-events.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/analytics/track"`.

- [ ] **Step 3: Write the implementation**

Create `lib/analytics/track.ts`:

```ts
// Named usage events for the analytics beacon. PURE and dependency-free: it imports
// nothing from posthog-js, so a call site in a store or a component never pulls the
// library into the main bundle. Beacon.tsx binds the client once PostHog has loaded.
// Until then, and for every browser that is not counted, track() does nothing.
//
// ENUMERATED VALUES ONLY. No free text, no coordinates, no camera or object ids, no area
// names. /privacy says each action is "recorded with the type of thing, never with a place,
// a name or anything you typed". eventProperties() is where that sentence is made true.
// The signal registry is NOT imported to validate layer ids: that would put every adapter
// in the client bundle (see CLAUDE.md). A short-slug rule does the same job for privacy.
//
// Spec: docs/superpowers/specs/2026-09-14-returning-visitors-design.md

import type { WorldObjectKind } from "@/lib/world";

export type UsageEvent =
  | { name: "object_opened"; kind: WorldObjectKind }
  | { name: "board_switched"; board: string }
  | { name: "layer_toggled"; layer: string }
  | { name: "share_link_copied"; what: "view" | "layout" }
  | { name: "alert_armed" };

export interface BeaconClient {
  capture(event: string, properties?: Record<string, string>): unknown;
}

/** A Record, not a Set, so adding a WorldObjectKind is a compile error until it is listed. */
const OBJECT_KINDS: Record<WorldObjectKind, true> = {
  camera: true,
  satellite: true,
  plane: true,
  webcam: true,
  signal: true,
  country: true,
  area: true,
};

/** Preset ids, layer keys and signal ids are all lowercase slugs. Anything else is dropped. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The properties an event may send, or null when it must not be sent at all. */
export function eventProperties(e: UsageEvent): Record<string, string> | null {
  switch (e.name) {
    case "object_opened":
      return Object.prototype.hasOwnProperty.call(OBJECT_KINDS, e.kind) ? { kind: e.kind } : null;
    case "board_switched":
      return SLUG.test(e.board) ? { board: e.board } : null;
    case "layer_toggled":
      return SLUG.test(e.layer) ? { layer: e.layer } : null;
    case "share_link_copied":
      return e.what === "view" || e.what === "layout" ? { what: e.what } : null;
    case "alert_armed":
      return {};
  }
}

let client: BeaconClient | null = null;

export function bindBeacon(next: BeaconClient | null): void {
  client = next;
}

export function track(e: UsageEvent): void {
  if (!client) return;
  const props = eventProperties(e);
  if (!props) return;
  try {
    client.capture(e.name, props);
  } catch {
    /* Analytics must never break the product. */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/usage-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/track.ts tests/unit/usage-events.test.ts
git commit -m "Add five enumerated usage events behind a no-op-until-bound tracker"
```

---

### Task 4: Wire the beacon

**Files:**
- Modify: `components/analytics/Beacon.tsx` (whole file below)
- Modify: `lib/analytics/beacon.ts:59-100`
- Test: `tests/unit/beacon-config.test.ts`

**Interfaces:**
- Consumes: `beginVisit` (Task 1). `currentTimeZone`, `isOptedOut`, `privacySignal`, `shouldCount`
  (Task 2). `bindBeacon` (Task 3).
- Produces: `beaconOptions(config)` now also returns `person_profiles: "identified_only"`, and
  `armedConfig()` is private to `Beacon.tsx`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/beacon-config.test.ts`, rename the first test inside
`describe("beacon options pin what privacy promises", ...)`:

```ts
  it("keeps PostHog's own identifier inside the tab, so it sets no cookie", () => {
```

(It was `"stores nothing that outlives the tab, so it sets no cookie"`. The return flag now outlives the
tab, so that name would be false.)

Add inside the same describe, after the `respect_dnt` test:

```ts
  it("builds no person profiles, because nothing here ever identifies a visitor", () => {
    // identified_only is PostHog's default, pinned anyway: "always" would build a profile
    // per anonymous tab, which is the individual-level record the ICO guidance warns about.
    expect(options.person_profiles).toBe("identified_only");
  });
```

Add a new describe at the end of the file:

```ts
describe("a browser that is not counted never loads the library", () => {
  // The opt-out, Do Not Track, GPC and the German time zone all work by stopping the
  // dynamic import, not by asking posthog-js to hold back. That is only true if EVERY
  // import passes the gate, so this reads the component and counts.
  const src = readFileSync(join(ROOT, "components", "analytics", "Beacon.tsx"), "utf8").replace(/\/\/.*$/gm, "");

  it("gates every posthog-js import behind armedConfig()", () => {
    const imports = src.match(/import\("posthog-js"\)/g) ?? [];
    const gates = src.match(/const config = armedConfig\(\);\s*if \(!config\) return;/g) ?? [];
    expect(imports.length).toBe(2);
    expect(gates.length).toBe(imports.length);
  });

  it("reads beaconConfig() in one place only, inside armedConfig()", () => {
    expect(src.match(/beaconConfig\(\)/g) ?? []).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beacon-config.test.ts`
Expected: FAIL. `person_profiles` is `undefined`, `gates.length` is 0 against 2, and the
`beaconConfig()` count is 2.

- [ ] **Step 3: Update `lib/analytics/beacon.ts`**

Replace:
```ts
 *                     are real, and nothing links one visit to the next.
```
with:
```ts
 *                     are real, and this identifier links nothing across visits. The one
 *                     deliberate exception is the return flag (lib/analytics/returnFlag.ts),
 *                     which keeps two dates on the device and sends no identifier.
```

Replace:
```ts
 * So: no cookies, nothing that survives the tab, and metrics that mean something.
```
with:
```ts
 * So: no cookies, no identifier that survives the tab, and metrics that mean something.
```

Replace:
```ts
    // Honour Do Not Track. Costs some coverage; the log still counts the request.
    respect_dnt: true,
  };
```
with:
```ts
    // Honour Do Not Track. Costs some coverage; the log still counts the request.
    // A second layer only: Beacon.tsx already refuses to load the library for DNT or GPC.
    respect_dnt: true,
    // No person profiles. Nothing here calls identify(), and "always" would build a
    // profile per anonymous tab. Pinned by tests/unit/beacon-config.test.ts.
    person_profiles: "identified_only" as const,
  };
```

- [ ] **Step 4: Rewrite `components/analytics/Beacon.tsx`**

Replace the whole file with:

```tsx
"use client";

// The client-side analytics beacon. Renders nothing.
//
// Mounted once in app/layout.tsx. With NEXT_PUBLIC_POSTHOG_KEY unset this component
// short-circuits before the dynamic import, so posthog-js is never fetched, never
// parsed and never runs — a self-hoster with no key pays nothing for it, and the
// network tab shows no third-party request at all.
//
// WHO IS NOT COUNTED. armedConfig() is the only way to reach posthog-js. It applies
// shouldCount() from lib/analytics/optOut.ts: the /privacy opt-out, Do Not Track,
// Global Privacy Control and a German time zone. Each one stops the IMPORT, so that
// browser loads nothing, sends nothing and gets no visit dates written.
// tests/unit/beacon-config.test.ts fails if an import skips the gate.
//
// See lib/analytics/beacon.ts for WHY this exists alongside the access log and why
// persistence is session-scoped rather than absent, and lib/analytics/returnFlag.ts for
// the one thing that does outlive the tab.

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { beaconConfig, beaconOptions, type BeaconConfig } from "@/lib/analytics/beacon";
import { currentTimeZone, isOptedOut, privacySignal, shouldCount } from "@/lib/analytics/optOut";
import { beginVisit } from "@/lib/analytics/returnFlag";
import { bindBeacon } from "@/lib/analytics/track";

/** The beacon config when THIS browser may be counted, otherwise null. */
function armedConfig(): BeaconConfig | null {
  const config = beaconConfig();
  if (!config) return null;
  const counted = shouldCount({
    configured: true,
    optedOut: isOptedOut(),
    signal: privacySignal(navigator, window as Window & { doNotTrack?: string | null }),
    timeZone: currentTimeZone(),
  });
  return counted ? config : null;
}

export function Beacon(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Init once. The empty dependency list is deliberate: posthog-js installs its own
  // listeners and re-initialising on navigation would double-count.
  useEffect(() => {
    const config = armedConfig();
    if (!config) return;

    let cancelled = false;
    // Dynamic import so the library lands in its own chunk, fetched only when a key is
    // present. A static import would put it in the main bundle for every visitor of
    // every deployment, configured or not.
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(config.key, {
        ...beaconOptions(config),
        // posthog-js 1.428.1 calls `loaded` synchronously inside init and schedules the
        // first $pageview with setTimeout(..., 1) after it (dist/module.js). So what is
        // registered here rides on that first view. An upgrade could change the order:
        // the post-deploy check looks for visit_kind on the FIRST $pageview.
        loaded: (ph) => {
          bindBeacon(ph);
          const props = beginVisit({ registered: ph.get_property("visit_kind"), now: new Date() });
          if (props) ph.register(props);
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // App Router does not fire a page load between client-side navigations, so
  // capture_pageview alone would record the FIRST page of a visit and nothing after.
  // On a site whose whole point is moving between the console and camera pages, that
  // would make every session look one page long — which is the same failure as getting
  // bounce rate wrong, arriving by a different route.
  useEffect(() => {
    if (!pathname) return;
    const config = armedConfig();
    if (!config) return;

    void import("posthog-js").then(({ default: posthog }) => {
      // __loaded is posthog-js's own "init has finished" flag. On the very first render
      // this effect can run before the init effect's promise resolves; capturing then
      // would throw away the event, so skip it — init's own capture_pageview covers
      // that first view.
      if (!posthog.__loaded) return;
      posthog.capture("$pageview");
    });
    // searchParams is included because /app encodes console state in the query string,
    // so a query-only change is a real navigation here, not a no-op.
  }, [pathname, searchParams]);

  return null;
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run tests/unit/beacon-config.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0. If tsc rejects `bindBeacon(ph)`, change the `BeaconClient.capture`
parameter in `lib/analytics/track.ts` to `properties?: Record<string, string> | null` and re-run
tsc. That signature is still assignable from posthog-js.

- [ ] **Step 6: Prove the gate guard goes red**

Temporarily change the second effect's `const config = armedConfig();` to
`const config = beaconConfig();`.
Run: `npx vitest run tests/unit/beacon-config.test.ts`
Expected: FAIL in "gates every posthog-js import behind armedConfig()".
Revert the change and re-run. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/analytics/Beacon.tsx lib/analytics/beacon.ts tests/unit/beacon-config.test.ts
git commit -m "Gate the beacon on the counting rule and register the visit class on load"
```

---

### Task 5: Call sites for the usage events

**Files:**
- Modify: `lib/overlay.ts:25-29`
- Modify: `lib/console/presets.ts:632-658` (`applyPreset`)
- Modify: `components/shell/ConsoleShell.tsx:146-147`
- Modify: `components/shell/SourceCatalog.tsx:308-311`
- Modify: `components/shell/CommandPalette.tsx:176-179` and `:221`
- Modify: `components/shell/FreshnessTicker.tsx:47`
- Modify: `components/shell/settings/DisplayTab.tsx:32` and `:40`
- Modify: `lib/share/deepLink.ts:85-86` and `:100`
- Modify: `components/shell/inspector/RulesPanel.tsx:96`
- Test: `tests/unit/usage-call-sites.test.ts`

**Interfaces:**
- Consumes: `track`, `bindBeacon` (Task 3).
- Produces: `applyPreset(presetId: string, opts: { reset?: boolean; track?: boolean } = {}): void`.
  `track: false` suppresses `board_switched`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/usage-call-sites.test.ts`:

```ts
// Where the usage events fire. The two in lib/ are exercised for real. The five in
// components are pinned by reading the source, because this repo has no component tests.
// The boot guard is the one that matters most: without it, every console load would
// count as a board switch and "boards switched per visit" would start at 1.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// persist.ts no-ops without `window`, which would make the preset tests vacuous
// (same reasoning as tests/unit/console-boards.test.ts).
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
  };
}

beforeEach(() => {
  installStorage();
  vi.resetModules();
});

async function boundCapture() {
  const { bindBeacon } = await import("@/lib/analytics/track");
  const capture = vi.fn();
  bindBeacon({ capture });
  return capture;
}

const named = (capture: ReturnType<typeof vi.fn>, name: string) => capture.mock.calls.filter(([n]) => n === name);

describe("object_opened", () => {
  it("fires on overlay.open with the object's kind and nothing else", async () => {
    const capture = await boundCapture();
    const { overlay } = await import("@/lib/overlay");
    overlay.open({ kind: "camera", id: "tfl:123", title: "Somewhere" } as never);
    expect(named(capture, "object_opened")).toEqual([["object_opened", { kind: "camera" }]]);
  });
});

describe("board_switched", () => {
  it("fires when the user moves to another board", async () => {
    const capture = await boundCapture();
    const { applyPreset } = await import("@/lib/console/presets");
    applyPreset("overview", { track: false });
    applyPreset("streets");
    expect(named(capture, "board_switched")).toEqual([["board_switched", { board: "streets" }]]);
  });

  it("does not fire for track: false, for the active board, or for a reset", async () => {
    const capture = await boundCapture();
    const { applyPreset, resetActiveBoard } = await import("@/lib/console/presets");
    applyPreset("streets", { track: false });
    applyPreset("streets");
    resetActiveBoard();
    expect(named(capture, "board_switched")).toEqual([]);
  });

  it("passes track: false on both of ConsoleShell's boot calls", () => {
    const src = readFileSync("components/shell/ConsoleShell.tsx", "utf8").replace(/\/\/.*$/gm, "");
    const calls = [...src.matchAll(/applyPreset\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toHaveLength(2);
    for (const args of calls) expect(args, args).toContain("track: false");
  });
});

describe("component call sites", () => {
  it.each([
    ["components/shell/SourceCatalog.tsx", "layer_toggled"],
    ["components/shell/CommandPalette.tsx", "layer_toggled"],
    ["components/shell/FreshnessTicker.tsx", "layer_toggled"],
    ["components/shell/CommandPalette.tsx", "share_link_copied"],
    ["components/shell/settings/DisplayTab.tsx", "share_link_copied"],
    ["lib/share/deepLink.ts", "share_link_copied"],
    ["components/shell/inspector/RulesPanel.tsx", "alert_armed"],
  ])("%s tracks %s", (file, name) => {
    expect(readFileSync(file, "utf8")).toContain(`name: "${name}"`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/usage-call-sites.test.ts`
Expected: FAIL. `object_opened` and `board_switched` have no calls, the ConsoleShell args lack
`track: false`, and all 7 source checks fail.

- [ ] **Step 3: `lib/overlay.ts`**

After `import type { WorldObject } from "./world";`, add:
```ts
import { track } from "@/lib/analytics/track";
```
Replace:
```ts
  open(object: WorldObject) {
    state = { object };
    emit();
  },
```
with:
```ts
  open(object: WorldObject) {
    state = { object };
    emit();
    // One site covers every opener: map clicks, search, widgets and a restored share link
    // (opening the link was the user's action). Only the kind is sent, never the object.
    track({ name: "object_opened", kind: object.kind });
  },
```

- [ ] **Step 4: `lib/console/presets.ts`**

After `import { ringFromCircle, type CircleSpec } from "@/lib/map/circle";`, add:
```ts
import { track } from "@/lib/analytics/track";
```
Replace:
```ts
export function applyPreset(presetId: string, opts: { reset?: boolean } = {}): void {
```
with:
```ts
export function applyPreset(presetId: string, opts: { reset?: boolean; track?: boolean } = {}): void {
```
Replace:
```ts
  layersStore.applyWorld(core);
  signalsStore.applyWorld(signals);
}
```
(the end of `applyPreset`, directly above the `Throw away a board's edits` doc comment) with:
```ts
  layersStore.applyWorld(core);
  signalsStore.applyWorld(signals);
  // A SWITCH, made by a person. Boot passes track: false, a reset is not a switch, and
  // re-selecting the board already open changes nothing. A custom board's id never leaves
  // the browser: it is sent as "custom".
  if (opts.track !== false && !opts.reset && outgoing !== presetId) {
    track({ name: "board_switched", board: built ? presetId : "custom" });
  }
}
```

- [ ] **Step 5: `components/shell/ConsoleShell.tsx`**

Replace:
```ts
    else if (presetParam && presetById(presetParam)) applyPreset(presetParam);
    else if (shellLayoutStore.get().widgets.length === 0) applyPreset(DEFAULT_PRESET_ID); // first-run seed
```
with:
```ts
    else if (presetParam && presetById(presetParam)) applyPreset(presetParam, { track: false });
    else if (shellLayoutStore.get().widgets.length === 0) applyPreset(DEFAULT_PRESET_ID, { track: false }); // first-run seed
```

- [ ] **Step 6: Layer toggles**

`components/shell/SourceCatalog.tsx`: add `import { track } from "@/lib/analytics/track";` after the
`@/lib/signals/store` import. Then replace:
```ts
  const onToggle = (id: string): void => {
    if (id in layers) layersStore.toggle(id as LayerKey);
    else signalsStore.toggle(id);
  };
```
with:
```ts
  const onToggle = (id: string): void => {
    if (id in layers) layersStore.toggle(id as LayerKey);
    else signalsStore.toggle(id);
    track({ name: "layer_toggled", layer: id });
  };
```

`components/shell/CommandPalette.tsx`: add `import { track } from "@/lib/analytics/track";` after the
`@/lib/console/activePreset` import. Then replace:
```ts
      run: () => {
        layersStore.toggle(k);
        close();
      },
```
with:
```ts
      run: () => {
        layersStore.toggle(k);
        track({ name: "layer_toggled", layer: k });
        close();
      },
```

`components/shell/FreshnessTicker.tsx`: add `import { track } from "@/lib/analytics/track";` after the
`@/lib/shell/useNow` import. Then replace:
```tsx
              onClick={() => layersStore.toggle(layerKey)}
```
with:
```tsx
              onClick={() => {
                layersStore.toggle(layerKey);
                track({ name: "layer_toggled", layer: layerKey });
              }}
```

- [ ] **Step 7: Share links and alerts**

`components/shell/CommandPalette.tsx`: in the `share-layout` command, replace
`navigator.clipboard?.writeText(url); close();` with:
```ts
void navigator.clipboard?.writeText(url).then(() => track({ name: "share_link_copied", what: "layout" }), () => {}); close();
```

`components/shell/settings/DisplayTab.tsx`: add `import { track } from "@/lib/analytics/track";` after
the `@/lib/console/activePreset` import. In `copyLayoutLink`, replace:
```ts
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return true; }
```
with:
```ts
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); track({ name: "share_link_copied", what: "layout" }); return true; }
```
and replace, inside the same function:
```ts
    return ok;
  } catch { return false; }
}
```
with:
```ts
    if (ok) track({ name: "share_link_copied", what: "layout" });
    return ok;
  } catch { return false; }
}
```

`lib/share/deepLink.ts`: add `import { track } from "@/lib/analytics/track";` below the file's
existing imports. In `copyShareLink`, replace:
```ts
      await navigator.clipboard.writeText(url);
      return true;
```
with:
```ts
      await navigator.clipboard.writeText(url);
      track({ name: "share_link_copied", what: "view" });
      return true;
```
and replace:
```ts
    document.body.removeChild(ta);
    return ok;
```
with:
```ts
    document.body.removeChild(ta);
    if (ok) track({ name: "share_link_copied", what: "view" });
    return ok;
```

`components/shell/inspector/RulesPanel.tsx`: add `import { track } from "@/lib/analytics/track";`
after the `@/lib/notify/sources` import. Then replace:
```ts
    rulesStore.add(rule);
  };
```
with:
```ts
    rulesStore.add(rule);
    // No area, radius or source: only that an alert was armed.
    track({ name: "alert_armed" });
  };
```

- [ ] **Step 8: Run the tests and the type check**

Run: `npx vitest run tests/unit/usage-call-sites.test.ts tests/unit/console-boards.test.ts tests/unit/preset-layers.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 9: Prove the boot guard goes red**

Temporarily remove `, { track: false }` from the first-run seed call in `ConsoleShell.tsx`.
Run: `npx vitest run tests/unit/usage-call-sites.test.ts`
Expected: FAIL in "passes track: false on both of ConsoleShell's boot calls". Restore it and re-run.
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/overlay.ts lib/console/presets.ts components/shell/ConsoleShell.tsx components/shell/SourceCatalog.tsx components/shell/CommandPalette.tsx components/shell/FreshnessTicker.tsx components/shell/settings/DisplayTab.tsx lib/share/deepLink.ts components/shell/inspector/RulesPanel.tsx tests/unit/usage-call-sites.test.ts
git commit -m "Fire the usage events at user actions, not at boot or store updates"
```

---

### Task 6: The /privacy opt-out and the wording

**Files:**
- Create: `components/analytics/CountingToggle.tsx`
- Modify: `app/provenance.css` (append)
- Modify: `app/(site)/privacy/page.tsx` (lines cited per step)
- Test: `tests/unit/privacy-page.test.ts`

**Interfaces:**
- Consumes: `beaconConfig` (existing). `countingState`, `currentTimeZone`, `isOptedOut`, `optIn`,
  `optOut`, `privacySignal`, `type CountingState`, `OPT_OUT_KEY` (Task 2). `VISIT_KEY` (Task 1).
- Produces: `export function CountingToggle(): JSX.Element | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/privacy-page.test.ts`, add after the existing imports:
```ts
import { VISIT_KEY } from "@/lib/analytics/returnFlag";
import { OPT_OUT_KEY } from "@/lib/analytics/optOut";
```
Replace:
```ts
    expect(copy).toContain(`dateTime="2026-09-03"`);
    expect(copy).toContain("3 September 2026");
```
with:
```ts
    expect(copy).toContain(`dateTime="2026-09-14"`);
    expect(copy).toContain("14 September 2026");
```
Add at the end of the file:
```ts
describe("privacy page: the return flag", () => {
  // Three sentences became false when the beacon learned to tell a return from a new visit.
  // If any of them comes back, or a storage key is renamed without the page, this fails.
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));

  it("names both storage keys", () => {
    expect(copy).toContain(VISIT_KEY);
    expect(copy).toContain(OPT_OUT_KEY);
  });

  it("no longer promises that nothing links one visit to the next", () => {
    expect(copy).not.toContain("nothing that links this visit to your next one");
    expect(copy).not.toContain("nothing that survives your tab");
    expect(copy).not.toContain("neither follows you");
  });

  it("states the 13 months, both browser signals and the German time zone", () => {
    expect(copy).toContain("13 months");
    expect(copy).toContain("Global Privacy Control");
    expect(copy).toContain("Germany&rsquo;s time zone");
  });

  it("never claims the dates are deleted on a timer, which localStorage cannot do", () => {
    expect(copy).not.toMatch(/deleted (13 months|after 13)/);
  });

  it("renders the opt-out control", () => {
    expect(copy).toContain("<CountingToggle />");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/privacy-page.test.ts`
Expected: FAIL on the date, the key names, the old sentences, the 13 months and `<CountingToggle />`.

- [ ] **Step 3: Create `components/analytics/CountingToggle.tsx`**

```tsx
"use client";

// The /privacy opt-out. UK PECR Schedule A1 exempts the page-view counter only with "a
// simple means of objecting", and the ICO says Do Not Track alone is not one. So here it is.
//
// It RELOADS instead of stopping posthog-js in place. opt_out_capturing() would store its
// own marker, and in posthog-js 1.428.1 that marker can only be localStorage or a cookie.
// After the reload, Beacon.tsx's armedConfig() sees the flag and never imports the library,
// so the tab provably stops.
//
// Renders nothing on the server: the state lives in this browser, and guessing it at
// render time would cause a hydration mismatch.

import { useEffect, useState } from "react";
import { beaconConfig } from "@/lib/analytics/beacon";
import {
  countingState,
  currentTimeZone,
  isOptedOut,
  optIn,
  optOut,
  privacySignal,
  type CountingState,
} from "@/lib/analytics/optOut";

const COPY: Record<CountingState, string> = {
  not_configured: "This copy of the site runs no page-view counter.",
  signal: "Your browser asks not to be tracked, so it is not counted.",
  excluded_zone: "Your browser is set to Germany's time zone, so it is not counted.",
  opted_out: "This browser is not counted.",
  counted: "This browser is counted.",
};

export function CountingToggle() {
  const [state, setState] = useState<CountingState | null>(null);

  useEffect(() => {
    setState(
      countingState({
        configured: beaconConfig() !== null,
        optedOut: isOptedOut(),
        signal: privacySignal(navigator, window as Window & { doNotTrack?: string | null }),
        timeZone: currentTimeZone(),
      }),
    );
  }, []);

  if (state === null) return null;

  const flip = () => {
    if (state === "counted") optOut();
    else optIn();
    window.location.reload();
  };

  return (
    <p className="pv-counting" role="status">
      <span>{COPY[state]}</span>
      {(state === "counted" || state === "opted_out") && (
        <button type="button" id="pv-counting-toggle" className="pv-counting-btn" onClick={flip}>
          {state === "counted" ? "Stop counting this browser" : "Count this browser again"}
        </button>
      )}
    </p>
  );
}
```

- [ ] **Step 4: Append the control's styles to `app/provenance.css`**

```css
/* /privacy opt-out control (components/analytics/CountingToggle.tsx). Colours come from
   the surrounding prose through currentColor, so it follows the page's own tokens. */
.pv-root .pv-counting {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.pv-root .pv-counting-btn {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0.35rem 0.8rem;
  cursor: pointer;
}
.pv-root .pv-counting-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

- [ ] **Step 5: Edit `app/(site)/privacy/page.tsx`: import, evidence comment, dates**

After `import { BRAND } from "@/lib/brand";`, add:
```ts
import { CountingToggle } from "@/components/analytics/CountingToggle";
```

Replace:
```
 * leave it out or say plainly that you do not know.
 *
 * WHAT CHANGED ON 2026-09-08:
```
with:
```
 * leave it out or say plainly that you do not know.
 *
 * WHAT CHANGED ON 2026-09-14:
 *   - The page-view counter can now tell a new visit from a return. The browser keeps
 *     tn.visit.v1 = { first, last } (lib/analytics/returnFlag.ts), and PostHog receives
 *     only visit_kind and return_gap as super properties (components/analytics/Beacon.tsx).
 *     So three sentences became false and were narrowed in this commit: "nothing that
 *     links this visit to your next one" (top card), "neither follows you" (cookies
 *     heading) and "nothing that survives your tab" (rights). tests/unit/privacy-page.test.ts
 *     fails if any of them comes back.
 *   - The 13 months are MAX_LIFETIME_DAYS = 395, counted from `first`. localStorage has no
 *     expiry, so the dates are thrown away the next time the browser visits after that.
 *     The page says exactly that and must NOT say "deleted after 13 months".
 *   - The opt-out (components/analytics/CountingToggle.tsx), Do Not Track, Global Privacy
 *     Control and the German time zones (EXCLUDED_TIME_ZONES in lib/analytics/optOut.ts)
 *     all stop the dynamic import of posthog-js, so such a browser loads nothing.
 *     tests/unit/beacon-config.test.ts pins the gate.
 *   - Five named actions (lib/analytics/track.ts) carry enumerated values only. The
 *     "recorded with the type of thing" sentence is made true by eventProperties().
 *
 * WHAT CHANGED ON 2026-09-08:
```

Replace:
```
 *     NOT is the thing the page previously ruled out: `persistence: "sessionStorage"` sets
 *     no cookie and keeps nothing past the tab, `disable_session_recording` is on, and
```
with:
```
 *     NOT is the thing the page previously ruled out: `persistence: "sessionStorage"` sets
 *     no cookie and keeps its identifier inside the tab (the return flag, added 2026-09-14,
 *     is the one thing that outlives it, and it sends no identifier), `disable_session_recording` is on, and
```

Replace both `<time dateTime="2026-09-03">3 September 2026</time>` occurrences (lines 178 and 906)
with `<time dateTime="2026-09-14">14 September 2026</time>`. Then replace
`This describes the code as deployed on 3 September 2026.` with
`This describes the code as deployed on 14 September 2026.`

- [ ] **Step 6: Edit the top card (~211-217)**

Replace:
```tsx
                clicks, on PostHog&rsquo;s European servers. No Google Analytics, no ad pixel, no
                session recording, and nothing that links this visit to your next one.
```
with:
```tsx
                clicks, on PostHog&rsquo;s European servers, and can tell a new visit from a
                return. No Google Analytics, no ad pixel, no session recording, and nothing that
                says who you are.
```

- [ ] **Step 7: Add the storage table rows (after the feedback-prompt row, ~416)**

Replace:
```tsx
                  <td>No. The decision is made in your browser</td>
                </tr>
```
with:
```tsx
                  <td>No. The decision is made in your browser</td>
                </tr>
                <tr>
                  <td>
                    The day you first came and the day you last came, so the page-view counter can
                    tell a return from a new visit
                  </td>
                  <td>
                    Local storage <span className="pv-num">tn.visit.v1</span>, thrown away on your
                    first visit after 13 months
                  </td>
                  <td>No. Only new or returning, and roughly how long ago, is sent to PostHog</td>
                </tr>
                <tr>
                  <td>That you asked not to be counted, if you did</td>
                  <td>
                    Local storage <span className="pv-num">tn.analytics.optout.v1</span>
                  </td>
                  <td>No</td>
                </tr>
```

- [ ] **Step 8: Edit the cookies section (~715-750)**

Replace:
```tsx
            <h2 className="pv-h2">No cookies of ours. Two counters, and neither follows you.</h2>
```
with:
```tsx
            <h2 className="pv-h2">No cookies of ours. Two counters, and neither knows who you are.</h2>
```

Replace:
```tsx
              request, and a click that fails to do anything sends nothing at all.
            </p>
```
with:
```tsx
              request, and a click that fails to do anything sends nothing at all. It also counts
              five named actions: opening something on the map, switching a board, turning a layer
              on or off, copying a share link and arming an alert. Each one is recorded with the
              type of thing, never with a place, a name or anything you typed.
            </p>
```

Replace:
```tsx
              memory and is destroyed when you close that tab, so there is nothing to link this
              visit to your next one and nothing to follow you to another site. It does not record
              your screen, your typing or your form fields &mdash; session replay is switched off
              in the configuration, not merely unused. There is no ad pixel, no Google Analytics,
              no Meta pixel and no fingerprinting library. And if your browser sends{" "}
              <span className="pv-num">Do Not Track</span>, it does not count you at all.
            </p>
```
with:
```tsx
              memory and is destroyed when you close that tab, so it cannot follow you to another
              site or to your next visit. It does not record your screen, your typing or your form
              fields &mdash; session replay is switched off in the configuration, not merely unused.
              There is no ad pixel, no Google Analytics, no Meta pixel and no fingerprinting library.
            </p>
            <p>
              <strong>One thing does outlive the tab.</strong> Your browser keeps two dates in its
              own storage, under <span className="pv-num">tn.visit.v1</span>: the day you first came
              and the day you last came. When you open the site, the counter is told only whether
              this browser has been here before and, if so, roughly how long ago: the same day, the
              day before, within a week, within a month, or longer. The dates are not sent. Every
              browser that came back within a week sends the same words, so the counter can say how
              many visits are returns but not whose. 13 months after your first visit, the dates are
              thrown away the next time you come, and you count as new again. Coming back does not
              extend the 13 months.
            </p>
            <p>
              You can turn this off with the button below. It stops the page-view counter in this
              browser, deletes the visit dates, and remembers your choice under{" "}
              <span className="pv-num">tn.analytics.optout.v1</span>. If your browser sends{" "}
              <span className="pv-num">Do Not Track</span> or{" "}
              <span className="pv-num">Global Privacy Control</span>, the counter does not load and
              nothing is written. It also does not load in a browser set to Germany&rsquo;s time
              zone, because German law gives this kind of counting no exemption.
            </p>
            <CountingToggle />
```

- [ ] **Step 9: Edit the rights paragraph (~877-879)**

Replace:
```tsx
              holds no cookie and nothing that survives your tab, and which will not have counted
              you at all if your browser sends Do Not Track. The third is a feedback answer, if you
```
with:
```tsx
              sets no cookie, keeps only your first and last visit dates on your own device, and
              does not run at all if you turned it off or your browser sends Do Not Track or Global
              Privacy Control. The third is a feedback answer, if you
```

- [ ] **Step 10: Run the tests and the type check**

Run: `npx vitest run tests/unit/privacy-page.test.ts tests/unit/beacon-config.test.ts && npx tsc --noEmit`
Expected: PASS (the em-dash test included), and tsc exits 0.

- [ ] **Step 11: Prove the old-sentence guard goes red**

Temporarily put back `and nothing that links this visit to your next one.` at the end of the top
card.
Run: `npx vitest run tests/unit/privacy-page.test.ts`
Expected: FAIL in "no longer promises that nothing links one visit to the next". Restore it and
re-run. Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add components/analytics/CountingToggle.tsx app/provenance.css "app/(site)/privacy/page.tsx" tests/unit/privacy-page.test.ts
git commit -m "Privacy: say what the return flag keeps and sends, and add the opt-out"
```

---

### Task 7: Gate, push, pull request

**Files:** none are changed. This task produces evidence and a PR.

- [ ] **Step 1: Run the full gate**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exits 0. vitest reports every file passed, at the baseline count (3,854 cases on
PR #233's branch, and lower on main) plus the 5 new or extended test files. If any file fails,
check it at `5372c19` before blaming this branch, as CLAUDE.md "Build gate" asks.

- [ ] **Step 2: Check the banned name and the dash rule**

Run: `git diff origin/main --stat && git diff origin/main | grep -n "World Monitor\|worldmonitor" ; echo "exit=$?"`
Expected: `exit=1` (no match).

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feat/return-flag`
Expected: `branch 'feat/return-flag' set up to track 'origin/feat/return-flag'`.

- [ ] **Step 4: Open the PR, as Sampo, in first person, with no generated-by footer**

Write the body to the scratchpad file
`C:\Users\sampo\AppData\Local\Temp\claude\C--Users-sampo\fb9b3d9e-7baf-4dbf-8f70-5a267307b569\scratchpad\pr-return-flag.md`:

```markdown
I wanted to know how many visitors come back and how much they use the site, without giving
anyone an identifier. This adds a return flag and five usage events to the PostHog beacon.

**What the browser keeps:** `tn.visit.v1` = the day of the first visit and the day of the last
visit. **What PostHog gets:** `visit_kind` (new / returning) and `return_gap`
(same_day / next_day / 2_7d / 8_30d / over_30d). It never gets the dates.

- `lib/analytics/returnFlag.ts`: classification, the 13-month cap from the first visit, one class per tab
- `lib/analytics/optOut.ts`: one counting rule covering the opt-out, DNT, GPC and German time zones
- `lib/analytics/track.ts`: `object_opened`, `board_switched`, `layer_toggled`, `share_link_copied`, `alert_armed`, with enumerated values only
- `components/analytics/Beacon.tsx`: every posthog-js import goes through the rule, and the class is registered in `loaded`
- `components/analytics/CountingToggle.tsx` and /privacy: the opt-out, plus three sentences that were no longer true

Spec: `docs/superpowers/specs/2026-09-14-returning-visitors-design.md`

**Do not merge until:**
- [ ] the PostHog DPA is signed (PostHog as processor; check what it says about transfers outside the EU)
- [ ] PostHog event retention is 25 months or less

**After deploy, check in my browser:**
- `tn.visit.v1` is written and the first `$pageview` carries `visit_kind`
- no cookie is set
- a reload keeps the class
- Stop counting deletes the key and stops requests
- with the time zone set to Berlin, nothing loads

Gate: tsc 0, vitest <N files / N cases> passed. Build: Vercel status on <sha>.
```

Fill in the gate numbers from Step 1 and the head sha from `git rev-parse HEAD` before running:
`gh pr create --base main --head feat/return-flag --title "Count returning visitors without an identifier" --body-file "<the file above>"`
Expected: a PR URL.

- [ ] **Step 5: Read the Vercel build status**

Run: `gh api repos/011-sam-110/Provenance/commits/$(git rev-parse HEAD)/statuses --jq '.[] | select(.context=="Vercel") | .state' | head -1`
Expected: `success`. If it is `pending`, re-run after a few minutes. If it is `failure`, read the log
through the status's `target_url`. This proves compile and prerender in Vercel's environment, not
the Lightsail standalone build.

- [ ] **Step 6: Report to Sam**

Report:
- the PR URL
- the gate numbers and the Vercel status
- the two gate items that are his: the DPA and the retention setting
- that nothing measures anything until the PR is merged and deployed
- that the first readable returning share comes 14 days after deploy
