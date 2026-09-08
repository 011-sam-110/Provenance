# Area Notifications — M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rule owned by a drawn area fires a notification when a source does something inside that area — for the four triggers that need only a row id, a number and a count.

**Architecture:** A pure diff (`lib/notify/engine.ts`) compares the previous observation of a `(area, source)` pair to the current rows, cropped to the area's ring, and returns events. Everything that decides anything is pure and node-testable; a thin impure runner subscribes to feeds and hands events to the existing `dispatch()` in `lib/shell/notifications.ts`. The composer builds rules from dropdowns whose options come from a four-layer capability resolution, so a combination the data cannot back is never offered.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19 (`useSyncExternalStore` module stores), vitest (node environment), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-area-notifications-design.md`

## Global Constraints

- **Gate before every commit:** `npx tsc --noEmit && npm test`
- **Commit attribution is SOLO.** No `Co-Authored-By` trailer. Matches every existing commit in this repo (`CLAUDE.md` → Build gate).
- **Tests are vitest, NODE environment, in `tests/unit/**/*.test.ts`.** No React Testing Library is installed — there are no component tests. UI is verified with Playwright screenshots to `persona-shots/`.
- **Every upstream fetch is keyless-first and dormant-safe:** failures resolve to `[]` / last-good / a labelled placeholder. Never a 5xx, never fabricated data.
- **Keep the domain mapping in a PURE exported function with a unit test.** Impure shells stay thin.
- **Path alias is `@/`** — e.g. `import { pointInRing } from "@/lib/shell/scope"`.
- **CSS tokens are `.tn-*` in `app/globals.css`.** Calm light identity. Do not introduce a second token set.
- **Never write `worldmonitor` or "World Monitor" into a user-visible string.** It is a competitor.
- **`MAX_PER_AREA_HOUR = 20`**, rolling hour, per area.
- **Persistence key for rules: `tn.notify.rules.v1`, version `1`.** For observations: `tn.notify.obs.v1`, version `1`.

---

## File Structure

**Create — pure core (no React, no DOM, no network):**
- `lib/notify/types.ts` — `TriggerKind`, `TriggerParams`, `AreaRule`, `ObservedRow`, `NotifyEvent`, `Observation`, `TriggerCapability`
- `lib/notify/groups.ts` — layer 2: source group → supported kinds
- `lib/notify/capability.ts` — layer 3 resolution: group ∪ implied ∪ add − remove
- `lib/notify/engine.ts` — the diff
- `lib/notify/wording.ts` — G4 + G5: how an event becomes a sentence
- `lib/notify/budget.ts` — G3: the rolling per-area ceiling

**Create — impure shell (thin):**
- `lib/notify/rules.ts` — persisted `AreaRule[]` store
- `lib/notify/observations.ts` — persisted `Observation` per `(areaId, sourceId)`
- `lib/notify/runner.ts` — subscribes to feeds, calls the engine, calls `dispatch()`

**Create — UI:**
- `components/shell/inspector/RulesPanel.tsx` — the composer and the armed list

**Modify:**
- `components/shell/inspector/AreasPanel.tsx` — a rule count on each area row
- `components/shell/ConsoleShell.tsx` — hydrate the two new stores, mount the runner

**Test:**
- `tests/unit/notify-capability.test.ts`
- `tests/unit/notify-engine.test.ts`
- `tests/unit/notify-guards.test.ts`
- `tests/unit/notify-rules.test.ts`
- `tests/unit/notify-observations.test.ts`
- `tests/unit/notify-wording.test.ts`
- `tests/unit/notify-budget.test.ts`

---

### Task 1: Types and capability resolution

Layer 2 (group defaults) and layer 3 (a source's own declaration) decide what the composer's second dropdown offers. This is the whole "plug and play" claim, so it is built first and tested hardest.

**Files:**
- Create: `lib/notify/types.ts`
- Create: `lib/notify/groups.ts`
- Create: `lib/notify/capability.ts`
- Test: `tests/unit/notify-capability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TriggerKind`, `TriggerParams`, `AreaRule`, `ObservedRow`, `NotifyEvent`, `Observation`, `TriggerCapability`, `GROUP_TRIGGERS`, `resolveTriggers(group, declaration)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-capability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveTriggers } from "@/lib/notify/capability";
import type { TriggerCapability } from "@/lib/notify/types";

describe("resolveTriggers", () => {
  it("gives a source its group's kinds when it declares nothing, so a new adapter is armable with no notification code", () => {
    expect(resolveTriggers("Natural hazards", undefined).sort()).toEqual(
      ["appears", "count", "crosses", "quiet"].sort(),
    );
  });

  it("offers nothing for a group with no defaults, so an unknown group cannot silently inherit someone else's", () => {
    expect(resolveTriggers("Not a real group", undefined)).toEqual([]);
  });

  it("offers nothing at all for static infrastructure, because a port publishes no state to notice a change in", () => {
    expect(resolveTriggers("Static infrastructure", undefined)).toEqual([]);
  });

  it("implies `crosses` from a declared scalar even when the group never offered it", () => {
    const cap: TriggerCapability = {
      scalars: [{ field: "score", label: "score", domain: [0, 82] }],
    };
    expect(resolveTriggers("Synthesis", cap)).toContain("crosses");
  });

  it("implies `state` from a declared state field", () => {
    const cap: TriggerCapability = { state: { field: "status", values: ["Go", "Hold"] } };
    expect(resolveTriggers("Space", cap)).toContain("state");
  });

  it("implies `due` from a declared due field", () => {
    const cap: TriggerCapability = { due: { field: "launchTime" } };
    expect(resolveTriggers("Space", cap)).toContain("due");
  });

  it("adds a kind the group lacks", () => {
    expect(resolveTriggers("Natural hazards", { add: ["enters"] })).toContain("enters");
  });

  it("removes a kind the group wrongly claims", () => {
    expect(resolveTriggers("Natural hazards", { remove: ["appears"] })).not.toContain("appears");
  });

  it("lets `remove` beat an implied kind, so a source can declare a field for the audit and still refuse to be armed on it", () => {
    const cap: TriggerCapability = {
      state: { field: "status", values: ["Go"] },
      remove: ["state"],
    };
    expect(resolveTriggers("Space", cap)).not.toContain("state");
  });

  it("lets `remove` beat `add`, so one field cannot be both", () => {
    expect(resolveTriggers("Space", { add: ["enters"], remove: ["enters"] })).not.toContain("enters");
  });

  it("returns each kind once even when the group and a declaration both name it", () => {
    const got = resolveTriggers("Natural hazards", { add: ["appears"] });
    expect(got.filter((k) => k === "appears")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-capability.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/capability"`.

- [ ] **Step 3: Write the types**

Create `lib/notify/types.ts`:

```ts
// The shared vocabulary for area-owned notification rules.
//
// EVERYTHING HERE IS A TYPE OR A CONSTANT. No behaviour, so it can be imported by
// the pure engine, the impure stores and the React composer without any of them
// dragging the others in.
//
// A rule is owned by an AREA, not by a widget and not by a preset. That is the whole
// design: `lib/shell/notifications.ts` keys its rules by widget TYPE, globally, which
// cannot express "in Soho" and cannot survive a board swap. This is a second, area-
// scoped rule set that reuses that file's channels and its `dispatch`.

import type { NotifyChannels } from "@/lib/shell/notifications";

/** The nine things a source can be asked to do. M1 implements four of them. */
export type TriggerKind =
  | "appears" | "disappears" | "enters" | "leaves"
  | "crosses" | "count" | "state" | "due" | "quiet";

/** Which side of a level fires. Both are EDGE-triggered — see engine.ts. */
export type Direction = "atOrAbove" | "below";

/**
 * A trigger and its settings in one value, so a rule carrying settings that do not
 * match its trigger cannot be constructed. The engine and the composer's parameter
 * row branch on the same discriminant.
 */
export type TriggerParams =
  | { kind: "appears" | "disappears" | "enters" | "leaves" }
  | { kind: "crosses"; field: string; dir: Direction; level: number }
  | { kind: "count"; dir: Direction; level: number }
  | { kind: "state"; field: string; to: string }
  | { kind: "due"; leadMs: number }
  | { kind: "quiet"; silentMs: number };

export interface AreaRule {
  /** "rule:<epoch ms>" — stable, and sorts by age without a second field. */
  id: string;
  /** An `inspectorStore` area id, or the literal "world". */
  areaId: string;
  /** A signal id, a core LayerKey, or a widget type id. */
  sourceId: string;
  params: TriggerParams;
  channels: NotifyChannels;
  enabled: boolean;
  createdAt: number;
}

/** The area id meaning "everywhere" — no ring, every row is inside. */
export const WORLD_AREA_ID = "world";

/**
 * One row as the engine sees it. A per-family adapter flattens a SignalFeature, a
 * WorldObject or a widget's own rows into this; the engine knows nothing else.
 */
export interface ObservedRow {
  id: string;
  lat: number;
  lon: number;
  /** Numeric fields named by the source's `scalars` declaration. */
  scalars: Record<string, number>;
  /** Value of the field named by the source's `state` declaration. */
  state?: string;
  /** Future ISO timestamp named by the source's `due` declaration. */
  dueAt?: string;
  /** Rendered into the message. */
  title: string;
}

/** What we knew about one `(area, source)` pair at the last poll. */
export interface Observation {
  /** row id → what we last knew about it. */
  rows: Record<string, { inside: boolean; scalars: Record<string, number>; state?: string }>;
  /** How many rows were inside the ring. */
  count: number;
  /** Last successful poll, epoch ms. 0 when never. */
  lastOk: number;
  /** Row ids already announced by a `due` rule, so a lead time fires once. */
  dueFired: string[];
  /** True once `quiet` has fired for the current silence, so it fires once per silence. */
  quietFired: boolean;
}

/** One thing that happened, before the budget decides whether it is sent. */
export interface NotifyEvent {
  ruleId: string;
  areaId: string;
  sourceId: string;
  kind: TriggerKind;
  /** The row that caused it. Absent for `count` and `quiet`, which are about the set. */
  rowId?: string;
  /** The finished sentence, already worded by wording.ts. */
  text: string;
  at: number;
}

/** What a source says about its own fields. Layer 3 of the resolution. */
export interface TriggerCapability {
  /** Field holding a stable per-row id. Defaults to the row's own `id`. */
  identity?: string;
  /** Numeric fields offerable to `crosses`, with their REAL domains. */
  scalars?: { field: string; label: string; unit?: string; domain: [number, number] }[];
  /** Categorical field offerable to `state`, and its known values. */
  state?: { field: string; values: string[] };
  /** Field holding a future ISO timestamp, offerable to `due`. */
  due?: { field: string };
  /** Kinds this source adds to its group default. */
  add?: TriggerKind[];
  /** Kinds this source removes. Wins over everything, including an implied kind. */
  remove?: TriggerKind[];
}
```

- [ ] **Step 4: Write the group defaults**

Create `lib/notify/groups.ts`:

```ts
// LAYER 2 — what a FAMILY of sources can be asked.
//
// Keyed by the `group` a source already carries (see SignalSource.group in
// lib/signals/types.ts), so a new adapter registered into an existing group is
// armable the moment it exists, with no notification code written. That is the
// "one adapter + one registry entry" rule this codebase already holds, extended
// to notifications.
//
// An UNKNOWN group resolves to nothing rather than to a default set. A source
// that quietly inherits someone else's capabilities is how a menu starts lying.
//
// "Static infrastructure" is deliberately EMPTY and that is the interesting entry.
// Nuclear plants, ports, airports and cables are OpenStreetMap reference data:
// position and tags, no operating state, changing on a scale of months. There is
// no honest rule to build against them, so the composer offers none — see
// §11 of the spec.

import type { TriggerKind } from "@/lib/notify/types";

export const GROUP_TRIGGERS: Record<string, TriggerKind[]> = {
  // Rows carry a stable id and a position that CHANGES between polls.
  Movers: ["appears", "disappears", "enters", "leaves", "crosses", "count", "quiet"],
  Maritime: ["appears", "disappears", "enters", "leaves", "count", "quiet"],
  Military: ["appears", "count", "quiet"],

  // Rows appear at a fixed place and do not move, so enters/leaves are meaningless.
  "Natural hazards": ["appears", "crosses", "count", "quiet"],
  Weather: ["appears", "crosses", "count", "quiet"],
  "Human cost": ["appears", "count", "quiet"],

  // A per-entity status that changes.
  "Cyber threat": ["appears", "disappears", "crosses", "count", "quiet"],
  Infrastructure: ["appears", "crosses", "count", "quiet"],
  Space: ["appears", "count", "quiet"],

  // A derived score. Not a set of rows, so counting them says nothing.
  Synthesis: ["quiet"],

  // Text rows arriving.
  News: ["appears", "count", "quiet"],

  // Streams that stop answering.
  Cameras: ["disappears", "count", "quiet"],

  // No state is published. Nothing to notice a change in.
  "Static infrastructure": [],
};
```

- [ ] **Step 5: Write the resolution**

Create `lib/notify/capability.ts`:

```ts
// LAYER 3 — a source's own declaration, and the last word.
//
// RESOLUTION ORDER, so no case is left to interpretation:
//   1. start with the group's kinds
//   2. a declared FIELD BLOCK implies its kind, whatever the group said —
//      declaring the field is the statement that the source can back the kind
//   3. union with `add`
//   4. subtract `remove`, which wins over everything including an implied kind
//
// Step 4 beating step 2 is what lets a source declare a `state` field so layer 4
// can audit it, while still refusing to be armed on it.

import { GROUP_TRIGGERS } from "@/lib/notify/groups";
import type { TriggerCapability, TriggerKind } from "@/lib/notify/types";

/** PURE: the kinds this source may be armed on, in a stable order. */
export function resolveTriggers(
  group: string,
  declaration: TriggerCapability | undefined,
): TriggerKind[] {
  const set = new Set<TriggerKind>(GROUP_TRIGGERS[group] ?? []);

  if (declaration) {
    if (declaration.scalars && declaration.scalars.length > 0) set.add("crosses");
    if (declaration.state) set.add("state");
    if (declaration.due) set.add("due");
    for (const k of declaration.add ?? []) set.add(k);
    for (const k of declaration.remove ?? []) set.delete(k);
  }

  // A stable order so the composer's dropdown does not reshuffle between renders.
  const ORDER: TriggerKind[] = [
    "appears", "disappears", "enters", "leaves",
    "crosses", "count", "state", "due", "quiet",
  ];
  return ORDER.filter((k) => set.has(k));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-capability.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/types.ts lib/notify/groups.ts lib/notify/capability.ts tests/unit/notify-capability.test.ts
git commit -m "Notify: what each source may be asked, decided by its group and its own declaration"
```

---

### Task 2: The engine — `appears`

The first trigger, and the one that establishes the diff's shape. Everything after this extends the same function.

**Files:**
- Create: `lib/notify/engine.ts`
- Test: `tests/unit/notify-engine.test.ts`

**Interfaces:**
- Consumes: `ObservedRow`, `Observation`, `NotifyEvent`, `AreaRule`, `WORLD_AREA_ID` from Task 1.
- Produces: `diff(prev, rows, ring, rules, feed, now)` returning `{ events: NotifyEvent[]; next: Observation }`, and `EMPTY_OBSERVATION`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule, ObservedRow, Observation } from "@/lib/notify/types";

