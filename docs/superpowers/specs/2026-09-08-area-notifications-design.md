# Area notifications — design

Date: 2026-09-08
Status: approved, not implemented
Branch: `feat/area-notifications`

Tell the console to watch a place. Pick a source, pick what it has to do, pick where the
message goes. The rule belongs to the area you drew, and the middle choice only ever offers
what that source can actually back.

---

## 1. What exists today

`lib/shell/notifications.ts` is a working notification system and is kept: a master gate,
three channels (Browser / Telegram / Discord), a Discord webhook held in the user's own
localStorage, and `dispatch(text, rule)` which fans out and degrades to a silent no-op on
every missing precondition. `WidgetFrame` calls it for any alert a widget reports that is not
already in a per-mount `firedRef`, seeded silently on first mount.

What it lacks is anything to report. Four alert producers exist in the whole app:

| Producer | Fires on |
|---|---|
| `lib/console/signals/signalCard.ts` → `projectSignal` | a `props` severity, or `magnitude >= config.alertMin` |
| `lib/console/widgets/aviation.rules.ts` | emergency squawk, military callsign, bizjet surge ≥ N |
| `lib/console/widgets/events.rules.ts` | tier S3/S4, or a quake at M5 and above |
| `lib/markets/alerts.ts` | a price crossing — its own system, never wired to a channel |

Every other widget reports `alerts: []`.

Three structural gaps against what this design delivers:

1. **No transitions.** An alert is a snapshot of the current list, deduped by
   `ref ?? id`. "A plane *enters* this space" is an edge, and nothing holds a previous
   observation to compare against.
2. **No areas.** Rules are keyed by widget *type*, globally. `lib/shell/inspector.ts`
   already holds drawn areas, each with its own `SourceSet` and ring, all live at once —
   and notifications do not know they exist.
3. **No preset link.** A preset is the whole workspace (`lib/console/presets.ts`).
   Switching one does not touch a rule.

### Measured, 2026-09-08

- **34 signal sources** registered (33 map layers + 1 data-only, the Country Instability
  Index). Counted off the `SIGNALS` array in `lib/signals/registry.ts`.
- These figures rot. Re-measure before quoting them anywhere else.

---

## 2. Decisions

Settled with Sampo before this spec was written. Each is recorded with the reason, because
the reason is what a later reader needs in order to change it safely.

**D1 — A rule belongs to an area, not to a preset or a widget.** Every worked example
named a place. Areas already exist as first-class persisted objects. A preset may *seed*
rules, but the area owns them, so switching board cannot disarm a watch.

**D2 — Delivery is immediate, with a per-area ceiling.** No digest tier. Chosen over a
per-rule volume setting and over severity routing.

**D3 — The ceiling never drops silently.** Over the ceiling, events stay visible in-app and
one line is sent saying how many were held. Suppression the user was not told about is the
worst outcome available, and this is the minimum that avoids it while keeping D2's semantics.

**D4 — The composer is dropdown-driven and lives on the area.** Source, then trigger, then
conditional parameters. The widget frame's existing bell becomes a shortcut that *opens*
this panel; it does not become a second editor. `AreasPanel` already holds the line that
duplicating a control gives the user two places to change one thing.

**D5 — Rules are unique per area.** Arming "planes enter" on Soho must not arm it on
Hormuz. This is structural — `areaId` is a field on the rule — not a convention.

**D6 — Capability resolves through four layers**, with source declaration as the last word.
See §5.

---

## 3. Data model

```ts
// lib/notify/types.ts

export type TriggerKind =
  | "appears" | "disappears" | "enters" | "leaves"
  | "crosses" | "count" | "state" | "due" | "quiet";

export type Direction = "atOrAbove" | "below";

export type TriggerParams =
  | { kind: "appears" | "disappears" | "enters" | "leaves" }
  | { kind: "crosses"; field: string; dir: Direction; level: number }
  | { kind: "count"; dir: Direction; level: number }
  | { kind: "state"; field: string; to: string }
  | { kind: "due"; leadMs: number }
  | { kind: "quiet"; silentMs: number };

export interface AreaRule {
  /** "rule:<epoch ms>" — stable, sorts by age without a second field. */
  id: string;
  /** An `inspectorStore` area id, or the literal "world". */
  areaId: string;
  /** A signal id, a core LayerKey, or a widget type id. */
  sourceId: string;
  params: TriggerParams;
  /** Reuses the existing NotifyChannels shape verbatim. */
  channels: NotifyChannels;
  enabled: boolean;
  createdAt: number;
}
```

