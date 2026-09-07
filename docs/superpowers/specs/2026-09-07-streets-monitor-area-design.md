# Streets: draw an area, get a monitored wall

**Date:** 2026-09-07
**Status:** design approved (Sam, 2026-09-07)
**Baseline:** `408d790` — *Hand out access keys that expire, and store nothing to do it (#184)*
**Supersedes the first-run half of:** `2026-09-04-streets-camera-wall-design.md` (the wall itself stands)
**Origin:** *"all cameras are enabled, and you are prompted to draw a circle around the area you want
to monitor. All of the cameras that are selected are then distributed onto a range of camera
widgets … It would be great if there was also some way to show on the map which cameras are
actually being monitored."*

---

## 1. How little of this is new

The wall board shipped in #155. The area gesture shipped with the camera picker. What is missing is
the join between them, a circle, and the marks.

Already on `main`, used as-is:

| Thing | Where | What it already does |
|---|---|---|
| `startAreaPick()` | `camslot.area.ts` | draws a ring, switches cameras+webcams on, collects what is inside |
| `camerasInRing()` | `camslot.pick.ts` | pure, node-tested containment over road cameras **and** Windy webcams |
| `orderByDistanceFrom()` | `camslot.arm.ts` | nearest-the-centre ordering, so a cap drops the outer edge |
| `arrangeWall()` | `layoutGrid.ts` | tiles uniform 4-column cards **three across** — nine tiles is three bands, exactly |
| `SELECT_RING_LAYER` | `WorldMap.tsx` | the amber ring on picked cameras; the monitored marks are its sibling |
| `CameraVideo` | `components/` | 52 lines, hls.js, falls back to `CameraImage`; already live on `/camera/[id]` |
| `filterToScopes()` | `lib/shell/sourceScope.ts` | pure ring-union filter taking a raw ring, no store (from console-ux, 2026-09-07) |

Four things are genuinely new: a **circle** gesture, a **fan-out** that fills nine widgets instead
of one, **monitored marks**, and **video in a tile**.

## 2. The board's three phases

### 2.1 Prompt

Streets opens with no tiles, cameras and webcams on (`mapCore` already does this), the map dock
**open and full-bleed**, and one line over it: *draw a circle round the area you want to monitor.*

**Full-bleed needs an exception, and it is stated rather than smuggled.** `dockSize()` clamps to
`RAIL_MAX.right` (720px) and to `container.w − WALL_MIN_PX` (360px), so today the dock cannot pass
half a 1440px window. `dockSize` will ignore both **when the wall holds zero tiles**. The floor
exists so the wall's own controls do not collide; an empty wall has no controls, so the reason for
the floor is not present. That is the whole argument, and if it stops being true the exception goes.

**The prompt appears only when the board has no cameras configured.** A saved Streets board opens
exactly as its owner left it. Re-prompting someone who set their board up yesterday would be
hostile; wiping their board to show a prompt would be worse.

### 2.2 Draw

Press for the centre, drag for the radius, release.

**A new module, not `lib/map/aoi.ts`.** That file belongs to console-ux this week, and centre-drag
is a different gesture from click-per-vertex — bolting a mode onto `startDraw` would mean living
inside their file. The circle emits the same **open `[lon,lat][]` ring** their polygon tool returns
(a ~64-gon), so `camerasInRing`, `aoiScope`, `withinScope` and `filterToScopes` all take it
unchanged and **no radius field is added anywhere**.

**One draw-state truth.** console-ux is exporting `setExternalDraw(next: DrawState | null)` and
widening `DrawTool` with `"circle"`. The circle calls it on start, finish and cancel, so
`isDrawing()` and their `DrawBanner` cover this gesture for free. **No parallel flag is
hand-rolled** — until that export lands, the circle owns its own cue and fakes no draw state.

Three points of that are contract rather than detail, given by console-ux on 2026-09-07:

- **`center` and `radiusKm` must be reported from the first mousemove, not on release.**
  `DrawBanner` already narrates `"circle"` — press prompt, then the live radius — off exactly those
  two fields. A gesture that withholds `center` until the end leaves the banner stuck on the press
  prompt for the whole drag, which looks like a dead tool.
- **`setExternalDraw` does not paint.** The draft layers belong to their gestures; the circle owns
  its own geometry on the map and this call publishes state only.
- **It does not touch `cancelActive`.** The circle's Cancel runs its own teardown *first*, then
  calls `setExternalDraw(null)`.

Their work is on `feat/console-nav-and-areas` and is **not on `main`**. PR #186 has since merged
WITHOUT `setExternalDraw` — the export is now expected in PR #187. This branch stays on
`origin/main` and adopts the call once it lands, rather than branching off an unreviewed PR for the
sake of one function call. **The gate is the symbol, never the PR number**: the check is a grep for
`setExternalDraw` in `lib/map/aoi.ts` on `origin/main`, which is what caught #186 not carrying it.

### 2.3 Monitor

The dock returns to its existing `WALL_DOCK_PX` (400) and the tiles appear. At 1440px that leaves
the wall ~1034px, so a 3-across tile is ~344px — clearing the camslot overlay's **300×170**
full-readout threshold, not merely the 240×135 compact one.

**The map never moves in the React tree through any of this.** Only `gridColumn` and a width change.
A `StageHost` remount costs a WebGL context, a full basemap style fetch, the countries geojson, ~18
re-rasterised sprites and ~19k camera features; that constraint is why the map is resized rather
than relocated, and it is unchanged here.

## 3. Distribution

Cameras inside the ring are ordered **live first, then nearest-the-centre**
(`orderByDistanceFrom`, already used by `pickRing` for exactly this reason), then dealt
**round-robin** across `min(count, 9)` widgets.

**Live-first is load-bearing, not a tie-break.** San Diego D11 is 72.5% live, so a real 5 km circle
there catches both kinds. Ordering by distance alone would scatter stills through the nine tiles and
a board asked for live video would open showing JPEGs. Stills still get in — they fill whatever
capacity is left after the live ones — but they never displace a live camera.

- Under nine cameras: one each, and a smaller grid. Four cameras is a 2×2, not nine tiles of which
  five are empty.
- Over nine: all nine rotate through their share, so nothing inside the circle goes unwatched.

Round-robin rather than contiguous chunks: consecutive cameras on a feed are usually consecutive on
one road, so chunking would put a whole interchange in one tile and a different road in another.
Dealing them out spreads each tile across the area.

### 3.1 Rotation, when the tile holds video

A still tile switches by swapping an `<img>` src. **A video tile switches by destroying an hls.js
instance and building another**, which costs a manifest fetch and a fresh buffer before the first
frame. At the still default of 8s a tile would spend most of its life buffering rather than showing
anything.

So a tile holding live streams rotates on a **longer dwell — 30s default** — and a tile holding
nine or fewer live cameras between them does not rotate at all, because there is nothing to rotate
to. Both numbers are in the widget's existing interval control, so a user who disagrees can change
them.

This is a decision made here rather than asked about, and it is the one most likely to be wrong:
30s is reasoned from what an HLS start-up costs, **not measured**. §7 measures it and the number
moves if the measurement says so.

## 4. The marks

Two strengths, from Sam directly:

- **assigned** — a quiet ring on every camera placed into a widget;
- **on screen now** — a bright filled mark on the frame each widget is currently showing, so the
  marks hop as the widgets rotate;
- everything else inside the ring stays an ordinary pin.

One source, one layer, one effect in `WorldMap.tsx`, added beside `SELECT_RING_LAYER` (~line 1290)
and **data-driven off a feature property** rather than two layers, so the rotation repaints by
`setData` instead of by adding and removing layers.

Paint values are hard-coded, as every other paint value in that file is: MapLibre paint properties
cannot read a CSS custom property, and a `getComputedStyle` read here would tie the map to whether
the terminal shell happened to mount first.

## 5. Live video, and its stated cost

**Measured 2026-09-07, from the upstream feeds directly.** Only four host families in
`lib/proxy/hls-allowlist.ts` serve playable video: Caltrans, SCDOT, and two Serbian networks.

| Source | Cameras | Live |
|---|---|---|
| SCDOT (South Carolina) | 771 | **771 (100%)** |
| Caltrans D11 (San Diego) | 324 | 235 (72.5%) |
| Caltrans D12 (Orange County) | 385 | 249 (64.7%) |

Densest 5 km circle of live cameras: **San Diego, 44** (centred `32.7641,-117.1577`, I-8 just east of
the 163); 75 within 8 km. That is the default area.

**The current seeds have zero live cameras between them.** London, Madrid and Prague are Windy
stills; TfL JamCams advertise MP4 clips and `classify.ts` is explicit that we present them as stills.
Swapping them out is the point of this section, not a side effect.

**Caveat, on the record.** Districts 3, 4, 6, 7 and 8 all returned HTTP 500 — Caltrans throttles
after roughly two requests. **LA (D7) and the Bay Area (D4) are unmeasured** and either could be
denser than San Diego. San Diego is the densest measured, not the densest that exists. If those
districts are later measured and beat it, the default is a one-line change.

**camslot cannot play video today.** It renders `CameraImage`, so a live camera in a tile is a
refreshing JPEG. `CameraVideo` is wired in for streams where `live` is true, keeping its existing
`CameraImage` fallback so a dead stream degrades rather than blanks.

**Nine concurrent hls.js instances is a real cost and it was chosen with the cost stated.** A cap was
recommended and Sam chose full video in all nine tiles; that is his call. It is not assumed to be
free: §7 measures it against the console this repo spent #158, #159 and #160 making fast, and
publishes the numbers either way, including if they are bad.

## 6. State, and what it is deliberately not coupled to

The circle lives in the **board's own layout** — `ShellLayout.watch?: { ring: [number, number][] }`,
sanitized like everything else that arrives from a `?c=` link (bounded vertex count, finite coords,
ring dropped entirely if malformed). It therefore persists with the board and rides the share link.

**It is not an `InspectorArea`, and it does not touch `scopeStore`.** Sam ruled on 2026-09-07 that
all areas are live at once and that an area's ring scopes only its own sources; console-ux is
actively removing the area→global-scope coupling. A Streets monitor region is board state, not a
source scope, and reaching for `scopeStore.set()` would fight a change already in flight.

`InspectorState.loaded` is now `.editing` and means "which context the rail writes to". It is not
read here.

## 7. Verification

Gate: `npx tsc --noEmit && npm test` (per `CLAUDE.md`).

**Unit**

- Circle → ring: a centre and radius produce a **64-vertex open ring** (matching the open
  `[lon, lat][]` shape `startDraw` returns — first vertex not repeated) whose `camerasInRing` result
  agrees with a direct haversine check to within one vertex-spacing, at the equator, at 60° latitude,
  and across the antimeridian. 64 vertices puts the worst-case chord error under 0.13% of the radius,
  which at a 5 km circle is ~6 m — below the positional accuracy of the camera coordinates
  themselves, so the polygon is not the limiting factor.
- Live-first ordering: a ring holding both kinds fills the tiles with every live camera before any
  still, and a ring holding only stills still fills.
- Video dwell: a tile with one live stream never rotates; a tile with several rotates at the video
  default, not the still default.
- Fan-out: 4 cameras → 4 widgets one each; 30 → 9 widgets of 3-4; 0 → no widgets and the prompt
  stays; 1 → one widget. Round-robin order pinned.
- `ShellLayout.watch` sanitize round-trip, including a malformed ring dropped and a board with no
  `watch` key behaving exactly as today.
- `dockSize` full-bleed exception: zero tiles → full width; one tile → the existing clamp, unchanged.
- `console-presets.test.ts` learns Streets seeds a ring and no longer seeds three webcam ids.

**Browser, measured, at 1440×900** — a script that exits non-zero on failure, as
`scripts/verify-wall.mjs` does, not a note:

- the map does not remount across prompt → draw → monitor (one `StageHost` mount for the session);
- nine tiles land as a 3×3 and each is ≥300px wide, so the full overlay readout is reachable;
- the marks repaint as widgets rotate, and the bright mark count equals the visible tile count;
- a reload restores the ring, the tiles and the marks.

**The performance measurement, which is a gate and not a footnote.** Nine concurrent HLS streams,
against the same board with video off, on the same machine and window size: CPU at rest, dropped
frames while panning the map, and heap after five minutes. #158 measured `/app` at 60.8% → 9.0% CPU
at rest; if nine decodes push it back up, that number is reported to Sam plainly rather than
absorbed. A cap remains the fallback and its shape is already known.

Also measured, because it is the failure this design could produce and no unit test would catch:
**rotation churn** — with the video dwell at 30s, how long a switching tile shows black before its
first frame, and whether heap grows across twenty switches (an hls.js instance that is not destroyed
on switch is a leak that only appears after minutes on a board built to run all day).

## 8. Not in scope

- **The camslot tile's own design.** This changes what fills a tile and how many there are, never the
  card's anatomy.
- **Rails mode and every other board.** Untouched.
- **The polygon area tool and the Inspector.** console-ux owns both this week; the circle is additive
  and consumes their geometry rather than forking it.
- **Mobile.** Below the rails breakpoint Streets keeps rendering as a stack. A free grid on a 390px
  screen is a column with extra steps, and nine video decodes on a phone is worse than that.
