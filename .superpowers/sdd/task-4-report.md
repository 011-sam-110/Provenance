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

I initially extended `tests/unit/terminal-rails-dock.test.ts` (existing 6
cases untouched) with 2 new cases pinning that the full-bleed dock width
can exceed `RAIL_MAX.right` and returns within it once a tile exists. A
concurrent process reviewing the same fix (see **Concurrent integration**
below) correctly judged both redundant: the existing first case already
pins the full-bleed width at 1440 (`> RAIL_MAX.right` at 720) and the
existing third case already pins the clamped width at exactly
`RAIL_MAX.right`, so neither new assertion could go red independently of
one already in the file — which is exactly the "no test that cannot fail"
condition this task warned against. That process replaced my two cases
with a comment making the same point in words instead. **Net test count
change: zero** — the file still holds its original 6 cases.

**Component changes are not unit-testable.** `WallWorkspace`'s early
return and `ConsoleWorkspace`'s splitter suppression are both React
component behaviour, and this repo has no React testing library and runs
vitest in the node environment (confirmed: no `@testing-library/react` or
similar in `package.json`, and every existing test under `tests/unit/`
exercises pure functions only). No test asserts on either component
directly. This is an acknowledged coverage gap, not a vacuous test.

### Commands and output (final state)

```
$ npx vitest list 2>&1 | grep -c " > "
3262
```

Baseline, verified before making any change.

```
$ npx tsc --noEmit
(no output — clean)

$ npm test
 Test Files  331 passed (331)
      Tests  3262 passed (3262)
```

