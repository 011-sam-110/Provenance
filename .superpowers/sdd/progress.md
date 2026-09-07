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
- [x] Task 5: ring -> planned wall (camslot.monitor.ts)
- [~] Task 6: circle gesture + rubber band -- built 4ed4dd2, fixing review findings
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

Task 5: implemented (790e2cd, 2 files, 189 insertions). Suite 331/3262 -> 332/3270, exactly
  the +8 the brief specified. I verified that count MYSELF after the commit rather than
  taking the report's word, and checked the commit holds only its own two files.
  Second index collision of the session, this time agent-to-agent: I dispatched Task 5 while
  the Task 4 FIX agent was still running, having assumed its commit meant it had finished.
  Its staged files were swept in and reverted twice. No content lost -- both agents diffed
  rather than trusting, and both recovered with explicit pathspecs. THE RULE I KEEP BREAKING:
  a commit existing is not an agent finishing. Wait for the completion notification.
  REVIEW: spec OK, quality NOT approved -- one CRITICAL, and it is the second vacuous test
  of this plan. camslot-monitor.test.ts:68 "refuses a ring with fewer than three vertices"
  asserts only tiles===[] and found===0, and BOTH already hold without planMonitor's guard,
  because camerasInRing independently returns [] for ring.length<3. I verified it: delete
  camslot.monitor.ts:64-66 and the test stays green. The two states differ ONLY in message
  ("That area is not a shape." vs "No cameras inside that area.") and neither is asserted --
  so the one distinction this task exists to draw is implemented correctly and pinned by
  nothing.
  IMPORTANT: the test at :46 is titled "when the ring is empty" but passes a real 64-vertex
  ring; it is the CAMERAS that are empty. Nothing anywhere feeds planMonitor a genuinely
  refused ring, so Task 1's antimeridian refusal is not connected to Task 5's message
  end to end.
  FIXED (2eb340d). Suite 333/3272 -> 333/3273. The fix agent handed back the RED run, which
  was the deliverable: deleting camslot.monitor.ts:64-66 fails both tests with
  "expected 'No cameras inside that area.' to be 'That area is not a shape.'", and restoring
  it turns them green. I read the diff myself rather than dispatching a re-review: both tests
  now assert the distinguishing message, the mistitled test is renamed to say it is the
  CAMERAS that are empty, and the new end-to-end test asserts ringFromCircle actually refused
  BEFORE asserting anything downstream, so it cannot quietly become a duplicate. webcamRef
  bound once. Task 5 COMPLETE. Task 6 (circle gesture) running alongside it as the
  SOLE writer -- a read-only reviewer next to one writer is fine, two writers is not.

Task 6: implemented (4ed4dd2, 2 files, 241 insertions). Suite 332/3270 -> 333/3272; the
  implementer cross-checked with `npx vitest list` as well as the npm test summary, and I
  re-ran it myself: 3272. Layer ids tn-circle-src / -fill / -line, confirmed disjoint.
  Rubber band is real: fill+line updated via setData on every pointermove, not a radiusKm
  readout. Ring closed ONLY at the MapLibre feature boundary; an empty ring from
  ringFromCircle is dropped in onUp and never reaches onFinish.
  ITS CONCERN, RESOLVED WITHOUT ASKING THE PEER: a repo-wide grep found no aoi-areas* ids,
  which the brief said aoi.ts owns. Correct and expected -- those ids are in console-ux's
  UNMERGED #187, not on origin/main, which this branch is cut from. The brief was describing
  a future state. No collision either way. Worth re-checking at the Task 12 rebase.
  REVIEW: spec OK, quality APPROVED, three findings, none blocking. Verified teardown order
  (layers before source), that an empty ring reaches neither onFinish nor MapLibre, that the
  ring closes only at the paintPreview boundary, and that both specFrom tests would fail on a
  swapped-argument or hardcoded-zero bug. center/radiusKm publish on onDown, earlier than the
  brief asked.
  IMPORTANT, being fixed: no pointercancel listener. A pointer taken away mid-drag (tab
  switch, system touch gesture, stylus out of range) leaves center set, the band painted and
  -- the part that matters -- dragPan DISABLED, so the map will not pan and nothing on screen
  says why. aoi.ts has the same gap; not ours to fix.
  MINOR, being fixed: a comment claimed aoi.ts already adds preventDefault on Enter. It does
  not -- that is on console-ux's unmerged #187. The claim came VERBATIM FROM MY OWN PLAN, so
  I corrected the plan too (d204636). Briefs are meant to be copied verbatim, which makes a
  false line in a brief a defect that ships.

## Follow-ups (SURFACE TO USER)
- [ ] ANTIMERIDIAN CONTAINMENT, proper fix. lib/shell/scope.ts pointInRing/bboxOfRing do
  planar ray-casting with no seam unwrapping. Affects the EXISTING polygon AOI tool as well
  as the circle. Deferred by Sam 2026-09-07 in favour of refusing a straddling circle.
  Needs its own task + coordination with console-ux (filterToScopes consumes the same path).

## Minor findings rollup (for final review)
- T1-m1: the pole clamp Math.max(-90,Math.min(90,degLat)) is inert -- Math.asin already
  returns [-pi/2,pi/2]. Plan-mandated, harmless, could be dropped.
- T1-m2: ringFromCircle's `vertices` param undertested (no case < 3 or fractional).
- T6-m1: no pointerId check in onDown/onMove/onUp -- a second touch or stylus contact
  mid-drag silently overwrites center or ends the gesture early. Low likelihood on a
  mouse-first console; deliberately left for the final review to triage.
- T5-m1: ringCentre + WEBCAM_REFRESH_SECONDS=600 in camslot.monitor.ts is a THIRD copy of
  logic already duplicated in camslot.area.ts:197,202. The comments disclose the mirroring
  honestly and the brief's exported-function contract forced it, but nothing keeps the three
  in sync. Worth a decision at final review: one home, or a comment naming all three.
- T5-m2: camslot.monitor.ts:191-193 builds webcamRef(w.id, w.label) twice (once for the ref,
  once inside pickKey) instead of binding it once.
- T5-m3: camslot-monitor.test.ts:88 asserts not.toContain("not placed") against a string that
  appears nowhere in the code -- documentation, not a constraint.
- T4-m1: RailSplitter's aria-controls points at a nonexistent id in wall mode. PRE-EXISTING,
  not introduced or worsened by Task 4 -- spotted by the Task 4 re-reviewer while reading
  RailSplitter.tsx to confirm the aria-valuenow defect. Someone should decide whether wall
  mode wants a real target or no aria-controls at all.
- T1-m3: the pole-clamp test (lat 89.9, radiusKm 200) now hits the refusal path, so its
  loop runs over [] VACUOUSLY -- it asserts nothing. Reported honestly by the fixer rather
  than hidden. Either give it a radius that does not wrap 360 of longitude, or delete it.
