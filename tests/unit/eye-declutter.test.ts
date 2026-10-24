import { describe, expect, it } from "vitest";
import {
  LEADER,
  cardBox,
  estimateTextWidth,
  insideFrame,
  overlaps,
  placeCards,
  placeTags,
  placementOrder,
  tagBox,
  type Box,
  type Frame,
  type TagCandidate,
} from "@/lib/eye/declutter";

const FRAME: Frame = { width: 1440, height: 900, top: 104, bottom: 150, side: 12 };
const CARD = { width: 172, height: 181, stalk: 52 };

describe("boxes", () => {
  it("touching edges do not count as overlap; shared area does", () => {
    const a: Box = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(overlaps(a, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false);
    expect(overlaps(a, { x0: 9, y0: 9, x1: 20, y1: 20 })).toBe(true);
  });

  it("a card stands above its anchor, centred, stalk and all", () => {
    const b = cardBox(500, 600, CARD);
    expect(b.x0).toBeLessThan(500 - CARD.width / 2);
    expect(b.x1).toBeGreaterThan(500 + CARD.width / 2);
    expect(b.y0).toBeLessThan(600 - CARD.stalk - CARD.height);
    expect(b.y1).toBeGreaterThan(600);
  });
});

describe("placeCards", () => {
  it("never places two cards over each other, nor one under the HUD's bands", () => {
    const cands = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, x: 100 + ((i * 97) % 1240), y: 120 + ((i * 53) % 760) }));
    const taken: Box[] = [];
    const placed = placeCards(cands, CARD, FRAME, 40, taken);
    expect(placed.length).toBeGreaterThan(0);
    for (let i = 0; i < taken.length; i++) {
      expect(insideFrame(taken[i], FRAME)).toBe(true);
      for (let j = i + 1; j < taken.length; j++) expect(overlaps(taken[i], taken[j])).toBe(false);
    }
  });

  it("stops at the cap and keeps the caller's order", () => {
    const cands = [
      { id: "a", x: 300, y: 500 },
      { id: "b", x: 700, y: 500 },
      { id: "c", x: 1100, y: 500 },
    ];
    expect(placeCards(cands, CARD, FRAME, 2, []).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("leaves out a card rather than moving it off its camera", () => {
    const cands = [
      { id: "a", x: 700, y: 500 },
      { id: "b", x: 720, y: 510 }, // would cover a
    ];
    const placed = placeCards(cands, CARD, FRAME, 5, []);
    expect(placed).toEqual([{ id: "a", x: 700, y: 500 }]);
  });

  it("skips anchors too close to the top for the card to stand", () => {
    expect(placeCards([{ id: "a", x: 700, y: 200 }], CARD, FRAME, 5, [])).toEqual([]);
  });
});

describe("placeTags", () => {
  const tag = (id: string, x: number, y: number): TagCandidate => ({ id, x, y, width: 130, height: 38 });

  it("opens to the right, and to the left at the right edge", () => {
    expect(placeTags([tag("a", 600, 500)], FRAME, 5, [])).toEqual([{ id: "a", x: 600, y: 500, flip: false }]);
    expect(placeTags([tag("b", 1400, 500)], FRAME, 5, [])).toEqual([{ id: "b", x: 1400, y: 500, flip: true }]);
  });

  it("flips to the left of a card it would cover on the right", () => {
    const taken = [cardBox(700, 560, CARD)];
    const [t] = placeTags([tag("a", 560, 500)], FRAME, 5, taken);
    expect(t?.flip).toBe(true);
    expect(overlaps(tagBox(tag("a", 560, 500), true), taken[0])).toBe(false);
  });

  it("hangs the tag above its object, by the leader's run", () => {
    const b = tagBox(tag("a", 600, 500), false);
    expect(b.y1).toBeLessThanOrEqual(500 - LEADER + 6);
  });
});

describe("placementOrder", () => {
  it("puts the pinned camera first, then what is on screen, then the nearest to the middle", () => {
    const cands = [
      { id: "far", x: 100, y: 100 },
      { id: "near", x: 710, y: 450 },
      { id: "shown", x: 1300, y: 800 },
      { id: "pin", x: 50, y: 850 },
    ];
    expect(placementOrder(cands, { x: 720, y: 450 }, new Set(["shown"]), "pin").map((c) => c.id)).toEqual([
      "pin",
      "shown",
      "near",
      "far",
    ]);
  });
});

describe("estimateTextWidth", () => {
  it("gives capitals more room than lower case", () => {
    expect(estimateTextWidth("PEARL OF LONDON", 11.5)).toBeGreaterThan(estimateTextWidth("pearl of london", 11.5));
    expect(estimateTextWidth("", 11.5)).toBe(0);
  });
});
