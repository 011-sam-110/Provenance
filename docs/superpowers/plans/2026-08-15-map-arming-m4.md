# Map arming and box-select (Streets M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arm one `camslot`, then fill it from the map — click a pin, click a cluster, or shift-drag a box — so a user composes a wall from the place rather than from a search box.

**Architecture:** Arming is a **global mode on a map that has no mode concept**. The mode lives in one ephemeral module store outside `WorldMap`, and every map entry point — the layer click, the live-thumbnail DOM button, the cluster badge, the box drag — funnels into **one shared resolver that reads that store at event time**. Nothing closes over the armed state, because the two places that would (`wireInteractions`, `createThumbnailManager`) are both mount-once closures. All the arithmetic — dedupe, cap, ordering, the note — is pure and node-tested; `WorldMap` only supplies geometry and side effects.

**Tech Stack:** Next.js 15, React 19, TypeScript, MapLibre GL 5.24, vitest (node env). No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-15-streets-board-design.md` §6.2. Read all seven interceptions before starting. Two of its claims are corrected below under *Measured ground truth*.
- **Build gate:** `npx tsc --noEmit && npm test` before every commit. `npm run build` OOMs this box when two agents run it — ask on the bus first.
- **Tests:** vitest, **node environment**, `tests/unit/**/*.test.ts`. No React testing library — **no component tests**. Every rule that can be pure must be pure.
- **Commit style:** solo attribution, **no co-author trailer**. Stage explicit paths, never `git add -A`.
- **Arm state is EPHEMERAL.** Module-level, per-session, never through `lib/shell/persist`. A persisted mode is a trap: you reload tomorrow, click a pin expecting a dossier, and silently append to a slot that is scrolled off screen. Contrast `camslot.prefs.ts`, which *is* persisted, because a pause is a preference and arming is a held modifier key.
- **Arm state is NOT widget config.** `store.ts:74` `configure` → `emit()` → `writeBoardLayout`, and `boards.ts:104` `layoutSignature` includes `g: w.config`, so an armed flag in config would mark the board "customised" on the first click.
- **Never hand-roll a `StreamRef`.** Import the type and `sanitizeCamslotConfig`/`MAX_STREAMS` from `camslot.model.ts`. A ref is exactly `{k:"cam",id} | {k:"webcam",id} | {k:"yt",videoId}`; anything else is dropped by `sanitizeLayout` on the next `?c=` round trip and the user silently loses it.
- **Read the playlist from the store at append time**, never from a captured value. The picker can read `streams` from props because it is mounted; an armed append fires from a map event with no such guarantee.
- **Every count on screen is the count for the thing the user actually did.** No constant denominators — see *Measured ground truth*.

## Measured ground truth (2026-08-15, live dev server, `window.__map`, cameras layer on, over Trafalgar Square)

Everything here was measured, not inferred. All of it rots — re-measure.

| Fact | Value |
|---|---|
| Rendered targets by zoom (pins / cluster badges) | z6 `0/1` · z9 `3/30` · z11 `18/71` · z11.5 `10/46` · z12 `275/0` |
| Live-thumbnail buttons in the DOM by zoom | z12 `3` · z13 `24` (`MAX_THUMBS`, hit exactly) · z14 `21` |
| Individual pins at z13 | `97` — so **24 bypass the map click and 73 do not, on one screen** |
| `camera-dots` hit-testable while `circle-opacity` is 0 | **yes**, returns a hit at z9/11/11.5/12/13/14 |
| `camera-markers` at the same coordinate | also hit-tests, and is **visible** (minzoom 5, `icon-allow-overlap`, `icon-ignore-placement`) |
| `map.boxZoom.isEnabled()` | `true` — the constructor at `WorldMap.tsx:1389-1397` passes no `boxZoom` option |
| `/api/cameras` total | `20,130` (CLAUDE.md's 19,328 has rotted again) |
| Cameras in a box | tight Westminster `65` (60 available) · central London `306` (279) · greater London `882` (781) |
| `/api/cameras` row shape | `id,name,lat,lon,available,source,country,live,region,refreshSeconds,attribution,license` |

**Two corrections to the spec, recorded so they are not reintroduced:**

- **§6.2 #3 understates clustering.** The spec frames clusters as a below-zoom-12 edge case. In a dense city the cluster badge is the **majority target at every zoom below 12** — 71 badges to 18 pins at z11. Armed cluster behaviour is load-bearing, not a nicety.
- **There is no invisible-clickable window, and the fear that there was one is retracted.** `camera-dots` does hit-test while invisible, but `camera-markers` draws a *visible* icon on the same coordinate at every zoom ≥ 5, and below 5 the dot itself is visible at 0.45–0.5 opacity. So an armed click can never land on a target the user cannot see, and the armed hit target needs **no** `minzoom`.
- **`loadedCamerasStore` already carries `refreshSeconds`.** `loaded.ts:7-14` types six fields and `Pt` (`WorldMap.tsx:71-80`) types eight, but `CamerasFeed` (`:1959-1961`) passes the raw parsed `/api/cameras` objects straight through, and those carry twelve. The cadence-derived cap is therefore computable with a **type** change, not a fetch.

## File Structure

| File | Responsibility |
|---|---|
| `lib/console/widgets/camslot.arm.ts` | **Create.** The ephemeral arm store + every pure rule: bbox filter, dedupe, cadence cap, centre-out ordering, the note. |
| `lib/cameras/loaded.ts` | **Modify.** Widen `LoadedCamera` with optional `refreshSeconds`/`source`; fix the stale header comment (§12). |
| `components/WorldMap.tsx` | **Modify.** One shared resolver; the four interceptions; the box drag; `boxZoom` custody; the armed ring. |
| `components/shell/ConsoleShell.tsx` | **Modify.** Escape sequencing, ahead of both the dialog guard and `selectionStore.clear()`. |
| `app/globals.css` | **Modify — NOT IN MY ASSIGNED SET.** `.tn-armed*` styles. Ownership must be settled on the bus before Task 5. |
| `tests/unit/camslot-arm.test.ts` | **Create.** Every pure rule above. |

---

### Task 1: The arm store and the pure append rules

**Files:**
- Create: `lib/console/widgets/camslot.arm.ts`
- Test: `tests/unit/camslot-arm.test.ts`

**Interfaces:**
- Consumes: `StreamRef`, `streamKey`, `MAX_STREAMS` from `camslot.model.ts`; `LoadedCamera` from `lib/cameras/loaded.ts`.
- Produces: `armStore`, `useArmedSlot()`, `useIsArmed(id)`, `LatLonBounds`, `camerasInBounds()`, `orderByDistanceFrom()`, `cadenceCap()`, `planAppend()`, `describeAppend()`.

Module scope must stay inert — no `window`, no `document` at import time — or the node test cannot import it. `camslot.prefs.ts` is the precedent: it is `"use client"` and still node-importable because it only touches `window` lazily inside `initial()`.

- [ ] **Step 1: Write the failing test**

Cover, at minimum:

```ts
// camerasInBounds
it("includes the edges and excludes the outside", …)
it("handles a box dragged right-to-left / bottom-to-top (normalised bounds)", …)
it("drops rows with a non-finite lat or lon rather than plotting them at 0,0", …)

