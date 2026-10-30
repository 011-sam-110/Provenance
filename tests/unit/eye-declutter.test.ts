import { describe, expect, it } from "vitest";
import {
  LEADER,
  cardBox,
  estimateTextWidth,
  insideFrame,
  overlaps,
  placeCards,
  placeTags,
  PHONE_ROAD_TAGS,
  placementOrder,
  tagBox,
  tagCaps,
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

  it("keeps a wider right band when the frame names one", () => {
    const box: Box = { x0: 1300, y0: 300, x1: 1400, y1: 360 };
    expect(insideFrame(box, FRAME)).toBe(true);
    expect(insideFrame(box, { ...FRAME, right: 60 })).toBe(false);
    expect(insideFrame({ ...box, x0: 1200, x1: 1370 }, { ...FRAME, right: 60 })).toBe(true);
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

describe("tagCaps", () => {
  const frame = (o: Partial<{ portrait: boolean; record: boolean; landscapePhone: boolean }> = {}) => ({
    portrait: false,
    record: false,
    landscapePhone: false,
    ...o,
  });

  it("gives a portrait phone four road plates, and the rest of its caps as they were", () => {
    expect(PHONE_ROAD_TAGS).toBe(4);
    expect(tagCaps(frame({ portrait: true }))).toEqual({ ship: 4, plane: 2, road: 4, signal: 1 });
  });

  it("gives a landscape phone four road plates, and the wide caps for the rest", () => {
    expect(tagCaps(frame({ landscapePhone: true }))).toEqual({ ship: 8, plane: 3, road: 4, signal: 2 });
  });

  it("keeps a wide screen at two road plates", () => {
    expect(tagCaps(frame())).toEqual({ ship: 8, plane: 3, road: 2, signal: 2 });
  });

  it("leaves a recording or a film as it was, wide or portrait", () => {
    expect(tagCaps(frame({ portrait: true, record: true }))).toEqual({ ship: 4, plane: 2, road: 1, signal: 1 });
    expect(tagCaps(frame({ record: true, landscapePhone: true }))).toEqual({ ship: 8, plane: 3, road: 2, signal: 2 });
  });
});

describe("four road plates on a phone", () => {
  // A 390 x 844 phone: the frame's edge bands, the header and the counts as kept boxes.
  const phone: Frame = { width: 390, height: 844, top: 10, bottom: 10, side: 8 };
  const kept = (): Box[] => [
    { x0: 0, y0: 0, x1: 390, y1: 130 },
    { x0: 0, y0: 690, x1: 390, y1: 760 },
  ];
  const plate = (id: string, x: number, y: number): TagCandidate => ({ id, x, y, width: 150, height: 34 });
  const overlapAny = (placed: { id: string; x: number; y: number; flip: boolean }[], cands: TagCandidate[]) => {
    const boxes = placed.map((p) => tagBox(cands.find((c) => c.id === p.id)!, p.flip));
    return boxes.some((a, i) => boxes.slice(i + 1).some((b) => overlaps(a, b)));
  };

  it("hangs four notices that have room, apart from each other and from the header and the counts", () => {
    const cands = [plate("a", 40, 250), plate("b", 40, 340), plate("c", 40, 430), plate("d", 40, 520), plate("e", 40, 600)];
    const taken = kept();
    const placed = placeTags(cands, phone, tagCaps({ portrait: true, record: false, landscapePhone: false }).road, taken);
    expect(placed.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(overlapAny(placed, cands)).toBe(false);
    for (const p of placed) {
      const box = tagBox(cands.find((c) => c.id === p.id)!, p.flip);
      for (const k of kept()) expect(overlaps(box, k)).toBe(false);
      expect(insideFrame(box, phone)).toBe(true);
    }
  });

  it("hangs fewer than four when they crowd each other, never overlapping", () => {
    // Four notices within 20 px of each other can hang one plate, not four.
    const cands = [plate("a", 60, 300), plate("b", 70, 310), plate("c", 80, 305), plate("d", 90, 315)];
    const placed = placeTags(cands, phone, 4, kept());
    expect(placed).toHaveLength(1);
  });

  it("hangs fewer when a notice sits under the header, or too near the edge for a plate to fit", () => {
    const cands = [plate("under-header", 100, 90), plate("edge", 380, 400), plate("ok", 40, 300)];
    const placed = placeTags(cands, phone, 4, kept());
    expect(placed.map((p) => p.id)).toEqual(["ok"]);
  });

  it("opens a plate to the left where only that fits", () => {
    const placed = placeTags([plate("right-edge", 300, 300)], phone, 4, kept());
    expect(placed).toHaveLength(1);
    expect(placed[0].flip).toBe(true);
  });
});
