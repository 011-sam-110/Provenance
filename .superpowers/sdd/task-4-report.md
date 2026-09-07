# Task 4 report — The full-bleed dock exception

## What was implemented

`dockSize` in `lib/terminal/rails.ts` now returns `container.w` when
`l.mode === "wall"` and `l.widgets.length === 0`, before the existing
`RAIL_MAX` / `WALL_MIN_PX` clamp runs. The collapsed check stays first and
unconditional, so a collapsed dock still returns 0 even when the wall is
empty ("closed is closed"). The rails-mode path is untouched — the new
branch is gated on `l.mode === "wall"`.

Implementation matches the brief's Step 3 verbatim, comment included.

`components/console/ConsoleWorkspace.tsx` was **not modified**. Its one
call site (`const dock = wall ? dockSize(layout, box) : 0;`, line 127)
already passes the full `layout` object, which is the `ShellLayout`
carrying `.widgets` — `dockSize`'s new internal read of `l.widgets.length`
needs no new argument, so "pass the tile count" was already true of the
existing call. Confirmed via `git diff components/console/ConsoleWorkspace.tsx`
showing no changes, and via reading the file (lines 90–150) before touching
anything.

## Files touched

- `lib/terminal/rails.ts` — modified (`dockSize` implementation)
- `tests/unit/terminal-rails-dock.test.ts` — new (6 tests, verbatim from brief)
- `components/console/ConsoleWorkspace.tsx` — read, not modified (see above)

## TDD steps, exact commands and output

**Step 1–2: write the failing test, confirm failure reason**

```
$ npx vitest run tests/unit/terminal-rails-dock.test.ts
 ❯ tests/unit/terminal-rails-dock.test.ts (6 tests | 1 failed)
   × dockSize > takes the whole board when the wall holds no tiles
     → expected 400 to be 1440 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Matches the brief's predicted failure exactly (400 vs expected 1440).

**Step 3: implement** — see diff below.

**Step 4: confirm pass**

```
$ npx vitest run tests/unit/terminal-rails-dock.test.ts
 ✓ tests/unit/terminal-rails-dock.test.ts (6 tests) 3ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Step 5: gate**

```
$ npx tsc --noEmit
(no output — clean)

$ npm test
 Test Files  331 passed (331)
      Tests  3262 passed (3262)
```

Ran the full suite **twice** in a row (per the brief's OOM warning) — both
runs reported identical file count (331) and test count (3262), so no
worker silently dropped a file.

## Test count before/after

- Before (per task instructions): 3256
- After: 3262
- Delta: +6, matching the 6 new tests in `terminal-rails-dock.test.ts` exactly.

## Diff

```diff
--- a/lib/terminal/rails.ts
+++ b/lib/terminal/rails.ts
@@ -46,6 +46,19 @@ export const WALL_MIN_PX = STAGE_MIN_PX;
  */
 export function dockSize(l: ShellLayout, container: { w: number; h: number }): number {
   if (l.segments.right.collapsed) return 0;
+
+  // AN EMPTY WALL GIVES THE MAP THE WHOLE BOARD.
+  //
+  // The two bounds below exist for one reason each, and neither reason is present
+  // when there are no tiles: RAIL_MAX stops a rail crowding the map out, and
+  // WALL_MIN_PX keeps the WALL's own controls from colliding. A wall with nothing
+  // in it has no controls to collide and nothing to be crowded out of.
+  //
+  // This is what lets the Streets board open as a full-bleed map asking for an
+  // area. If a future empty wall grows chrome of its own, this exception is wrong
+  // and goes — it is guarded by the tile count precisely so that stays checkable.
+  if (l.mode === "wall" && l.widgets.length === 0) return container.w;
+
   const want = clampRailSize("right", l.segments.right.size);
   return Math.max(0, Math.min(want, container.w - WALL_MIN_PX));
 }
```

## Existing test that already exercises this path

`tests/unit/console-presets.test.ts` — "a wall board opens with its map
dock closed" calls `dockSize` on the Streets preset's fresh (empty,
collapsed) layout and expects 0. This still passes because `collapsed`
is checked before the new empty-wall branch, so a collapsed+empty board
still returns 0. Ran as part of the full suite above — 331/331 files
green, no edits made to this or any other existing test.

## Deviations from the brief

None. Implementation, test file, and commit message are verbatim from
the brief. No exports, helpers, or validation were added beyond what the
brief specifies.

## Commit

```
c3df69c Give the map the whole board while the wall is empty
```

Staged explicitly (`git add lib/terminal/rails.ts
tests/unit/terminal-rails-dock.test.ts`) — did not touch the other
modified-but-unrelated files already sitting in the worktree
(`.superpowers/sdd/progress.md`, the two docs under
`docs/superpowers/`), which predate this task and belong to a different
step of the plan.

No `Co-Authored-By` trailer, per CLAUDE.md's solo-attribution convention
and the task's explicit override of the default attribution instruction.

## Untouched per instructions

- `lib/map/circle.ts`, `ShellLayout.watch`, `lib/console/widgets/camslot.fanout.ts` —
  not referenced, not needed for this task.
- `lib/map/aoi.ts`, `lib/shell/scope.ts`, `components/shell/*` — not touched.
- `lib/terminal/rails.ts`'s other exports (`RAIL_MIN`, `RAIL_MAX`, `STAGE_MIN_PX`,
  `WALL_MIN_PX`, `railSizes`, `effectiveRailSize`, `railSizeFromPointer`,
  `railVars`, `splitSpan`, `railsFromRects`, `clampRailSize`, `RAIL_STEP`,
  `RAIL_STEP_COARSE`) — unchanged.