/** A square ring around the origin, big enough to hold (0,0) and exclude (10,10). */
const RING: [number, number][] = [
  [-1, -1], [1, -1], [1, 1], [-1, 1],
];

const row = (id: string, lat = 0, lon = 0, scalars: Record<string, number> = {}): ObservedRow => ({
  id, lat, lon, scalars, title: id,
});

const rule = (params: AreaRule["params"]): AreaRule => ({
  id: "rule:1",
  areaId: "area:1",
  sourceId: "earthquakes",
  params,
  channels: { browser: true, telegram: false, discord: false },
  enabled: true,
  createdAt: 0,
});

const OK = { ok: true, lastOk: 1_000 };

describe("diff — appears", () => {
  it("fires for a row that was not in the previous observation", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a"), row("b")], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe("b");
    expect(events[0].kind).toBe("appears");
  });

  it("does not fire for a row that was already there", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a")], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("ignores a new row OUTSIDE the ring, because the rule is about a place", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} } }, count: 1 };
    const { events } = diff(prev, [row("a"), row("far", 10, 10)], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("treats every row as inside when the ring is null, which is the World context", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { events } = diff(prev, [row("far", 10, 10)], null, [rule({ kind: "appears" })], OK, 2_000);
    expect(events).toHaveLength(1);
  });

  it("does not fire for a disabled rule", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const r = { ...rule({ kind: "appears" }), enabled: false };
    const { events } = diff(prev, [row("a")], RING, [r], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("records the current rows in `next`, so the following poll compares against this one", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { next } = diff(prev, [row("a"), row("far", 10, 10)], RING, [rule({ kind: "appears" })], OK, 2_000);
    expect(next.rows.a.inside).toBe(true);
    expect(next.rows.far.inside).toBe(false);
    expect(next.count).toBe(1);
    expect(next.lastOk).toBe(1_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/engine"`.

- [ ] **Step 3: Write the engine**

Create `lib/notify/engine.ts`:

```ts
// THE DIFF. Every trigger is the same operation: compare what we knew to what we
// see, cropped to the ring.
//
// PURE. No React, no DOM, no network, no Date.now() — `now` is a parameter. This is
// the lib/console/widgets/camslot.conditions.ts idiom: every claim the product makes
// is decided in one node-testable file, and the impure shell only supplies inputs.
//
// The caller owns persistence. `diff` returns the NEXT observation rather than
// writing one, so a caller that decides not to trust this poll can keep the old one
// (see the guards in this file).

import { pointInRing } from "@/lib/shell/scope";
import type {
  AreaRule, NotifyEvent, ObservedRow, Observation, TriggerKind,
} from "@/lib/notify/types";

/** A never-observed pair. `lastOk: 0` means "no successful poll yet". */
export const EMPTY_OBSERVATION: Observation = {
  rows: {}, count: 0, lastOk: 0, dueFired: [], quietFired: false,
};

/** A sanitised open ring of [lon, lat], or null for the World context. */
export type Ring = readonly [number, number][] | null;

function isInside(r: ObservedRow, ring: Ring): boolean {
  if (ring === null) return true; // World — no boundary to be outside of
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return false;
  return pointInRing(r.lon, r.lat, ring);
}

function snapshot(rows: readonly ObservedRow[], ring: Ring): Observation["rows"] {
  const out: Observation["rows"] = {};
  for (const r of rows) {
    out[r.id] = { inside: isInside(r, ring), scalars: r.scalars, ...(r.state ? { state: r.state } : {}) };
  }
  return out;
}

function event(
  rule: AreaRule, kind: TriggerKind, at: number, rowId?: string,
): NotifyEvent {
  // `text` is filled in by wording.ts, which owns every sentence the product sends.
  // An empty string here is deliberate: the engine decides WHAT happened, never how
  // it is worded, so a source's honesty rules cannot be bypassed by a new trigger.
  return { ruleId: rule.id, areaId: rule.areaId, sourceId: rule.sourceId, kind, at, text: "", ...(rowId ? { rowId } : {}) };
}

export function diff(
  prev: Observation | undefined,
  rows: readonly ObservedRow[],
  ring: Ring,
  rules: readonly AreaRule[],
  feed: { ok: boolean; lastOk: number },
  now: number,
): { events: NotifyEvent[]; next: Observation } {
  const before = prev ?? EMPTY_OBSERVATION;
  const nextRows = snapshot(rows, ring);
  const insideNow = rows.filter((r) => isInside(r, ring));
  const next: Observation = {
    rows: nextRows,
    count: insideNow.length,
    lastOk: feed.ok ? feed.lastOk : before.lastOk,
    dueFired: before.dueFired,
    quietFired: before.quietFired,
  };

  const events: NotifyEvent[] = [];
  const armed = rules.filter((r) => r.enabled);

  for (const rule of armed) {
    if (rule.params.kind === "appears") {
      for (const r of insideNow) {
        if (!before.rows[r.id]) events.push(event(rule, "appears", now, r.id));
      }
    }
  }

  return { events, next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: PASS, 6 tests.

> Note: the "does not fire for a row that was already there" and the seed case both pass here only because `prev` is supplied. Task 5 adds the guard for `prev === undefined`, which is the case that matters in production.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/engine.ts tests/unit/notify-engine.test.ts
git commit -m "Notify: the diff, and the first trigger — something appeared inside the ring"
```

---

### Task 3: `count` and `crosses`, edge-triggered

Both read a number against a level and a direction. They are built together because they share the edge rule, and the edge rule is a **correction to existing behaviour**: `aviation.rules.ts`'s `jetSurgeMin` re-fires on every report while the condition holds, deduped only by a per-mount set, so a remount re-announces a surge that never went away.

**Files:**
- Modify: `lib/notify/engine.ts`
- Test: `tests/unit/notify-engine.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: no new exports; `diff` now handles `{ kind: "count" }` and `{ kind: "crosses" }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/notify-engine.test.ts`:

```ts
describe("diff — count, edge-triggered", () => {
  const countRule = rule({ kind: "count", dir: "atOrAbove", level: 3 });

  it("fires on the poll that crosses the level", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, count: 2, lastOk: 500 };
    const { events } = diff(prev, [row("a"), row("b"), row("c")], RING, [countRule], OK, 2_000);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("count");
    expect(events[0].rowId).toBeUndefined();
  });

  it("does NOT fire again while the level stays crossed — this is the jetSurgeMin bug", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, count: 3, lastOk: 500 };
    const { events } = diff(prev, [row("a"), row("b"), row("c"), row("d")], RING, [countRule], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("re-arms once the count falls back below, so the next crossing fires again", () => {
    const dropped = diff(
      { ...EMPTY_OBSERVATION, count: 4, lastOk: 500 },
      [row("a")], RING, [countRule], OK, 2_000,
    );
    expect(dropped.events).toHaveLength(0);
    const again = diff(dropped.next, [row("a"), row("b"), row("c")], RING, [countRule], OK, 3_000);
    expect(again.events).toHaveLength(1);
  });

  it("fires on a `below` rule when the count drops through the level", () => {
    const below = rule({ kind: "count", dir: "below", level: 2 });
    const prev: Observation = { ...EMPTY_OBSERVATION, count: 3, lastOk: 500 };
    const { events } = diff(prev, [row("a")], RING, [below], OK, 2_000);
    expect(events).toHaveLength(1);
  });
});

describe("diff — crosses, edge-triggered per row", () => {
  const magRule = rule({ kind: "crosses", field: "magnitude", dir: "atOrAbove", level: 5 });

  it("fires when a row's number passes the level", () => {
    const prev: Observation = {
      ...EMPTY_OBSERVATION,
      rows: { q: { inside: true, scalars: { magnitude: 4.2 } } },
      count: 1, lastOk: 500,
    };
    const { events } = diff(prev, [row("q", 0, 0, { magnitude: 5.4 })], RING, [magRule], OK, 2_000);
    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe("q");
  });

  it("does not fire while the row stays above the level", () => {
    const prev: Observation = {
      ...EMPTY_OBSERVATION,
      rows: { q: { inside: true, scalars: { magnitude: 5.4 } } },
      count: 1, lastOk: 500,
    };
    const { events } = diff(prev, [row("q", 0, 0, { magnitude: 6.1 })], RING, [magRule], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("does not fire for a row seen for the first time, because there is no previous value to cross FROM", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 500 };
    const { events } = diff(prev, [row("q", 0, 0, { magnitude: 9 })], RING, [magRule], OK, 2_000);
    expect(events).toHaveLength(0);
  });

  it("ignores a row missing the field rather than treating absent as zero", () => {
    const prev: Observation = {
      ...EMPTY_OBSERVATION,
      rows: { q: { inside: true, scalars: { magnitude: 4 } } },
      count: 1, lastOk: 500,
    };
    const { events } = diff(prev, [row("q")], RING, [magRule], OK, 2_000);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: FAIL — the `count` and `crosses` describes fail with `expected [] to have a length of 1`.

- [ ] **Step 3: Implement both**

In `lib/notify/engine.ts`, add above `diff`:

```ts
/**
 * EDGE, not level. True only when the value moved ACROSS the line since last time.
 *
 * This is a deliberate correction. `aviation.rules.ts` emits its private-jet surge
 * whenever the count is at or above the threshold, and WidgetFrame's dedupe set is
 * per-MOUNT, so focusing a widget and coming back re-announces a surge that never
 * went away. An edge fires once and re-arms only when the value returns.
 *
 * A non-finite previous value means "we have never seen this", which is not a
 * crossing — you cannot cross a line you were never on a side of.
 */
function crossed(prev: number | undefined, cur: number, dir: "atOrAbove" | "below", level: number): boolean {
  if (prev == null || !Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  return dir === "atOrAbove" ? prev < level && cur >= level : prev >= level && cur < level;
}
```

Then inside the `for (const rule of armed)` loop, after the `appears` branch:

```ts
    if (rule.params.kind === "count") {
      const { dir, level } = rule.params;
      if (crossed(before.count, next.count, dir, level)) {
        events.push(event(rule, "count", now));
      }
    }

    if (rule.params.kind === "crosses") {
      const { field, dir, level } = rule.params;
      for (const r of insideNow) {
        const cur = r.scalars[field];
        if (!Number.isFinite(cur)) continue; // absent is not zero
        if (crossed(before.rows[r.id]?.scalars?.[field], cur, dir, level)) {
          events.push(event(rule, "crosses", now, r.id));
        }
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: PASS. Every test in the file — 14 if nothing was added since this plan was
written. Cumulative across a file earlier tasks also own, so it drifts; trust the file,
and never add or delete a test to make a count match.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/engine.ts tests/unit/notify-engine.test.ts
git commit -m "Notify: a level crossed once, not announced every poll it stays crossed"
```

---

### Task 4: `quiet`

The feed itself stopped answering. This one reads no rows — it reads the gap between `lastOk` and `now`.

**Files:**
- Modify: `lib/notify/engine.ts`
- Test: `tests/unit/notify-engine.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: no new exports; `diff` now handles `{ kind: "quiet" }`, and maintains `Observation.quietFired`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/notify-engine.test.ts`:

```ts
describe("diff — quiet", () => {
  const quietRule = rule({ kind: "quiet", silentMs: 30 * 60_000 });
  const DOWN = { ok: false, lastOk: 0 };

  it("fires when the last success is older than the window", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, lastOk: 1_000 };
    const { events } = diff(prev, [], RING, [quietRule], DOWN, 1_000 + 31 * 60_000);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("quiet");
  });

  it("does not fire inside the window", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, lastOk: 1_000 };
    const { events } = diff(prev, [], RING, [quietRule], DOWN, 1_000 + 5 * 60_000);
    expect(events).toHaveLength(0);
  });

  it("fires once per silence, not once per poll", () => {
    const first = diff({ ...EMPTY_OBSERVATION, lastOk: 1_000 }, [], RING, [quietRule], DOWN, 1_000 + 31 * 60_000);
    expect(first.events).toHaveLength(1);
    const second = diff(first.next, [], RING, [quietRule], DOWN, 1_000 + 40 * 60_000);
    expect(second.events).toHaveLength(0);
  });

  it("re-arms after the feed recovers, so the NEXT outage is announced too", () => {
    const first = diff({ ...EMPTY_OBSERVATION, lastOk: 1_000 }, [], RING, [quietRule], DOWN, 1_000 + 31 * 60_000);
    const recovered = diff(first.next, [row("a")], RING, [quietRule], { ok: true, lastOk: 3_000_000 }, 3_000_000);
    expect(recovered.next.quietFired).toBe(false);
    const again = diff(recovered.next, [], RING, [quietRule], { ok: false, lastOk: 3_000_000 }, 3_000_000 + 31 * 60_000);
    expect(again.events).toHaveLength(1);
  });

  it("never fires for a pair that has NEVER succeeded, because silence we have no baseline for is not an outage", () => {
    const { events } = diff(EMPTY_OBSERVATION, [], RING, [quietRule], DOWN, 999_999_999);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: FAIL — the `quiet` describe fails with `expected [] to have a length of 1`.

- [ ] **Step 3: Implement `quiet`**

In `lib/notify/engine.ts`, inside the rule loop, after the `crosses` branch:

```ts
    if (rule.params.kind === "quiet") {
      const { silentMs } = rule.params;
      // lastOk === 0 means this pair has NEVER answered. Silence with no baseline is
      // not an outage — it is a source that was armed before it ever worked, and
      // announcing it would blame the wrong thing.
      // A poll that SUCCEEDED is not silence, whatever the previous lastOk says.
      // Without the `!feed.ok` term, the single poll on which a feed RECOVERS both
      // fires a bogus outage and re-latches quietFired after the reset above has
      // already cleared it — leaving the latch stuck true, so the next genuine
      // outage is never announced at all.
      const silentFor = !feed.ok && before.lastOk > 0 ? now - before.lastOk : 0;
      if (silentFor >= silentMs && !before.quietFired) {
        events.push(event(rule, "quiet", now));
        next.quietFired = true;
      }
    }
```

And immediately after `const next: Observation = { ... }` is built, reset the latch on recovery:

```ts
  // A successful poll ends the silence, so the NEXT outage is announced too.
  if (feed.ok) next.quietFired = false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-engine.test.ts`
Expected: PASS. Every test in the file — 19 if nothing was added since this plan was
written. Cumulative across a file earlier tasks also own, so it drifts; trust the file.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/engine.ts tests/unit/notify-engine.test.ts
git commit -m "Notify: a feed that went quiet, said once per silence"
```

---

### Task 5: Guards G1 and G2

**These two assertions are written first and watched to FAIL against the current engine before the guard exists.** A guard test nobody saw go red proves nothing — it can be passing for the wrong reason from the moment it is written.

**Files:**
- Modify: `lib/notify/engine.ts`
- Test: `tests/unit/notify-guards.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: no new exports. `diff` now returns no events and an unchanged observation for an untrustworthy poll.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diff, EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { AreaRule, ObservedRow, Observation } from "@/lib/notify/types";

const RING: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const row = (id: string): ObservedRow => ({ id, lat: 0, lon: 0, scalars: {}, title: id });
const rule = (params: AreaRule["params"]): AreaRule => ({
  id: "rule:1", areaId: "area:1", sourceId: "earthquakes", params,
  channels: { browser: true, telegram: false, discord: false },
  enabled: true, createdAt: 0,
});

describe("G1 — the first observation seeds silently", () => {
  it("announces nothing when there is no previous observation, so arming over a busy area does not fire ninety times", () => {
    const rows = Array.from({ length: 90 }, (_, i) => row(`e${i}`));
    const { events } = diff(undefined, rows, RING, [rule({ kind: "appears" })], { ok: true, lastOk: 1_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("still records the seed, so the NEXT poll compares against it and a genuinely new row does fire", () => {
    const seed = diff(undefined, [row("a")], RING, [rule({ kind: "appears" })], { ok: true, lastOk: 1_000 }, 2_000);
    expect(seed.next.rows.a).toBeTruthy();
    const then = diff(seed.next, [row("a"), row("b")], RING, [rule({ kind: "appears" })], { ok: true, lastOk: 2_000 }, 3_000);
    expect(then.events).toHaveLength(1);
    expect(then.events[0].rowId).toBe("b");
  });

  it("seeds a count rule silently too, so arming above the level does not fire immediately", () => {
    const { events } = diff(
      undefined, [row("a"), row("b"), row("c")], RING,
      [rule({ kind: "count", dir: "atOrAbove", level: 2 })],
      { ok: true, lastOk: 1_000 }, 2_000,
    );
    expect(events).toHaveLength(0);
  });
});

describe("G2 — a failed or suspicious poll is not a disappearance", () => {
  const countRule = rule({ kind: "count", dir: "below", level: 2 });
  const healthy: Observation = { ...EMPTY_OBSERVATION, rows: { a: { inside: true, scalars: {} }, b: { inside: true, scalars: {} } }, count: 2, lastOk: 1_000 };

  it("emits nothing when the fetch errored, whatever the rows say", () => {
    const { events } = diff(healthy, [], RING, [countRule], { ok: false, lastOk: 1_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("LEAVES THE OBSERVATION UNTOUCHED on a failed poll, so the next healthy poll compares against the last state we trusted", () => {
    const { next } = diff(healthy, [], RING, [countRule], { ok: false, lastOk: 1_000 }, 2_000);
    expect(next.count).toBe(2);
    expect(next.rows.a).toBeTruthy();
    expect(next.rows.b).toBeTruthy();
  });

  it("emits nothing when a healthy count collapses to zero, because that is an upstream hiccup wearing the costume of an evacuation", () => {
    const { events } = diff(healthy, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(events).toHaveLength(0);
  });

  it("leaves the observation untouched on a collapse to zero as well", () => {
    const { next } = diff(healthy, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(next.count).toBe(2);
  });

  it("ACCEPTS a genuine zero when the previous observation was also zero, so an empty area is not frozen forever", () => {
    const empty: Observation = { ...EMPTY_OBSERVATION, rows: {}, count: 0, lastOk: 1_000 };
    const { next } = diff(empty, [], RING, [countRule], { ok: true, lastOk: 2_000 }, 2_000);
    expect(next.lastOk).toBe(2_000);
  });

  it("still fires a `quiet` rule on a failed poll, because a dead feed is exactly what that trigger is for", () => {
    const prev: Observation = { ...EMPTY_OBSERVATION, lastOk: 1_000 };
    const { events } = diff(prev, [], RING, [rule({ kind: "quiet", silentMs: 60_000 })], { ok: false, lastOk: 0 }, 1_000 + 120_000);
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and WATCH IT GO RED**

Run: `npx vitest run tests/unit/notify-guards.test.ts`

Expected: **FAIL**, and confirm the specific failures before writing the guard. You should see:
- G1 "announces nothing when there is no previous observation" — FAIL, receives 90 events
- G1 "seeds a count rule silently too" — FAIL, receives 1 event
- G2 "LEAVES THE OBSERVATION UNTOUCHED" — FAIL, `next.count` is 0 not 2
- G2 "emits nothing when a healthy count collapses to zero" — FAIL, receives 1 event

If any of these four PASS at this step, stop: the test is not exercising what it claims and must be fixed before the guard is written.

- [ ] **Step 3: Implement both guards**

In `lib/notify/engine.ts`, replace the body of `diff` from `const before = ...` down to the `const events` declaration with:

```ts
  const seeding = prev === undefined;
  const before = prev ?? EMPTY_OBSERVATION;

  // G2 — is this poll worth believing?
  //   • the fetch errored, so its rows tell us nothing; or
  //   • a previously non-empty set came back completely empty, which is what an
  //     upstream hiccup looks like and is indistinguishable from a real evacuation.
  // Either way the OBSERVATION IS LEFT UNTOUCHED, so the next healthy poll compares
  // against the last state we trusted rather than against an empty one. Believing a
  // bad poll would announce that everything left Soho, and then announce it all
  // arriving back a minute later.
  const collapsed = before.count > 0 && rows.length === 0;
  const trustRows = feed.ok && !collapsed;

  const nextRows = trustRows ? snapshot(rows, ring) : before.rows;
  const insideNow = trustRows ? rows.filter((r) => isInside(r, ring)) : [];
  const next: Observation = {
    rows: nextRows,
    count: trustRows ? insideNow.length : before.count,
    lastOk: feed.ok && !collapsed ? feed.lastOk : before.lastOk,
    dueFired: before.dueFired,
    quietFired: before.quietFired,
  };
  if (trustRows) next.quietFired = false; // same expression the quiet branch negates

  const events: NotifyEvent[] = [];
  const armed = rules.filter((r) => r.enabled);
```

Then guard the three row-reading branches. Wrap the `appears`, `count` and `crosses` handling in:

```ts
  // G1 — the first observation SEEDS. Rows already present are not "appeared", and a
  // count already over its level is not a crossing. Arming a rule over a busy area
  // must not fire ninety messages about things that were there before the rule
  // existed. `quiet` is exempt: it reads the clock, not the rows.
  if (trustRows && !seeding) {
    for (const rule of armed) {
      // ... the appears / count / crosses branches, unchanged ...
    }
  }
```

Leave the `quiet` branch in its own loop **outside** that block, so a dead feed still announces itself:

```ts
  for (const rule of armed) {
    if (rule.params.kind !== "quiet") continue;
    const { silentMs } = rule.params;
    // A poll we TRUSTED is not silence, whatever the previous lastOk says. This
    // term must stay the exact complement of the `next.quietFired = false` reset
    // above — hence `trustRows`, not a re-typed `feed.ok`. If the two ever
    // disagree, the single poll on which a feed RECOVERS both fires a bogus
    // outage and re-latches quietFired after the reset already cleared it,
    // leaving the latch stuck true so the next genuine outage is never announced.
    const silentFor = !trustRows && before.lastOk > 0 ? now - before.lastOk : 0;
    if (silentFor >= silentMs && !before.quietFired) {
      events.push(event(rule, "quiet", now));
      next.quietFired = true;
    }
  }
```

- [ ] **Step 4: Run both test files to verify they pass**

Run: `npx vitest run tests/unit/notify-guards.test.ts tests/unit/notify-engine.test.ts`
Expected: PASS. 9 guard tests — that one is exact, this task writes all nine. The engine
file is CUMULATIVE and drifts (22 as measured on 2026-09-08); trust the file, not this
number, and never add or delete a test to make a count match.

> If an engine test from Task 2–4 now fails, it is because it passed `prev` as a real object and the guard is correct — check the test supplies a previous observation rather than `undefined`. Do not weaken the guard to satisfy a test.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/engine.ts tests/unit/notify-guards.test.ts
git commit -m "Notify: seed the first look silently, and never believe a poll that collapsed"
```

---

### Task 6: The rule store

Persisted `AreaRule[]`. The coercion is the interesting part: a rule naming an area or source that no longer exists is **dropped, not repaired**.

**Files:**
- Create: `lib/notify/rules.ts`
- Test: `tests/unit/notify-rules.test.ts`

**Interfaces:**
- Consumes: `AreaRule`, `TriggerParams` from Task 1.
- Produces: `coerceRules(saved, knownAreaIds, knownSourceIds)`, `rulesStore` with `get()`, `forArea(areaId)`, `add(rule)`, `remove(id)`, `setEnabled(id, on)`, `subscribe(fn)`, `hydrate(knownAreaIds, knownSourceIds)`, and `useAreaRules(areaId)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coerceRules } from "@/lib/notify/rules";
import { WORLD_AREA_ID } from "@/lib/notify/types";

const AREAS = new Set(["area:1", "area:2"]);
const SOURCES = new Set(["earthquakes", "planes"]);

const good = {
  id: "rule:1", areaId: "area:1", sourceId: "earthquakes",
  params: { kind: "appears" },
  channels: { browser: true, telegram: false, discord: false },
  enabled: true, createdAt: 1,
};

describe("coerceRules", () => {
  it("keeps a well-formed rule", () => {
    expect(coerceRules([good], AREAS, SOURCES)).toHaveLength(1);
  });

  it("DROPS a rule naming an area that no longer exists, rather than retargeting it — a silently retargeted rule watches a place nobody asked about", () => {
    const orphan = { ...good, id: "rule:2", areaId: "area:deleted" };
    expect(coerceRules([orphan], AREAS, SOURCES)).toHaveLength(0);
  });

  it("drops a rule naming a source that is no longer registered", () => {
    const orphan = { ...good, id: "rule:3", sourceId: "food-security" };
    expect(coerceRules([orphan], AREAS, SOURCES)).toHaveLength(0);
  });

  it("keeps a World rule even though `world` is not a drawn area", () => {
    const w = { ...good, id: "rule:4", areaId: WORLD_AREA_ID };
    expect(coerceRules([w], AREAS, SOURCES)).toHaveLength(1);
  });

  it("drops a rule whose params carry a level that is not a number", () => {
    const bad = { ...good, id: "rule:5", params: { kind: "count", dir: "atOrAbove", level: "lots" } };
    expect(coerceRules([bad], AREAS, SOURCES)).toHaveLength(0);
  });

  it("drops a rule whose trigger kind is not one of the nine", () => {
    const bad = { ...good, id: "rule:6", params: { kind: "explodes" } };
    expect(coerceRules([bad], AREAS, SOURCES)).toHaveLength(0);
  });

  it("returns an empty list for junk rather than throwing, so a corrupt key cannot brick the console", () => {
    expect(coerceRules("not an array", AREAS, SOURCES)).toEqual([]);
    expect(coerceRules(null, AREAS, SOURCES)).toEqual([]);
    expect(coerceRules([42, undefined], AREAS, SOURCES)).toEqual([]);
  });

  it("defaults a missing `enabled` to false, so a half-written rule never fires unasked", () => {
    const partial = { ...good, id: "rule:7", enabled: undefined };
    expect(coerceRules([partial], AREAS, SOURCES)[0].enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-rules.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/rules"`.

- [ ] **Step 3: Write the store**

Create `lib/notify/rules.ts`:

```ts
"use client";
// The area-owned rule set. Persisted to the user's own localStorage; no account,
// no server — the lib/shell/notifications.ts idiom, and it shares that file's
// channels and its `dispatch`.
//
// THE COERCION IS THE POINT. A rule naming an area that has been deleted, or a
// source that has been retired, is DROPPED rather than repaired. Retargeting it to
// some surviving area would leave the user watching a place they never asked about,
// and would do it silently. Four signal layers were retired on 2026-09-05; any rule
// pointing at one of them should simply cease to exist.

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import type { AreaRule, Direction, TriggerKind, TriggerParams } from "@/lib/notify/types";
import { WORLD_AREA_ID } from "@/lib/notify/types";

const KEY = "tn.notify.rules.v1";
const VERSION = 1;

const KINDS: readonly TriggerKind[] = [
  "appears", "disappears", "enters", "leaves",
  "crosses", "count", "state", "due", "quiet",
];
const DIRS: readonly Direction[] = ["atOrAbove", "below"];

/** PURE: a persisted params blob → valid TriggerParams, or null if it cannot be trusted. */
function coerceParams(raw: unknown): TriggerParams | null {
  const p = raw as { kind?: unknown; field?: unknown; dir?: unknown; level?: unknown; to?: unknown; leadMs?: unknown; silentMs?: unknown };
  if (!p || typeof p !== "object") return null;
  const kind = p.kind as TriggerKind;
  if (!KINDS.includes(kind)) return null;

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

  switch (kind) {
    case "appears": case "disappears": case "enters": case "leaves":
      return { kind };
    case "crosses": {
      const field = str(p.field), level = num(p.level);
      const dir = DIRS.includes(p.dir as Direction) ? (p.dir as Direction) : null;
      return field && dir && level != null ? { kind, field, dir, level } : null;
    }
    case "count": {
      const level = num(p.level);
      const dir = DIRS.includes(p.dir as Direction) ? (p.dir as Direction) : null;
      return dir && level != null ? { kind, dir, level } : null;
    }
    case "state": {
      const field = str(p.field), to = str(p.to);
      return field && to ? { kind, field, to } : null;
    }
    case "due": {
      const leadMs = num(p.leadMs);
      return leadMs != null && leadMs > 0 ? { kind, leadMs } : null;
    }
    case "quiet": {
      const silentMs = num(p.silentMs);
      return silentMs != null && silentMs > 0 ? { kind, silentMs } : null;
    }
  }
}

/** PURE: persisted blob → the rules that still name something real. */
export function coerceRules(
  saved: unknown,
  knownAreaIds: ReadonlySet<string>,
  knownSourceIds: ReadonlySet<string>,
): AreaRule[] {
  if (!Array.isArray(saved)) return [];
  const out: AreaRule[] = [];
  for (const raw of saved) {
    const r = raw as Partial<AreaRule> & { channels?: Partial<AreaRule["channels"]> };
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || typeof r.areaId !== "string" || typeof r.sourceId !== "string") continue;
    if (r.areaId !== WORLD_AREA_ID && !knownAreaIds.has(r.areaId)) continue;
    if (!knownSourceIds.has(r.sourceId)) continue;
    const params = coerceParams(r.params);
    if (!params) continue;
    const c = r.channels ?? {};
    out.push({
      id: r.id,
      areaId: r.areaId,
      sourceId: r.sourceId,
      params,
      channels: { browser: c.browser === true, telegram: c.telegram === true, discord: c.discord === true },
      enabled: r.enabled === true,
      createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    });
  }
  return out;
}

let rules: AreaRule[] = [];
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); savePersisted(KEY, VERSION, rules); }

export const rulesStore = {
  get(): AreaRule[] { return rules; },
  forArea(areaId: string): AreaRule[] { return rules.filter((r) => r.areaId === areaId); },
  add(rule: AreaRule) { rules = [rule, ...rules]; emit(); },
  remove(id: string) { rules = rules.filter((r) => r.id !== id); emit(); },
  setEnabled(id: string, on: boolean) {
    rules = rules.map((r) => (r.id === id ? { ...r, enabled: on } : r));
    emit();
  },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  hydrate(knownAreaIds: ReadonlySet<string>, knownSourceIds: ReadonlySet<string>) {
    rules = coerceRules(loadPersisted<unknown>(KEY, VERSION), knownAreaIds, knownSourceIds);
    emit();
  },
};

export function useAreaRules(areaId: string): AreaRule[] {
  return useSyncExternalStore(
    rulesStore.subscribe,
    () => rulesStore.forArea(areaId),
    () => rulesStore.forArea(areaId),
  );
}
```

> **`useAreaRules` derives with `.filter()`, which returns a new array every call.** `useSyncExternalStore` compares snapshots by identity and will loop forever. Task 6 Step 5 fixes this; do not skip it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-rules.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Fix the snapshot identity, and pin it**

A `getSnapshot` that derives a fresh value each call makes React re-render forever. Memoise per area, invalidated on every `emit`.

Replace `forArea` and `useAreaRules` in `lib/notify/rules.ts`:

```ts
// getSnapshot MUST return a stable reference between emits. `.filter()` returns a new
// array every call, and useSyncExternalStore compares by identity — a deriving
// snapshot is an infinite render loop, and React's default error for it names the
// hook rather than the cause. Memoised per area, cleared on every write.
let byArea = new Map<string, AreaRule[]>();
```

Add `byArea = new Map();` as the first line of `emit()`. Then:

```ts
  forArea(areaId: string): AreaRule[] {
    const hit = byArea.get(areaId);
    if (hit) return hit;
    const built = rules.filter((r) => r.areaId === areaId);
    byArea.set(areaId, built);
    return built;
  },
```

Append to `tests/unit/notify-rules.test.ts`:

```ts
import { rulesStore } from "@/lib/notify/rules";

describe("rulesStore snapshot identity", () => {
  it("returns the SAME array reference between writes, because a deriving getSnapshot loops useSyncExternalStore forever", () => {
    rulesStore.hydrate(AREAS, SOURCES);
    expect(rulesStore.forArea("area:1")).toBe(rulesStore.forArea("area:1"));
  });

  it("returns a NEW reference after a write, so subscribers actually re-render", () => {
    rulesStore.hydrate(AREAS, SOURCES);
    const first = rulesStore.forArea("area:1");
    rulesStore.add({ ...good, id: "rule:new" } as never);
    expect(rulesStore.forArea("area:1")).not.toBe(first);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-rules.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/rules.ts tests/unit/notify-rules.test.ts
git commit -m "Notify: rules that belong to an area, and drop themselves when it does not"
```

---

### Task 7: The observation store

Where the previous observation lives between polls, keyed by `(areaId, sourceId)`.

**Files:**
- Create: `lib/notify/observations.ts`
- Test: `tests/unit/notify-observations.test.ts`

**Interfaces:**
- Consumes: `Observation`, `EMPTY_OBSERVATION`.
- Produces: `obsKey(areaId, sourceId)`, `pruneObservations(saved, liveKeys)`, `observationsStore` with `get(areaId, sourceId)`, `put(areaId, sourceId, obs)`, `hydrate()`, `prune(liveKeys)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-observations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { obsKey, pruneObservations } from "@/lib/notify/observations";
import { EMPTY_OBSERVATION } from "@/lib/notify/engine";

describe("obsKey", () => {
  it("separates the same source watched by two different areas, which is the whole point of a per-area rule", () => {
    expect(obsKey("area:1", "planes")).not.toBe(obsKey("area:2", "planes"));
  });

  it("is stable for the same pair", () => {
    expect(obsKey("area:1", "planes")).toBe(obsKey("area:1", "planes"));
  });
});

describe("pruneObservations", () => {
  const saved = {
    [obsKey("area:1", "planes")]: EMPTY_OBSERVATION,
    [obsKey("area:gone", "planes")]: EMPTY_OBSERVATION,
  };

  it("keeps an observation whose pair is still armed", () => {
    const live = new Set([obsKey("area:1", "planes")]);
    expect(Object.keys(pruneObservations(saved, live))).toEqual([obsKey("area:1", "planes")]);
  });

  it("drops an observation for a pair nothing watches any more, so the key cannot grow without bound", () => {
    const live = new Set([obsKey("area:1", "planes")]);
    expect(pruneObservations(saved, live)[obsKey("area:gone", "planes")]).toBeUndefined();
  });

  it("returns an empty map for junk rather than throwing", () => {
    expect(pruneObservations("nonsense", new Set())).toEqual({});
    expect(pruneObservations(null, new Set())).toEqual({});
  });

  it("drops an entry whose shape is not an Observation, so a corrupt row cannot reach the engine as `prev`", () => {
    const corrupt = { [obsKey("area:1", "planes")]: { rows: "not an object" } };
    expect(pruneObservations(corrupt, new Set([obsKey("area:1", "planes")]))).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-observations.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/observations"`.

- [ ] **Step 3: Write the store**

Create `lib/notify/observations.ts`:

```ts
"use client";
// What we knew last time, per (area, source). This is the state that turns a
// stateless feed into a stream of transitions.
//
// PERSISTED, deliberately. If it lived only in memory, every reload would be a
// fresh seed (G1) and the first poll after a refresh would announce nothing — so a
// user who reloads during an incident would miss it. Persisting means a reload
// picks up where it left off.
//
// PRUNED on hydrate against the pairs that are actually armed, so disarming a rule
// does not leave its observation behind forever. localStorage is small and shared.

import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { EMPTY_OBSERVATION } from "@/lib/notify/engine";
import type { Observation } from "@/lib/notify/types";

const KEY = "tn.notify.obs.v1";
const VERSION = 1;

/** The composite key. A "|" cannot appear in an area id ("area:<epoch>") or a
 *  signal id, so no two pairs can collide. */
export function obsKey(areaId: string, sourceId: string): string {
  return `${areaId}|${sourceId}`;
}

function isObservation(v: unknown): v is Observation {
  const o = v as Partial<Observation>;
  return (
    !!o && typeof o === "object" &&
    !!o.rows && typeof o.rows === "object" && !Array.isArray(o.rows) &&
    typeof o.count === "number" && Number.isFinite(o.count) &&
    typeof o.lastOk === "number" && Number.isFinite(o.lastOk) &&
    Array.isArray(o.dueFired) &&
    typeof o.quietFired === "boolean"
  );
}

/** PURE: keep only well-shaped observations for pairs that are still armed. */
export function pruneObservations(
  saved: unknown,
  liveKeys: ReadonlySet<string>,
): Record<string, Observation> {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const out: Record<string, Observation> = {};
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (!liveKeys.has(k)) continue;
    if (!isObservation(v)) continue;
    out[k] = v;
  }
  return out;
}

let obs: Record<string, Observation> = {};

export const observationsStore = {
  /** `undefined` means never observed — the engine reads that as the seed case. */
  get(areaId: string, sourceId: string): Observation | undefined {
    return obs[obsKey(areaId, sourceId)];
  },
  put(areaId: string, sourceId: string, next: Observation) {
    obs = { ...obs, [obsKey(areaId, sourceId)]: next };
    savePersisted(KEY, VERSION, obs);
  },
  hydrate(liveKeys: ReadonlySet<string>) {
    obs = pruneObservations(loadPersisted<unknown>(KEY, VERSION), liveKeys);
    savePersisted(KEY, VERSION, obs);
  },
  /** Test-only: drop everything. */
  __reset() { obs = {}; },
};

export { EMPTY_OBSERVATION };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-observations.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/observations.ts tests/unit/notify-observations.test.ts
git commit -m "Notify: remember what each area last saw, so a reload does not reset the watch"
```

---

### Task 8: Wording — G4 and G5

Every sentence the product sends is built here. A channel message is stripped of all on-screen hedging, so a source's honesty rules have to travel with the text. This mirrors `BANNED_IN_DERIVED` in `camslot.conditions.ts`.

**Files:**
- Create: `lib/notify/wording.ts`
- Test: `tests/unit/notify-wording.test.ts`

**Interfaces:**
- Consumes: `NotifyEvent`, `ObservedRow`, `AreaRule`.
- Produces: `wordEvent(event, ctx)` returning a `string`, and `SOURCE_WORDING`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-wording.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wordEvent } from "@/lib/notify/wording";
import type { NotifyEvent } from "@/lib/notify/types";

const ev = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  ruleId: "rule:1", areaId: "area:1", sourceId: "earthquakes",
  kind: "appears", rowId: "q1", text: "", at: 1_000, ...over,
});

const ctx = {
  areaLabel: "Soho",
  sourceLabel: "Earthquakes",
  rowTitle: "M5.4 — 12 km NE of Ridgecrest",
  count: 4,
  level: 3,
};

describe("wordEvent — G4, every message names its area", () => {
  it("leads with the area, so two areas watching planes do not send two identical lines", () => {
    expect(wordEvent(ev(), ctx)).toMatch(/^Soho · /);
  });

  it("names the source after the area", () => {
    expect(wordEvent(ev(), ctx)).toContain("Soho · Earthquakes · ");
  });

  it("names the row for a row-scoped event", () => {
    expect(wordEvent(ev(), ctx)).toContain("M5.4 — 12 km NE of Ridgecrest");
  });

  it("says the count for a count event, which has no row", () => {
    const text = wordEvent(ev({ kind: "count", rowId: undefined }), ctx);
    expect(text).toContain("4");
    expect(text).not.toContain("undefined");
  });
});

describe("wordEvent — G5, a source's honesty rules travel with the message", () => {
  it("words a GDELT event as REPORTED and never asserts an incident, because those rows are coded news coverage", () => {
    const text = wordEvent(ev({ sourceId: "conflict" }), { ...ctx, sourceLabel: "Conflict coverage" });
    expect(text).toMatch(/report/i);
    expect(text).toContain("not a verified incident");
  });

  it("words an AIS disappearance as STOPPED BEING HEARD, because leaving coverage and switching off a transponder look identical", () => {
    const text = wordEvent(ev({ sourceId: "ais", kind: "disappears" }), { ...ctx, sourceLabel: "AIS vessels" });
    expect(text).toContain("stopped being heard");
    expect(text).not.toMatch(/\bleft\b|\bdeparted\b/);
  });

  it("names the country for an instability event, because the index is scored per country and cannot be narrower than the ring", () => {
    const text = wordEvent(
      ev({ sourceId: "instability", kind: "crosses" }),
      { ...ctx, sourceLabel: "Country instability", rowTitle: "Sudan", level: 60 },
    );
    expect(text).toContain("Sudan");
    expect(text).toMatch(/scored per country/i);
  });

  it("leaves an ordinary source unadorned, so the caveat machinery does not clutter every message", () => {
    const text = wordEvent(ev(), ctx);
    expect(text).not.toContain("not a verified incident");
    expect(text).not.toMatch(/scored per country/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-wording.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/wording"`.

- [ ] **Step 3: Write the wording**

Create `lib/notify/wording.ts`:

```ts
// EVERY SENTENCE A NOTIFICATION SENDS IS BUILT HERE, and nothing here touches React,
// the DOM or the network — so every claim the product makes in someone's Telegram is
// decided in one pure, node-testable file. This is deliberately the same arrangement
// as camslot.conditions.ts, and for the same reason.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. A channel message is stripped of every
// on-screen hedge: no tooltip, no provenance panel, no "coverage" label beside the
// layer name. Whatever a source is careful to say on the map has to be said again
// here, in the message itself, or the care is lost exactly where it matters most.

import type { NotifyEvent } from "@/lib/notify/types";

export interface WordingContext {
  areaLabel: string;
  sourceLabel: string;
  /** Title of the row that caused it. Absent for `count` and `quiet`. */
  rowTitle?: string;
  /** Rows inside the ring, for `count`. */
  count?: number;
  /** The rule's level, for `count` and `crosses`. */
  level?: number;
}

/**
 * Per-source qualifiers, appended to the message. Keyed by signal id.
 *
 * These are not decoration. Each one restates on the wire a limit the app already
 * states on screen, because the message travels without the screen.
 */
export const SOURCE_WORDING: Record<string, { suffix?: string; verb?: Partial<Record<NotifyEvent["kind"], string>> }> = {
  // GDELT rows are coded news COVERAGE, not verified incidents. lib/signals/gdelt.ts
  // already refuses to state a CAMEO label as fact; the message must not undo that.
  // One article about a livestream once seeded pins on three cities.
  conflict: {
    suffix: "Reported coverage, not a verified incident.",
    verb: { appears: "was reported in", count: "reports in" },
  },
  protests: {
    suffix: "Reported coverage, not a verified incident.",
    verb: { appears: "was reported in", count: "reports in" },
  },
  // Terrestrial receivers only. A vessel leaving coverage and a vessel switching off
  // its transponder are indistinguishable, so the message must not claim it left.
  ais: {
    verb: { disappears: "stopped being heard in" },
  },
  // Scored per country, so an area rule resolves to the countries the ring touches
  // and cannot be narrower. The score is a conservative floor on most countries.
  instability: {
    suffix: "Scored per country, and a floor where inputs are missing.",
  },
};

const VERB: Record<NotifyEvent["kind"], string> = {
  appears: "appeared in",
  disappears: "disappeared from",
  enters: "entered",
  leaves: "left",
  crosses: "crossed the level in",
  count: "inside",
  state: "changed state in",
  due: "is due in",
  quiet: "has gone quiet for",
};

/** PURE: one event → the sentence that is sent. */
export function wordEvent(event: NotifyEvent, ctx: WordingContext): string {
  const w = SOURCE_WORDING[event.sourceId] ?? {};
  const verb = w.verb?.[event.kind] ?? VERB[event.kind];

  let body: string;
  if (event.kind === "count") {
    body = `${ctx.count ?? 0} ${verb} the area (level ${ctx.level ?? 0})`;
  } else if (event.kind === "quiet") {
    body = `${verb} the configured window`;
  } else if (event.kind === "crosses") {
    body = `${ctx.rowTitle ?? "a row"} ${verb} ${ctx.areaLabel} (level ${ctx.level ?? 0})`;
  } else {
    body = `${ctx.rowTitle ?? "a row"} ${verb} ${ctx.areaLabel}`;
  }

  // G4 — the area ALWAYS leads. Two areas watching planes must never produce two
  // indistinguishable lines.
  const head = `${ctx.areaLabel} · ${ctx.sourceLabel} · `;
  return w.suffix ? `${head}${body}. ${w.suffix}` : `${head}${body}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-wording.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/wording.ts tests/unit/notify-wording.test.ts
git commit -m "Notify: say on the wire what the map is careful to say on screen"
```

---

### Task 9: The budget — G3

Delivery is immediate, with a per-area ceiling, and **the ceiling never drops silently**.

**Files:**
- Create: `lib/notify/budget.ts`
- Test: `tests/unit/notify-budget.test.ts`

**Interfaces:**
- Consumes: `NotifyEvent`.
- Produces: `MAX_PER_AREA_HOUR`, `WINDOW_MS`, `applyBudget(events, sent, now)` returning `{ send: NotifyEvent[]; held: number; nextSent: number[]; closing: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notify-budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyBudget, MAX_PER_AREA_HOUR, WINDOW_MS } from "@/lib/notify/budget";
import type { NotifyEvent } from "@/lib/notify/types";

const events = (n: number, at = 1_000): NotifyEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    ruleId: "rule:1", areaId: "area:1", sourceId: "earthquakes",
    kind: "appears" as const, rowId: `r${i}`, text: `t${i}`, at,
  }));

describe("applyBudget", () => {
  it("sends everything under the ceiling", () => {
    const { send, held } = applyBudget(events(5), [], 1_000);
    expect(send).toHaveLength(5);
    expect(held).toBe(0);
  });

  it("sends up to the ceiling and holds the rest", () => {
    const { send, held } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(send).toHaveLength(MAX_PER_AREA_HOUR);
    expect(held).toBe(6);
  });

  it("counts sends already made inside the window", () => {
    const already = Array.from({ length: MAX_PER_AREA_HOUR - 2 }, () => 900);
    const { send, held } = applyBudget(events(5), already, 1_000);
    expect(send).toHaveLength(2);
    expect(held).toBe(3);
  });

  it("forgets sends that fell out of the rolling window, so the ceiling is per hour and not for ever", () => {
    const old = Array.from({ length: MAX_PER_AREA_HOUR }, () => 1_000);
    const { send } = applyBudget(events(3), old, 1_000 + WINDOW_MS + 1);
    expect(send).toHaveLength(3);
  });

  it("RETURNS A CLOSING LINE naming how many were held, because suppression nobody was told about is the worst outcome available", () => {
    const { closing } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(closing).toContain("6");
    expect(closing).toMatch(/held/i);
  });

  it("returns no closing line when nothing was held", () => {
    expect(applyBudget(events(2), [], 1_000).closing).toBeNull();
  });

  it("records the timestamps of what it actually sent, so the next call's window is right", () => {
    const { nextSent } = applyBudget(events(3, 1_234), [], 1_234);
    expect(nextSent.filter((t) => t === 1_234)).toHaveLength(3);
  });

  it("does not let the closing line itself consume budget, or a storm would silence its own warning", () => {
    const { send, nextSent } = applyBudget(events(MAX_PER_AREA_HOUR + 6), [], 1_000);
    expect(nextSent).toHaveLength(send.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-budget.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/notify/budget"`.

- [ ] **Step 3: Write the budget**

Create `lib/notify/budget.ts`:

```ts
// G3 — a per-area ceiling on immediate delivery, and it NEVER DROPS SILENTLY.
//
// Sampo chose immediate delivery over a digest tier, and the honest objection to a
// cap is that dropping is silent. So this holds rather than drops: held events stay
// visible in the console, and one line goes out naming how many were held. That
// line does not itself consume budget — a storm that silenced its own warning would
// be the failure this exists to prevent.

import type { NotifyEvent } from "@/lib/notify/types";

/** Per area, per rolling hour. */
export const MAX_PER_AREA_HOUR = 20;
export const WINDOW_MS = 60 * 60_000;

/**
 * PURE: split this batch into what is sent and what is held.
 *
 * @param sent epoch-ms timestamps of prior sends for THIS area, any age.
 */
export function applyBudget(
  events: readonly NotifyEvent[],
  sent: readonly number[],
  now: number,
): { send: NotifyEvent[]; held: number; nextSent: number[]; closing: string | null } {
  const live = sent.filter((t) => now - t < WINDOW_MS);
  const room = Math.max(0, MAX_PER_AREA_HOUR - live.length);
  const send = events.slice(0, room);
  const held = events.length - send.length;

  const area = events[0]?.areaId ?? "";
  return {
    send,
    held,
    nextSent: [...live, ...send.map((e) => e.at)],
    closing: held > 0 ? `${area}: ${held} more held this hour. They are listed in the console.` : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/notify-budget.test.ts`
Expected: PASS, 8 tests.

> The last test passes because `nextSent` counts only `send`, never the closing line. Keep it that way.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/budget.ts tests/unit/notify-budget.test.ts
git commit -m "Notify: a ceiling that holds and says so, rather than dropping in silence"
```

---

### Task 10: The runner

The thin impure shell. It subscribes, calls the pure pieces in order, and hands text to the existing `dispatch()`. No decisions are made here.

**Files:**
- Create: `lib/notify/runner.ts`
- Modify: `components/shell/ConsoleShell.tsx`

**Interfaces:**
- Consumes: `diff`, `rulesStore`, `observationsStore`, `wordEvent`, `applyBudget`, `resolveTriggers`, and `dispatch` / `notificationsStore` from `lib/shell/notifications`.
- Produces: `startNotifyRunner(): () => void` — mounts the loop, returns a teardown.

- [ ] **Step 1: Write the runner**

Create `lib/notify/runner.ts`:

```ts
"use client";
// The impure shell. It reads the stores, calls the pure pieces in the one correct
// order, and hands finished text to `dispatch` in lib/shell/notifications.ts.
//
// NOTHING HERE DECIDES ANYTHING. What happened is engine.ts, how it is worded is
// wording.ts, whether it is sent is budget.ts. If a behaviour question arises in
// this file, it belongs in one of those three.
//
// WHY IT IS ONE SUBSCRIBER AND NOT PER-WIDGET. A rule must fire whether or not a
// widget for its source is on the board — the point of an area rule is that you are
// watching a PLACE, not a card. WidgetFrame's existing per-mount dispatch cannot do
// that, and is left alone: it keeps serving the widget-type rules it always did.

import { diff } from "@/lib/notify/engine";
import { rulesStore } from "@/lib/notify/rules";
import { observationsStore } from "@/lib/notify/observations";
import { wordEvent } from "@/lib/notify/wording";
import { applyBudget } from "@/lib/notify/budget";
import { dispatch, notificationsStore, type NotifyRule } from "@/lib/shell/notifications";
import { inspectorStore } from "@/lib/shell/inspector";
import { WORLD_AREA_ID, type AreaRule, type ObservedRow } from "@/lib/notify/types";

/** How often the runner re-reads the feeds. Well under the fastest source cadence
 *  (planes at 12s) so a transition is not missed, and cheap because it reads stores
 *  that are already being filled — it adds no upstream request of its own. */
const TICK_MS = 10_000;

/** Per-area send timestamps for the rolling budget. In memory only: a reload
 *  legitimately starts a fresh hour, and persisting it would let a stale window
 *  silence a genuinely new incident. */
const sentByArea = new Map<string, number[]>();

/** Supplied by the source adapters registered in `lib/notify/sources.ts` (Task 11). */
export interface SourceFeed {
  rows: readonly ObservedRow[];
  ok: boolean;
  lastOk: number;
  label: string;
}
export type FeedReader = (sourceId: string) => SourceFeed | null;

function ringFor(areaId: string): readonly [number, number][] | null {
  if (areaId === WORLD_AREA_ID) return null;
  const area = inspectorStore.get().areas.find((a) => a.id === areaId);
  return area ? area.polygon : null;
}

function labelFor(areaId: string): string {
  if (areaId === WORLD_AREA_ID) return "World";
  return inspectorStore.get().areas.find((a) => a.id === areaId)?.label ?? areaId;
}

/** One pass: diff every armed (area, source) pair, word it, budget it, send it. */
export function tick(readFeed: FeedReader, now: number): void {
  const rules = rulesStore.get().filter((r) => r.enabled);
  if (rules.length === 0) return;

  // Group by pair so one diff serves every rule watching the same area and source.
  const pairs = new Map<string, { areaId: string; sourceId: string; rules: AreaRule[] }>();
  for (const r of rules) {
    const k = `${r.areaId}|${r.sourceId}`;
    const hit = pairs.get(k);
    if (hit) hit.rules.push(r);
    else pairs.set(k, { areaId: r.areaId, sourceId: r.sourceId, rules: [r] });
  }

  const perArea = new Map<string, { text: string; areaId: string; at: number }[]>();

  for (const { areaId, sourceId, rules: armed } of pairs.values()) {
    const feed = readFeed(sourceId);
    if (!feed) continue; // source not registered / not loaded — not an error

    const prev = observationsStore.get(areaId, sourceId);
    const { events, next } = diff(prev, feed.rows, ringFor(areaId), armed, { ok: feed.ok, lastOk: feed.lastOk }, now);
    observationsStore.put(areaId, sourceId, next);
    if (events.length === 0) continue;

    const areaLabel = labelFor(areaId);
    for (const e of events) {
      const row = e.rowId ? feed.rows.find((r) => r.id === e.rowId) : undefined;
      const rule = armed.find((r) => r.id === e.ruleId);
      const level =
        rule && (rule.params.kind === "count" || rule.params.kind === "crosses")
          ? rule.params.level
          : undefined;
      const text = wordEvent(e, {
        areaLabel,
        sourceLabel: feed.label,
        rowTitle: row?.title,
        count: next.count,
        level,
      });
      const bucket = perArea.get(areaId) ?? [];
      // The ruleId RIDES ALONG. Each event is sent on the channels of the rule that
      // produced it — a rule armed to Browser only must not reach Telegram because
      // some other rule on the same area happens to have Telegram on.
      bucket.push({ ...e, text });
      perArea.set(areaId, bucket);
    }
  }

  for (const [areaId, items] of perArea) {
    const { send, nextSent, closing } = applyBudget(items, sentByArea.get(areaId) ?? [], now);
    sentByArea.set(areaId, nextSent);

    for (const e of send) {
      const rule = rulesStore.get().find((r) => r.id === e.ruleId);
      if (rule) fanOut(e.text, rule.channels);
    }
    // The closing line is about the AREA, not about any one rule, so it goes to the
    // union of everything armed there — it must reach whoever was going to be
    // notified, whichever rule's events were the ones held.
    if (closing) fanOut(closing, unionChannels(areaId));
  }
}

function unionChannels(areaId: string): NotifyRule["channels"] {
  const channels = { browser: false, telegram: false, discord: false };
  for (const r of rulesStore.forArea(areaId)) {
    if (!r.enabled) continue;
    channels.browser ||= r.channels.browser;
    channels.telegram ||= r.channels.telegram;
    channels.discord ||= r.channels.discord;
  }
  return channels;
}

/** Fan one line out on exactly these channels. */
function fanOut(text: string, channels: NotifyRule["channels"]): void {
  // Reuses the existing master gate, cred checks and relays verbatim — a rule here
  // can never send through a channel the user has switched off globally.
  const rule: NotifyRule = { enabled: true, channels };
  dispatch(text, rule);
}

/** Mount the loop. Returns a teardown for ConsoleShell's effect. */
export function startNotifyRunner(readFeed: FeedReader): () => void {
  if (typeof window === "undefined") return () => {};
  const h = window.setInterval(() => {
    if (!notificationsStore.getState().master) return; // global gate, checked live
    tick(readFeed, Date.now());
  }, TICK_MS);
  return () => window.clearInterval(h);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS.

> If `NotifyRule` complains about a missing `minValue`, it is optional in `lib/shell/notifications.ts` — confirm rather than adding a field.

- [ ] **Step 3: Hydrate the stores and mount the runner**

In `components/shell/ConsoleShell.tsx`, find the hydrate block containing `notificationsStore.hydrate();` and add below it:

```tsx
    // Rules hydrate AFTER inspectorStore, because coercion drops a rule naming an
    // area that no longer exists — and before that store is hydrated, no area does.
    const areaIds = new Set(inspectorStore.get().areas.map((a) => a.id));
    const sourceIds = new Set(SIGNALS.map((s) => s.id));
    rulesStore.hydrate(areaIds, sourceIds);
    observationsStore.hydrate(
      new Set(rulesStore.get().map((r) => `${r.areaId}|${r.sourceId}`)),
    );
```

Add the imports at the top of the file:

```tsx
import { rulesStore } from "@/lib/notify/rules";
import { observationsStore } from "@/lib/notify/observations";
import { startNotifyRunner } from "@/lib/notify/runner";
import { SIGNALS } from "@/lib/signals/registry";
```

And a separate effect to mount the runner:

```tsx
  useEffect(() => startNotifyRunner(readNotifyFeed), []);
```

- [ ] **Step 4: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/runner.ts components/shell/ConsoleShell.tsx
git commit -m "Notify: one runner for every area, not one per card on the board"
```

---

### Task 11: Source feeds and the composer

The last task wires real rows in and puts the control on the screen.

**Files:**
- Create: `lib/notify/sources.ts`
- Create: `components/shell/inspector/RulesPanel.tsx`
- Modify: `components/shell/inspector/AreasPanel.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: everything above.
- Produces: `readNotifyFeed(sourceId): SourceFeed | null`, `armableSources()`, and the `<RulesPanel areaId>` component.

- [ ] **Step 1: Write the feed adapter**

Create `lib/notify/sources.ts`:

```ts
"use client";
// Flattens a source's real rows into ObservedRow, which is all the engine knows.
//
// SIGNALS ONLY IN M1. Core layers (planes, cameras) arrive in M3 with enters/leaves,
// which is when their positions are actually needed. A source this file does not
// know returns null, and the runner treats that as "not loaded" rather than an
// error — dormant-safe, like every other fetch path in this codebase.

import { SIGNALS, getSignal } from "@/lib/signals/registry";
import type { SignalFeature } from "@/lib/signals/types";
import type { ObservedRow } from "@/lib/notify/types";
import type { SourceFeed } from "@/lib/notify/runner";

/** Last successful payload per signal id, filled by the shared signal feed hook. */
const cache = new Map<string, { rows: SignalFeature[]; ok: boolean; lastOk: number }>();

/** Called by `useSignalFeed` on every settled poll, so the runner reads the same
 *  data the widgets read and adds no upstream request of its own. */
export function recordSignalPoll(id: string, rows: SignalFeature[], ok: boolean, at: number): void {
  const prev = cache.get(id);
  cache.set(id, { rows: ok ? rows : (prev?.rows ?? []), ok, lastOk: ok ? at : (prev?.lastOk ?? 0) });
}

/**
 * PURE: a SignalFeature → the flat row the engine reads.
 *
 * THE SCALAR COMES FROM THE SOURCE'S OWN `metric`, not from a hardcoded field name.
 * `SignalMetric` already exists in lib/signals/types.ts precisely because
 * `props.magnitude` is overloaded — a Richter value for quakes, a rescaled radius
 * proxy for GDACS and cyclones — and each source names its REAL field and domain
 * there. That declaration is exactly what a threshold needs, so `crosses` reads it
 * rather than inventing a parallel one. A source with no `metric` offers no
 * `crosses`, which is the honest answer.
 */
export function toObservedRow(f: SignalFeature, metricField?: string): ObservedRow {
  const scalars: Record<string, number> = {};
  if (metricField) {
    const raw = metricField === "magnitude" ? f.props?.magnitude : f.props?.[metricField];
    if (typeof raw === "number" && Number.isFinite(raw)) scalars[metricField] = raw;
  }
  return {
    id: f.id, lat: f.lat, lon: f.lon, scalars, title: f.title,
    ...(f.ts ? { dueAt: f.ts } : {}),
  };
}

export function readNotifyFeed(sourceId: string): SourceFeed | null {
  const source = getSignal(sourceId);
  const hit = cache.get(sourceId);
  if (!source || !hit) return null;
  const field = source.metric?.field;
  return {
    rows: hit.rows.map((f) => toObservedRow(f, field)),
    ok: hit.ok, lastOk: hit.lastOk, label: source.label,
  };
}

/** Every source the composer may offer, with what it needs to build the menu.
 *  `metric` is passed through so the composer can label the threshold with the
 *  source's real field and clamp it to the source's real domain. */
export function armableSources(): {
  id: string; label: string; group: string;
  metric?: { field: string; domain: [number, number]; unit?: string };
}[] {
  return SIGNALS.map((s) => ({
    id: s.id, label: s.label, group: s.group,
    ...(s.metric ? { metric: { field: s.metric.field, domain: s.metric.domain, unit: s.metric.unit } } : {}),
  }));
}
```

Then in `lib/console/signals/useSignalFeed.ts` (or wherever `useSignalFeed` settles a poll), call `recordSignalPoll(id, features, ok, Date.now())` on each settled fetch. Locate it with:

```bash
grep -rn "export function useSignalFeed" lib/
```

- [ ] **Step 2: Write the composer**

Create `components/shell/inspector/RulesPanel.tsx`:

```tsx
"use client";
// The composer, and the armed list, for ONE area.
//
// THE SECOND DROPDOWN IS THE WHOLE FEATURE. Its options come from
// resolveTriggers(), so a combination the source cannot back is never offered — and
// a source that can back nothing renders an empty, disabled list and says why,
// rather than offering something it cannot deliver. Nuclear plants are the case
// that forced it: an OSM extract with no operating state.
//
// NOT A SECOND EDITOR. WidgetFrame's bell opens this panel; it does not grow its own
// copy of these controls. AreasPanel already holds that line for the source list.

import { useMemo, useState } from "react";
import { resolveTriggers } from "@/lib/notify/capability";
import { armableSources } from "@/lib/notify/sources";
import { rulesStore, useAreaRules } from "@/lib/notify/rules";
import type { AreaRule, TriggerKind, TriggerParams } from "@/lib/notify/types";

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  appears: "appears in the area",
  disappears: "disappears from the area",
  enters: "enters the area",
  leaves: "leaves the area",
  crosses: "crosses a level",
  count: "how many crosses a level",
  state: "changes state",
  due: "is due",
  quiet: "goes quiet",
};

/** M1 ships four. The rest are resolved and listed but not yet armable, so the menu
 *  never advertises a kind the engine would silently ignore. */
const IMPLEMENTED: TriggerKind[] = ["appears", "crosses", "count", "quiet"];

export default function RulesPanel({ areaId }: { areaId: string }) {
  const sources = useMemo(armableSources, []);
  const rules = useAreaRules(areaId);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [kind, setKind] = useState<TriggerKind>("appears");
  const [level, setLevel] = useState(5);
  const [channels, setChannels] = useState({ browser: true, telegram: false, discord: false });

  const source = sources.find((s) => s.id === sourceId);
  const offered = useMemo(() => {
    if (!source) return [];
    // A source with no `metric` names no real scalar, so `crosses` has no field to
    // read and is dropped — the group default cannot conjure one. This is layer 3
    // doing its job with the declaration the codebase already has.
    return resolveTriggers(source.group, source.metric ? { scalars: [{ field: source.metric.field, label: source.metric.field, domain: source.metric.domain }] } : { remove: ["crosses"] })
      .filter((k) => IMPLEMENTED.includes(k));
  }, [source]);

  const arm = () => {
    let params: TriggerParams;
    if (kind === "crosses") {
      if (!source?.metric) return; // offered[] already prevents this; belt and braces
      params = { kind, field: source.metric.field, dir: "atOrAbove", level };
    }
    else if (kind === "count") params = { kind, dir: "atOrAbove", level };
    else if (kind === "quiet") params = { kind, silentMs: 30 * 60_000 };
    else params = { kind: "appears" };

    const rule: AreaRule = {
      id: `rule:${Date.now()}`,
      areaId, sourceId, params, channels,
      enabled: true, createdAt: Date.now(),
    };
    rulesStore.add(rule);
  };

  return (
    <div className="tn-rules">
      <div className="tn-subhead">
        Rules <span className="tn-insp-count">{rules.length}</span>
      </div>

      <label className="tn-rules-row">
        <span>When</span>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.label} — {s.group}</option>
          ))}
        </select>
      </label>

      <label className="tn-rules-row">
        <span className="tn-sr-only">What it has to do</span>
        <select
          value={kind}
          disabled={offered.length === 0}
          onChange={(e) => setKind(e.target.value as TriggerKind)}
        >
          {offered.length === 0
            ? <option>— nothing this source can back —</option>
            : offered.map((k) => <option key={k} value={k}>{TRIGGER_LABEL[k]}</option>)}
        </select>
      </label>

      {offered.length === 0 && (
        <p className="tn-rules-refuse">
          {source?.label} publishes no state to notice a change in. It is reference
          data — a position and its tags — so there is no honest rule to build here.
        </p>
      )}

      {(kind === "crosses" || kind === "count") && offered.length > 0 && (
        <label className="tn-rules-row">
          <span>{kind === "crosses" ? source?.metric?.field ?? "Level" : "Count"}</span>
          <input
            type="number" value={level}
            min={kind === "crosses" ? source?.metric?.domain[0] : 0}
            max={kind === "crosses" ? source?.metric?.domain[1] : undefined}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
          {kind === "crosses" && source?.metric && (
            <span className="tn-rules-domain">
              {source.metric.domain[0]}–{source.metric.domain[1]}{source.metric.unit ?? ""}
            </span>
          )}
        </label>
      )}

      <div className="tn-rules-row">
        <span>Send</span>
        {(["browser", "telegram", "discord"] as const).map((c) => (
          <label key={c} className="tn-rules-ch">
            <input
              type="checkbox" checked={channels[c]}
              onChange={(e) => setChannels({ ...channels, [c]: e.target.checked })}
            />
            {c[0].toUpperCase() + c.slice(1)}
          </label>
        ))}
      </div>

      <button type="button" onClick={arm} disabled={offered.length === 0}>
        Arm rule
      </button>

      <ul className="tn-rules-list">
        {rules.map((r) => (
          <li key={r.id}>
            <span>{r.sourceId} {TRIGGER_LABEL[r.params.kind]}</span>
            <button type="button" onClick={() => rulesStore.remove(r.id)} aria-label="Remove rule">×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Show the rule count on the area row**

In `components/shell/inspector/AreasPanel.tsx`, import the store and render `<RulesPanel>` for the editing area. Add to the imports:

```tsx
import RulesPanel from "@/components/shell/inspector/RulesPanel";
import { rulesStore } from "@/lib/notify/rules";
```

Inside the area row, after the existing `tn-insp-sub` span, add:

```tsx
            {rulesStore.forArea(a.id).length > 0 && (
              <span className="tn-insp-pill">{rulesStore.forArea(a.id).length} ▲</span>
            )}
```

And after the `state.areas.map(...)` block, render the composer for whichever area is being edited:

```tsx
      {state.editing && <RulesPanel areaId={state.editing} />}
```

- [ ] **Step 4: Add the styles**

In `app/globals.css`, beside the existing `.tn-insp-*` rules, add:

```css
.tn-rules { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 4px; }
.tn-rules-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.tn-rules-row > span:first-child { width: 44px; color: var(--tn-text-muted); flex: none; }
.tn-rules-row select,
.tn-rules-row input[type="number"] {
  flex: 1; min-width: 0; font: inherit; color: var(--tn-text);
  background: var(--tn-surface-solid); border: 1px solid var(--tn-border-strong);
  border-radius: 4px; padding: 5px 7px;
}
.tn-rules-ch { display: inline-flex; align-items: center; gap: 4px; }
.tn-rules-refuse { font-size: 12px; color: var(--tn-text-muted); line-height: 1.45; margin: 0; }
.tn-rules-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.tn-rules-list li { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.tn-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 5: Verify in the real app**

```bash
npm run dev
```

Open `http://localhost:3000/app`, draw an area, and confirm:
1. The Rules block appears under the area's sources.
2. Changing the source rebuilds the trigger list.
3. Selecting **Nuclear plants** empties the list, disables it, and shows the refusal sentence.
4. Arming a rule adds it to the list and puts a count pill on the area row.
5. A reload keeps both.

Capture evidence:

```bash
npx playwright screenshot --viewport-size=1440,820 http://localhost:3000/app persona-shots/area-rules-1440x820.png
```

- [ ] **Step 6: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/notify/sources.ts components/shell/inspector/RulesPanel.tsx components/shell/inspector/AreasPanel.tsx app/globals.css lib/console/signals/useSignalFeed.ts persona-shots/area-rules-1440x820.png
git commit -m "M1: arm a rule on an area, from a menu that cannot offer what the data will not back"
```

---

## Self-review

**Spec coverage.** §3 data model → Task 1, 6. §4 vocabulary → Tasks 2–4 (four of nine; the other five are M2–M4 by design). §5 four-layer resolution → Task 1 (layers 2, 3), Task 11 (the menu reads it). **Layer 4's audit and calibration is M2 per §9 of the spec** and has no task here — correct, since it annotates the `crosses` control with observed values and M1 has no declarations to audit yet. §6 engine → Tasks 2–5, 10. §7 guards → Task 5 (G1, G2), Task 8 (G4, G5), Task 9 (G3). §8 interface → Task 11. §10 testing → every task.

**Layer 3 in M1, from a declaration that already exists.** `SignalSource.metric`
(`{ field, domain, unit }`) is already in `lib/signals/types.ts`, and it exists for
exactly this reason: `props.magnitude` is overloaded — a Richter value for quakes, a
rescaled radius proxy for GDACS and cyclones — so each source names its real field
and its real domain there. Task 11 builds a `TriggerCapability` from it, so `crosses`
reads the source's own field, its threshold input is clamped to the source's own
domain, and a source with no `metric` does not offer `crosses` at all. No hardcoded
field name, and no invented parallel declaration.

**Still deferred to M2:** layer 4's audit and observed-value calibration, and
`state` / `due` declarations. §9 of the spec phases both there.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries its code.

**Type consistency.** `Observation` gained `quietFired` in Task 1 and is used in Tasks 4, 5, 7. `EMPTY_OBSERVATION` is exported from `engine.ts` and re-exported by `observations.ts` — one definition. `NotifyEvent.text` is `""` from the engine and filled by `wordEvent`; the runner is the only caller that does the filling. `resolveTriggers(group, declaration)` has the same signature in Tasks 1 and 11. `SourceFeed` is defined in `runner.ts` and imported by `sources.ts`, not redeclared.
