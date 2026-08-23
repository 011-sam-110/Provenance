import { describe, it, expect } from "vitest";
import {
  normalizeBounds,
  camerasInBounds,
  orderByDistanceFrom,
  cadenceCap,
  planAppend,
  describeAppend,
  webcamRef,
  FALLBACK_REFRESH_SECONDS,
} from "@/lib/console/widgets/camslot.arm";
import { MAX_STREAMS, streamKey, type StreamRef } from "@/lib/console/widgets/camslot.model";

// A tiny fixture standing in for loadedCamerasStore rows. The real rows carry
// twelve fields (measured off /api/cameras 2026-08-15); these are the ones any
// rule here is allowed to depend on.
const cam = (id: string, lat: number, lon: number, refreshSeconds?: number) => ({
  id,
  name: id,
  lat,
  lon,
  available: true,
  live: false,
  refreshSeconds,
});

describe("webcamRef", () => {
  it("keeps the title it was given, so a vanished directory entry still has a name", () => {
    expect(webcamRef("windy:1606332744", "Trafalgar Square")).toEqual({
      k: "webcam",
      id: "windy:1606332744",
      t: "Trafalgar Square",
    });
  });

  it("drops a blank or whitespace title rather than storing an empty one", () => {
    // An empty `t` would shadow the directory lookup with nothing, which renders
    // worse than having no title at all.
    expect(webcamRef("windy:1", "")).toEqual({ k: "webcam", id: "windy:1" });
    expect(webcamRef("windy:1", "   ")).toEqual({ k: "webcam", id: "windy:1" });
    expect(webcamRef("windy:1")).toEqual({ k: "webcam", id: "windy:1" });
  });

  it("does not let the title affect identity — the same webcam de-dupes either way", () => {
    expect(streamKey(webcamRef("windy:1", "A name"))).toBe(streamKey(webcamRef("windy:1")));
    const plan = planAppend([webcamRef("windy:1")], [webcamRef("windy:1", "A name")], 10);
    expect(plan).toMatchObject({ added: 0, duplicates: 1 });
  });
});

describe("normalizeBounds", () => {
  it("accepts a box dragged in any direction", () => {
    const downRight = normalizeBounds({ lat: 51.54, lon: -0.2 }, { lat: 51.47, lon: -0.02 });
    const upLeft = normalizeBounds({ lat: 51.47, lon: -0.02 }, { lat: 51.54, lon: -0.2 });
    expect(downRight).toEqual({ north: 51.54, east: -0.02, south: 51.47, west: -0.2 });
    expect(upLeft).toEqual(downRight);
  });
});

describe("camerasInBounds", () => {
  const box = { north: 51.54, east: -0.02, south: 51.47, west: -0.2 };

  it("includes the edges and excludes the outside", () => {
    const rows = [
      cam("inside", 51.5, -0.1),
      cam("on-north-edge", 51.54, -0.1),
      cam("on-west-edge", 51.5, -0.2),
      cam("north-of", 51.6, -0.1),
      cam("east-of", 51.5, 0.4),
    ];
    expect(camerasInBounds(rows, box).map((c) => c.id)).toEqual([
      "inside",
      "on-north-edge",
      "on-west-edge",
    ]);
  });

  it("drops rows with a non-finite coordinate rather than plotting them at 0,0", () => {
    const rows = [
      cam("good", 51.5, -0.1),
      { ...cam("nan-lat", 0, -0.1), lat: Number.NaN },
      { ...cam("undef-lon", 51.5, 0), lon: undefined as unknown as number },
    ];
    expect(camerasInBounds(rows, box).map((c) => c.id)).toEqual(["good"]);
  });

  it("returns a new array and never mutates the input", () => {
    const rows = [cam("a", 51.5, -0.1)];
    const out = camerasInBounds(rows, box);
    expect(out).not.toBe(rows);
    expect(rows).toHaveLength(1);
  });
});