`TriggerParams` is a discriminated union so the parameter row and the engine branch on the
same value, and a rule with parameters that do not match its trigger cannot be constructed.

### Persistence

One new key, `tn.notify.rules.v1`, through the existing `loadPersisted` / `savePersisted`
helpers, holding `AreaRule[]`. Coerced on hydrate: a rule naming an unknown `areaId` or an
unknown `sourceId` is **dropped, not repaired** — a silently retargeted rule watches
something nobody asked for.

`lib/shell/notifications.ts` keeps `master`, `discordWebhook` and its own per-widget-type
`rules` map. That map stays as-is; this is a second, area-scoped rule set that shares the
same channels and the same `dispatch`. Nothing existing changes behaviour.

---

## 4. The trigger vocabulary

Nine kinds. Every one is the same operation: compare the previous observation to the
current one, cropped to the ring.

| Kind | Reads | Parameters |
|---|---|---|
| `appears` | a row id not in the previous observation, inside the ring | none |
| `disappears` | a row id in the previous observation, now absent | none |
| `enters` | a row previously outside the ring, now inside | none |
| `leaves` | a row previously inside, now outside | none |
| `crosses` | a row's numeric field passes a level, edge-triggered | field, direction, level |
| `count` | the number of rows inside the ring passes a level | direction, level |
| `state` | a row's categorical field changes to a named value | field, target value |
| `due` | a future-dated row comes within a lead time of now | lead time |
| `quiet` | the source has had no successful poll for a window | window |

`crosses` and `count` are **edge-triggered**, not level-triggered. This is a deliberate
correction to the existing behaviour: `aviation.rules.ts`'s `jetSurgeMin` re-fires on every
report while the condition holds, deduped only by a per-mount `firedRef`, so a remount
re-announces a surge that never went away. An edge fires once when the level is crossed and
re-arms only when the value returns to the other side.

---

## 5. Capability resolution

Four layers. Only one of them decides what appears in the dropdown.

**Layer 1 — engine.** `lib/notify/kinds.ts` owns the nine kinds and the diff. Nothing else
introduces a trigger.

**Layer 2 — group defaults.** `lib/notify/groups.ts` maps a source's existing `group`
("Natural hazards", "Cyber threat", "Space", …) to the kinds that family supports. A new
adapter in an existing group is armable the moment it is registered, with no notification
code written.

**Layer 3 — source declaration.** An optional `triggers` block on `SignalSource` (and an
equivalent for core layers), naming this source's own fields:

```ts
export interface TriggerCapability {
  /** Field holding a stable per-row id. Defaults to SignalFeature.id. */
  identity?: string;
  /** Numeric fields offerable to `crosses`, with their real domains. */
  scalars?: { field: string; label: string; unit?: string; domain: [number, number] }[];
  /** Categorical field offerable to `state`, and its known values. */
  state?: { field: string; values: string[] };
  /** Field holding a future ISO timestamp, offerable to `due`. */
  due?: { field: string };
  /** Kinds this source adds to its group default. */
  add?: TriggerKind[];
  /** Kinds this source removes from its group default. Wins over `add`. */
  remove?: TriggerKind[];
}
```

**Precedence: layer 3 beats layer 2, in both directions.** A source can add a kind its group
lacks and remove one its group wrongly claims.

Resolution order, so no case is left to interpretation:

1. Start with the group's kinds.
2. **A declared field block implies its kind**, whatever the group said: a non-empty
   `scalars` offers `crosses`, a `state` block offers `state`, a `due` block offers `due`.
   Declaring the field is the statement that the source can back the kind.
3. Union with `add`.
4. Subtract `remove`. **`remove` wins over everything**, including an implied kind — so a
   source may declare a `state` field for the audit in layer 4 and still refuse to be armed
   on it.

**Layer 4 — observation.** `lib/notify/audit.ts`. Never changes the menu. It does two jobs:

- **Audit.** A declared field absent from real rows is reported on `/diagnostics`. This is
  how a declaration and its data are kept honest as upstreams change shape.
- **Calibration.** Observed minimum and maximum for each declared scalar annotate the
  threshold control, so a slider does not present levels the number cannot reach.

**Cross-source rules** live with layer 2, not with a source, because no adapter can declare
a condition about another adapter. They are out of scope until M4 (§9).

---

## 6. The engine

One pure function per `(area, source)` per poll. No React, no DOM, no network — the
`camslot.conditions.ts` idiom, node-testable in full.

