# Sources and Inspector — design

**Date:** 2026-09-07
**Base:** PR #177 (`feat/retire-dead-signal-layers`, `f0c376b` + `30ab64b`, cut off `origin/main` 4d2f8f1)
**Status:** design agreed in outline; one open decision (§8); awaiting approval to plan
**Visual review:** https://claude.ai/code/artifact/3e54c841-00f6-4307-a0e9-6d94cb182817

> Do not design against `69faca4` or `feat/sources-rail-legibility`. That branch forks twelve
> commits behind main and was already squash-merged as `177eecb`; PR #178 was opened from it
> and closed as conflicting. #177 is the same layer work on a base that merges, plus the
> ScopeControl fix below.

---

## 1. What this changes

The console has one set of sources. It gets several.

- **World** — the globe. Its own sources. What the console is today.
- **An area** — a drawn ring. Its own sources.

Exactly one is **loaded** at a time. Loading an area filters the whole console to that ring
and draws that area's sources. Unloading returns World exactly as it was.

An area does not inherit from World, override it, or copy it. The sets are independent, which
is the property that makes this safe: nothing is borrowed, so nothing can be stranded.

The Sources rail edits **whichever context is loaded**. The Inspector is the index — where you
choose the context and manage areas. Sources are never configured from the Inspector; that is
the Sources tab's job.

## 2. Two surfaces, both already in the tree

The layout is index-left, detail-right, and **both halves already exist**:

| | Element | Geometry |
|---|---|---|
| Index | `.tn-rail` (`SourceCatalog.tsx`) | `position: fixed; left: 12px; width: 268px` |
| Detail | `.tn-dossier` (`FeedOverlay.tsx`) | `position: fixed; right: 10px; width: min(384px, 94vw)`, top bar to ticker |

`FeedOverlay` is not a modal over the globe — it is a 384px right-edge panel mirroring the
rail. `lib/overlay-content.tsx` is a `kind → component` switch (camera, satellite, plane,
webcam, signal, country). **The Inspector adds two kinds to it — `area` and `basket` — rather
than growing a second detail panel.** That inherits the existing focus handling, close button,
slide-in and mobile behaviour for free.

## 3. Why the rail must announce its context

A requirement, not styling. Flip a toggle without knowing whether you changed the globe or the
Kharkiv area and the control lies about its effect. This codebase has shipped and then fixed
two variants of that bug already.

- A context line above the tabs, visible in **both** tabs: `⌂ World` or `▣ <area> ✕`.
- Section headings in the Sources tab read `EDITING THIS AREA` while an area is loaded.
- It persists across a reload. A user who reloads into a loaded area must be told why the map
  is sparse, or they conclude the app is broken.

## 4. Data model

```ts
// lib/shell/inspector.ts — new, persisted, the lib/shell store idiom
// (module state + listener set + useSyncExternalStore, like scope.ts and watchlist.ts)

/**
 * id → on, for ONE context. Covers layersStore's 4 core LayerKeys and signalsStore's
 * signal ids in a single map, because a context does not care which registry a source
 * came from. The two stores keep their typed surfaces on top of this.
 */
type SourceSet = Record<string, boolean>;

interface InspectorArea {
  id: string;                     // "area:1788744123456"
  label: string;                  // editable, defaults to the ring's own label
  polygon: [number, number][];    // OPEN ring of [lon, lat] — the shape scope.ts speaks
  bbox: [number, number, number, number];
  createdAt: number;
  sources: SourceSet;             // its own; never merged with World's
}

interface InspectorState {
  world: SourceSet;               // the globe's own set
  areas: InspectorArea[];         // drawn only — cap 40, oldest evicted (matches WATCHLIST_CAP)
  loaded: string | null;          // null = World. The context switch.
}
```

A clicked country needs **no field here**. `lib/overlay.ts` already holds the open object, and
a country is a dossier rather than a context. That also means it clears on reload, which is
right — a stale dossier from last week is worse than none.

### What loading does, precisely

1. Sets `loaded`.
2. Sets `scopeStore` to the ring — this is what filters the map, feed and widgets.
   `lib/map/aoi.ts` already paints the active scope on its own layers and re-asserts them on
   `styledata`, so the boundary is drawn with no map edit.
3. Flies to the bbox once. A separate **Fly to** re-centres on demand.
4. Points the Sources rail at that area's `SourceSet`.

Unloading reverses 1, 2 and 4, and does **not** move the camera. A map that jumps when you
close a panel is disorienting.

## 5. The store migration — the part with real blast radius

`layersStore` and `signalsStore` have many callers: `WorldMap`, `SourceCatalog`, presets,
monitors, variants, widgets. **Their public API does not change.**

`layersStore.toggle(key)`, `useLayers()`, `signalsStore.set(id, on)`, `useSignals()` keep their
exact signatures. Internally they read and write
`loaded === null ? world : area.sources`. Every existing caller is correct by construction and
no call site is edited.

