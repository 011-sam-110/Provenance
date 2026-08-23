import { describe, expect, it } from "vitest";
import {
  MAX_PICKS, camerasInRing, mergePicks, nameForPicks, pickKey,
  type PickedCamera,
} from "@/lib/console/widgets/camslot.pick";

const pick = (id: string, label = id, lat = 51.5, lon = -0.12): PickedCamera => ({
  ref: { k: "cam", id },
  key: pickKey({ k: "cam", id }),
  label, lat, lon,
});

describe("mergePicks", () => {
  it("appends new picks in the order they were chosen", () => {
    const r = mergePicks([pick("a")], [pick("b"), pick("c")]);
    expect(r.next.map((p) => p.key)).toEqual(["cam:a", "cam:b", "cam:c"]);
    expect(r.added).toBe(2);
  });

  it("counts a camera already in the basket as a duplicate and does not re-add it", () => {
    const r = mergePicks([pick("a")], [pick("a"), pick("b")]);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.next.map((p) => p.key)).toEqual(["cam:a", "cam:b"]);
  });

  it("dedups within a single incoming batch, not only against the basket", () => {
    // A box drag can hand the same camera twice when it appears in two layers.
    const r = mergePicks([], [pick("a"), pick("a")]);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
  });

  it("refuses past the cap rather than evicting what the user already chose", () => {
    const full = Array.from({ length: 3 }, (_, i) => pick(`f${i}`));
    const r = mergePicks(full, [pick("new1"), pick("new2")], 3);
    expect(r.added).toBe(0);
    expect(r.refused).toBe(2);
    // The originals survive untouched — nothing was pushed out to make room.
    expect(r.next.map((p) => p.key)).toEqual(["cam:f0", "cam:f1", "cam:f2"]);
  });

  it("partially fills when the batch straddles the cap, and reports both halves", () => {
    const r = mergePicks([pick("a")], [pick("b"), pick("c"), pick("d")], 3);
    expect(r.added).toBe(2);
    expect(r.refused).toBe(1);
    expect(r.next).toHaveLength(3);
  });

  it("returns the existing array unchanged when nothing was added", () => {
    const existing = [pick("a")];
    const r = mergePicks(existing, [pick("a")]);
    expect(r.next).toEqual(existing);
  });

  it("defaults its cap to one wall's worth", () => {
    const many = Array.from({ length: MAX_PICKS + 5 }, (_, i) => pick(`m${i}`));
    const r = mergePicks([], many);
    expect(r.next).toHaveLength(MAX_PICKS);
    expect(r.refused).toBe(5);
  });
});

describe("camerasInRing", () => {
  // A unit square around the origin, stored open (no repeated closing vertex).
  const square: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];

  it("keeps points inside and drops points outside", () => {
    const rows = [
      { id: "in", lat: 0.5, lon: 0.5 },
      { id: "out-east", lat: 0.5, lon: 2 },
      { id: "out-north", lat: 3, lon: 0.5 },
    ];
    expect(camerasInRing(rows, square).map((r) => r.id)).toEqual(["in"]);
  });

  it("drops non-finite coordinates rather than coercing them to zero", () => {
    // `lat ?? 0` would put this row at 0,0 — inside a ring nobody drew it into.
    const rows = [{ id: "broken", lat: Number.NaN, lon: 0.5 }];
    expect(camerasInRing(rows, square)).toEqual([]);
  });

  it("returns nothing for a ring that is not an area", () => {
    const rows = [{ id: "in", lat: 0.5, lon: 0.5 }];
    expect(camerasInRing(rows, [[0, 0], [1, 1]])).toEqual([]);
  });

  it("respects concavity — a bbox test alone would admit the notch", () => {
    // An L: the top-right quadrant is cut out of the unit square.
    const ell: [number, number][] = [[0, 0], [0, 1], [0.5, 1], [0.5, 0.5], [1, 0.5], [1, 0]];
    const inNotch = { id: "notch", lat: 0.75, lon: 0.75 };
    const inArm = { id: "arm", lat: 0.25, lon: 0.25 };
    const kept = camerasInRing([inNotch, inArm], ell).map((r) => r.id);
    expect(kept).toEqual(["arm"]);
  });
});

describe("nameForPicks", () => {
  it("prefers an explicit area label over anything derived", () => {
    expect(nameForPicks([pick("a", "London: Trafalgar Square")], "Soho")).toBe("Soho");
  });

  it("uses the single camera's own name when there is only one", () => {
    expect(nameForPicks([pick("a", "London: Trafalgar Square")])).toBe("London: Trafalgar Square");
  });

  it("lifts the place the labels agree on", () => {
    const picks = [
      pick("a", "London: Trafalgar Square"),
      pick("b", "London: Oxford Circus"),
    ];
    expect(nameForPicks(picks)).toBe("London");
  });

  it("counts rather than guessing when the labels do not agree", () => {
    const picks = [pick("a", "London: Trafalgar Square"), pick("b", "Madrid: Cortes")];
    expect(nameForPicks(picks)).toBe("2 cameras");
  });

  it("is empty for an empty basket", () => {
    expect(nameForPicks([])).toBe("");
  });
});