```
$ npx vitest run tests/unit/terminal-rails-dock.test.ts
 ✓ tests/unit/terminal-rails-dock.test.ts (6 tests) 4ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Covering-test command: `npx vitest run tests/unit/terminal-rails-dock.test.ts`
— 6/6 passed (the original 6 cases; none added, none edited, none removed
from Task 4's own set).

### Test count before/after

- Before: 3262 (verified via `npx vitest list`)
- After: 3262
- Delta: 0. Two cases were added then removed as logically implied by
  existing ones (see **Tests** above); file count held at 331 across the
  full run, so no worker silently dropped a file.

### Files touched (final state, across all commits below)

- `components/console/WallWorkspace.tsx` — modified (early `return null`)
- `components/console/ConsoleWorkspace.tsx` — modified (`renderSplit` guard)
- `lib/terminal/rails.ts` — modified: the `dockSize` comment's claim ("a
  wall with nothing in it has no controls to collide") was the false
  premise this whole defect report opened with. Once `WallWorkspace`
  returns null at zero tiles, the honest comment names that early return
  as the dependency the exception rests on, rather than asserting
  independently that the wall "has no controls" — a claim that was true
  only because of the code the comment did not mention.
- `tests/unit/terminal-rails-dock.test.ts` — 6 pre-existing cases, still
  untouched; a trailing comment added, no case count change.

### Not touched

`lib/map/aoi.ts`, `lib/shell/scope.ts`, `components/shell/**` — untouched.

### Concurrent integration — read before trusting any SHA above

While this fix was in progress, another process was actively committing
to this same branch/worktree in parallel, working the identical defect
(same file paths, near-identical comment wording, same reasoning). Two of
my own `git add` + `git commit` attempts landed correctly in the index but
were then swept into that process's own commits and/or rebased under new
SHAs — my local commit (`76d1864`, then briefly `2fa3b34`) does not exist
in the final `git log`. The branch's history was rewritten more than once
while I worked.

The **final, verified state of the fix** lives at whatever is HEAD when
this section was written — confirmed by commit message and diff:

- `2fa3b34` "Wall renders nothing when empty; drop its dead dock splitter"
  — the core fix (WallWorkspace, ConsoleWorkspace, the two now-removed
  test cases), content-identical to what I authored.
- `57094ec` "Say what the full-bleed exception rests on, and drop two
  implied assertions" — the refinement: fixes the `rails.ts` comment I
  did not touch, rewords `WallWorkspace`'s comment to stop quoting text
  that no longer exists, and removes my two redundant test cases in
  favour of a documentation comment.

I did not fight this history rewrite or force my own version back in —
the end state is correct, gate-green, and arguably better than what I
would have shipped alone (it closes the exact false-comment defect this
task opened with, in `rails.ts`, which my own plan had explicitly left
untouched). I re-ran the full gate against the actual current files
(commands above) rather than trusting either commit's own claims.

### Commit

This report-correction edit is committed separately, solo attribution —
no `Co-Authored-By` trailer, no `Claude-Session` line, per `CLAUDE.md`'s
solo-attribution convention and this task's explicit override. The code
fix itself is already committed (see **Concurrent integration**); I am
not re-committing code that is already correctly on the branch.

## Re-review

**1. Spec compliance: yes.** The fix matches the brief's Step 4 intent exactly
— `WallWorkspace` returns `null` at zero tiles, `ConsoleWorkspace`'s
`renderSplit` suppresses the dock splitter in that same state, nothing else
touched. The brief's parenthetical ("use whatever the file already calls its
placed-tile list") could be read as the `ordered`/DOM-order list, but the
implementation uses `layout.widgets.length` instead — the right call, not a
deviation in spirit: it's the same field `dockSize` itself reads, so the two
conditions can never disagree (a mid-repair widget with no `rect` yet would
otherwise desync `dockSize`'s full-bleed trigger from `WallWorkspace`'s early
return).

**2. Code quality: Approved.**

- **Exception is now actually safe.** Grepped: `dockSize` has exactly one
  consumer (`ConsoleWorkspace.tsx:127`), and `.tn-wall-bar` is painted only by
  `WallWorkspace.tsx`. No other component writes chrome into the wall column.
  `WallWorkspace`'s early return sits after every hook (`useShellLayout`,
  `useGridDrag`, the repair-on-arrival `useEffect`, both `useMemo`s) — no
  Rules-of-Hooks violation, and the repair effect's `.some()` on an empty
  array is a no-op, so nothing fires into a null render. `StageHost` stays at
  a fixed sibling index regardless of `wall`/`dock`/widget count — this diff
  never conditions its presence, only `gridColumn` and the unrelated
  `is-stowed` class — so the no-remount constraint holds.
- **Splitter suppression correct, and matches every case asked about.**
  Collapsed dock: `dockSize` checks `.collapsed` before the empty-wall branch,
  so it's already 0 and the pre-existing `size === 0` check would return null
  even without the new guard — no double-guard bug. `rails` mode: the new
  guard is `wall && ...`, so a rails board is untouched (the `renderSplit`
  `wall`-ternary for `size` already existed pre-diff). First-tile transition:
  the guard reads `layout.widgets.length`, so it clears the instant `dockSize`
  itself returns to the normal clamp — no lag or mismatch between the two.
- **Verified the original defect was real**, not just asserted: `RailSplitter`
  renders `aria-valuenow={size}` against a fixed `aria-valuemax={RAIL_MAX[rail]}`
  (720) — pre-fix, an empty wall would have reported `aria-valuenow=1440` on a
  control whose max claims 720. Confirmed by reading `RailSplitter.tsx`
  directly, not just taking the commit message's word for it.
- **Test removal (57094ec) was correct.** Diffed 2fa3b34→57094ec directly: the
  two dropped assertions (`toBeGreaterThan(RAIL_MAX.right)` and
  `toBeLessThanOrEqual(RAIL_MAX.right)`) test facts already pinned as exact
  equalities two tests above (`toBe(box.w)` where `box.w=1440`, and
  `toBe(RAIL_MAX.right)`) — arithmetic on file-local constants, not new code
  behaviour; neither could go red without the equality above it going red
  first. The replacement comment states this honestly and claims no more
  coverage than exists. The remaining 6 tests all constrain real `dockSize`
  behaviour (full-bleed, clamp-restored, RAIL_MAX, WALL_MIN_PX floor,
  collapsed, rails-mode) — none are vacuous.
- **Comments checked against the code they describe**, not taken on faith:
  `rails.ts`'s comment now says the safety is a *dependency* on
  `WallWorkspace` returning null, not an intrinsic property of an empty wall
  — true today (verified above) and correctly frames it as falsifiable if
  `WallWorkspace` ever grows chrome back.
- Noted but out of scope: `RailSplitter`'s `aria-controls={tn-rail-${rail}}`
  points at an id that doesn't exist in wall mode at all (`renderRail` isn't
  called there) — pre-existing, unrelated to this diff, not worsened by it.

**Findings:** none — no Critical, Important, or Minor.
