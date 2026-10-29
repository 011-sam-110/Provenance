import { describe, expect, it } from "vitest";
import { dropIndex, movePin, type PinRect } from "@/lib/eye/pins";

/** Three pins of 100 px side by side with 8 px between: midpoints at 50, 158 and 266. */
const RECTS: PinRect[] = [
  { left: 0, right: 100 },
  { left: 108, right: 208 },
  { left: 216, right: 316 },
];

describe("dropIndex", () => {
  it("is 0 on an empty bar", () => {
    expect(dropIndex(40, [])).toBe(0);
    expect(dropIndex(-500, [])).toBe(0);
  });

  it("goes before a pin whose middle the pointer has not passed", () => {
    expect(dropIndex(-20, RECTS)).toBe(0);
    expect(dropIndex(49, RECTS)).toBe(0);
  });

  it("goes between two pins once the first one's middle is passed", () => {
    expect(dropIndex(51, RECTS)).toBe(1);
    expect(dropIndex(157, RECTS)).toBe(1);
    expect(dropIndex(159, RECTS)).toBe(2);
  });

  it("goes after the last pin past its middle", () => {
    expect(dropIndex(267, RECTS)).toBe(3);
    expect(dropIndex(900, RECTS)).toBe(3);
  });

  it("a pointer exactly on a middle goes before that pin", () => {
    expect(dropIndex(50, RECTS)).toBe(0);
  });

  it("ignores the pin being dragged, so the answer is a place in the list without it", () => {
    // Carrying the middle pin: the other two are at 50 and 266.
    expect(dropIndex(100, RECTS, 1)).toBe(1);
    expect(dropIndex(158, RECTS, 1)).toBe(1);
    expect(dropIndex(0, RECTS, 1)).toBe(0);
    expect(dropIndex(400, RECTS, 1)).toBe(2);
    // Over its own place it stays where it is.
    expect(dropIndex(158, RECTS, 1)).toBe(1);
  });
});

describe("movePin", () => {
  const pins = ["a", "b", "c", "d"];

  it("moves a pin to the right, to a place in the list without it", () => {
    expect(movePin(pins, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(movePin(pins, "a", 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("moves a pin to the left", () => {
    expect(movePin(pins, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(movePin(pins, "c", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("clamps a place out of range to the ends", () => {
    expect(movePin(pins, "b", -5)).toEqual(["b", "a", "c", "d"]);
    expect(movePin(pins, "b", 99)).toEqual(["a", "c", "d", "b"]);
  });

  it("gives the same array back when nothing moves, or the pin is not on the bar", () => {
    expect(movePin(pins, "b", 1)).toBe(pins);
    expect(movePin(pins, "zzz", 0)).toBe(pins);
    expect(movePin([], "a", 0)).toEqual([]);
  });

  it("never changes the array it is given", () => {
    const before = [...pins];
    movePin(pins, "a", 3);
    expect(pins).toEqual(before);
  });
});
