# Streets camera wall — the free grid, restored for one board

**Date:** 2026-09-04
**Status:** design approved (Sam, 2026-09-04); implementation in `feat/streets-camera-wall`
**Baseline:** `8b5c4bf` — *Strip the console to a bare rotating globe (#153)*
**Origin:** *"I liked that users could resize everything and build a camera wall for that page,
so can we add that functionality back, but just for the streets page?"*

---

## 1. What happened, and what this restores

The free twelve-column grid was **not** removed by #153. It was removed by **#146**, the console
reskin, which replaced one free grid with a fixed hero map and three rails. #153's own commit
message says *"Streets is untouched"*, and it is right — Streets lost its wall a release earlier.

Under rails a widget's only position is which rail it sits in and where in that rail's stack. Its
width is the rail's width; its height is a `−H`/`+H` chip in the ⋯ menu. So the Streets board
today is **one vertical column of camera cards beside the map**, which is a list, not a wall.

`presets.ts` already records that this is unfinished:

> *Deliberately NOT redesigned here (Sam's call, 2026-09-03). Its final shape is a separate job
> after the camslot overlay lands.*

This is that job.

### 1.1 Why the reskin's objection does not apply here

#146 gave a specific reason for deleting the grid, and it is a good one:

> *the map was just another tile — with its own drag grip and eight resize handles, competing for
> cells with every widget. You could shove the map into a corner and leave it there […] the honest
> answer to "where will this land?" was "somewhere".*

Every clause of that is about **the map being in the grid**. On the wall board the map is not in
the grid at all — it moves to a dock, and the grid holds camera tiles only. The objection is
answered by the shape of the board rather than argued with.

## 2. The model

### 2.1 One flag, two engines

```ts
export type LayoutMode = "rails" | "wall";
```

`ShellLayout.mode` selects the engine. `"rails"` is the default and describes every board that
exists today. `"wall"` is what the Streets preset ships.

**A stored layout with no `mode` reads as `"rails"`.** That single rule is what makes every saved
board, every archived board and every `?c=` share link already in the wild behave exactly as it
does now. There is no layout version bump, so nobody's board is wiped to add a flag.

`WidgetInstance.rect` stops being legacy-only and becomes real — but only meaningful in wall mode.
In rails mode it is absent, exactly as now.

### 2.2 What each mode owns

| | rails | wall |
|---|---|---|
| Position | `segment` + `order` | `rect` (x, y, w, h in cells) |
| Width | the rail's | `rect.w` of 12 columns |
| Height | `height` px | `rect.h` × 24px rows |
| Map | the hero cell | a dock on the right seam, closed by default |
| Resize | rail seam + ⋯ chips | eight handles per tile, plus the ⋯ chips |
| Reorder | ↑/↓ within rail, ←/→ across rails | free drag; arrows nudge, shift+arrows resize |

Both modes keep `segment`, `order` and `height` populated and valid. Wall mode simply does not
read them for placement. That is deliberate: switching a board between modes must never need a
migration, and `railsFromRects` already knows how to derive a rail placement from a rect.

## 3. The frame does not change

`ConsoleWorkspace` keeps its five-column, three-row frame. In wall mode:

- the **hero cell (column 3)** renders `<WallWorkspace>` instead of the rail stack;
- the **`.tn-cw-stage` section moves to the right-hand track (column 5)**, sized by the existing
  `RailSplitter` and collapsible to zero.

**The stage section stays in one React tree position in both modes.** Only its inline
`gridColumn` changes. This is the constraint the whole file already bends around — a `StageHost`
remount costs a WebGL context, a full basemap style fetch, the countries geojson, ~18 re-rasterised
sprites and ~19k camera features — and it is why the map moves by changing a grid track rather
than by being rendered somewhere else.

### 3.1 The map dock

The dock is **not new machinery**. It is the existing right rail, holding the stage instead of
widgets:

- `RailSplitter` gives it a draggable seam and `clampRailSize` bounds it.
- Its width persists in `segments.right.size` like any other rail.
- It opens from a **Pick cameras** control in the wall's toolbar, and from the existing map-pick
  flow (`CameraPickControl`).
- On the Streets preset it opens **closed** (`segments.right.size = 0`).

**MapLibre in a zero-width track needs `map.resize()` on reveal.** This is the one thing verified
in a browser before anything else is built on it, not assumed.

## 4. The wall surface

`components/console/WallWorkspace.tsx` — the grid, the guides, the ghost, the handles, and nothing
else. It is what `ConsoleWorkspace` was before #146 **minus the stage**, which removes the frozen
DOM-order machinery's hardest case and the whole "where does a new widget land beside the map"
question.

Recovered verbatim from `368f1c8`, the last commit before the reskin:

| File | Lines | What it is |
|---|---|---|
| `lib/terminal/layoutGrid.ts` | 549 | `settle`, `compact`, `resolveCollisions`, `arrangeWall`, `readingOrder`, pixel⇄cell |
| `lib/terminal/useGridDrag.ts` | 391 | the drag/resize state machine — the pin, the ghost, per-frame DOM writes |
| `tests/unit/terminal-layout-grid.test.ts` | 376 | its unit tests, restored rather than rewritten |
| `.tn-rz` rules in `globals.css` | 23 | the eight handles |

Still on `main` and never deleted: `.tn-grid`, `.tn-grid-guides`, `.tn-grid-ghost` and
`.tn-stage-grip` CSS, plus `lib/console/move.ts`, `lib/console/resize.ts` and `lib/terminal/flip.ts`.

Restored to the model: `gridItems`, `applyItems`, `setItemRect`, `arrangeBoard`, `setWidgetWidth`
(reducers) and `placeItem`, `arrange`, `resizeWidth` (store).

`lib/terminal/grid.ts` is **not** restored. It generated a `grid-template-areas` string from
segment membership and ignored every stored rect — it was already dead before #146 deleted it, and
its own replacement comment says so.

### 4.1 Gravity, stated plainly

`settle()` is `compact(resolveCollisions(...))`, and `compact()` floats every tile up in reading
order for as long as the cell above it is free. So:

- **Vertical gaps close.** A tile dropped into empty space rises to meet the one above it.
- **Horizontal gaps persist.** `compact` only moves `y`.

That combination is what lets a user build a hero tile with a column of small ones beside it, and
it is the behaviour to describe in the tour rather than a bug to fix.

## 5. Two hazards, both found in the code

### 5.1 `sanitize.ts` destroys rects on purpose

It does not ignore a stored rect. It feeds every rect it finds through `railsFromRects` and
converts it into a rail placement. That is *correct* today, because the only way a rect can arrive
is from a pre-rails blob.

Left alone, the wall silently reverts to a stack on the next reload — no error, no warning.

**Fix:** branch on `mode`. Rails mode keeps the legacy migration exactly as it is. Wall mode
validates and keeps the rect, and synthesises one via `findFreeSpot` for any widget arriving
without one. Pinned by a round-trip test in **both** directions, and by a test asserting that a
blob with no `mode` still migrates rects away exactly as it does today.

### 5.2 Every drag frame re-parses the whole board archive

`emit()` calls `writeBoardLayout()`, which `loadPersisted`s the entire saved-board archive
(`JSON.parse`), mutates one slot and `savePersisted`s it back (`JSON.stringify`). `commit()` in
`useGridDrag` fires on every cell crossing — tens of times in one drag.

`types.ts` names this itself as the reason `MAX_WIDGETS` is 200 rather than unbounded:

> *the DRAG PATH is the thing to watch: boards.ts re-parses its whole archive on every cell
> crossing of every drag.*

It is dormant on `main` only because nothing drags any more. Restoring free drag makes it live.

**Fix:** a gesture-scoped suspension. `shellLayoutStore.beginGesture()` / `endGesture()` bracket a
drag; while suspended, `emit()` still notifies subscribers and still writes the single live layout
slot, but the **archive** write is deferred and runs once on release. Subscribers must keep firing
or the board would not repaint mid-drag, so this suspends persistence, never notification.

## 6. The board

`streets` builds with `mode: "wall"` through a restored `composeWall`, which calls `arrangeWall`
to tile the cards and then places them by rect. The map is not in the arrangement, so `arrangeWall`
no longer has to reserve `CARD_W` columns for a stage — every one of the twelve columns is the
wall's.

`mapCore: ["cameras", "webcams"]` stays. Opening the dock has to show pins immediately;
`presetLayers.ts` hard-resets those layers to `false` on every board switch and `WIDGET_TO_CORE`
does not map `camslot` back on.

`segments.right.size` opens at `0` — the dock is closed until asked for.

`Globe` is untouched and stays in rails mode.

## 7. What is deliberately not in scope

- **The `camslot` tile's own design.** Its final shape is a separate job, as `presets.ts` says. This
  work changes where a tile sits and how big it is, never what it renders.
- **Rails mode.** Not one behaviour of the Globe board or any saved board changes.
- **Mobile.** The wall is a pointer-driven surface. Below the rails breakpoint the Streets board
  keeps rendering as a stack, exactly as it does now — a free grid on a 390px screen is not a wall,
  it is a column with extra steps.

## 8. Verification

Gate: `npx tsc --noEmit && npm test` (per `CLAUDE.md`).

Unit:
- `terminal-layout-grid.test.ts` restored intact — it is the settle/compact contract.
- Sanitize round-trip, three cases: wall keeps rects · rails migrates rects · absent `mode` reads
  as rails and behaves exactly as today.
- The gesture suspension: subscribers fire during a gesture, the archive is written once on
  release.
- `console-presets.test.ts` learns that `streets` is a wall board and that the rest are not.

Browser, in the running app, at 1440×900:
- the map does not remount when the dock opens or closes (one `StageHost` mount for the session);
- `map.resize()` on reveal produces a correctly sized canvas rather than a stretched one;
- a drag and a resize both land where the ghost said they would;
- a reload restores the wall as a wall, which is hazard 5.1 caught in the act.

### 8.1 What the browser run actually found

`scripts/verify-wall.mjs` runs all four as measured PASS/FAIL checks against a live dev server and
exits non-zero on any failure, so this section is a gate rather than a note. It is at ten checks and
passes ten, three runs in a row, with shots in `persona-shots/wall/`. Two of those checks exist
because the first run failed them, and both defects were invisible to the unit suite:

- **The north-west resize handle covered the drag grip.** Restoring the grid put `onGrab` on the
  14px grip alone, where before #146 the whole header carried it. Measured: the grip occupies
  x50..64 of a tile, `.tn-rz-nw` covers x42..58, and `elementFromPoint` at the grip's own centre
  returned the handle. Every pointer aimed at the thing that looks draggable resized the tile
  instead — the first live drag came back as `4x17 → 2x13`, which is exactly `resizeRect(…, "nw")`.
  Fixed by giving the header the handler back (as it had) and lifting the grip above the handles.
  Pinned by a hit test, because nothing about the stylesheet reads wrong.
- **The world clock spilled out of the dock.** A 567px seven-city row centred in a 400px stage,
  84px past each edge. `@media (max-width: 900px)` already hides it when the WINDOW is narrow; the
  dock makes the STAGE narrow independently, so the same rule now applies through the `tnstage`
  container query that is already there for the search field. Pinned by a check that nothing inside
  `.tn-cw-stage` paints outside it.

One thing the run reports and does not explain: an intermittent dev-only React hydration warning,
about one per full run, tagged `[reload]`. It did not reproduce in four targeted probes of the same
flow on either board (load, board switch, reload, a 30-second poll all came back clean), and React
regenerates the tree client-side when it fires. Left as an open observation rather than claimed as
either caused or cleared by this branch.