**Migration on first run:** the persisted `tn.layers.v1` and `tn.signals.v1` become World's
`SourceSet` verbatim. A returning user sees the console they left. Pinned by a test that loads
a v1 payload and asserts World's set matches key for key.

**Known consequence, deliberate:** applying a preset or monitor variant while an area is loaded
writes that area's set, not World's. That is the correct reading — you are configuring the
loaded thing — but it is a behaviour change and is stated in the UI.

### The Inspector is the sole UI owner of scope

Checked at `69faca4` and confirmed independently by `sources-rail` against the tree:
`components/shell/ScopeControl.tsx` was orphaned — its only importer, `ConsoleTopBar.tsx`, was
deleted, and `coerceSavedScope` coerced a persisted `near-me` to World but let `region` through
as-is, so a user with a Region scope reloaded filtered with Draw → Clear as the only way out.

**Fixed in #177 commit `30ab64b`:** `ScopeControl.tsx` deleted, `region` now coerces to World.
Nothing for this branch to carry. The only remaining `scopeStore` writers are `lib/map/aoi.ts`
lines 542, 593 and 605 — so the Inspector's context bar owns the mode outright and there is no
second control to reconcile with.

### Cameras and webcams

Sam's rule: cameras and webcams are always on in every area. This settles what a new area
starts with — **empty, except those two** — so an area never loads to a blank map. They render
as an always-on marker, never as a toggle that ignores clicks.

**OPEN for webcams — see §8.**

## 6. Scope reach

Sam's call: map, feed and every widget honour the loaded area before any of it ships.

Measured against the tree:

| | Count | What |
|---|---|---|
| Already scoped | 10 files | `ais.detail`, `anomaly`, `cables.detail`, `directory.detail`, `events`, `events.detail`, `forecast.detail`, `schedule.detail`, `signals`, `signals.detail` — all call `useScope()` today |
| One hook each | 6 files | `usePlanes` (aviation ×2), `useCameras` + `useWebcamDirectory` (camslot ×3), `useSatellites` (satellites ×2) |
| Nothing geographic | the rest | clocks, notes, trust cards, chrome |

**The filter goes inside the four hooks, not at each call site.** A widget added next month is
then scoped by construction — the same property that makes adding a signal layer need no edit
to the rail.

The classification pass runs over every registered widget type. That count is **63 as of
#177**, down from 70 in that same PR — it is #177's number, not a standing fact, and
`readme-counts.test.ts` pins the README's copy of it. Re-measure with `listWidgetTypes()`;
never type it from memory.

### Two things it will not do, which the UI must admit

1. **Loading an area crops what you see. It does not reduce what is fetched.** A source
   adapter's `fetch()` takes no arguments — every one returns a global list and the scope
   filter runs after it arrives. A small area is not a cheaper console.
2. **A source that is off in this area genuinely is not fetched — that is where the saving
   is.** The existing rule holds per context: only sources you can see are fetched. An area
   with four sources on pulls four feeds, not thirty-six. Stated next to the point above so
   the two are not confused.

## 7. The camera tray, split rather than moved

`components/console/CameraTray.tsx`, rendered by `StageBar.tsx:188` over the map stage. Both of
Sam's cases — "select an area" and "select cameras" — are one feature: picking cameras inside a
drawn ring.

**Do not move all of it.** Verified on the live preview by `wallpicker`, who owns the picker:
while picking is armed the tray is the **only** thing on screen carrying **Stop picking** and
**Send to wall**. The Sources rail mounts closed. A receipt in a closed panel means a user arms
picking, sees nothing, and cannot stop.

The split follows the line the tray's own header already draws — it lives on the stage because
it "belongs to one gesture on one surface":

| Stays on the stage | Moves to the `basket` dossier |
|---|---|
| Stop picking | The picked list |
| Live found-in-area count | The cap, stated as a cap |
| | Send to wall, Clear |

`wallpicker` has ruled: a read-only summary subscribing to `pickStore` is free to take now;
taking `CameraTray.tsx` and `StageBar.tsx:188` is agreed once Sam approves a plan.
`camslot.pick.ts`, `camslot.send.ts`, `camslot.area.ts` and `camslot.layers.ts` stay theirs.

**The area total is never `picks.length`.** The tray's header is explicit that printing the
basket size as the area's total turns a cap into a coverage claim. The dossier must not
regress that.

## 8. Open decision

**Webcams always-on.** `lib/layers.ts` defaults webcams to `false` and excludes it from the
layer presets deliberately: it is a keyed, rate-limited global sample. Its `fetch()` takes no
arguments, so **the pull is global regardless of the area** — scoping changes what is drawn,
never what is pulled. Always-on in every area means that keyed feed runs whenever any area is
loaded.

Recommendation: cameras always on, webcams on by default but switchable. The never-blank-map
property comes from cameras alone. One line either way.