## Things I am unsure about

Nothing. The change is small, the brief's test file and implementation were
followed verbatim, the gate is green, the test-count delta matches exactly,
and the one existing test covering this code path (the wall-opens-closed
test in `console-presets.test.ts`) still passes unedited.

## Fix: empty-wall chrome and dock splitter

### The defect

`dockSize`'s comment ("a wall with nothing in it has no controls to
collide") was false: `WallWorkspace.tsx` renders `.tn-wall-bar` — Map,
+ Wall, Re-tile — unconditionally, regardless of tile count. On an empty
wall the dock claims 100% of the width, the wall column gets 0px, and
that toolbar (the visible way back to a non-empty wall) is squeezed to
nothing. Separately, `ConsoleWorkspace.tsx`'s `renderSplit("right")`
kept rendering the dock's `RailSplitter` in that state, reporting
`aria-valuenow` equal to the full container width while `aria-valuemax`
stayed pinned at `RAIL_MAX.right` (720) — an out-of-range ARIA value on
a control `dockSize` had already stopped reading `segments.right.size`
for.

### What was implemented

**`components/console/WallWorkspace.tsx`** — added, after the `domOrder`
`useMemo` (all hooks still run unconditionally on every render) and
before `gridStyle` is built:

```ts
if (layout.widgets.length === 0) return null;
```

with a comment explaining that this is what makes `dockSize`'s
justification true: an empty wall now genuinely has no controls to
collide, because it renders no controls at all. The board's empty-state
prompt is explicitly left to a later task (Task 8), to be painted as a
map overlay — no prompt UI was added here.

**`components/console/ConsoleWorkspace.tsx`** — added one guard at the
top of `renderSplit`:

```ts
if (wall && rail === "right" && layout.widgets.length === 0) return null;
```

placed before the existing `const size = ...` line, matching `dockSize`'s
own `l.mode === "wall" && l.widgets.length === 0` condition exactly. Every
other rail/mode combination is untouched — `renderSplit("left")`,
`renderSplit("bottom")`, and `renderSplit("right")` in rails mode or on a
non-empty wall all take the same path as before.

Both edits are the smallest change that closes the collision: no
restructuring of either component beyond the two guards above.

### Tests

Extended `tests/unit/terminal-rails-dock.test.ts` (existing 6 cases
untouched) with 2 new cases under a new `describe`:

- `"the full-bleed dock width can exceed RAIL_MAX.right"` — pins that
  `dockSize(layout([]), box)` (1440) is `> RAIL_MAX.right` (720). This is
  the numeric precondition the `ConsoleWorkspace` guard exists to handle:
  if a rendered splitter reported this value as `aria-valuenow` against
  an unchanged `aria-valuemax` of `RAIL_MAX.right`, it would be out of
  range.
- `"stays within RAIL_MAX.right once a tile exists, for the same
  container"` — pins that with one tile placed, `dockSize` returns to
  `<= RAIL_MAX.right`, guarding the "yields to normal clamps" behaviour
  Task 4 established (the pre-existing tests at lines 29–31 and 33–35
  already cover this directly; this test restates it from the ARIA-safety
  angle so a future change to `RAIL_MAX`/`WALL_MIN_PX` can't silently
  reopen the out-of-range condition).

**Component changes are not unit-testable.** `WallWorkspace`'s early
return and `ConsoleWorkspace`'s splitter suppression are both React
component behaviour, and this repo has no React testing library and runs
vitest in the node environment (confirmed: no `@testing-library/react` or
similar in `package.json`, and every existing test under `tests/unit/`
exercises pure functions only). No test was added that asserts on either
component directly — the two new cases above are pure `dockSize`
assertions that document why the suppression is needed, not proof that
the suppression itself works. This is an acknowledged coverage gap, not a
vacuous test.

### Commands and output

```
$ npx vitest list 2>&1 | grep -c " > "
3262
```

Verified the stated baseline (3262) before making any change.

```
$ npx tsc --noEmit
(no output — clean)

$ npm test
 Test Files  331 passed (331)
      Tests  3264 passed (3264)
```

```
$ npx vitest run tests/unit/terminal-rails-dock.test.ts
 ✓ tests/unit/terminal-rails-dock.test.ts (8 tests) 4ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Covering-test command: `npx vitest run tests/unit/terminal-rails-dock.test.ts`
— 8/8 passed (6 pre-existing + 2 new).

### Test count before/after

- Before: 3262 (verified via `npx vitest list`)
- After: 3264
- Delta: +2, matching the 2 new cases added; file count held at 331 across
  the full run, so no worker silently dropped a file.

### Files touched

- `components/console/WallWorkspace.tsx` — modified (early `return null`)
- `components/console/ConsoleWorkspace.tsx` — modified (`renderSplit` guard)
- `tests/unit/terminal-rails-dock.test.ts` — extended (+2 tests, 0 edited)

### Not touched

`lib/map/aoi.ts`, `lib/shell/scope.ts`, `components/shell/**` — untouched,
per instructions. `lib/terminal/rails.ts` itself was not modified for this
fix — its `dockSize` implementation from Task 4 is unchanged; only the two
components that consume it were edited, which is what makes its comment's
claim true instead of false.

### Commit

Solo attribution — no `Co-Authored-By` trailer, no `Claude-Session` line,
per `CLAUDE.md`'s solo-attribution convention and this task's explicit
override.
