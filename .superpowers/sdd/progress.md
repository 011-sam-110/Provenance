# Streets Monitor Area — Progress Ledger

Plan: docs/superpowers/plans/2026-09-07-streets-monitor-area.md
Spec: docs/superpowers/specs/2026-09-07-streets-monitor-area-design.md
Branch: feat/streets-monitor-area  (worktree C:\Users\sampo\Desktop\tn-streets-area)
Execution: subagent-driven-development, SONNET implementers and reviewers (Sam, 2026-09-07).
BASE for Task 1 = c35c037.
Baseline test count on this branch BEFORE any task: 3223 (npx vitest list). An OOM.d
vitest worker DROPS a file and still prints green -- check the count, not the colour.
NOTE: the previous ledger here was for the 2026-06-28 widget-console-redesign plan and was
COMPLETE. Preserved as progress-widget-console-redesign.md. Its tasks are NOT this plan's.

## Pre-flight decisions (Sam, 2026-09-07)
- tilesToLayout takes a `mintId: () => string` PARAMETER; store.ts exports nextWidgetId.
- Task 11 check 9 CALIBRATES over 3 runs, worst-of-three, then asserts. Raw figures to Sam
  BEFORE thresholds are written.
- Task 12 gate is `grep setExternalDraw lib/map/aoi.ts`, waiting on PR #187 (NOT #186 --
  #186 merged without the export).