// orderByDistanceFrom — the thing that stops a cap being an arbitrary sample
it("orders centre-out, so a capped selection is 'the N nearest', not 'the first N'", …)
it("is stable for equidistant rows", …)

// cadenceCap = floor(minRefreshSeconds / (intervalMs/1000))
it("derives the cap from the SLOWEST member's cadence and the dwell", …)
it("falls back to 300s for a camera whose refreshSeconds is missing", …)  // never assume fast
it("never returns less than 1, and never more than MAX_STREAMS", …)

// planAppend
it("skips refs already in the slot, and counts them as duplicates not additions", …)
it("REFUSES the overflow instead of silently truncating, and reports the number refused", …)
it("is a no-op that still returns a note when the slot is already at the cap", …)
it("never mutates the existing array", …)

// describeAppend — the actionable note
it("states the real denominator for THIS box, available and total", …)
it("names a next action, not just a truncation", …)
it("does not claim a selection it did not make", …)
```

The `describeAppend` assertions are the point of this module. A note reading *"306 in this box (279 live). Added the 12 nearest the centre — narrow the box, or filter to one operator."* passes; *"Showing 12 of 306"* does not, and neither does a bare *"Added 12 cameras"*, because that is the 5% arbitrary sample presented as a selection that `describeCoverage` exists to prevent.

- [ ] **Step 2: Implement**

```ts
// Sketch — the shapes the tests pin down.
export interface LatLonBounds { north: number; east: number; south: number; west: number; }