```ts
// lib/notify/engine.ts

/** One row as the engine sees it, flattened from a SignalFeature, a WorldObject or a
 *  widget's own rows by a per-family adapter. The engine knows nothing else about it. */
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

/** The area boundary. A sanitised ring from `lib/shell/scope.ts`; null means World. */
export type Ring = ReturnType<typeof sanitiseRing> | null;

/** One thing that happened, before it is worded or rate-limited. */
export interface NotifyEvent {
  ruleId: string;
  areaId: string;
  sourceId: string;
  kind: TriggerKind;
  /** Row that caused it, absent for `count` and `quiet` which are about the set. */
  rowId?: string;
  /** The message, already worded by the source's own honesty rules (G5). */
  text: string;
  at: number;
}

export interface Observation {
  /** row id → what we last knew about it. */
  rows: Record<string, { inside: boolean; scalars: Record<string, number>; state?: string }>;
  /** rows inside the ring at the last observation. */
  count: number;
  /** Last successful poll, epoch ms. */
  lastOk: number;
  /** ids already announced by a `due` rule, so a lead time fires once. */
  dueFired: string[];
}

export function diff(
  prev: Observation | undefined,
  rows: readonly ObservedRow[],
  ring: Ring | null,
  rules: readonly AreaRule[],
  feed: { ok: boolean; lastOk: number },
  now: number,
): { events: NotifyEvent[]; next: Observation };
```

`prev === undefined` is the seed case and yields no events (§7, G1). `ring === null` means
the World context and every row is inside.

### Where it runs

One subscriber mounted by `ConsoleShell`, not per widget. A rule must fire whether or not a
widget for its source is on the board — the whole point of an area rule is that you are
watching a place, not a card. The subscriber reads the same feeds the widgets read, so it
adds no upstream requests.

This is the one place the design costs something: a rule on a source no widget shows means
that source is now fetched for the rule's sake. The Sources rail already treats "on" as
"fetched globally, cropped to the rings that asked" (`lib/shell/sourceScope.ts`), so arming
a rule turns its source on in that area's `SourceSet` and reuses that path. Arming a rule is
therefore visible on the map, which is honest: you can see what you are watching.

---

## 7. Guards

**G1 — The first observation seeds silently.** Rows already present are not `appears`, and
rows already inside are not `enters`. Arming a rule over a busy area must not fire ninety
messages about things that were there before the rule existed. `WidgetFrame` already does
this per-mount; here it is persisted and per-`(area, source)`, so a reload does not
re-announce the world.

**G2 — A failed or suspicious poll is not a disappearance.** The diff is skipped entirely
when `feed.ok` is false, and when the row count falls to zero from a previously non-zero
observation. One upstream hiccup must never announce that everything left Soho. The
observation is left unchanged, so the next healthy poll compares against the last state we
trusted rather than against an empty one.

**G3 — The ceiling never drops silently.** `MAX_PER_AREA_HOUR = 20`, a rolling hour per
area. Over it, events are still recorded and still shown in-app; one line is sent when the
window closes: `Soho: 14 more held this hour.`

**G4 — Every message names its area.** Two areas watching planes must not produce two
indistinguishable Telegram lines. Format:
`<area> · <source> · <what happened>`, e.g. `Soho · Planes · RYR4123 entered the area`.

**G5 — A source's own honesty rules travel with its message.** A channel message is
stripped of every on-screen hedge, so the wording is decided in the pure layer:

- **Conflict coverage (GDELT)** rows are coded news coverage, not verified incidents.
  `lib/signals/gdelt.ts` already refuses to state a CAMEO label as fact. A notification from
  this source is worded `reported` and carries the coding, never a bare claim that an event
  occurred. *Assumption:* the source stays armable. Flipping it to
  `remove: ["appears", "count"]` excludes it from channels entirely, and that is a one-line
  change if the wording is judged not enough.
- **Country Instability Index** is scored per country, so an area rule resolves to whichever
  countries the ring intersects, and cannot be narrower. The message names the country, not
  the area's own ring. The score is a conservative floor on most countries and cannot exceed
  82, so its declared `domain` is `[0, 82]` and layer 4 annotates it with what it has
  actually reached.
- **AIS** has terrestrial coverage only. A vessel leaving coverage and a vessel switching off
  its transponder are indistinguishable, so `disappears` is worded *stopped being heard*.

---

## 8. Interface

### The composer

Lives in the area's block, below its sources. Three controls and a conditional row.

