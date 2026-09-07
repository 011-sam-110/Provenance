# Streets Monitor Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Streets opens by asking you to draw a circle; every camera inside it fills a nine-tile wall of live video, and the map marks which cameras are assigned and which are on screen right now.

**Architecture:** Four pure modules carry every rule that can be tested in node (circle geometry, the nine-way fan-out, the `watch` field's sanitize, the dock exception). Three thin browser layers consume them (the drag gesture, the prompt, the marks). Nothing forks the existing area machinery — the circle emits the same open `[lon, lat][]` ring `lib/map/aoi.ts` already returns, so `camerasInRing`, `aoiScope` and `filterToScopes` take it unchanged.

**Tech Stack:** Next.js 15, React, TypeScript, MapLibre GL, hls.js, vitest (node environment), Playwright.

## Global Constraints

- **Gate:** `npx tsc --noEmit && npm test` — both must pass before any commit.
- **Commits: solo attribution, no co-author trailer** (`CLAUDE.md` line 56). This matches every existing commit in the repo.
- **Tests are vitest in the NODE environment**, in `tests/unit/**/*.test.ts`. **No React testing library is installed — component tests are impossible.** Any rule that needs testing must live in a pure module.
- **Know the baseline test count before trusting a green run.** An OOM'd vitest worker drops a whole file and still prints all-green. Baseline at the time of writing: run `npx vitest list` (collects without running, safe alongside other agents) and record the number before starting.
- **Do not edit `lib/map/aoi.ts`, `components/shell/inspector/*`, `lib/shell/inspector.ts`, `components/shell/SourceCatalog.tsx`, `components/shell/PresetBar.tsx`, `components/console/PlacementPicker.tsx`, or `lib/console/move.ts`.** Another agent (`console-ux`, PR #186) owns these. Coordinate on the agent bus before touching any of them.
- **CSS rules go at the end of `app/globals.css` under a `.tn-streets-` prefix.** That block is agreed as this branch's; `console-ux` stays above it.
- **Never add a `radius` field to `InspectorArea`.** The circle is board state, not an area.
- **Never call `scopeStore.set()`** to crop this board. That coupling is being removed by PR #186.
- **MapLibre paint properties cannot read CSS custom properties.** Hard-code paint colours, as every other layer in `WorldMap.tsx` does.
- Branch: `feat/streets-monitor-area`, based on `origin/main` at `408d790`. Rebase onto `main` after PR #186 merges.

---

### Task 1: Circle geometry

The pure half of the gesture: a centre and a radius become a ring. Everything downstream already knows how to consume a ring, so this task unblocks Tasks 3, 6 and 8 without any browser code existing.

**Files:**
- Create: `lib/map/circle.ts`
- Test: `tests/unit/map-circle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CircleSpec { lat: number; lon: number; radiusKm: number }`
  - `export const CIRCLE_VERTICES = 64`
  - `export function ringFromCircle(c: CircleSpec, vertices?: number): [number, number][]` — an **open** ring (first vertex not repeated), `[lon, lat]` pairs, matching what `startDraw`'s `onFinish` hands back.
  - `export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/map-circle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CIRCLE_VERTICES, haversineKm, ringFromCircle } from "@/lib/map/circle";
import { camerasInRing } from "@/lib/console/widgets/camslot.pick";

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm({ lat: 32.76, lon: -117.15 }, { lat: 32.76, lon: -117.15 })).toBeCloseTo(0, 6);
  });

  it("measures one degree of latitude as ~111.19 km anywhere", () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: 60, lon: 20 }, { lat: 61, lon: 20 })).toBeCloseTo(111.19, 1);
  });
});

describe("ringFromCircle", () => {
  it("returns an OPEN ring of the requested vertex count", () => {
    const ring = ringFromCircle({ lat: 0, lon: 0, radiusKm: 5 });
    expect(ring).toHaveLength(CIRCLE_VERTICES);
    // Open: the last vertex is not a repeat of the first.
    expect(ring[ring.length - 1]).not.toEqual(ring[0]);
  });

  it("puts every vertex at the requested radius, at the equator and at 60N", () => {
    for (const lat of [0, 60]) {
      const ring = ringFromCircle({ lat, lon: 10, radiusKm: 5 });
      for (const [lon, vlat] of ring) {
        expect(haversineKm({ lat, lon: 10 }, { lat: vlat, lon })).toBeCloseTo(5, 1);
      }
    }
  });

  it("wraps longitude across the antimeridian instead of running past 180", () => {
    const ring = ringFromCircle({ lat: 0, lon: 179.9, radiusKm: 50 });
    for (const [lon] of ring) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
    // It genuinely straddles: some vertices are negative, some positive.
    expect(ring.some(([lon]) => lon < 0)).toBe(true);
    expect(ring.some(([lon]) => lon > 0)).toBe(true);
  });

  it("clamps latitude at the poles rather than producing an invalid coordinate", () => {
    const ring = ringFromCircle({ lat: 89.9, lon: 0, radiusKm: 200 });
    for (const [, lat] of ring) {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });

  it("agrees with camerasInRing to within one vertex spacing", () => {
    const centre = { lat: 32.7641, lon: -117.1577 };
    const radiusKm = 5;
    const ring = ringFromCircle({ ...centre, radiusKm });

    // A grid of candidate points around the centre.
    const rows: { id: string; lat: number; lon: number }[] = [];
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        rows.push({ id: `${dx},${dy}`, lat: centre.lat + dy * 0.01, lon: centre.lon + dx * 0.01 });
      }
    }

    const inRing = new Set(camerasInRing(rows, ring).map((r) => r.id));
    // A 64-gon inscribes the circle, so it can only ever EXCLUDE points just inside
    // the true radius — never include one outside it. Allow a 1% band for that.
    for (const r of rows) {
      const d = haversineKm(centre, r);
      if (d < radiusKm * 0.99) expect(inRing.has(r.id)).toBe(true);
      if (d > radiusKm * 1.01) expect(inRing.has(r.id)).toBe(false);
    }
  });

  it("returns an empty ring for a non-finite or non-positive radius", () => {
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: 0 })).toEqual([]);
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: -1 })).toEqual([]);
    expect(ringFromCircle({ lat: 0, lon: 0, radiusKm: Number.NaN })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/map-circle.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/map/circle"`.

- [ ] **Step 3: Write the implementation**

Create `lib/map/circle.ts`:

```ts
// A circle, as a ring. The pure half of the Streets area gesture.
//
// WHY THIS IS NOT IN lib/map/aoi.ts. That module owns a click-per-vertex polygon
// gesture and belongs to another workstream. Centre-and-drag is a different
// gesture, not a mode of that one. What the two share is their OUTPUT — an open
// [lon, lat][] ring — so everything downstream (camerasInRing, aoiScope,
// withinScope, filterToScopes) consumes either without knowing which drew it.
//
// NO RADIUS SURVIVES THIS MODULE. The ring is the interface; a centre+radius pair
// is an input to it and is never stored, never persisted and never added to
// InspectorArea. That keeps one geometry type in the system rather than two.

/** Mean Earth radius, km. The same figure MapLibre and turf use. */
const EARTH_KM = 6371.0088;

export interface CircleSpec {
  lat: number;
  lon: number;
  radiusKm: number;
}

/**
 * Vertices in a generated ring.
 *
 * 64 puts the worst-case chord error at 1 - cos(pi/64) = 0.12% of the radius,
 * which on a 5 km circle is about 6 m — below the positional accuracy of the
 * camera coordinates themselves, so the polygon is not the limiting factor.
 * Raising it costs `pointInRing` work on every containment test for no gain
 * anyone can see.
 */
export const CIRCLE_VERTICES = 64;

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fold a longitude into [-180, 180]. The antimeridian is a seam in the number
 *  line, not in the world, and a ring that runs to 180.4 is silently empty. */
function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * An OPEN ring approximating a circle — first vertex not repeated, `[lon, lat]`
 * pairs, matching what `startDraw`'s `onFinish` hands back.
 *
 * Returns `[]` rather than throwing for a radius that is not a positive finite
 * number: every caller is a pointer handler mid-gesture, and a zero-radius circle
 * is what the very first mousemove of every drag looks like.
 */
export function ringFromCircle(c: CircleSpec, vertices = CIRCLE_VERTICES): [number, number][] {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return [];
  if (!Number.isFinite(c.radiusKm) || c.radiusKm <= 0) return [];

  const n = Math.max(3, Math.floor(vertices));
  const lat = (c.lat * Math.PI) / 180;
  const lon = (c.lon * Math.PI) / 180;
  const ang = c.radiusKm / EARTH_KM;

  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const bearing = (2 * Math.PI * i) / n;
    // Standard destination-point formula. Done on the sphere rather than by
    // scaling degrees, because a degree of longitude is not a fixed distance —
    // a "circle" built by dividing by cos(lat) is an ellipse everywhere but the
    // equator, and visibly wrong by 60 degrees north.
    const vlat = Math.asin(
      Math.sin(lat) * Math.cos(ang) + Math.cos(lat) * Math.sin(ang) * Math.cos(bearing),
    );
    const vlon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(ang) * Math.cos(lat),
        Math.cos(ang) - Math.sin(lat) * Math.sin(vlat),
      );
    const degLat = (vlat * 180) / Math.PI;
    out.push([wrapLon((vlon * 180) / Math.PI), Math.max(-90, Math.min(90, degLat))]);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/map-circle.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/map/circle.ts tests/unit/map-circle.test.ts
git commit -m "Add circle-to-ring geometry for the Streets area gesture"
```

---

### Task 2: The `watch` field on a layout

The circle has to survive a reload and a `?c=` link. This is the only persistence change the feature makes.

**Files:**
- Modify: `lib/console/types.ts` (add `watch` to `ShellLayout`)
- Modify: `lib/console/sanitize.ts` (parse it)
- Test: `tests/unit/console-sanitize-watch.test.ts`

**`sanitizeLayout` returns `ShellLayout | null`** — every call in these tests uses `!`, because a
blob that fails the outer parse returns null and TypeScript will not let you read `.watch` off it.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ShellLayout.watch?: { ring: [number, number][] }`
  - `export const MAX_WATCH_VERTICES = 256` from `lib/console/types.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/console-sanitize-watch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { MAX_WATCH_VERTICES } from "@/lib/console/types";

const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const wallBlob = (extra: Record<string, unknown> = {}) => ({
  mode: "wall",
  stage: "map2d",
  segments: { left: { size: 320, collapsed: false }, right: { size: 400, collapsed: true }, bottom: { size: 0, collapsed: false } },
  widgets: [],
  focusedWidgetId: null,
  ...extra,
});

describe("sanitizeLayout — watch ring", () => {
  it("keeps a well-formed ring", () => {
    const l = sanitizeLayout(wallBlob({ watch: { ring: square } }))!;
    expect(l.watch?.ring).toEqual(square);
  });

  it("drops the key entirely when it is absent, so an untouched board is byte-identical", () => {
    const l = sanitizeLayout(wallBlob())!;
    expect("watch" in l).toBe(false);
    expect(JSON.stringify(l)).not.toContain("watch");
  });

  it("drops a ring with fewer than three vertices", () => {
    expect(sanitizeLayout(wallBlob({ watch: { ring: [[0, 0], [1, 1]] } }))!.watch).toBeUndefined();
  });

  it("drops a ring holding a non-finite or out-of-range coordinate", () => {
    const bad = [[0, 0], [1, 1], [Number.NaN, 2]];
    expect(sanitizeLayout(wallBlob({ watch: { ring: bad } }))!.watch).toBeUndefined();
    const off = [[0, 0], [1, 1], [999, 2]];
    expect(sanitizeLayout(wallBlob({ watch: { ring: off } }))!.watch).toBeUndefined();
  });

  it("drops junk shapes rather than throwing", () => {
    for (const junk of [{ watch: 7 }, { watch: null }, { watch: { ring: "nope" } }, { watch: {} }]) {
      expect(() => sanitizeLayout(wallBlob(junk))).not.toThrow();
      expect(sanitizeLayout(wallBlob(junk))!.watch).toBeUndefined();
    }
  });

  it("refuses a ring longer than the vertex cap, so a share link cannot carry a megabyte", () => {
    const huge = Array.from({ length: MAX_WATCH_VERTICES + 1 }, (_, i) => [i * 0.001, 0] as [number, number]);
    expect(sanitizeLayout(wallBlob({ watch: { ring: huge } }))!.watch).toBeUndefined();
  });

  it("round-trips through JSON unchanged", () => {
    const once = sanitizeLayout(wallBlob({ watch: { ring: square } }))!;
    const twice = sanitizeLayout(JSON.parse(JSON.stringify(once)))!;
    expect(twice.watch?.ring).toEqual(square);
  });

  it("ignores a watch ring on a RAILS board — it is a wall-board concept", () => {
    const rails = sanitizeLayout({ ...wallBlob({ watch: { ring: square } }), mode: "rails" })!;
    expect(rails.watch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/console-sanitize-watch.test.ts`
Expected: FAIL — `MAX_WATCH_VERTICES` is not exported.

- [ ] **Step 3: Add the type**

In `lib/console/types.ts`, add next to `MAX_WIDGETS`:

```ts
/**
 * Vertex ceiling for a stored watch ring.
 *
 * `ringFromCircle` produces 64. This is four times that so a ring drawn with the
 * polygon tool and saved onto a board is not truncated, while still bounding what
 * a `?c=` link can carry: 256 vertices of two 8-byte numbers is ~4 KB of JSON,
 * against a basket of picks that is already larger.
 */
export const MAX_WATCH_VERTICES = 256;
```

And add the field to `ShellLayout`, after `mode`:

```ts
  /**
   * The area this board is monitoring, as an OPEN [lon, lat] ring.
   *
   * Board state, deliberately — NOT an InspectorArea and NOT the shell scope. An
   * area scopes its own sources; this ring says which cameras a wall was built
   * from, which is a different claim and belongs to the board that made it. It
   * therefore persists with the board and rides the `?c=` link.
   *
   * Absent on every rails board and on any wall board nobody has drawn on. The
   * key's ABSENCE is the untouched state — `layoutSignature()` JSON.stringifies
   * the layout and JSON.stringify drops `undefined`, so writing an explicit
   * `watch: null` here would light the "customised" dot on a board nobody edited.
   */
  watch?: { ring: [number, number][] };
```

- [ ] **Step 4: Parse it in sanitize**

In `lib/console/sanitize.ts`, add this helper near `readRect`:

```ts
/** A stored watch ring, or undefined. Total — never throws, never half-accepts.
 *  A ring that fails ANY check is dropped whole rather than repaired: a partly
 *  valid area is a lie about where the cameras came from. */
function readWatch(raw: unknown): { ring: [number, number][] } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = (raw as Record<string, unknown>).ring;
  if (!Array.isArray(r) || r.length < 3 || r.length > MAX_WATCH_VERTICES) return undefined;

  const ring: [number, number][] = [];
  for (const pt of r) {
    if (!Array.isArray(pt) || pt.length !== 2) return undefined;
    const [lon, lat] = pt;
    if (typeof lon !== "number" || typeof lat !== "number") return undefined;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return undefined;
    ring.push([lon, lat]);
  }
  return { ring };
}
```

Import `MAX_WATCH_VERTICES` from `@/lib/console/types` alongside the existing type imports.

Then, where the `layout` object is built, attach it only on a wall board and only when present:

```ts
  const layout: ShellLayout = {
    segments,
    stage: r.stage as StageId,
    widgets,
    focusedWidgetId,
    mode,
  };

  // Wall boards only, and the key stays ABSENT when there is nothing to store —
  // see the field's own note about layoutSignature and the "customised" dot.
  if (mode === "wall") {
    const watch = readWatch(r.watch);
    if (watch) layout.watch = watch;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/console-sanitize-watch.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the full gate and commit**

Existing sanitize and share tests must still pass — this field is additive and no stored board carries it.

```bash
npx tsc --noEmit && npm test
git add lib/console/types.ts lib/console/sanitize.ts tests/unit/console-sanitize-watch.test.ts
git commit -m "Store the monitored area on the board, not in the shell scope"
```

---

### Task 3: The nine-way fan-out

Turns a ring's worth of cameras into nine widgets' worth of streams. Pure, so every rule here is testable in node.

**Files:**
- Create: `lib/console/widgets/camslot.fanout.ts`
- Test: `tests/unit/camslot-fanout.test.ts`

**Interfaces:**
- Consumes: `PickedCamera` and `pickKey` from `@/lib/console/widgets/camslot.pick`; `orderByDistanceFrom` and `LatLon` from `@/lib/console/widgets/camslot.arm`.
- Produces:
  - `export const WALL_TILES = 9`
  - `export interface FanOutTile { name: string; streams: StreamRef[] }`
  - `export function orderForWall(picks: readonly PickedCamera[], centre: LatLon): PickedCamera[]`
  - `export function planFanOut(picks: readonly PickedCamera[], centre: LatLon, tiles?: number): FanOutTile[]`

**Note on `live`:** `PickedCamera` has no `live` field today. This task adds an optional one (`live?: boolean`) to the interface in `camslot.pick.ts`; Task 8 populates it from `Camera.live`, which `lib/cameras/body.ts` already sets via `isLiveStreamUrl`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-fanout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WALL_TILES, orderForWall, planFanOut } from "@/lib/console/widgets/camslot.fanout";
import { pickKey, type PickedCamera } from "@/lib/console/widgets/camslot.pick";

const centre = { lat: 32.7641, lon: -117.1577 };

/** `n` cameras walking away from the centre, so distance order is id order. */
const cam = (id: string, opts: { live?: boolean; away?: number } = {}): PickedCamera => ({
  ref: { k: "cam", id },
  key: pickKey({ k: "cam", id }),
  label: id,
  lat: centre.lat + (opts.away ?? 0) * 0.01,
  lon: centre.lon,
  ...(opts.live === undefined ? {} : { live: opts.live }),
});

const many = (n: number, live = false) =>
  Array.from({ length: n }, (_, i) => cam(`c${i}`, { live, away: i + 1 }));

describe("orderForWall", () => {
  it("puts every live camera ahead of every still one", () => {
    const rows = [
      cam("still-near", { live: false, away: 1 }),
      cam("live-far", { live: true, away: 9 }),
      cam("still-far", { live: false, away: 8 }),
      cam("live-near", { live: true, away: 2 }),
    ];
    expect(orderForWall(rows, centre).map((p) => p.label))
      .toEqual(["live-near", "live-far", "still-near", "still-far"]);
  });

  it("orders within each group by distance from the centre", () => {
    const rows = [cam("c3", { live: true, away: 3 }), cam("c1", { live: true, away: 1 }), cam("c2", { live: true, away: 2 })];
    expect(orderForWall(rows, centre).map((p) => p.label)).toEqual(["c1", "c2", "c3"]);
  });

  it("treats a missing live flag as not live", () => {
    const rows = [cam("unknown", { away: 1 }), cam("live", { live: true, away: 9 })];
    expect(orderForWall(rows, centre)[0].label).toBe("live");
  });
});

describe("planFanOut", () => {
  it("gives one camera per tile when there are fewer than nine", () => {
    const tiles = planFanOut(many(4, true), centre);
    expect(tiles).toHaveLength(4);
    for (const t of tiles) expect(t.streams).toHaveLength(1);
  });

  it("caps at nine tiles and spreads the rest across them", () => {
    const tiles = planFanOut(many(30, true), centre);
    expect(tiles).toHaveLength(WALL_TILES);
    const counts = tiles.map((t) => t.streams.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
    // 30 across 9 is 3 or 4 each — never 0, never lopsided.
    expect(Math.min(...counts)).toBe(3);
    expect(Math.max(...counts)).toBe(4);
  });

  it("deals ROUND-ROBIN, so neighbouring cameras land in different tiles", () => {
    const tiles = planFanOut(many(18, true), centre);
    // c0 and c1 are adjacent on the road; they must not share a tile.
    expect(tiles[0].streams[0]).toEqual({ k: "cam", id: "c0" });
    expect(tiles[1].streams[0]).toEqual({ k: "cam", id: "c1" });
    expect(tiles[0].streams[1]).toEqual({ k: "cam", id: "c9" });
  });

  it("returns no tiles for an empty selection", () => {
    expect(planFanOut([], centre)).toEqual([]);
  });

  it("makes exactly one tile for one camera", () => {
    const tiles = planFanOut([cam("only", { live: true })], centre);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].streams).toEqual([{ k: "cam", id: "only" }]);
  });

  it("names a single-camera tile after that camera, and a shared tile by count", () => {
    expect(planFanOut([cam("Trafalgar Sq", { live: true })], centre)[0].name).toBe("Trafalgar Sq");
    const tiles = planFanOut(many(18, true), centre);
    expect(tiles[0].name).toBe("2 cameras");
  });

  it("puts live cameras in the first tiles when the ring holds both kinds", () => {
    const rows = [...many(3, false), ...[cam("L1", { live: true, away: 20 }), cam("L2", { live: true, away: 21 })]];
    const tiles = planFanOut(rows, centre);
    expect(tiles[0].streams[0]).toEqual({ k: "cam", id: "L1" });
    expect(tiles[1].streams[0]).toEqual({ k: "cam", id: "L2" });
  });

  it("honours a caller-supplied tile count", () => {
    expect(planFanOut(many(12, true), centre, 4)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-fanout.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/console/widgets/camslot.fanout"`.

- [ ] **Step 3: Add `live` to `PickedCamera`**

In `lib/console/widgets/camslot.pick.ts`, add to the `PickedCamera` interface, after `source`:

```ts
  /** Whether this camera serves a stream `/api/hls` can actually play. Optional,
   *  and optional on purpose: a webcam has no such stream and a road camera whose
   *  row we have not read yet has no answer. Absent reads as NOT live — the safe
   *  direction, because it can only ever under-promise. */
  live?: boolean;
```

- [ ] **Step 4: Write the fan-out**

Create `lib/console/widgets/camslot.fanout.ts`:

```ts
// Turning a drawn area into a wall of tiles.
//
// The existing send path (camslot.send.ts) puts a whole basket into ONE camera
// wall that rotates through up to sixty streams. That is right for "I clicked
// four cameras, put them somewhere". It is wrong for "monitor this area", where
// the answer is a grid you can watch at a glance.
//
// Everything here is pure so the rules are testable in the node environment the
// rest of tests/unit uses — there is no React testing library in this repo, so a
// rule that lives in a component cannot be tested at all.

import { orderByDistanceFrom, type LatLon } from "@/lib/console/widgets/camslot.arm";
import type { PickedCamera } from "@/lib/console/widgets/camslot.pick";
import type { StreamRef } from "@/lib/console/widgets/camslot.model";

/**
 * Tiles a monitored area fills.
 *
 * Nine because `arrangeWall` tiles uniform 4-of-12-column cards three across, so
 * nine is exactly three full bands and the grid has no ragged last row. It is a
 * parameter rather than a constant at the call site so a narrower board can ask
 * for fewer, but nine is the shape the board was measured for: at 1440px with the
 * 400px dock open a 3-across tile is ~344px, clearing the camslot overlay's
 * 300x170 full-readout threshold.
 */
export const WALL_TILES = 9;

export interface FanOutTile {
  /** The tile's header. A place or a count — never "Camera wall", which is what
   *  four identical untitled tiles used to read as. */
  name: string;
  streams: StreamRef[];
}

/**
 * Wall order: every live camera first, then everything else, each group nearest
 * the centre of the area first.
 *
 * LIVE-FIRST IS LOAD-BEARING, NOT A TIE-BREAK. Caltrans D11 is 72.5% live, so a
 * real circle over San Diego catches both kinds. Ordering by distance alone would
 * scatter stills through the nine tiles, and a board asked for live video would
 * open showing JPEGs. Stills still get in — they fill whatever capacity is left —
 * but they never displace a live camera.
 */
export function orderForWall(picks: readonly PickedCamera[], centre: LatLon): PickedCamera[] {
  const live = orderByDistanceFrom(picks.filter((p) => p.live === true), centre);
  const rest = orderByDistanceFrom(picks.filter((p) => p.live !== true), centre);
  return [...live, ...rest];
}

/**
 * Deal an area's cameras across the wall.
 *
 * ROUND-ROBIN, NOT CONTIGUOUS CHUNKS. Consecutive cameras in a feed are usually
 * consecutive on one road, so chunking would put a whole interchange in tile one
 * and a different road entirely in tile two. Dealing them out gives each tile a
 * spread across the area, which is what makes nine tiles read as coverage rather
 * than as four views of the same junction.
 */
export function planFanOut(
  picks: readonly PickedCamera[],
  centre: LatLon,
  tiles: number = WALL_TILES,
): FanOutTile[] {
  const ordered = orderForWall(picks, centre);
  if (ordered.length === 0) return [];

  // Never more tiles than cameras: nine tiles of which five are empty is not a
  // smaller wall, it is a broken one.
  const count = Math.max(1, Math.min(Math.floor(tiles), ordered.length));
  const buckets: PickedCamera[][] = Array.from({ length: count }, () => []);
  ordered.forEach((p, i) => buckets[i % count].push(p));

  return buckets.map((bucket) => ({
    // A tile holding one camera is named after it, because that is the most
    // useful thing the header could say. A tile holding several cannot be, so it
    // states what it is instead of picking one of its cameras and implying the
    // others are not there.
    name: bucket.length === 1 ? bucket[0].label : `${bucket.length} cameras`,
    streams: bucket.map((p) => p.ref),
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-fanout.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.fanout.ts lib/console/widgets/camslot.pick.ts tests/unit/camslot-fanout.test.ts
git commit -m "Deal an area's cameras across nine tiles, live ones first"
```

---

### Task 4: The full-bleed dock exception

While the wall holds no tiles, the map takes the whole board. Today it cannot: `dockSize` clamps to `RAIL_MAX.right` (720px) and to `container.w - WALL_MIN_PX` (360px).

**Files:**
- Modify: `lib/terminal/rails.ts` (`dockSize`)
- Modify: `components/console/WallWorkspace.tsx` (render nothing at zero tiles — its toolbar included)
- Modify: `components/console/ConsoleWorkspace.tsx` (pass the tile count; suppress the dock splitter while the map is full-bleed)
- Test: `tests/unit/terminal-rails-dock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `dockSize(l: ShellLayout, container: { w: number; h: number }): number` — same signature, new behaviour when `l.widgets.length === 0` and `l.mode === "wall"`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/terminal-rails-dock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dockSize, RAIL_MAX, WALL_MIN_PX } from "@/lib/terminal/rails";
import type { ShellLayout, WidgetInstance } from "@/lib/console/types";

const box = { w: 1440, h: 900 };

const layout = (widgets: WidgetInstance[], collapsed = false, size = 400): ShellLayout => ({
  mode: "wall",
  stage: "map2d",
  widgets,
  focusedWidgetId: null,
  segments: {
    left: { size: 320, collapsed: false },
    right: { size, collapsed },
    bottom: { size: 0, collapsed: false },
  },
});

const tile = (id: string): WidgetInstance => ({
  id, type: "camslot", segment: "left", order: 0, height: 280,
  collapsed: false, config: {}, rect: { x: 0, y: 0, w: 4, h: 6 },
});

describe("dockSize", () => {
  it("takes the whole board when the wall holds no tiles", () => {
    expect(dockSize(layout([]), box)).toBe(box.w);
  });

  it("returns to the normal clamp as soon as one tile exists", () => {
    expect(dockSize(layout([tile("a")]), box)).toBe(400);
  });

  it("still honours RAIL_MAX once tiles exist", () => {
    expect(dockSize(layout([tile("a")], false, 9999), box)).toBe(RAIL_MAX.right);
  });

  it("still leaves the wall its floor once tiles exist", () => {
    const narrow = { w: WALL_MIN_PX + 100, h: 900 };
    expect(dockSize(layout([tile("a")], false, 9999), narrow)).toBe(100);
  });

  it("respects a collapsed dock even on an empty wall — closed is closed", () => {
    expect(dockSize(layout([], true), box)).toBe(0);
  });

  it("does not apply the exception to a rails board", () => {
    const rails = { ...layout([]), mode: "rails" as const };
    expect(dockSize(rails, box)).not.toBe(box.w);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/terminal-rails-dock.test.ts`
Expected: FAIL — first test gets `400`, expected `1440`.

- [ ] **Step 3: Implement the exception**

Replace `dockSize` in `lib/terminal/rails.ts`:

```ts
export function dockSize(l: ShellLayout, container: { w: number; h: number }): number {
  if (l.segments.right.collapsed) return 0;

  // AN EMPTY WALL GIVES THE MAP THE WHOLE BOARD.
  //
  // The two bounds below exist for one reason each: RAIL_MAX stops a rail
  // crowding the map out, and WALL_MIN_PX keeps the WALL's own controls from
  // colliding. Neither applies to a board with nothing on it — but only because
  // WallWorkspace RETURNS NULL at zero tiles, its toolbar included. That is a
  // dependency, not an observation: leave that toolbar mounted and this exception
  // squeezes it to 0px, taking "+ Wall" and "Map" — the visible way back — with it.
  //
  // This is what lets the Streets board open as a full-bleed map asking for an
  // area. If a future empty wall grows chrome of its own, this exception is wrong
  // and goes — it is guarded by the tile count precisely so that stays checkable.
  if (l.mode === "wall" && l.widgets.length === 0) return container.w;

  const want = clampRailSize("right", l.segments.right.size);
  return Math.max(0, Math.min(want, container.w - WALL_MIN_PX));
}
```

- [ ] **Step 4: Make the exception's premise true**

`dockSize` above is only safe because an empty wall draws nothing. Today it draws
`.tn-wall-bar` regardless of tile count, so make that conditional. In
`components/console/WallWorkspace.tsx`, before any markup:

```tsx
  // An empty wall renders NOTHING, toolbar included: dockSize hands the map the
  // whole board in that state, so this column is 0px wide and any chrome here is
  // squeezed to nothing. The board's empty state goes over the map instead — see
  // StreetsPrompt in ConsoleWorkspace.
  if (items.length === 0) return null;
```

(Use whatever the file already calls its placed-tile list.)

Then in `components/console/ConsoleWorkspace.tsx`, do not render the dock splitter
while the map is full-bleed. The seam is meaningless there — `dockSize` ignores
`segments.right.size` in that state, so dragging it does nothing, and its
`aria-valuenow` would report the full container width against an `aria-valuemax`
of `RAIL_MAX.right` (720). Every other case keeps its current behaviour.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/terminal-rails-dock.test.ts`
Expected: PASS, 6 tests.

The two component changes are NOT unit-testable here: vitest runs in the node
environment and the repo has no React testing library. Task 11's browser gate is
where the full-bleed state is actually looked at.

- [ ] **Step 6: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/terminal/rails.ts components/console/WallWorkspace.tsx components/console/ConsoleWorkspace.tsx tests/unit/terminal-rails-dock.test.ts
git commit -m "Give the map the whole board while the wall is empty"
```

---

### Task 5: Building a board from a ring

The join: a ring plus the loaded camera stores becomes a set of tiles on the layout. Split from the gesture so it is testable without a map.

**Files:**
- Create: `lib/console/widgets/camslot.monitor.ts`
- Test: `tests/unit/camslot-monitor.test.ts`

**Interfaces:**
- Consumes: `ringFromCircle` (Task 1), `planFanOut` / `FanOutTile` (Task 3), `ShellLayout.watch` (Task 2), `camerasInRing` and `PickedCamera` from `camslot.pick`, `webcamRef` from `camslot.arm`.
- Produces:
  - `export interface MonitorInput { ring: readonly [number, number][]; cameras: readonly CameraRow[]; webcams: readonly WebcamRow[] }`
  - `export interface CameraRow extends LatLon { id: string; name?: string; refreshSeconds?: number; source?: string; live?: boolean }`
  - `export interface WebcamRow extends LatLon { id: string; label?: string }`
  - `export interface MonitorPlan { tiles: FanOutTile[]; found: number; live: number; message: string }`
  - `export function planMonitor(input: MonitorInput, tiles?: number): MonitorPlan`
  - `export function ringCentre(ring: readonly [number, number][]): LatLon`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-monitor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planMonitor, ringCentre, type CameraRow, type WebcamRow } from "@/lib/console/widgets/camslot.monitor";
import { ringFromCircle } from "@/lib/map/circle";

const centre = { lat: 32.7641, lon: -117.1577 };
const ring = ringFromCircle({ ...centre, radiusKm: 5 });

const road = (id: string, live: boolean, away = 1): CameraRow => ({
  id, name: id, live, lat: centre.lat + away * 0.005, lon: centre.lon,
});
const web = (id: string, away = 1): WebcamRow => ({
  id, label: id, lat: centre.lat + away * 0.005, lon: centre.lon,
});

describe("ringCentre", () => {
  it("returns the mean of the vertices", () => {
    const c = ringCentre([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(c.lon).toBeCloseTo(1, 6);
    expect(c.lat).toBeCloseTo(1, 6);
  });
});

describe("planMonitor", () => {
  it("builds nine tiles from a ring holding more than nine cameras", () => {
    const cameras = Array.from({ length: 30 }, (_, i) => road(`c${i}`, true, (i % 8) + 1));
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.tiles).toHaveLength(9);
    expect(plan.found).toBe(30);
    expect(plan.live).toBe(30);
  });

  it("ignores cameras outside the ring", () => {
    const cameras = [road("in", true, 1), { ...road("out", true), lat: 40, lon: -80 }];
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.found).toBe(1);
    expect(plan.tiles).toHaveLength(1);
  });

  it("includes webcams, and counts them as not live", () => {
    const plan = planMonitor({ ring, cameras: [road("r", true)], webcams: [web("w")] });
    expect(plan.found).toBe(2);
    expect(plan.live).toBe(1);
    // Live first: the road camera leads.
    expect(plan.tiles[0].streams[0]).toEqual({ k: "cam", id: "r" });
  });

  it("says nothing was found when the ring is empty, and makes no tiles", () => {
    const plan = planMonitor({ ring, cameras: [], webcams: [] });
    expect(plan.tiles).toEqual([]);
    expect(plan.found).toBe(0);
    expect(plan.message).toContain("No cameras");
  });

  it("states the live count in its message when the ring holds both kinds", () => {
    const cameras = [road("a", true), road("b", false, 2)];
    const plan = planMonitor({ ring, cameras, webcams: [] });
    expect(plan.message).toContain("2");
    expect(plan.message).toContain("1 live");
  });

  it("reports how many were left out when the ring holds more than the wall shows", () => {
    const cameras = Array.from({ length: 30 }, (_, i) => road(`c${i}`, true, (i % 8) + 1));
    const plan = planMonitor({ ring, cameras, webcams: [] });
    // Nothing is dropped — the overflow rotates — so the message must not claim a loss.
    expect(plan.message).not.toContain("not placed");
    expect(plan.message).toContain("30");
  });

  it("refuses a ring with fewer than three vertices", () => {
    const plan = planMonitor({ ring: [[0, 0], [1, 1]], cameras: [road("a", true)], webcams: [] });
    expect(plan.tiles).toEqual([]);
    expect(plan.found).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-monitor.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write the module**

Create `lib/console/widgets/camslot.monitor.ts`:

```ts
// A drawn area becomes a board.
//
// Kept apart from the gesture (camslot.circle.ts) and from the stores it reads,
// so the WHOLE rule — what is inside the ring, which cameras lead, how they are
// dealt out, and what the user is told — is a pure function over plain rows. That
// is the only way it can be tested here: vitest runs in the node environment and
// there is no React testing library in this repo.

import { planFanOut, type FanOutTile } from "@/lib/console/widgets/camslot.fanout";
import { camerasInRing, pickKey, type PickedCamera } from "@/lib/console/widgets/camslot.pick";
import { webcamRef, type LatLon } from "@/lib/console/widgets/camslot.arm";

/** Mirrors camslot.area.ts and WorldMap — Windy's image tokens last ~10 minutes. */
const WEBCAM_REFRESH_SECONDS = 600;

export interface CameraRow extends LatLon {
  id: string;
  name?: string;
  refreshSeconds?: number;
  source?: string;
  /** Set by lib/cameras/body.ts from isLiveStreamUrl — a stream /api/hls can play. */
  live?: boolean;
}

export interface WebcamRow extends LatLon {
  id: string;
  label?: string;
}

export interface MonitorInput {
  ring: readonly [number, number][];
  cameras: readonly CameraRow[];
  webcams: readonly WebcamRow[];
}

export interface MonitorPlan {
  tiles: FanOutTile[];
  /** How many cameras the ring contained. Every one of them is on the board — the
   *  overflow rotates rather than being dropped — so this is not a "found vs
   *  shown" pair and must never be reported as one. */
  found: number;
  live: number;
  /** A sentence for the user. Always populated. */
  message: string;
}

/**
 * The mean of a ring's vertices.
 *
 * Good enough to rank distance within one ring, which is all it is used for. It is
 * NOT a centroid and must not be shown to anyone as "the middle of this area" —
 * the same caveat `camslot.area.ts` carries on its own copy.
 */
export function ringCentre(ring: readonly [number, number][]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) { lon += x; lat += y; }
  const n = Math.max(1, ring.length);
  return { lat: lat / n, lon: lon / n };
}

export function planMonitor(input: MonitorInput, tiles?: number): MonitorPlan {
  const { ring } = input;
  if (ring.length < 3) {
    return { tiles: [], found: 0, live: 0, message: "That area is not a shape." };
  }

  const inRing = camerasInRing(input.cameras, ring);
  const webcamsInRing = camerasInRing(input.webcams, ring);

  const picks: PickedCamera[] = [
    ...inRing.map((c) => ({
      ref: { k: "cam" as const, id: c.id },
      key: pickKey({ k: "cam", id: c.id }),
      label: c.name || c.id,
      lat: c.lat,
      lon: c.lon,
      refreshSeconds: c.refreshSeconds,
      source: c.source,
      live: c.live === true,
    })),
    ...webcamsInRing.map((w) => ({
      ref: webcamRef(w.id, w.label),
      key: pickKey(webcamRef(w.id, w.label)),
      label: w.label || w.id,
      lat: w.lat,
      lon: w.lon,
      refreshSeconds: WEBCAM_REFRESH_SECONDS,
      source: "Windy",
      // A Windy webcam is a refreshing still by definition — there is no HLS
      // stream behind one — so this is a fact, not a default.
      live: false,
    })),
  ];

  const found = picks.length;
  if (found === 0) {
    return { tiles: [], found: 0, live: 0, message: "No cameras inside that area." };
  }

  const live = picks.filter((p) => p.live).length;
  const centre = ringCentre(ring);
  const plan = planFanOut(picks, centre, tiles);

  // The honest sentence. It states the total and how many of them play video,
  // because those are different numbers and the difference is the whole reason
  // the default area is where it is.
  const noun = found === 1 ? "camera" : "cameras";
  const message =
    live === found
      ? `${found} ${noun}, all live.`
      : `${found} ${noun}, ${live} live.`;

  return { tiles: plan, found, live, message };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-monitor.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.monitor.ts tests/unit/camslot-monitor.test.ts
git commit -m "Turn a drawn ring into a planned wall of tiles"
```

---

### Task 6: The circle gesture

The browser half. Press for the centre, drag for the radius, release.

**Files:**
- Create: `lib/console/widgets/camslot.circle.ts`
- Test: `tests/unit/camslot-circle.test.ts` (the pure helper only)

**Interfaces:**
- Consumes: `ringFromCircle`, `haversineKm`, `CircleSpec` (Task 1).
- Produces:
  - `export interface CircleDrawState { center: LatLon | null; radiusKm: number }`
  - `export const circleDrawStore` — `{ get(): CircleDrawState | null; subscribe(fn: () => void): () => void }`
  - `export function startCircleDraw(map: MapLike, opts: { onFinish: (ring: [number, number][]) => void }): boolean`
  - `export function cancelCircleDraw(): void`
  - `export function specFrom(center: LatLon, edge: LatLon): CircleSpec` — pure, tested.

**The gesture must PAINT, and this was nearly missed.** Publishing `radiusKm` to a text
readout is not a drawing tool — without a rubber-band circle following the pointer, the user
drags against a blank map and reads a number. The preview is part of this task, not a polish
pass.

**Layer ids are namespaced `tn-circle-*` and must not collide.** `lib/map/aoi.ts` owns
`aoi-areas`, `aoi-areas-fill`, `aoi-areas-line` and `aoi-areas-line-editing` (confirmed by
console-ux, 2026-09-07). Reusing any of those would have one gesture's teardown remove the
other's paint. **MapLibre drops an invalid layer silently**, so a collision here shows up as
"the circle just doesn't draw" with nothing in the console.

- [ ] **Step 1: Write the failing test for the pure helper**

Create `tests/unit/camslot-circle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { specFrom } from "@/lib/console/widgets/camslot.circle";
import { haversineKm } from "@/lib/map/circle";

describe("specFrom", () => {
  it("keeps the centre and measures the radius to the dragged edge", () => {
    const center = { lat: 32.7641, lon: -117.1577 };
    const edge = { lat: 32.8091, lon: -117.1577 };
    const spec = specFrom(center, edge);
    expect(spec.lat).toBe(center.lat);
    expect(spec.lon).toBe(center.lon);
    expect(spec.radiusKm).toBeCloseTo(haversineKm(center, edge), 6);
  });

  it("gives a zero radius when the pointer has not moved, which is every drag's first frame", () => {
    const p = { lat: 10, lon: 10 };
    expect(specFrom(p, p).radiusKm).toBeCloseTo(0, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-circle.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write the gesture**

Create `lib/console/widgets/camslot.circle.ts`:

```ts
"use client";

import { ringFromCircle, haversineKm, type CircleSpec } from "@/lib/map/circle";
import type { LatLon } from "@/lib/console/widgets/camslot.arm";

// ── Press, drag, release ─────────────────────────────────────────────────────
//
// WHY THIS IS NOT A MODE OF lib/map/aoi.ts. That module owns a click-per-vertex
// polygon: each click adds a point, a double-click closes the ring, and it takes
// custody of double-click-zoom so that closing gesture does not also zoom. A
// circle is one continuous pointer gesture with no vertices and no closing click.
// Sharing an implementation would mean two state machines in one file, and that
// file belongs to another workstream this week.
//
// What IS shared is the output: an open [lon, lat][] ring, identical in shape to
// what `startDraw`'s onFinish hands back. Everything downstream — camerasInRing,
// aoiScope, withinScope, filterToScopes — consumes either without knowing which
// gesture drew it.
//
// MODULE STATE, not React state. Same constraint the picker documents: the map's
// interaction wiring is a `useCallback(..., [])` invoked once at mount, so
// anything a handler closes over is frozen at mount. State read at EVENT time is
// the only shape that works.

/** The minimum a drag must cover before it counts as a circle rather than a click.
 *  Below this, a user who pressed and released on the same spot would get a ring
 *  containing nothing and no explanation. */
const MIN_RADIUS_KM = 0.05;

/** Preview layer ids. NAMESPACED AWAY FROM aoi.ts, which owns `aoi-areas*`. Two
 *  gestures sharing a layer id means one's teardown removes the other's paint,
 *  and MapLibre drops an invalid layer SILENTLY — the symptom is "the circle does
 *  not draw" with a clean console. */
const CIRCLE_SRC = "tn-circle-src";
const CIRCLE_FILL = "tn-circle-fill";
const CIRCLE_LINE = "tn-circle-line";

export interface CircleDrawState {
  center: LatLon | null;
  radiusKm: number;
}

/** The minimum of MapLibre this module needs. Typed structurally so the unit
 *  tests never have to construct a Map. */
export interface MapLike {
  getCanvas(): HTMLCanvasElement;
  unproject(p: [number, number]): { lat: number; lng: number };
  dragPan: { enable(): void; disable(): void };
  getSource(id: string): { setData(d: unknown): void } | undefined;
  addSource(id: string, spec: unknown): void;
  getLayer(id: string): unknown;
  addLayer(spec: unknown): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
}

/**
 * The rubber band. Ensures the preview layers exist and pushes the current ring.
 *
 * Called on every pointermove, so it adds the source and layers ONCE and does
 * `setData` thereafter — adding a layer per frame is what makes a drag stutter.
 * Paint values are hard-coded, as every paint value in this codebase is: MapLibre
 * cannot read a CSS custom property.
 */
function paintPreview(map: MapLike, ring: readonly [number, number][]): void {
  const data = {
    type: "FeatureCollection",
    features: ring.length >= 3
      ? [{
          type: "Feature",
          properties: {},
          // A GeoJSON polygon ring must be CLOSED — first coordinate repeated.
          // Our rings are open by contract, so the closure happens here, at the
          // one place that hands geometry to MapLibre, and nowhere else.
          geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        }]
      : [],
  };

  const existing = map.getSource(CIRCLE_SRC);
  if (existing) { existing.setData(data); return; }

  map.addSource(CIRCLE_SRC, { type: "geojson", data });
  if (!map.getLayer(CIRCLE_FILL)) {
    map.addLayer({
      id: CIRCLE_FILL, type: "fill", source: CIRCLE_SRC,
      paint: { "fill-color": "#ffb020", "fill-opacity": 0.1 },
    });
  }
  if (!map.getLayer(CIRCLE_LINE)) {
    map.addLayer({
      id: CIRCLE_LINE, type: "line", source: CIRCLE_SRC,
      paint: { "line-color": "#ffb020", "line-width": 2, "line-opacity": 0.95 },
    });
  }
}

/** Remove the preview. Layers BEFORE the source — MapLibre refuses to drop a
 *  source that a layer still references, and the refusal is silent. */
function clearPreview(map: MapLike): void {
  for (const id of [CIRCLE_FILL, CIRCLE_LINE]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(CIRCLE_SRC)) map.removeSource(CIRCLE_SRC);
}

let state: CircleDrawState | null = null;
const listeners = new Set<() => void>();
function emit() { for (const fn of listeners) fn(); }

export const circleDrawStore = {
  get(): CircleDrawState | null { return state; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Centre plus the point being dragged to, as a circle. Pure, so the arithmetic
 *  is tested without a map. */
export function specFrom(center: LatLon, edge: LatLon): CircleSpec {
  return { lat: center.lat, lon: center.lon, radiusKm: haversineKm(center, edge) };
}

let teardown: (() => void) | null = null;

/**
 * Begin a circle draw. Returns false when the map is not ready.
 *
 * The ring arrives later, through `onFinish`, exactly as `startDraw` does — a
 * gesture cannot return its own result.
 */
export function startCircleDraw(
  map: MapLike,
  opts: { onFinish: (ring: [number, number][]) => void },
): boolean {
  if (!map || teardown) return false;

  const canvas = map.getCanvas();
  if (!canvas) return false;

  // Panning must be off for the duration or the drag that sets the radius also
  // drags the map, and the circle grows from a centre that is moving under it.
  map.dragPan.disable();
  canvas.style.cursor = "crosshair";

  const at = (e: PointerEvent): LatLon => {
    const r = canvas.getBoundingClientRect();
    const p = map.unproject([e.clientX - r.left, e.clientY - r.top]);
    return { lat: p.lat, lon: p.lng };
  };

  let center: LatLon | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    center = at(e);
    // Publish the centre on the FIRST event, not on release. The draw banner
    // narrates from `center` and `radiusKm`; withholding the centre until the
    // end leaves it stuck on the press prompt for the whole drag, which reads as
    // a dead tool.
    state = { center, radiusKm: 0 };
    emit();
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!center) return;
    const spec = specFrom(center, at(e));
    state = { center, radiusKm: spec.radiusKm };
    // Draw the band the user is dragging. Without this the gesture is a number
    // in a panel and the map shows nothing at all.
    paintPreview(map, ringFromCircle(spec));
    emit();
  };

  const onUp = (e: PointerEvent) => {
    if (!center) return;
    const spec = specFrom(center, at(e));
    const done = spec.radiusKm >= MIN_RADIUS_KM ? ringFromCircle(spec) : [];
    stop();
    // Fired AFTER teardown so a handler that starts another gesture is not
    // immediately torn down by this one's cleanup.
    if (done.length >= 3) opts.onFinish(done);
  };

  // Escape only — this gesture never ENDS on a key, and that is deliberate.
  // The console-ux workstream hit the trap in their polygon tool: a focused button
  // turns Enter into a click as its default action, so arming a draw from a button
  // and pressing Enter to finish re-armed it on the same keystroke. Their fix is a
  // preventDefault on Enter in `aoi.ts`, and it is on an UNMERGED branch (#187) —
  // do not write a comment claiming `aoi.ts` on this branch already does it, because
  // it does not. A gesture that ends on pointerup cannot hit the trap at all. If a
  // key ever ends this one, it needs that preventDefault.
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelCircleDraw(); };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey);

  const stop = () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey);
    canvas.style.cursor = "";
    map.dragPan.enable();
    // The preview is the GESTURE's paint, not the board's. The finished area is
    // drawn separately from `layout.watch`, so leaving this behind would put two
    // rings on the map that drift apart the moment a second area is drawn.
    clearPreview(map);
    teardown = null;
    state = null;
    emit();
  };

  teardown = stop;
  state = { center: null, radiusKm: 0 };
  emit();
  return true;
}

/** Abandon a circle in progress. Safe to call when none is running. */
export function cancelCircleDraw(): void {
  teardown?.();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-circle.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.circle.ts tests/unit/camslot-circle.test.ts
git commit -m "Add a press-and-drag circle gesture for the Streets board"
```

---

### Task 7: The Streets preset opens on an area

Replace the three seeded webcams with a pre-drawn circle over San Diego and no tiles, so the board opens as a prompt.

**Files:**
- Modify: `lib/console/presets.ts` (the `streets` entry and `composeWall`)
- Modify: `tests/unit/console-presets.test.ts`
- Test: same file

**Interfaces:**
- Consumes: `ringFromCircle` (Task 1), `ShellLayout.watch` (Task 2).
- Produces: `export const STREETS_DEFAULT_AREA: CircleSpec` from `lib/console/presets.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/console-presets.test.ts`:

```ts
import { BUILTIN_PRESETS, STREETS_DEFAULT_AREA } from "@/lib/console/presets";
import { haversineKm } from "@/lib/map/circle";

describe("the Streets board opens on a monitored area", () => {
  const streets = BUILTIN_PRESETS.find((p) => p.id === "streets")!;

  it("is still the only wall board", () => {
    expect(streets.build().mode).toBe("wall");
  });

  it("opens with NO tiles, so the board is a prompt", () => {
    expect(streets.build().widgets).toEqual([]);
  });

  it("carries a default area as a ring", () => {
    const ring = streets.build().watch?.ring;
    expect(ring).toBeDefined();
    expect(ring!.length).toBeGreaterThanOrEqual(3);
  });

  it("centres that area on the measured live-camera cluster", () => {
    // San Diego, I-8 just east of the 163 — 44 live cameras within 5 km,
    // measured from the Caltrans D11 feed on 2026-09-07.
    expect(STREETS_DEFAULT_AREA.lat).toBeCloseTo(32.7641, 3);
    expect(STREETS_DEFAULT_AREA.lon).toBeCloseTo(-117.1577, 3);
    expect(STREETS_DEFAULT_AREA.radiusKm).toBe(5);
  });

  it("puts every ring vertex the stated radius from the centre", () => {
    for (const [lon, lat] of streets.build().watch!.ring) {
      expect(haversineKm(STREETS_DEFAULT_AREA, { lat, lon })).toBeCloseTo(5, 1);
    }
  });

  it("no longer seeds the three fixed webcam ids", () => {
    const json = JSON.stringify(streets.build());
    for (const dead of ["1420893641", "1606332744", "1345327762"]) {
      expect(json).not.toContain(dead);
    }
  });

  it("opens with the dock UNCOLLAPSED, so the prompt is a visible map", () => {
    expect(streets.build().segments.right.collapsed).toBe(false);
  });

  it("still asks for the camera and webcam layers", () => {
    expect(streets.mapCore).toEqual(["cameras", "webcams"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/console-presets.test.ts`
Expected: FAIL — `STREETS_DEFAULT_AREA` is not exported; `widgets` is not empty.

- [ ] **Step 3: Rewrite the preset**

In `lib/console/presets.ts`, add the import and the constant:

```ts
import { ringFromCircle, type CircleSpec } from "@/lib/map/circle";

/**
 * Where Streets opens.
 *
 * MEASURED, not chosen for the name. Only four host families in
 * `lib/proxy/hls-allowlist.ts` serve playable video — Caltrans, SCDOT and two
 * Serbian networks — so a board that promises live cameras can only open on one
 * of those networks. Fetched from the upstream feeds on 2026-09-07: SCDOT is
 * 771/771 live, Caltrans D11 (San Diego) 235/324, D12 (Orange County) 249/385.
 * The densest 5 km circle of live cameras measured was San Diego at 44, on I-8
 * just east of the 163.
 *
 * KNOWN GAP, stated rather than hidden: districts 3, 4, 6, 7 and 8 all returned
 * HTTP 500 under what looked like throttling, so LOS ANGELES (D7) and the BAY
 * AREA (D4) were never measured and either could be denser. This is the densest
 * area measured, not the densest that exists. If those are read later and win,
 * this constant is the only thing that changes.
 *
 * The three webcam ids this replaced — Trafalgar Square, Plaza Canalejas,
 * Wenceslas Square — had ZERO live cameras between them. They were Windy stills,
 * and TfL's JamCams are presented as stills too (see lib/cameras/classify.ts).
 */
export const STREETS_DEFAULT_AREA: CircleSpec = { lat: 32.7641, lon: -117.1577, radiusKm: 5 };
```

Change `composeWall` to take an optional area and to accept an empty card list:

```ts
function composeWall(
  stage: ShellLayout["stage"],
  shell: { w: number; h: number },
  cards: CardSpec[],
  area?: CircleSpec,
): ShellLayout {
  let l: ShellLayout = { ...setStage(createDefaultLayout(), stage), mode: "wall" };

  for (const c of cards) {
    l = addWidget(l, c.type, id(), {
      segment: "left",
      ...(c.config ? { config: c.config } : {}),
    });
  }

  l = arrangeBoard(l, Math.floor(shell.h / (ROW_PX + GAP_PX)));

  // THE DOCK OPENS UNCOLLAPSED NOW, and that is the whole first-run change. With
  // no tiles on the board `dockSize` gives the map the full width (see
  // lib/terminal/rails.ts), so "open" and "empty" together ARE the prompt state.
  // A collapsed dock would open this board on a blank grid instead.
  l = setSegmentSize(l, "right", WALL_DOCK_PX);
  l = setSegmentCollapsed(l, "right", false);

  if (area) {
    const ring = ringFromCircle(area);
    if (ring.length >= 3) l = { ...l, watch: { ring } };
  }

  return l;
}
```

Replace the `streets` entry's `build` (keep the surrounding comment block, but replace the paragraphs about the three seeds and the four cards with a note pointing at `STREETS_DEFAULT_AREA`):

```ts
    build: (shell = DEFAULT_SHELL) => composeWall("map2d", shell, [], STREETS_DEFAULT_AREA),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/console-presets.test.ts`
Expected: PASS. The board-count row in `CLAUDE.md` does not move — this is still 2 boards.

- [ ] **Step 5: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/presets.ts tests/unit/console-presets.test.ts
git commit -m "Open Streets on a measured live-camera area instead of three fixed webcams"
```

---

### Task 8: The prompt, and applying a drawn area

Wire the pieces: an empty wall shows the prompt, the prompt starts the gesture, and a finished ring builds the board.

**Files:**
- Create: `components/console/StreetsPrompt.tsx`
- Create: `lib/console/widgets/camslot.apply.ts`
- Modify: `components/console/ConsoleWorkspace.tsx` (render the prompt over the stage while the wall is empty)
- Modify: `app/globals.css` (append a `.tn-streets-` block at the end)
- Test: `tests/unit/camslot-apply.test.ts`

**Interfaces:**
- Consumes: `planMonitor` / `MonitorPlan` (Task 5), `startCircleDraw` (Task 6), `createCamslot` from `camslot.create`, `shellLayoutStore` from `lib/console/store`, `arrangeBoard` from `lib/console/reducers`.
- Produces:
  - `export function applyMonitorPlan(plan: MonitorPlan, ring: readonly [number, number][]): { ok: boolean; message: string; created: number }`
  - `export function startStreetsArea(): { ok: boolean; message?: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-apply.test.ts`. This tests the layout arithmetic through the reducers, which are pure:

```ts
import { describe, expect, it } from "vitest";
import { tilesToLayout } from "@/lib/console/widgets/camslot.apply";
import { createDefaultLayout } from "@/lib/console/types";
import type { FanOutTile } from "@/lib/console/widgets/camslot.fanout";

const wall = () => ({ ...createDefaultLayout(), mode: "wall" as const });

/** A deterministic minter, which is the point of `mintId` being a parameter:
 *  the test asserts the LAYOUT, not the shape of a random string. */
const minter = () => { let n = 0; return () => `w${++n}`; };
const tile = (name: string, n: number): FanOutTile => ({
  name,
  streams: Array.from({ length: n }, (_, i) => ({ k: "cam" as const, id: `${name}-${i}` })),
});

describe("tilesToLayout", () => {
  it("creates one widget per tile", () => {
    const l = tilesToLayout(wall(), [tile("a", 1), tile("b", 2), tile("c", 3)], 28, minter());
    expect(l.widgets).toHaveLength(3);
    expect(l.widgets.every((w) => w.type === "camslot")).toBe(true);
  });

  it("gives every widget a rect, so none is mounted-but-undrawn", () => {
    const l = tilesToLayout(wall(), Array.from({ length: 9 }, (_, i) => tile(`t${i}`, 2)), 28, minter());
    expect(l.widgets).toHaveLength(9);
    for (const w of l.widgets) expect(w.rect).toBeDefined();
  });

  it("lays nine tiles out three across", () => {
    const l = tilesToLayout(wall(), Array.from({ length: 9 }, (_, i) => tile(`t${i}`, 1)), 28, minter());
    const xs = l.widgets.map((w) => w.rect!.x);
    expect(new Set(xs)).toEqual(new Set([0, 4, 8]));
    expect(new Set(l.widgets.map((w) => w.rect!.y)).size).toBe(3);
  });

  it("carries each tile's name and streams into its config", () => {
    const l = tilesToLayout(wall(), [tile("Soho", 2)], 28, minter());
    expect(l.widgets[0].config.name).toBe("Soho");
    expect(l.widgets[0].config.streams).toEqual([{ k: "cam", id: "Soho-0" }, { k: "cam", id: "Soho-1" }]);
  });

  it("uses the video dwell for a tile holding several streams", () => {
    const l = tilesToLayout(wall(), [tile("many", 4)], 28, minter());
    expect(l.widgets[0].config.intervalMs).toBe(30_000);
  });

  it("mints ids through the injected factory, so the layout is deterministic", () => {
    const l = tilesToLayout(wall(), [tile("a", 1), tile("b", 1)], 28, minter());
    expect(l.widgets.map((w) => w.id)).toEqual(["w1", "w2"]);
  });

  it("REPLACES whatever the board held, so redrawing does not append", () => {
    const first = tilesToLayout(wall(), [tile("a", 1), tile("b", 1)], 28, minter());
    const second = tilesToLayout(first, [tile("c", 1)], 28, minter());
    expect(second.widgets).toHaveLength(1);
    expect(second.widgets[0].config.name).toBe("c");
  });

  it("leaves an empty tile list as an empty board, which is the prompt state", () => {
    expect(tilesToLayout(wall(), [], 28, minter()).widgets).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-apply.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write the apply module**

Create `lib/console/widgets/camslot.apply.ts`:

```ts
"use client";

import { arrangeBoard, addWidget, removeWidget } from "@/lib/console/reducers";
import { shellLayoutStore } from "@/lib/console/store";
import { getMapInstance } from "@/lib/map/instance";
import { revealPickLayers } from "@/lib/console/widgets/camslot.layers";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { loadedWebcamsStore } from "@/lib/webcams/loaded";
import { startCircleDraw } from "@/lib/console/widgets/camslot.circle";
import { planMonitor, type MonitorPlan } from "@/lib/console/widgets/camslot.monitor";
import { WALL_TILES, type FanOutTile } from "@/lib/console/widgets/camslot.fanout";
import { ROW_PX, GAP_PX } from "@/lib/terminal/layoutGrid";
import type { ShellLayout } from "@/lib/console/types";

/**
 * Dwell for a tile that holds more than one stream.
 *
 * A still tile switches by swapping an <img> src. A VIDEO tile switches by
 * destroying an hls.js instance and building another, which costs a manifest
 * fetch and a fresh buffer before the first frame — at the still default of 8s a
 * tile would spend most of its life buffering rather than showing anything.
 *
 * 30s is REASONED FROM THAT COST AND NOT MEASURED. It is the number in this
 * feature most likely to be wrong, and `scripts/verify-streets-area.mjs` times a
 * switch precisely so it can be corrected with evidence rather than taste.
 */
export const VIDEO_DWELL_MS = 30_000;

/** A camera tile's opening height in px. Mirrors camslot.create.ts's constant —
 *  the "M" preset, so a new tile opens on a size the ⋯ menu highlights. */
const TILE_HEIGHT_PX = 280;

/**
 * Replace a wall's tiles with a planned set. PURE, so the layout arithmetic is
 * testable without a store or a map.
 *
 * REPLACES rather than appends. Drawing a second area means "monitor this
 * instead", not "monitor both" — and appending would silently walk the board past
 * nine tiles on every redraw.
 *
 * `mintId` IS A PARAMETER so this stays pure and deterministic under test. Minting
 * ids inside would make a function that claims to be pure return a different
 * layout on every call, and a test could then only assert the SHAPE of an id, not
 * the layout. The app passes the store's own minter, so ids keep the `w<base36>`
 * format every other widget in the console uses.
 */
export function tilesToLayout(
  l: ShellLayout,
  tiles: readonly FanOutTile[],
  rows: number,
  mintId: () => string,
): ShellLayout {
  let next = l;
  for (const w of [...l.widgets]) next = removeWidget(next, w.id);

  for (const t of tiles) {
    next = addWidget(next, "camslot", mintId(), {
      segment: "left",
      height: TILE_HEIGHT_PX,
      config: {
        name: t.name,
        streams: t.streams,
        // A tile with one stream never rotates, so its interval is inert; giving
        // it the video dwell anyway would be a claim about behaviour that does
        // not happen. The default is right for it.
        ...(t.streams.length > 1 ? { intervalMs: VIDEO_DWELL_MS } : {}),
      },
    });
  }

  return tiles.length > 0 ? arrangeBoard(next, rows) : next;
}

export interface ApplyResult { ok: boolean; message: string; created: number }

/** Put a planned wall onto the open board and remember the area that made it. */
export function applyMonitorPlan(plan: MonitorPlan, ring: readonly [number, number][]): ApplyResult {
  if (plan.tiles.length === 0) {
    return { ok: false, message: plan.message, created: 0 };
  }
  const rows = Math.floor((typeof window === "undefined" ? 900 : window.innerHeight) / (ROW_PX + GAP_PX));
  shellLayoutStore.replace((l) => ({
    ...tilesToLayout(l, plan.tiles, rows, nextWidgetId),
    watch: { ring: [...ring] as [number, number][] },
  }));
  return { ok: true, message: plan.message, created: plan.tiles.length };
}

/**
 * Start the Streets area gesture.
 *
 * Turns the camera layers on first, for the reason camslot.layers.ts gives: a
 * ring that closes onto an empty result because a layer was off is the tool
 * refusing a request it understood. The guarantee belongs to the GESTURE, so it
 * lives here rather than in the button that starts it.
 */
export function startStreetsArea(): { ok: boolean; message?: string } {
  const map = getMapInstance();
  if (!map) return { ok: false, message: "The map is not ready yet." };

  revealPickLayers();

  const ok = startCircleDraw(map as never, {
    onFinish: (ring) => {
      const plan = planMonitor(
        { ring, cameras: loadedCamerasStore.get(), webcams: loadedWebcamsStore.get() },
        WALL_TILES,
      );
      const res = applyMonitorPlan(plan, ring);
      toast(res.message);
    },
  });
  return ok ? { ok: true } : { ok: false, message: "Could not start drawing." };
}

function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}
```

**Two additions to `lib/console/store.ts`.** `console-ux` has confirmed they do not touch this file.

1. `replace(fn)`, if it does not already exist — alongside `add`/`remove`:

```ts
  /** Swap the whole layout through a pure function. The one door for a change
   *  that rewrites the board wholesale, so every such change emits exactly once. */
  // `replace` ALREADY EXISTS taking a ShellLayout. Do not add a second method —
  // OVERLOAD it, and route BOTH shapes through sanitizeLayout. A bare
  // `state = fn(state)` would be an unvalidated second door into `watch`, skipping
  // the vertex-count and coordinate-range checks Task 2 built for exactly that field.
  replace(arg: ShellLayout | ((l: ShellLayout) => ShellLayout), opts: { archive?: boolean } = {}) {
    const next = typeof arg === "function" ? arg(state) : arg;
    const clean = sanitizeLayout(next);
    if (clean) { state = clean; emit(opts.archive !== false); }
  },
```

2. Export the id minter. `nextId()` is module-private today and is the ONLY thing
   in the app that knows a widget id is `w<base36>` plus a monotonic counter. A
   second minter elsewhere would be a second format:

```ts
/** The app's widget-id minter, exported so a caller that builds a board wholesale
 *  (camslot.apply.ts) mints ids in the same format and from the same counter as
 *  `add()` does, rather than inventing a parallel scheme. */
export function nextWidgetId(): string { return nextId(); }
```

Import it in `camslot.apply.ts` as `import { shellLayoutStore, nextWidgetId } from "@/lib/console/store";`

- [ ] **Step 4: Write the prompt component**

Create `components/console/StreetsPrompt.tsx`:

```tsx
"use client";

import { useSyncExternalStore } from "react";
import { circleDrawStore } from "@/lib/console/widgets/camslot.circle";
import { cancelCircleDraw } from "@/lib/console/widgets/camslot.circle";
import { startStreetsArea } from "@/lib/console/widgets/camslot.apply";

/**
 * What an empty wall says.
 *
 * It is not an empty state in the usual sense — the board is not missing
 * something the user forgot to add. It is the board's first question, and the map
 * behind it is full-bleed precisely so the question has somewhere to be answered.
 */
export function StreetsPrompt() {
  const draw = useSyncExternalStore(circleDrawStore.subscribe, circleDrawStore.get, () => null);
  const drawing = draw !== null;

  return (
    <div className="tn-streets-prompt">
      <p className="tn-streets-prompt-t">Draw a circle round the area you want to monitor</p>
      <p className="tn-streets-prompt-s">
        {drawing
          ? draw?.center
            ? `${draw.radiusKm.toFixed(1)} km — release to set it`
            : "Press on the map and drag out from the centre"
          : "Every camera inside it fills the board."}
      </p>
      {drawing ? (
        <button type="button" className="tn-streets-prompt-b" onClick={() => cancelCircleDraw()}>
          Cancel
        </button>
      ) : (
        <button type="button" className="tn-streets-prompt-b" onClick={() => startStreetsArea()}>
          Draw an area
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Render it over the stage**

The prompt goes in `components/console/ConsoleWorkspace.tsx`, NOT in the wall.
Task 4 gives the map the whole board while the wall is empty, which makes the wall
column 0px wide — a prompt rendered there would be invisible, and WallWorkspace
returns `null` in that state for exactly this reason.

The stage `<section>` already hosts the map's overlays. Add the prompt beside
`PinNavigator`, inside that section, after `{showMapOverlays && <PinNavigator />}`:

```tsx
          {/* The board's first question, over the map that answers it. It lives
              here rather than in WallWorkspace because an empty wall column has
              no width — see dockSize's full-bleed exception. */}
          {wall && showMapOverlays && layout.widgets.length === 0 && <StreetsPrompt />}
```

`wall`, `showMapOverlays` and `layout` are all already in scope in that component.
The `showMapOverlays` gate matters: it is false when a widget is fullscreened onto
the stage or the stage is not a map, and a prompt to draw on a map that is not
there would be a false claim.

- [ ] **Step 6: Append the CSS**

At the very end of `app/globals.css`:

```css
/* ── Streets monitor area ───────────────────────────────────────────────────
   Appended at the end of the file and namespaced .tn-streets-*, by agreement
   with the console-ux workstream, so the two branches cannot collide here. */
.tn-streets-prompt{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;
  display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:18px 22px;text-align:center;max-width:min(90%,420px);
  border-radius:12px;border:1px solid var(--tn-border);
  background:var(--tn-surface);box-shadow:0 6px 20px rgba(0,0,0,.18);
  /* The card sits in the middle of the map, which is where the drag that answers
     it starts. pointer-events:none lets that press fall THROUGH to the map; only
     the button takes the cursor back. */
  pointer-events:none;
}
.tn-streets-prompt-t{
  margin:0;font-size:calc(var(--tnx-fs) + 2px);font-weight:600;color:var(--tn-text);text-wrap:balance;
}
.tn-streets-prompt-s{
  margin:0;font-size:var(--tnx-fs);color:var(--tn-text-muted);font-variant-numeric:tabular-nums;
}
.tn-streets-prompt-b{
  pointer-events:auto;margin-top:6px;font:inherit;font-size:var(--tnx-fs);
  padding:6px 14px;border-radius:8px;border:1px solid var(--tn-border);
  background:var(--tn-surface-2);color:var(--tn-text);cursor:pointer;
}
.tn-streets-prompt-b:hover{border-color:var(--tn-accent);}
.tn-streets-prompt-b:focus-visible{outline:2px solid var(--tn-accent);outline-offset:2px;}
```

**Font sizes are `calc()`d off `--tnx-fs`, never written as px literals.**
`tests/unit/terminal-tokens.test.ts` is a pinned drift guard that BANS px literals in the
console region, and the first draft of this block tripped it. `calc(var(--tnx-fs) + 2px)`
is 15px on the scale's current 13px root and follows `--tnx-fs-lg`'s own idiom.

These are the real token names, read from `app/globals.css`: `--tn-surface`,
`--tn-surface-2`, `--tn-border`, `--tn-text`, `--tn-text-muted`, `--tn-accent`.
All six are re-pointed at the `.tn-terminal` skin's own palette further down that
file, so using the tokens — never the literals — is what makes the card correct on
the console as well as the marketing map.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-apply.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.apply.ts components/console/StreetsPrompt.tsx components/console/ConsoleWorkspace.tsx app/globals.css lib/console/store.ts tests/unit/camslot-apply.test.ts
git commit -m "Ask for an area on an empty Streets board, and build the wall from it"
```

---

### Task 9: Monitored marks on the map

Two strengths: a quiet ring on every assigned camera, a bright mark on the frame each tile is showing now.

**Files:**
- Create: `lib/console/widgets/camslot.watching.ts` (the store plus a pure feature builder)
- Modify: `components/WorldMap.tsx` (one source, one layer, one effect — beside `SELECT_RING_LAYER`, ~line 1290)
- Modify: `lib/console/widgets/camslot.tsx` (report the visible stream)
- Test: `tests/unit/camslot-watching.test.ts`

**Interfaces:**
- Consumes: `StreamRef` and `streamKey` from `camslot.model`.
- Produces:
  - `export const watchingStore` — `{ get(): WatchingState; subscribe(fn): () => void; setTile(id: string, assigned: StreamRef[], onAir: StreamRef | null): void; dropTile(id: string): void }`
  - `export interface WatchingState { assigned: Set<string>; onAir: Set<string> }`
  - `export function watchingFeatures(state: WatchingState, locate: (key: string) => LatLon | null): GeoJSON.Feature[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-watching.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { watchingStore, watchingFeatures } from "@/lib/console/widgets/camslot.watching";

const at = (key: string) => (key === "cam:missing" ? null : { lat: 1, lon: 2 });

describe("watchingStore", () => {
  beforeEach(() => { watchingStore.reset(); });

  it("collects assigned and on-air keys across tiles", () => {
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "a" });
    watchingStore.setTile("t2", [{ k: "cam", id: "c" }], { k: "cam", id: "c" });
    const s = watchingStore.get();
    expect([...s.assigned].sort()).toEqual(["cam:a", "cam:b", "cam:c"]);
    expect([...s.onAir].sort()).toEqual(["cam:a", "cam:c"]);
  });

  it("forgets a tile that is removed", () => {
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }], { k: "cam", id: "a" });
    watchingStore.dropTile("t1");
    expect(watchingStore.get().assigned.size).toBe(0);
  });

  it("notifies subscribers when a tile rotates", () => {
    let hits = 0;
    const off = watchingStore.subscribe(() => { hits++; });
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "a" });
    watchingStore.setTile("t1", [{ k: "cam", id: "a" }, { k: "cam", id: "b" }], { k: "cam", id: "b" });
    off();
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it("returns an IDENTICAL snapshot when nothing changed", () => {
    // useSyncExternalStore loops forever if get() derives a fresh object each call.
    expect(watchingStore.get()).toBe(watchingStore.get());
  });
});

describe("watchingFeatures", () => {
  it("marks an on-air camera as on-air and an assigned one as assigned", () => {
    const state = { assigned: new Set(["cam:a", "cam:b"]), onAir: new Set(["cam:a"]) };
    const f = watchingFeatures(state, at);
    const byKey = Object.fromEntries(f.map((x) => [x.properties!.key, x.properties!.onair]));
    expect(byKey["cam:a"]).toBe(1);
    expect(byKey["cam:b"]).toBe(0);
  });

  it("drops a camera whose position is unknown rather than placing it at 0,0", () => {
    const state = { assigned: new Set(["cam:missing"]), onAir: new Set<string>() };
    expect(watchingFeatures(state, at)).toEqual([]);
  });

  it("never emits an on-air key that is not also assigned", () => {
    const state = { assigned: new Set(["cam:a"]), onAir: new Set(["cam:a", "cam:ghost"]) };
    expect(watchingFeatures(state, at).map((x) => x.properties!.key)).toEqual(["cam:a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-watching.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write the store**

Create `lib/console/widgets/camslot.watching.ts`:

```ts
"use client";

import { streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";
import type { LatLon } from "@/lib/console/widgets/camslot.arm";

// ── What the board is actually watching ──────────────────────────────────────
//
// Two different claims, and the map makes both:
//   ASSIGNED — this camera is in one of the tiles.
//   ON AIR   — this is the frame a tile is showing right now.
//
// A wall of nine tiles rotating through thirty cameras is showing nine of them at
// any instant. Marking all thirty identically would overstate what the operator
// can see; marking only nine would lose the set. So both, at two strengths.
//
// MODULE STATE for the same reason the basket is: WorldMap's interaction wiring
// is a `useCallback(..., [])` invoked once at mount, and StageHost unmounts the
// map entirely when a widget is focused. Component state survives neither.
//
// NOT PERSISTED. This is a description of what is on screen this second, not a
// preference — and anything that reached widget config would light the board's
// "customised" dot on a board nobody edited.

export interface WatchingState {
  assigned: Set<string>;
  onAir: Set<string>;
}

const tiles = new Map<string, { assigned: string[]; onAir: string | null }>();
const listeners = new Set<() => void>();

// The snapshot is CACHED and only rebuilt when a tile actually changes.
// `useSyncExternalStore` compares snapshots by identity and re-renders forever if
// `get()` derives a fresh object on every call — the classic trap in this repo.
let snapshot: WatchingState = { assigned: new Set(), onAir: new Set() };

function rebuild() {
  const assigned = new Set<string>();
  const onAir = new Set<string>();
  for (const t of tiles.values()) {
    for (const k of t.assigned) assigned.add(k);
    if (t.onAir) onAir.add(t.onAir);
  }
  snapshot = { assigned, onAir };
  for (const fn of listeners) fn();
}

export const watchingStore = {
  get(): WatchingState { return snapshot; },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  /** A tile reports what it holds and what it is showing. Called on mount and on
   *  every rotation. */
  setTile(id: string, assigned: readonly StreamRef[], onAir: StreamRef | null) {
    tiles.set(id, {
      assigned: assigned.map(streamKey),
      onAir: onAir ? streamKey(onAir) : null,
    });
    rebuild();
  },

  dropTile(id: string) {
    if (tiles.delete(id)) rebuild();
  },

  /** Tests only. */
  reset() { tiles.clear(); rebuild(); },
};

/**
 * The marks, as GeoJSON. Pure — the position lookup is injected, so this is
 * testable in node and does not import a store into a hot loop.
 *
 * ONE LAYER, DATA-DRIVEN off the `onair` property rather than two layers. The
 * rotation then repaints with a single `setData` instead of adding and removing
 * layers on a timer, which MapLibre does not enjoy and which would fight the
 * basemap style reload.
 */
export function watchingFeatures(
  state: WatchingState,
  locate: (key: string) => LatLon | null,
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const key of state.assigned) {
    const at = locate(key);
    // A camera we cannot place is DROPPED, never coerced to 0,0 — that would put
    // it in the Gulf of Guinea and claim we are watching it.
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [at.lon, at.lat] },
      properties: { key, onair: state.onAir.has(key) ? 1 : 0 },
    });
  }
  return out;
}
```

- [ ] **Step 4: Report from the tile**

In `lib/console/widgets/camslot.tsx`, inside the component, report to the store whenever the visible stream changes and clean up on unmount. `streams` is the already-computed visible playlist and `index` the rotation position:

```tsx
  useEffect(() => {
    watchingStore.setTile(id, streams, streams[index] ?? null);
    return () => watchingStore.dropTile(id);
  }, [id, streams, index]);
```

Import `watchingStore` from `@/lib/console/widgets/camslot.watching`. Use whatever the component already calls its widget id, playlist and index.

- [ ] **Step 5: Add the map layer**

In `components/WorldMap.tsx`, beside `SELECT_RING_LAYER` (~line 1290), add the source and layer. Constants go with the other layer-id constants at the top of the file:

```ts
const WATCH_SRC = "tn-watching-src";
const WATCH_LAYER = "tn-watching";
```

```ts
      // WHAT THE BOARD IS WATCHING. A sibling of SELECT_RING_LAYER and drawn just
      // above it: a pick is a selection in progress, this is a commitment already
      // made, so it must not be hidden underneath one.
      //
      // ONE layer, data-driven off `onair`, so a rotation is a setData rather than
      // a layer swap. Paint values are hard-coded like every other paint value in
      // this file — MapLibre cannot read a CSS custom property, and a
      // getComputedStyle read here would tie the map to whether the terminal shell
      // happened to mount first.
      if (!map.getSource(WATCH_SRC)) {
        map.addSource(WATCH_SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getLayer(WATCH_LAYER)) {
        map.addLayer({
          id: WATCH_LAYER,
          type: "circle",
          source: WATCH_SRC,
          paint: {
            "circle-radius": ["case", ["==", ["get", "onair"], 1], 7, 5],
            "circle-color": ["case", ["==", ["get", "onair"], 1], "#ffb020", "rgba(0,0,0,0)"],
            "circle-opacity": ["case", ["==", ["get", "onair"], 1], 0.95, 1],
            "circle-stroke-color": "#ffb020",
            "circle-stroke-width": ["case", ["==", ["get", "onair"], 1], 2.5, 2],
            "circle-stroke-opacity": ["case", ["==", ["get", "onair"], 1], 1, 0.55],
          },
        });
      }
```

Then an effect that pushes features whenever the store changes. Position lookup reads `loadedCamerasStore` and `loadedWebcamsStore`, both of which the file already imports:

```ts
  useEffect(() => {
    const paint = () => {
      const map = mapRef.current;
      const src = map?.getSource(WATCH_SRC) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const cams = loadedCamerasStore.get();
      const webs = loadedWebcamsStore.get();
      const locate = (key: string) => {
        const [kind, ...rest] = key.split(":");
        const id = rest.join(":");
        if (kind === "cam") {
          const c = cams.find((x) => x.id === id);
          return c ? { lat: c.lat, lon: c.lon } : null;
        }
        const w = webs.find((x) => x.id === id);
        return w ? { lat: w.lat, lon: w.lon } : null;
      };
      src.setData({ type: "FeatureCollection", features: watchingFeatures(watchingStore.get(), locate) });
    };
    paint();
    return watchingStore.subscribe(paint);
  }, []);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-watching.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.watching.ts components/WorldMap.tsx lib/console/widgets/camslot.tsx tests/unit/camslot-watching.test.ts
git commit -m "Mark on the map which cameras the board is watching, and which are on screen"
```

---

### Task 10: Video in a camera tile

`camslot` renders `CameraImage`, so a live camera in a tile is a refreshing JPEG. Wire `CameraVideo` in for streams that can actually play.

**Files:**
- Create: `lib/console/widgets/camslot.video.ts` (the pure decision)
- Modify: `lib/console/widgets/camslot.tsx` (render `CameraVideo` when the decision says so)
- Test: `tests/unit/camslot-video.test.ts`

**Interfaces:**
- Consumes: `StreamRef` from `camslot.model`.
- Produces: `export function playsVideo(ref: StreamRef, live: (id: string) => boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/camslot-video.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { playsVideo } from "@/lib/console/widgets/camslot.video";

const live = (id: string) => id === "caltrans:d11-C052";

describe("playsVideo", () => {
  it("plays a road camera whose stream our proxy can serve", () => {
    expect(playsVideo({ k: "cam", id: "caltrans:d11-C052" }, live)).toBe(true);
  });

  it("does NOT play a road camera with no playable stream", () => {
    expect(playsVideo({ k: "cam", id: "tfl:JamCams_00001" }, live)).toBe(false);
  });

  it("never plays a Windy webcam — there is no stream behind one", () => {
    expect(playsVideo({ k: "webcam", id: "windy:1420893641" }, live)).toBe(false);
  });

  it("never plays a YouTube ref — that is an iframe, not our player", () => {
    expect(playsVideo({ k: "yt", videoId: "aaaaaaaaaaa" }, live)).toBe(false);
  });

  it("says no for a camera we have not loaded yet, rather than guessing", () => {
    expect(playsVideo({ k: "cam", id: "unknown" }, () => false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/camslot-video.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write the decision**

Create `lib/console/widgets/camslot.video.ts`:

```ts
import type { StreamRef } from "@/lib/console/widgets/camslot.model";

/**
 * Whether a tile should mount the HLS player rather than a refreshing image.
 *
 * Pure and injectable, so the rule is testable in node and the component does not
 * grow a second copy of it.
 *
 * ONLY road cameras qualify. A Windy webcam has no stream behind it at all — the
 * catalogue serves still images — and a YouTube ref is an iframe the widget
 * already renders its own way. `live` is the caller's lookup into
 * `loadedCamerasStore`, whose `live` flag `lib/cameras/body.ts` sets from
 * `isLiveStreamUrl`: true means /api/hls can actually serve it, not merely that
 * the upstream advertised a video mediaType. TfL JamCams advertise MP4 clips and
 * are correctly false here.
 *
 * FALSE IS THE SAFE ANSWER and is what an unknown id gets. A wrong false shows a
 * still where video was possible; a wrong true mounts a player against a URL that
 * cannot serve it and shows a broken tile.
 */
export function playsVideo(ref: StreamRef, live: (id: string) => boolean): boolean {
  return ref.k === "cam" && live(ref.id);
}
```

- [ ] **Step 4: Render it**

In `lib/console/widgets/camslot.tsx`, where the visible stream is rendered through `CameraImage`, branch on the decision. Keep `CameraImage` as the else-branch — `CameraVideo` already falls back to it internally on a fatal hls.js error, so a dead stream degrades to a still rather than to a blank tile:

```tsx
  const isLive = playsVideo(stream, (id) => loadedCamerasStore.get().find((c) => c.id === id)?.live === true);

  return isLive ? (
    <CameraVideo
      id={stream.id}
      alt={label}
      attribution={attribution}
      license={license}
      refreshSeconds={refreshSeconds}
    />
  ) : (
    <CameraImage /* ...existing props unchanged... */ />
  );
```

Import `CameraVideo` from `@/components/CameraVideo`, `playsVideo` from `@/lib/console/widgets/camslot.video`, and `loadedCamerasStore` from `@/lib/cameras/loaded`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/camslot-video.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the gate and commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.video.ts lib/console/widgets/camslot.tsx tests/unit/camslot-video.test.ts
git commit -m "Play live video in a camera tile instead of a refreshing still"
```

---

### Task 11: Measure it in a browser

The unit suite cannot see a WebGL remount, a tile narrower than its own overlay, a mark that does not follow a rotation, or nine video decodes. This task is a gate, not a note.

**Files:**
- Create: `scripts/verify-streets-area.mjs`
- Create: `persona-shots/streets-area/` (output)

**Interfaces:**
- Consumes: everything above, running in a dev server.
- Produces: a script that exits non-zero on any failed check.

- [ ] **Step 1: Write the script**

Create `scripts/verify-streets-area.mjs`, modelled on the existing `scripts/verify-wall.mjs`. Every check is a measured PASS/FAIL against a live dev server, and the script exits non-zero if any fails.

Checks, each of which must print its measured value, not just a verdict:

1. **The map does not remount.** Instrument one `StageHost` mount counter on `window`; walk prompt → draw → monitor → reload and assert the count is 1 for the session.
2. **Full-bleed prompt.** On a fresh Streets board with no tiles, the stage element's measured width equals the shell width (within 1px), and the prompt text is visible.
3. **The gesture draws.** Synthesise pointerdown → 6 pointermoves → pointerup on the canvas; assert `circleDrawStore` reported a rising `radiusKm` on the way and that tiles appear afterwards.
4. **Nine tiles, three across.** Count tiles, assert 9, assert three distinct `x` values and three distinct `y` values.
5. **Every tile clears 300px.** Measure each tile's rendered width; assert `>= 300`, which is the camslot overlay's full-readout threshold. Print the narrowest.
6. **The marks track the rotation.** Read the `tn-watching` source's features; assert the count of `onair === 1` equals the visible tile count, wait one dwell, assert the on-air key set has changed.
7. **A reload restores it.** Reload; assert the ring, the nine tiles and the marks all come back — this is the `watch` sanitize path caught in the act.
8. **Video actually plays.** Assert at least one `<video>` element has `readyState >= 2` and a non-zero `currentTime` after 10s. A tile showing a poster forever is the failure this catches.
9. **The nine-decode cost.** Measure CPU at rest over 30s with video on and with video off on the same board and window; measure dropped frames while panning the map; measure heap after 5 minutes. Print all three.

   **This check runs in two passes — measure, then assert.** It is deliberately NOT a
   check that can never fail; a check that cannot fail is not a check.

   *Pass one (this step):* run it with `--calibrate`. It prints the three numbers and
   writes them to `scripts/streets-area-baseline.json`. It asserts nothing and exits 0.

   *Pass two (step 3a below):* once the numbers exist, the thresholds are written from
   them plus a stated margin, committed into that file, and the check asserts against
   them from then on. The margin is 25% on CPU and heap and 2x on dropped frames —
   wide enough that ordinary run-to-run variance does not produce a red suite, tight
   enough that a real regression trips it.

   **The threshold encodes one run, and that is a known weakness.** Calibrate over three
   runs and take the WORST of the three, so a single unlucky run cannot set a threshold
   the next run fails, and a single lucky run cannot set one nothing ever trips.
10. **Rotation churn.** Time from a tile switching to its first painted frame, over 20 switches; assert heap does not grow monotonically across them, which is the un-destroyed hls.js instance leak.

- [ ] **Step 2: Run it**

```bash
npm run dev &
node scripts/verify-streets-area.mjs
```
Expected: all checks PASS except #9, which prints numbers. Screenshots land in `persona-shots/streets-area/`.

- [ ] **Step 3a: Calibrate, then assert**

Run the perf pass three times and take the worst of the three:

```bash
for i in 1 2 3; do node scripts/verify-streets-area.mjs --calibrate; done
```

Write the worst figures plus the stated margins into `scripts/streets-area-baseline.json`,
then re-run WITHOUT `--calibrate` and confirm check 9 now passes as an assertion rather
than printing. Commit the baseline file with the numbers in the commit message, so the
threshold's provenance is in the history rather than in someone's memory.

**Report the raw calibration figures to Sam before writing the thresholds.** If nine
decodes cost materially more than the 9.0% CPU at rest that #158 achieved, the right
answer may be the cap (play the 3-4 tiles nearest the centre, stills elsewhere) rather
than a threshold that enshrines a regression. That is Sam's call, not the script's.

- [ ] **Step 3: Act on what it finds**

If check 5 fails, the dock's post-draw default is too wide — reduce `WALL_DOCK_PX` for this board and re-run.
If check 8 fails, `playsVideo` is returning true for a stream `/api/hls` cannot serve — check the allowlist rather than loosening the predicate.
If check 9's calibration shows CPU at rest materially above the 9.0% #158 measured, **report the number to Sam before writing any threshold** and offer the cap (play the 3-4 tiles nearest the centre, stills elsewhere), which was the recommended option. Do not calibrate a threshold around a regression and call it a baseline.
If check 10 shows growing heap, the hls.js instance is not being destroyed on switch — that is a real leak on a board built to run all day.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm test
git add scripts/verify-streets-area.mjs scripts/streets-area-baseline.json persona-shots/streets-area
git commit -m "Measure the Streets area board in a browser, nine decodes included"
```

---

### Task 12: Rebase onto the draw-state writer

Once **PR #187** merges, adopt the shared draw-state truth so one banner narrates both gestures.

**Files:**
- Modify: `lib/console/widgets/camslot.circle.ts`

**The gate is the GREP, never the PR number.** #186 merged on 2026-09-07 (`b666922`) and
`setExternalDraw` **was not in it** — it was still uncommitted when the PR was merged, and it now
sits in **#187** (`feat/console-areas-visible`). A gate that trusted "#186 merged" would have
wired this branch to an export that does not exist. Trust the symbol, not the announcement.

- [ ] **Step 1: Confirm the export exists**

```bash
git fetch origin && git rebase origin/main
grep -n "setExternalDraw" lib/map/aoi.ts
```
Expected: `export function setExternalDraw(next: DrawState | null): void`. If absent, **stop** — the
export has not landed yet and this task waits. Do not implement a local stand-in.

- [ ] **Step 2: Call it from the gesture**

In `camslot.circle.ts`, import `setExternalDraw` and call it alongside the local store — on start, on each move, and on teardown:

```ts
  // ONE draw-state truth. `DrawBanner` narrates "circle" from `center` and
  // `radiusKm`, so both are published from the FIRST move rather than on release —
  // withholding the centre leaves the banner stuck on the press prompt for the
  // whole drag. This publishes STATE only: the draft layers belong to aoi.ts's own
  // gestures and this module owns its geometry on the map.
  setExternalDraw(state ? { tool: "circle", center: state.center, radiusKm: state.radiusKm } : null);
```

In `stop()`, run the local teardown **first**, then `setExternalDraw(null)` — it does not touch `cancelActive`, so the cancel path must clean itself up before clearing the shared state.

- [ ] **Step 3: Verify the banner**

Re-run `node scripts/verify-streets-area.mjs` and add a check: during a drag, the draw banner is present and its text contains a rising km figure.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm test
git add lib/console/widgets/camslot.circle.ts scripts/verify-streets-area.mjs
git commit -m "Publish the circle gesture through the shared draw state"
```

---

## Self-Review

**Spec coverage.** §2.1 Prompt → Tasks 4, 7, 8. §2.2 Draw → Tasks 1, 6, 12. §2.3 Monitor → Tasks 7, 8. §3 Distribution → Task 3. §3.1 Rotation dwell → Task 8 (`VIDEO_DWELL_MS`), measured in Task 11. §4 Marks → Task 9. §5 Live video and the default area → Tasks 7, 10. §6 State → Task 2. §7 Verification → every task's unit steps, plus Task 11. §8 Not-in-scope → nothing here touches rails mode, the Inspector, or mobile.

**Type consistency.** `PickedCamera.live?: boolean` is added in Task 3 and populated in Task 5. `FanOutTile` is produced in Task 3 and consumed in Tasks 5 and 8. `MonitorPlan` is produced in Task 5 and consumed in Task 8. `WatchingState` is produced and consumed within Task 9. `CircleSpec` is produced in Task 1 and consumed in Tasks 6 and 7. `ringFromCircle` keeps one name throughout.

**Two known unknowns, deliberately left as such rather than papered over:**
- `WallWorkspace.tsx`'s internal variable names (Task 8, step 5) and `camslot.tsx`'s playlist/index names (Tasks 9 and 10) are described by role, because they were not read line-by-line while planning. The implementer reads the file and substitutes.
- The `.tn-*` CSS token names in Task 8 step 6 are placeholders, flagged in the step itself.