## Status
- [x] Task 1: circle geometry (lib/map/circle.ts)
- [x] Task 2: watch field + sanitize
- [x] Task 3: nine-way fan-out
- [x] Task 4: full-bleed dock exception (re-review clean)
- [ ] Task 5: ring -> planned wall (camslot.monitor.ts)
- [ ] Task 6: circle gesture + rubber band
- [ ] Task 7: Streets preset opens on an area
- [ ] Task 8: prompt + apply
- [ ] Task 9: monitored marks
- [ ] Task 10: video in a tile
- [ ] Task 11: browser + perf gate
- [ ] Task 12: adopt setExternalDraw (BLOCKED on #187)

## Completed
Task 1: implemented (bda54fc, 3223->3231). Review: spec OK. Quality found ONE CRITICAL,
  PLAN-MANDATED (my geometry, not the implementer's): ringFromCircle wraps each vertex's
  longitude independently, and pointInRing ray-casts on raw lon with no seam handling, so a
  circle across +/-180 INVERTS. Verified independently: 50km circle at 179.9E gives bbox
  -179.969..179.988 (near-global), the CENTRE tests outside, a point 111km away tests inside.
  San Diego control correct. Escalated to Sam -> DECISION: refuse a straddling circle now,
  fix pointInRing properly as its own task later. Fix dispatched.
  NOTE: pointInRing is SHARED, so the existing POLYGON tool has the same flaw.
Task 1: COMPLETE (commits bda54fc..a72e9b8, re-review clean -- spec OK, quality Approved).
  Fix a72e9b8 added crossesAntimeridian (computed from the circle's own extents, NOT from
  wrapped output) + ringFromCircle returns [] for a straddling or globe-spanning circle.
  Re-review verified: correct both sides of the seam, at the pole (cos(lat)<1e-6 guard),
  globe-spanning at multiple lons, and NOT over-eager (170E/50km and 179.998 both false).
  Tests 3231->3237. NOTE: one npm test run OOM'd and printed all-green at 3225 -- a whole
  file dropped silently. The count check caught it. Keep checking the number, not the colour.

Task 2: COMPLETE (commit 3154fcf, review clean -- spec OK, quality Approved, ZERO findings).
  ShellLayout.watch + MAX_WATCH_VERTICES=256 + readWatch in sanitize. Tests 3237->3245.
  Reviewer probed the parser adversarially in node: proto-pollution sibling key inert,
  sparse holes rejected, 3-tuples rejected, numeric strings rejected, NaN/Infinity rejected,
  256 accepted / 257 rejected. ALSO verified seedWallRects PRESERVES watch by reading
  reducers.ts (both paths spread) -- a silent data-loss risk I had not flagged.
  Known-inherent: a transposed but in-range [lat,lon] pair cannot be detected structurally.

Task 3: COMPLETE (commit 17db8b4, review clean -- spec OK, quality Approved, ZERO findings).
  camslot.fanout.ts (orderForWall + planFanOut) + live?:boolean on PickedCamera.
  Tests 3245->3256. Reviewer verified: strict ===true/!==true so absent reads not-live;
  Array.sort is spec-stable since ES2019 so equidistant order is deterministic; remainder
  always lands on the FIRST buckets and spread never exceeds 1 (10000/9 -> [1112,1111x8]);
  tiles=0/negative collapses to 1 rather than crashing; no bucket can be empty so the
  "N cameras" header can never mislabel. camslot.area.ts/send.ts untouched as required.

Task 4: implemented (c3df69c) then FIXED (2fa3b34, 57094ec). Tests 3262 (331 files),
  the same count as before the fix -- the fix added 2 assertions and I removed 2.
  Review found ONE CRITICAL, and it was MINE not the implementer's: dockSize's comment
  justified the full-bleed exception with "a wall with nothing in it has no controls to
  collide", which is FALSE -- WallWorkspace paints .tn-wall-bar (Map / + Wall / Re-tile)
  regardless of tile count, so the exception squeezed a live toolbar to 0px and took the
  two visible ways back with it. Reachable today by deleting a board's last tile.
  Verified both halves myself before dispatching a fix: WallWorkspace.tsx:165-205 renders
  the bar unconditionally; ConsoleWorkspace's renderSplit only returns null at size 0, so
  the dock splitter stayed mounted reporting aria-valuenow up to 1440 against an
  aria-valuemax of 720, on a control dockSize had stopped listening to.
  FIX: WallWorkspace returns null at zero tiles (bar included); the dock splitter is
  suppressed in that state; rails.ts now NAMES that early return as the dependency the
  exception rests on rather than asserting the wall has no chrome.
  I also removed two assertions the fixer added -- both were implied by cases above them
  (the full-bleed width is already pinned at 1440, the clamped one at RAIL_MAX.right), so
  neither could go red on its own. The note on what the node-environment suite cannot
  cover stays.
  KNOCK-ON I CAUGHT, which the reviewer did not reach: Task 8 rendered StreetsPrompt
  INSIDE WallWorkspace -- the one column this exception shrinks to 0px. The prompt would
  never have been visible. Plan amended (670cede): it moves to the stage overlay beside
  PinNavigator, gated on showMapOverlays, with a centred-card CSS that lets a press fall
  through to the map.
  PROCESS FAULT, mine: I ran `git add <path> && git commit` with NO pathspec while a
  subagent was staging in the same worktree, and my commit swallowed its code. One index,
  two writers. Straightened by soft-resetting the two commits and re-committing each with
  an explicit `-- <paths>`. From here every commit in this worktree uses a pathspec, and
  no two agents that WRITE run at once.
  RE-REVIEW (clean): spec OK, quality approved, zero findings. It did not take the fix on
  trust -- it read RailSplitter.tsx itself to confirm aria-valuenow={size} against a fixed
  aria-valuemax={RAIL_MAX.right}, checked dockSize has exactly ONE consumer
  (ConsoleWorkspace.tsx:127) and .tn-wall-bar exactly one painter, confirmed the early
  return sits after every hook call, and confirmed StageHost keeps its sibling index so
  nothing remounts. It also endorsed using layout.widgets.length over a rect-filtered list,
  because that is the same field dockSize itself branches on.

## Follow-ups (SURFACE TO USER)
- [ ] ANTIMERIDIAN CONTAINMENT, proper fix. lib/shell/scope.ts pointInRing/bboxOfRing do
  planar ray-casting with no seam unwrapping. Affects the EXISTING polygon AOI tool as well
  as the circle. Deferred by Sam 2026-09-07 in favour of refusing a straddling circle.
  Needs its own task + coordination with console-ux (filterToScopes consumes the same path).

## Minor findings rollup (for final review)
- T1-m1: the pole clamp Math.max(-90,Math.min(90,degLat)) is inert -- Math.asin already
  returns [-pi/2,pi/2]. Plan-mandated, harmless, could be dropped.
- T1-m2: ringFromCircle's `vertices` param undertested (no case < 3 or fractional).
- T4-m1: RailSplitter's aria-controls points at a nonexistent id in wall mode. PRE-EXISTING,
  not introduced or worsened by Task 4 -- spotted by the Task 4 re-reviewer while reading
  RailSplitter.tsx to confirm the aria-valuenow defect. Someone should decide whether wall
  mode wants a real target or no aria-controls at all.
- T1-m3: the pole-clamp test (lat 89.9, radiusKm 200) now hits the refusal path, so its
  loop runs over [] VACUOUSLY -- it asserts nothing. Reported honestly by the fixer rather
  than hidden. Either give it a radius that does not wrap 360 of longitude, or delete it.