export interface AppendPlan {
  /** The playlist to hand to configure(), or null when nothing may be added. */
  next: StreamRef[] | null;
  added: number;
  duplicates: number;
  /** Refused for cap reasons — reported, never silently dropped. */
  refused: number;
  /** Total candidates the gesture actually covered — the honest denominator. */
  considered: number;
}
```

`FALLBACK_REFRESH_SECONDS = 300` and its reasoning (the slowest real cadence, so an unknown row never makes us ask for frames faster than any operator publishes) is duplicated from `camslot.tsx:33-35`; import it if it becomes exported, but do **not** edit `camslot.tsx` to export it — that file belongs to streets-lead.

- [ ] **Step 3: Verify** — `npx vitest run tests/unit/camslot-arm.test.ts`

---

### Task 2: Tell the truth about what `loadedCamerasStore` holds

**Files:**
- Modify: `lib/cameras/loaded.ts`

- [ ] **Step 1:** Add `refreshSeconds?: number` and `source?: string` to `LoadedCamera`, with a comment saying these are **already present at runtime** (`WorldMap.tsx:1959-1961` sets the raw `/api/cameras` rows) and are optional so that an upstream shape change degrades to the fallback instead of lying.
- [ ] **Step 2:** Fix the misleading header comment flagged in spec §12 — the store is not viewport-scoped and never has been; it is populated only while the camera layer is on.
- [ ] **Step 3: Verify** — `npx tsc --noEmit`. No behaviour change, so no new test.

---

### Task 3: One resolver, four entry points

**Files:**
- Modify: `components/WorldMap.tsx`

This is the whole risk surface. The rule that makes it tractable: **`wireInteractions` and the init effect never learn about arming.** They call a resolver that asks the store at event time.

- [ ] **Step 1: The resolver**

```ts
// Reads armStore at CALL time. Returns true when it consumed the event, so every
// caller can `if (armedPick(...)) return;` before doing its normal job.
const armedPick = (refs: StreamRef[], considered: number, ctx: string): boolean
```

- [ ] **Step 2: Interception 1 — road pins (`:1075-1090`)**

`camClick` must `return` **before** `cinematic.dive`. A road pin does not open a dossier; it flies the map and lands a full-screen hero card, so an unsuppressed armed click is loud and wrong, not merely a no-op.

- [ ] **Step 3: Interception 2 — live-thumbnail buttons (`:1421-1426`)**

`onPick` calls the **same** resolver. This is not "also patch `onPick`": at z13 twenty-four cameras route through here and seventy-three do not, on the same screen, so two code paths that can disagree will disagree in production. Both must be one call.

- [ ] **Step 4: Interception 3 — cluster badges (`:1240-1247`)**

While armed, a cluster click appends its leaves via `getClusterLeaves` rather than easing the camera. Below z12 this is the **majority** of armed clicks (71 badges to 18 pins at z11), so the zoom-instead behaviour would read as "arming is broken". If the leaf count exceeds the cap, append the cap's worth nearest the badge and say what was left — **never leave an armed click with no visible consequence.**

- [ ] **Step 5: Interception 4 — shift-drag, and `boxZoom` custody**

`map.boxZoom.disable()` / `.enable()` **in the same effect that paints the ring**, so they cannot desync. Do **not** use the constructor-only `boxZoomEnd` option: it suppresses fit-to-box unconditionally and would silently delete shift-drag zoom from all six existing boards.

Re-enable in the effect **cleanup** as well as on disarm. `StageHost.tsx:33,37` unmounts `WorldMap` entirely when a widget is focused, so the disable and the re-enable can be separated by an unmount; if that strands, shift-drag zoom is dead everywhere, permanently, with nothing on screen to explain it.

- [ ] **Step 6: Interception 7 — the armed ring**

Ring plus a `crosshair` cursor on the map container, driven by `useSyncExternalStore` in the component body (not inside either mount-once closure). Every append fires the existing `tn-toast` CustomEvent with the note from `describeAppend`, and the toast carries the undo.

- [ ] **Step 7: Verify** — `npx tsc --noEmit && npm test`, then Task 5.

---

### Task 4: Escape, sequenced

**Files:**
- Modify: `components/shell/ConsoleShell.tsx`

- [ ] **Step 1:** Disarm inside the existing `keydown` switch, ahead of `selectionStore.clear()` (`:214-216`). A second listener races it and one Escape does both.

- [ ] **Step 2:** Place the disarm **above** the `[role="dialog"]` early return at `:193`, with the reason written in. That guard exists so a dialog's Escape does not also clear the user's selection — a silent data loss. Leaving a *mode* armed behind a dialog is the opposite: `camslot.picker.tsx:218` renders `role="dialog"`, so "arm a slot, open the picker, press Escape" would otherwise leave the map armed with the ring hidden behind the dialog that just closed. Exiting a mode is not data loss.

**Open decision — raise on the bus before implementing:** this means one Escape both closes the picker and disarms. The alternative is that opening the picker disarms, which is arguably cleaner (they are two routes to the same append) but lives in `camslot.tsx`, which belongs to streets-lead.

- [ ] **Step 3:** Clear arm on board switch and on widget focus, per §6.2's "focus view and map-arming are mutually exclusive modes".

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm test`