```
▣ Soho · add rule
  Area   [ Soho — 2.1 km² · London        ▾ ]
  When   [ Planes — Movers                ▾ ]  [ enters the area   ▾ ]
         [ ── no settings ──                                          ]
  Send   [✓ Browser]  [✓ Telegram]  [ Discord ]
  message → Soho · Planes · <callsign> entered the area
                                        [ Cancel ]  [ Arm rule ]
```

- The **source** list holds sources armable in this area — every registered signal, the core
  layers, and the widget-backed sources (camera wall, markets, news).
- The **trigger** list is built by §5. A source that can back nothing renders an empty,
  disabled list and a panel saying why. **An impossible combination is never offered.**
- The **parameter** row is driven by `TriggerParams`'s discriminant. A `crosses` row carries
  the field, a direction, a level, and layer 4's observed range beside it.
- A **caveat panel** appears above the channels for sources with a known limit — the
  aircraft cache latency, the GDELT coverage wording, the instability ceiling. It is shown
  *before* arming, not after a message disappoints someone.

### Elsewhere

- **The area row** gains a rule count, beside its existing source summary.
- **The widget frame's bell** opens this panel, pre-selected to that widget's source and the
  editing area. It stops being an editor of its own.
- **`/diagnostics`** gains layer 4's audit output.

---

## 9. Order of work

Each slice is a milestone under the repo's existing gate
(`npx tsc --noEmit && npm test`), one commit, one PR, branched off latest `main`.

| Slice | Triggers | New work |
|---|---|---|
| **M1** | `appears` `crosses` `count` `quiet` | `lib/notify/{types,kinds,groups,engine,store}.ts`, the composer, the area row's count, **all five guards** |
| **M2** | `due` `state` | `triggers` declarations on launches and the status feeds; layer 3 and layer 4 |
| **M3** | `enters` `leaves` | positions plumbed into `ObservedRow`; the latency caveat in the UI |
| **M4** | `disappears`, cross-source | the composite editor |

**Every guard ships in M1**, including G2. It is tempting to defer the suspicious-poll guard
to M4 with `disappears`, and that is wrong: a failed poll returning zero rows drives a
`count` rule below its level, so M1 misfires without G2 exactly as M4 would.

M1 covers the largest share of the catalogue because its four kinds need only a row id, a
number and a count — which nearly every source already has.

---

## 10. Testing

Vitest, node environment, `tests/unit/**`, matching the repo's existing split of a pure core
and a thin impure shell.

- `notify-engine.test.ts` — the diff. One case per kind; the seed case yields nothing; an
  edge fires once and re-arms only after returning; `ring === null` treats every row as
  inside.
- `notify-guards.test.ts` — G1 and G2. A failed poll leaves the observation untouched. A
  count falling to zero from non-zero produces no `disappears`. **These two assertions are
  written first and watched to fail against a stub before the guard exists** — a guard test
  nobody saw go red proves nothing.
- `notify-capability.test.ts` — layer 3 beats layer 2 in both directions; `remove` beats
  `add`; a source with no group default and no declaration offers nothing.
- `notify-refusals.test.ts` — the static-infrastructure group offers zero kinds, asserted by
  group rather than by naming sources, so a new port adapter inherits the refusal.
- `notify-wording.test.ts` — G5. A GDELT message contains `reported` and never asserts an
  incident; an instability message names a country; an AIS `disappears` message says
  *stopped being heard*. Mirrors `BANNED_IN_DERIVED` in `camslot.conditions.ts`.
- `notify-rules-coerce.test.ts` — a rule naming an unknown area or source is dropped.

---

## 11. Out of scope

**Nuclear reactor status.** `lib/signals/nuclear.ts` is an OpenStreetMap `power=plant`
extract — around 216 named plants, snapshot-first, changing on a scale of months. It carries
location and tags and **no operating state**. "Tell me if this plant goes down" cannot be
built against it. It needs an upstream that publishes reactor state (IAEA PRIS, or
per-country generation data), which is its own piece of work. The static-infrastructure group
offers no triggers at all, and the composer says so rather than offering something it cannot
deliver.

**Server-side rules.** Everything here is client-side and runs while a tab is open, which is
what the existing notification system already is. A rule that fires with no browser open
needs a server, an account and a scheduler — a different project.

**Preset-seeded rule packs.** D1 leaves room for a preset to seed rules into an area. Not
built here; the area owns rules first, and seeding is only worth designing once there are
rules to seed.

**Markets.** `lib/markets/alerts.ts` stays its own system. Folding it in means giving prices
an area, and a price has no position.