describe("orderByDistanceFrom", () => {
  // This is what stops a cap being an arbitrary sample. "The 12 nearest the centre
  // of the box you dragged" is a selection a user can reason about; "the first 12
  // in whatever order the API happened to return" is the coverage lie.
  it("orders centre-out", () => {
    const centre = { lat: 51.5, lon: -0.1 };
    const rows = [cam("far", 51.9, -0.1), cam("near", 51.51, -0.1), cam("mid", 51.6, -0.1)];
    expect(orderByDistanceFrom(rows, centre).map((c) => c.id)).toEqual(["near", "mid", "far"]);
  });

  it("corrects for longitude convergence, so a degree of lon near the pole counts for less", () => {
    // At lat 60, one degree of longitude is half a degree of latitude on the ground.
    // Without the cos(lat) term these two would tie and the order would be arbitrary.
    const centre = { lat: 60, lon: 0 };
    const rows = [cam("one-deg-lon", 60, 1), cam("one-deg-lat", 61, 0)];
    expect(orderByDistanceFrom(rows, centre)[0].id).toBe("one-deg-lon");
  });

  it("is stable for equidistant rows", () => {
    const centre = { lat: 0, lon: 0 };
    const rows = [cam("a", 0, 1), cam("b", 0, -1), cam("c", 1, 0)];
    expect(orderByDistanceFrom(rows, centre).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("cadenceCap", () => {
  // cap = floor(slowest-safe cycle / dwell) = floor(minRefreshSeconds / (intervalMs/1000)).
  // A slot whose whole cycle takes longer than its FASTEST-refreshing member's
  // cadence refetches every member on every pass, so the fastest member sets the cap.
  it("derives the cap from the fastest-refreshing member and the dwell", () => {
    expect(cadenceCap([60], 5000)).toBe(12);
    expect(cadenceCap([300], 5000)).toBe(60);
    expect(cadenceCap([300, 60, 120], 5000)).toBe(12); // the 60s camera sets it
  });

  it("falls back to the slowest real cadence when a row does not say", () => {
    // Never assume fast: guessing 60s for an unknown row would cap the slot at 12
    // for no measured reason.
    expect(cadenceCap([undefined], 5000)).toBe(FALLBACK_REFRESH_SECONDS / 5);
    expect(FALLBACK_REFRESH_SECONDS).toBe(300);
  });

  it("never returns less than 1", () => {
    expect(cadenceCap([60], 300_000)).toBe(1);
  });

  it("never exceeds MAX_STREAMS, whatever the arithmetic says", () => {
    expect(cadenceCap([600], 3000)).toBe(MAX_STREAMS);
  });

  it("survives an empty playlist and a nonsense dwell", () => {
    expect(cadenceCap([], 5000)).toBe(MAX_STREAMS);
    expect(cadenceCap([60], 0)).toBeGreaterThanOrEqual(1);
    expect(cadenceCap([60], Number.NaN)).toBeGreaterThanOrEqual(1);
  });
});

describe("planAppend", () => {
  const ref = (id: string): StreamRef => ({ k: "cam", id });

  it("appends in order and reports what it did", () => {
    const plan = planAppend([ref("a")], [ref("b"), ref("c")], 10);
    expect(plan.next).toEqual([ref("a"), ref("b"), ref("c")]);
    expect(plan).toMatchObject({ added: 2, duplicates: 0, refused: 0, considered: 2 });
  });

  it("skips refs already in the slot, and counts them as duplicates not additions", () => {
    const plan = planAppend([ref("a")], [ref("a"), ref("b")], 10);
    expect(plan.next).toEqual([ref("a"), ref("b")]);
    expect(plan).toMatchObject({ added: 1, duplicates: 1 });
  });

  it("de-dupes WITHIN the incoming batch too", () => {
    const plan = planAppend([], [ref("a"), ref("a")], 10);
    expect(plan.next).toEqual([ref("a")]);
    expect(plan).toMatchObject({ added: 1, duplicates: 1 });
  });

  it("refuses the overflow instead of silently truncating, and reports how many", () => {
    const incoming = ["b", "c", "d", "e"].map(ref);
    const plan = planAppend([ref("a")], incoming, 3);
    expect(plan.next).toEqual([ref("a"), ref("b"), ref("c")]);
    expect(plan).toMatchObject({ added: 2, refused: 2, considered: 4 });
  });

  it("is a no-op when the slot is already at the cap, and says so rather than throwing", () => {
    const plan = planAppend([ref("a"), ref("b")], [ref("c")], 2);
    expect(plan.next).toBeNull();
    expect(plan).toMatchObject({ added: 0, refused: 1 });
  });

  it("returns next:null when everything incoming was a duplicate — nothing to write", () => {
    const plan = planAppend([ref("a")], [ref("a")], 10);
    expect(plan.next).toBeNull();
    expect(plan).toMatchObject({ added: 0, duplicates: 1, refused: 0 });
  });

  it("never exceeds MAX_STREAMS even if handed a larger cap", () => {
    const incoming = Array.from({ length: MAX_STREAMS + 20 }, (_, i) => ref(`c${i}`));
    const plan = planAppend([], incoming, MAX_STREAMS + 20);
    expect(plan.next).toHaveLength(MAX_STREAMS);
    expect(plan.refused).toBe(20);
  });

  it("never mutates the existing playlist", () => {
    const existing = [ref("a")];
    planAppend(existing, [ref("b")], 10);
    expect(existing).toEqual([ref("a")]);
  });
});

describe("describeAppend", () => {
  const ref = (id: string): StreamRef => ({ k: "cam", id });

  it("states the real denominator for THIS gesture, and what it added", () => {
    const plan = planAppend([], Array.from({ length: 306 }, (_, i) => ref(`c${i}`)), 12);
    const note = describeAppend(plan, { available: 279, cap: 12, capSetBySeconds: 60 });
    expect(note).toContain("306");
    expect(note).toContain("279");
    expect(note).toContain("12");
  });

  it("says the selection is the nearest ones, not an unexplained slice", () => {
    const plan = planAppend([], Array.from({ length: 50 }, (_, i) => ref(`c${i}`)), 5);
    const note = describeAppend(plan, { available: 50, cap: 5, capSetBySeconds: 60 });
    expect(note.toLowerCase()).toContain("nearest");
  });

  it("names the reason the cap is what it is, so the user can change it", () => {
    // The fastest-refreshing camera in the mix sets the cap. Saying "12 max" is
    // useless; saying "a 60s camera set this cap" is something a user can act on.
    const plan = planAppend([], Array.from({ length: 50 }, (_, i) => ref(`c${i}`)), 12);
    const note = describeAppend(plan, { available: 50, cap: 12, capSetBySeconds: 60, capMixed: true });
    expect(note).toContain("60s");
    expect(note).toContain("fastest-refreshing");
  });

  it("does NOT suggest dropping the fastest camera when every cadence is identical", () => {
    // Measured case: a box over the Forth crossing is 29 Traffic Scotland cameras,
    // all 120s. "Drop the fastest-refreshing camera" is confident and useless there
    // — removing any one of them leaves the cap exactly where it was.
    const plan = planAppend([], Array.from({ length: 29 }, (_, i) => ref(`c${i}`)), 24);
    const note = describeAppend(plan, { available: 29, cap: 24, capSetBySeconds: 120, capMixed: false });
    expect(note).toContain("120s");
    expect(note).not.toContain("fastest-refreshing");
    expect(note).toContain("second wall");
  });

  it("does not claim a selection it did not make", () => {
    const plan = planAppend([ref("a")], [ref("a")], 10);
    const note = describeAppend(plan, { available: 1, cap: 10, capSetBySeconds: 300 });
    expect(note.toLowerCase()).toContain("already");
    expect(note).not.toMatch(/added \d/i);
  });

  it("is honest when the slot is full — no added count, and a way out", () => {
    const plan = planAppend([ref("a"), ref("b")], [ref("c")], 2);
    const note = describeAppend(plan, { available: 1, cap: 2, capSetBySeconds: 60 });
    expect(note.toLowerCase()).toContain("full");
    expect(note).not.toMatch(/^added/i);
  });

  it("never renders an empty or whitespace-only note", () => {
    for (const plan of [
      planAppend([], [ref("a")], 10),
      planAppend([ref("a")], [ref("a")], 10),
      planAppend([ref("a")], [ref("b")], 1),
    ]) {
      expect(describeAppend(plan, { available: 1, cap: 1, capSetBySeconds: 300 }).trim()).not.toBe("");
    }
  });
});
