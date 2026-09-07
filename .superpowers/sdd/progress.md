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
- [x] Task 6: circle gesture + rubber band
- [x] Task 7: Streets preset opens on an area
- [x] Task 8: prompt + apply
- [~] Task 9: monitored marks -- built 1b7047d + dbbb255, review running
- [~] Task 10: video in a tile -- implementer running
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
  FIXED (1061c357, one file). Suite unchanged at 333/3273, which is CORRECT -- pointer events
  against a real canvas are not testable in a node-environment vitest with no map, and the
  agent declined to build a fake map rather than manufacture coverage. I read the diff: the
  pointercancel listener routes through cancelCircleDraw, which is the same path Escape uses
  and resolves to the module's single stop() closure, and the listener is removed in that same
  block -- one teardown, not two. Comment now states the truth about aoi.ts. Task 6 COMPLETE.

Task 7: implemented (86da18a). Suite 333/3273 -> 333/3281 (+8). Streets now opens on NO tiles
  and a 5km circle over the densest live Caltrans cluster measured (San Diego, I-8 near the
  163, 44 cameras), with the dock uncollapsed so the empty wall is full-bleed on first paint.
  IT EDITED THREE PRE-EXISTING TESTS, so I read every one rather than trusting the summary:
   - console-boards.test.ts: adds a widget via shellLayoutStore.add before resizing, because
     no built-in board opens with one any more. Setup change, not an assertion change. It also
     corrected a message that CONTRADICTED ITS OWN ASSERTION ("came back where the template
     puts it" on an expect(...).toEqual(edited), which is where the USER left it). I went in
     suspecting an inverted assertion and found a pre-existing false comment instead.
   - console-boards reset test: now asserts widgets===[] rather than heights===template.
     Different claim, and a stronger one (complete discard, not merely un-resized). The
     height-restoration coverage is genuinely GONE, because no built-in board has an authored
     widget height left to restore. Product change, not a weakened test.
   - preset-layers.test.ts: "no board opens on a blank map" now reads the preset's own
     mapCore/mapSignals, not only widget-implied layers. Faithful to applyPreset, which always
     passes both; and it excludes "countries" so a basemap layer cannot satisfy it.
  COLLATERAL IT FOUND AND REPORTED RATHER THAN HID (good), now being fixed:
   - console-share.test.ts:6 round-trip went VACUOUS -- expect([]).toEqual([]). Its own comment
     says a round-trip "needs widgets to be worth anything". Third vacuous test of this plan.
   - scripts/mint-conditions-board.mts:58 -- slots is empty so slots[-1] is undefined. It does
     NOT crash as reported: {...undefined} is legal, so it mints widgets with no segment/order/
     height and prints only its own warning. Silent malformed output, worse than a crash.
   - README.md:54 alt text still describes the three-webcam wall.
   - scripts/shoot-conditions.mjs + verify-wall.mjs assume tiles exist; assessment requested
     before touching them.
  COLLATERAL FIXED (cc6976f). Suite unchanged at 333/3281 -- correct, since all three fixes
  change existing tests/scripts/docs rather than adding tests.
   - share round-trip is now built EXPLICITLY with three widgets instead of borrowing whichever
     preset still had some, which is the habit that broke it twice (Hazards, then Streets).
     Red run proven: "expected [] to deeply equal [ 'clock', 'aviation', 'camslot' ]".
   - mint-conditions-board.mts now calls the real addWidget reducer instead of copying a
     template that no longer exists, so segment/order/height/rect come from the product rather
     than from invented numbers.
   - README alt text reworded; readme-counts.test.ts re-verified 14/14, no pinned figure moved.
   - shoot-conditions.mjs fails LOUDLY (total===0 -> exit 1) and is unaffected in its intended
     TN_BOARD= mode. verify-wall.mjs also fails loudly but messily: page.$eval throws on a
     missing tile selector at :314, past a try/finally with no catch, after 2 of 7 screenshots.
     Both left unchanged BY DECISION -- loud is acceptable, and Task 11's browser gate may
     supersede verify-wall.mjs entirely. Revisit at Task 11, do not silently rewrite them.

Task 8: IN PROGRESS. The implementer hit an account session rate limit at 20:50 and died
  mid-task; the limit reset two minutes later and I resumed the same agent rather than
  restarting, so its context survived. Nothing was lost -- everything it had done was
  uncommitted on disk and I inventoried it before resuming: store.ts modified, camslot.apply.ts
  and its 8-test file created; StreetsPrompt.tsx, the ConsoleWorkspace render, the CSS block
  and the commit still to come.
  PLAN DEFECT IT FOUND, and its fix is better than my plan: my Task 8 text specified
  `replace(fn) { state = fn(state); emit(); }`. But `replace` ALREADY EXISTED taking a
  ShellLayout, and my version skipped sanitizeLayout -- which would have opened a second,
  UNVALIDATED door into the `watch` field, bypassing exactly the vertex-count and
  coordinate-range checks Task 2 built for it. It overloaded the existing method and routed
  BOTH shapes through sanitizeLayout. Keeping it; asked for it to be stated in the report as a
  deliberate deviation, and for confirmation that the typeof-function branch cannot capture
  any existing object-form caller or change archive semantics.
  LESSON: my plan said "replace(fn), if it does not already exist", which reads like diligence
  and is not. It existed WITH A DIFFERENT SIGNATURE, which is the case that phrasing misses.
  BUILT (2c356d0, 6 files). Suite 333/3281 -> 334/3289. I verified the thing most likely to be
  got wrong: StreetsPrompt renders at ConsoleWorkspace.tsx:357 gated
  `wall && showMapOverlays && layout.widgets.length === 0`, NOT in WallWorkspace.
  circleDrawStore.get() returns the module-level state directly and never derives, so
  useSyncExternalStore cannot spin -- the agent proved it with a throwaway toBe assertion and
  then deleted it rather than leaving a test that pins someone else's module.
  THREE PLAN DEFECTS, all found by the implementer, all corrected in the plan at 28dd76f:
   1. The replace signature above.
   2. My CSS wrote font-size in px LITERALS. tests/unit/terminal-tokens.test.ts is a pinned
      drift guard that bans px literals in the console region, and it caught it. Shipped as
      calc(var(--tnx-fs) + 2px), matching --tnx-fs-lg's own idiom. A guard test I did not know
      about did exactly its job.
   3. My test imported createDefaultLayout from @/lib/console/reducers; it lives in
      @/lib/console/types. Would not have compiled.
  REVIEW: spec OK, quality APPROVED, two MINORS. The reviewer did not take the deviations on
  trust -- it grepped every replace() call site (ConsoleShell.tsx:114, presets.ts:428, 3 tests,
  none passing a function), and it located terminal-tokens.test.ts's region sweep start
  (line 3496, the OPENDATA TERMINAL banner) to confirm the guard really covers a block appended
  at ~6897. It also confirmed the prompt gate in all four states and that the two planMonitor
  messages survive unmodified through applyMonitorPlan.
   - T8-m1: camslot.apply.ts:143's `tiles.length > 0 ? arrangeBoard(next, rows) : next` is DEAD.
     I checked arrangeBoard myself: it is applyItems(l, arrangeWall(ids, rows)), so with every
     widget already removed it changes nothing. PLAN-MANDATED (my code). Worse, task-8-report
     :122 names this ternary as what turns test 8 red, and that is false -- test 8 passes with
     it deleted. Fourth stated-red-condition on this branch that does not hold.
   - T8-m2: camslot.apply.ts:24's comment says scripts/verify-streets-area.mjs "times a switch",
     present tense, and that script does not exist yet -- it is Task 11's deliverable. Inherited
     verbatim from my brief, so not fabricated, but it reads as a claim about a real artifact.
     Same family as the two false comments already caught here.
  BOTH RESOLVED (dbbb255).
   - T8-m1: dead ternary removed. I checked arrangeBoard myself first rather than deleting on
     a reviewer's say-so: it is applyItems(l, arrangeWall(ids, rows)), a no-op with no widgets.
   - T8-m2: comment referencing scripts/verify-streets-area.mjs LEFT AS IS, by decision. It is
     Task 11's deliverable in this same branch, so it is a forward reference within one change,
     not a false claim about the world -- and rewording it now only to reword it back is churn.
     THE RISK IS REAL THOUGH: if Task 11 renames or drops that script the comment strands.
     VERIFY THE FILENAME AT TASK 11.
  Task 8 COMPLETE.

Task 9: implemented (1b7047d) + my follow-up (dbbb255). Suite 334/3289 -> 335/3298.
  Source tn-watching-src, layer tn-watching, all paint values LITERAL (#ffb020 / transparent),
  two strengths via data-driven `case` on an `onair` property. SignalFeed untouched, confirmed
  by diff -- console-ux owns four hunks in there.
  THE IMPLEMENTER FLAGGED ITS OWN GAP rather than hiding it: setTile rebuilt the snapshot
  unconditionally, so a tile reporting the SAME frame twice handed back a new object. Nothing
  uses useSyncExternalStore against this store today (WorldMap subscribes imperatively), so it
  was latent, not live -- but tiles call setTile on every rotation and a rotation landing on
  the same frame is a no-op, so it is the common case, and it is the exact infinite-render trap
  this repo has hit before. dropTile already guarded; setTile did not.
  I fixed it myself and pinned BOTH directions: unchanged report keeps the object, moved on-air
  frame does not. AND I PROVED THE RED: removing the guard fails
  "hands out the SAME snapshot object when a tile reports no change", 1 failed | 8 passed.
  Holding myself to the standard I have been setting for the agents.
  Plan's "Expected: PASS, 8 tests" for Task 9 was wrong AGAIN (file had 7, now 9). Third
  miscount in this plan; the line now tells the reader to count the it( blocks instead.
  REVIEW: spec PASS. Quality NOT APPROVED -- one CRITICAL, AND IT IS AGAINST MY OWN FIX.
  camslot.tsx:390-393 is `useEffect(() => { setTile(...); return () => dropTile(id); },
  [instanceId, streams, current])`, and `streams` is a useMemo keyed on benchTick, which
  useNowCoarse ticks EVERY 60 SECONDS -- so the array gets a new reference every minute even
  when its contents are identical. React runs an effect's cleanup before every re-run, not only
  on unmount, so dropTile fires first and tiles.get(id) is ALWAYS undefined when setTile runs.
  My `prev &&` guard can never be true for the real caller. Verified myself at
  camslot.tsx:79/213/214/390-393 -- the reviewer is exactly right.
  So: the guard is dead in production, the once-a-minute rebuild + notify + setData per tile
  that I said I had fixed is still happening, and my two tests exercise a sequence (two setTile
  calls with no dropTile between) that the real caller never performs. They constrain the
  store's contract honestly, but they do NOT protect the case the commit message claimed.
  FIFTH "looks like coverage, is not" on this branch, and the first one that is mine. The
  lesson is specific and worth keeping: I tested the STORE in isolation and never asked what
  its only caller actually does. A unit test of a module cannot tell you the module is reached.
  REAL FIX (reviewer's, and correct): split camslot.tsx into a report effect with NO cleanup
  and a separate unmount-only effect keyed on instanceId alone. QUEUED -- Task 10's implementer
  is editing camslot.tsx right now, so it waits rather than racing it.
  - T9-m1: WorldMap.tsx:1323 circle-opacity:1 on the non-on-air case is dead, since that fill is
    already rgba(0,0,0,0). Stroke has its own circle-stroke-opacity. Harmless, fold into the fix.
  - T9-m2 (scope): dbbb255 bundled camslot.apply.ts and the plan doc into Task 9's range. Fair
    call -- it was my combined fix commit. Safe, but it made the review range wider than the task.

BRANCH PUSHED (21:16). 34 commits had accumulated on ONE DISK, never pushed. `origin/main..HEAD`
  read 34 and looked reassuring, but that counts UNMERGED, not unpushed -- the upstream was
  origin/main, i.e. no branch of its own, which is the "exists nowhere else" case wearing a
  healthy number. Upstream is now origin/feat/streets-monitor-area and `@{u}..HEAD` is 0.
  No PR opened -- that is Sam's call at finishing-a-development-branch.

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