Cameras have no such limit and are uncontroversial.

## 9. Decisions taken

- **The country panel stays where it is.** *Reversing an earlier call in this document's rev 2.*
  I had planned to remove `case "country"` from `OverlayBody` and reflow `CountryDetail` into
  the left rail. The dossier is already a 384px right-edge panel, which is the chosen layout —
  so there is no reflow and no removal. A country click additionally opens the left rail on the
  Inspector tab so the index reflects what the dossier shows.
- **Alerts ship as a labelled, inert "coming soon" block**, not a half-built rule. Design in
  §12 so it drops in without moving anything on screen.

## 10. Build order

Off #177. Each milestone gated by `npx tsc --noEmit && npm test`. M1–M3 answer "saved areas I
can load, configure and remove".

| | Work | Files |
|---|---|---|
| M1 | The store — contexts, areas, loaded pointer; pure add / remove / rename / load / cap with tests. Nothing renders. | `lib/shell/inspector.ts` |
| M2 | `layersStore` and `signalsStore` become views onto the loaded set, APIs unchanged. v1 migration pinned by a test. | `lib/layers.ts`, `lib/signals/store.ts` |
| M3 | Context bar, tabs, Inspector index, and the `area` dossier kind. Draw saves; the index loads, renames, removes, flies to. Alert me ships marked coming soon. | `SourceCatalog.tsx`, `components/shell/inspector/*`, `overlay-content.tsx` |
| M4 | Loading drives `scopeStore`. Four hooks learn scope. Classification pass over every registered widget type. | 4 hooks, 6 widget files |
| M5 | Country click also opens the Inspector index. The `basket` dossier kind takes the tray's review half; the stage keeps Stop picking. | `WorldMap.tsx:1507`, `CameraTray.tsx`, `StageBar.tsx` |

## 11. Tests

Pure functions only — this repo has no React testing library and no component tests.

- `inspector.ts`: add / remove / rename / cap eviction / load-unload round trip / coerce a junk
  persisted payload to a valid state.
- Migration: a v1 `tn.layers.v1` + `tn.signals.v1` payload becomes World's set key for key.
- Context routing: a write while an area is loaded lands on the area and leaves World
  untouched; unload restores World byte for byte.
- Scope reach: a fixture of items inside and outside a ring, asserted through each of the four
  hooks' pure projection helpers.

Each guard test is watched go red before it goes green. A pinning test nobody saw fail is
decoration.

`wallpicker`'s technique is worth reusing for anything visual: point the e2e spec at
**production** to get the red, then at the branch's Vercel preview for the green. Red and green
against two real builds, no local build, no disk.

## 12. Deferred, designed

Area alerts. A membership differ, not a new fetcher. `lib/events/alerting.ts` already has the
shape — seeded baseline, fired-set dedupe, dormant-safe channels — but matches on radius from
an asset and fires only on appear.

1. A source polls (already happens). It calls `areaWatch.publish(sourceId, items, ok)`.
2. Per area, per source: `entered = cur − prev`, `left = prev − cur`. First tick is a silent
   baseline so arming does not stampede.
3. Fans out through `lib/shell/notifications.ts` — browser, Telegram, Discord. No new key, no
   new route.

Limits, which go in the UI and not only here: it fires only while a Provenance tab is open,
because the stack is client-side and keyless by design; areas must alert even when not loaded,
or an alert only reports what you are already looking at; "leaves" is honest only for sources
returning a complete set per poll, and `ok:false` must be dropped so one 403 never reads as a
mass exit; resolution is a poll (30s at best), not a second.

## 13. Not building

- User-pasted custom feeds per area. `SourceSet` is keyed by string id, so one slots in later
  as `custom:<id>` with no model change.
- Server-side alerting.
- More than one area loaded at once.
- Countries as saveable contexts. A country is a dossier, not an area.

## 14. Coordination

Bus channel `trafficnerd-v2`. Claimed and agreed:

- `sources-rail` — finished, PR #177. Off `SourceCatalog.tsx`, `components/shell/sources/*`,
  `PresetBar.tsx` and the `.tn-rail` CSS. Those are mine.
- `wallpicker` — PR #176, done and left the bus. Owns `components/console/maprail/*` and the
  `camslot.*` picker modules. `CameraTray.tsx` and `StageBar.tsx` are unclaimed.
- `shortcuts-ui` — no overlap declared.

`startDraw(map, {onFinish})` keeps its contract: the ring goes to the caller's callback, never
to the scope. A camera pick must never become a saved area. Saving is an explicit action only.

**Third orphan, not this branch's to fix:** `components/shell/EventFeed.tsx` is imported by
nothing, and was already dead on `origin/main` before #177. Its `.tn-feed` CSS block is
likewise unreachable. Flagged, untouched. Two orphans surfaced in one evening; a cheap sweep
would be to grep for an import of every default-exported component under `components/shell`.