---

### Task 5: Prove it, at the zoom that breaks it

**Files:** `persona-shots/` is owned by streets-qa — coordinate before writing there.

Unit tests cannot reach any of this; it is all MapLibre side effects. Drive the running dev server with Playwright against `window.__map`.

- [ ] **Step 1:** Arm a slot, then at **z13 over central London** append (a) a camera that **is** in the `.tn-thumb` pool and (b) one that is **not**. Both must append; neither may open a dossier or fly the map. A pass on only one of these is the failure this whole plan is shaped around — `MAX_THUMBS` is 24 against 97 pins there, so picking a pin at random tests one path with 75% probability.
- [ ] **Step 2:** Repeat at **z14**, where the mix inverts to 21 thumbs against 24 pins.
- [ ] **Step 3:** Armed cluster click at **z11**, where badges outnumber pins 71 to 18. Assert the playlist length changed — a camera move is not a consequence.
- [ ] **Step 4:** `boxZoom` custody: assert `map.boxZoom.isEnabled()` is `true` before arming, `false` while armed, and `true` again after (a) disarm, (b) Escape, (c) **focusing a widget while armed and unfocusing** — the unmount path.
- [ ] **Step 5:** Shift-drag a box over central London and assert the note carries **306/279**, or whatever that box really holds on the day, and not a constant.
- [ ] **Step 6:** Regression: with nothing armed, a road pin still dives, a webcam pin still opens its dossier, a cluster still expands, and shift-drag still zooms.

---

## Self-review notes

- **The riskiest thing here is not the hardest thing here.** The hardest is `boxZoom` custody; the riskiest is interception 2, because it fails for *some pins and not others at the same zoom*, so a manual "I clicked a pin and it armed" carries almost no information. That asymmetry is why Task 5 pins specific zooms and specific pins instead of saying "check arming works".
- **I was wrong once already on this milestone**, about `camera-dots` being an invisible click target that mattered. The hypothesis was right and the conclusion was not, because I had not checked whether anything else was drawn at the same coordinate. It is recorded above rather than quietly dropped.
- **`app/globals.css` is not in my assigned file set** and Task 3 Step 6 needs a small `.tn-armed*` block in it. Unresolved until the bus settles it.
- **The cadence cap is honest but not exact.** It is derived from the candidates plus the existing playlist, and adding to a slot changes its own cap. The note states what was added and why; it does not pretend the number is a law.
