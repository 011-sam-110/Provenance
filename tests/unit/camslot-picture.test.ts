import { describe, it, expect } from "vitest";
import {
  BLACK_MAX_LUMA,
  CARD_MATCH_MAX,
  DRAW_H,
  DRAW_W,
  FLAT_LUMA,
  GRID_H,
  GRID_W,
  KNOWN_CARDS,
  fingerprint,
  fingerprintDistance,
  isBlackFrame,
  judgeGrid,
  lumaGrid,
  matchKnownCard,
  pictureOutcome,
  readPicture,
} from "@/lib/console/widgets/camslot.picture";
import fixture from "@/tests/fixtures/camslot-picture-frames.json";

// Every frame here is real: a Caltrans still or stream frame that came through the
// site's own /api/proxy or /api/hls, by day (2026-10-23) and by night (2026-10-24).
// See the fixture's own `about` lines and scripts/camslot-picture-row.mts.
type Frame = (typeof fixture.frames)[number];
const gridOf = (f: Frame) => Uint8Array.from(Buffer.from(f.luma, "hex"));
const cards = fixture.frames.filter((f) => f.kind === "placeholder");
const roads = fixture.frames.filter((f) => f.kind === "road");
const caltrans = KNOWN_CARDS.find((c) => c.id === "caltrans-temporarily-unavailable")!;
const flat = (v: number) => new Uint8Array(GRID_W * GRID_H).fill(v);
const label = (f: Frame) => `${f.id} ${f.light} via ${f.via} at ${f.capturedUtc}${"at" in f ? ` +${f.at}s` : ""}`;

describe("the fixture", () => {
  it("is the grid the check judges", () => {
    expect(fixture.grid).toEqual({ w: GRID_W, h: GRID_H });
    for (const f of fixture.frames) expect(gridOf(f).length, label(f)).toBe(GRID_W * GRID_H);
  });

  it("holds real cards and at least 20 real road frames, by day AND by night", () => {
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(roads.length).toBeGreaterThanOrEqual(20);
    // Night is the case the approved rule was written around, so it must not be a
    // token handful: a black-frame rule that was never shown a dark road proves
    // nothing about one.
    expect(roads.filter((f) => f.light === "day").length).toBeGreaterThanOrEqual(10);
    expect(roads.filter((f) => f.light === "night").length).toBeGreaterThanOrEqual(10);
    // Both ways a tile receives a picture: a still and a stream frame.
    expect(new Set(roads.map((f) => f.via))).toEqual(new Set(["/api/proxy", "/api/hls"]));
  });
});

describe("the Caltrans 'Temporarily Unavailable' card", () => {
  it("is the card the reference frame shows — the stored fingerprint has not drifted", () => {
    // KNOWN_CARDS carries a fingerprint, not a picture. If FLAT_LUMA, the grid or the
    // averaging ever changes, the stored string silently stops describing the card
    // and nothing would match it. This is the line that notices.
    const reference = cards.find((f) => caltrans.seen.startsWith(f.id))!;
    expect(reference, "the frame KNOWN_CARDS names must be in the fixture").toBeDefined();
    expect(fingerprint(gridOf(reference))).toBe(caltrans.fingerprint);
  });

  it("matches every real card frame", () => {
    for (const f of cards) {
      expect(judgeGrid(gridOf(f)), label(f)).toBe("placeholder");
      expect(matchKnownCard(gridOf(f))?.id, label(f)).toBe(caltrans.id);
    }
  });

  it("matches NONE of the real road frames, by day or by night, still or stream", () => {
    for (const f of roads) expect(judgeGrid(gridOf(f)), label(f)).toBe("picture");
  });

  it("is nowhere near a real road: the closest sits more than five times the threshold away", () => {
    // Measured 2026-10-24: 116 of 263 trits. Pinned loosely on purpose — the point is
    // the gap, and a future frame that narrows it to within 5x deserves a look.
    const closest = Math.min(...roads.map((f) => fingerprintDistance(fingerprint(gridOf(f)), caltrans.fingerprint)));
    expect(closest).toBeGreaterThan(CARD_MATCH_MAX * 5);
  });

  it("is not a blank frame: white, snow, fog, grey and black are all far from it", () => {
    // A frame with no edges has an all-"0" fingerprint, so its distance from the card
    // is the number of edges the card has. If that ever fell under the threshold, a
    // white-out — fog, snow, glare — would read as the card. It must not.
    for (const v of [0, 64, 128, 190, 235, 255]) {
      expect(judgeGrid(flat(v)), `flat ${v}`).not.toBe("placeholder");
      expect(fingerprintDistance(fingerprint(flat(v)), caltrans.fingerprint)).toBeGreaterThan(CARD_MATCH_MAX * 3);
    }
  });

  it("is not a white frame that carries the card's own timestamp bar", () => {
    // The nearest thing to the card that is not the card: an over-exposed still
    // keeps the operator's bar along the bottom and loses everything else.
    const card = gridOf(cards[0]);
    const barOnly = card.map((v, i) => (Math.floor(i / GRID_W) < GRID_H - 1 ? 255 : v));
    expect(judgeGrid(barOnly)).toBe("picture");
  });

  it("still matches when the card arrives brighter, darker or in limited range", () => {
    const card = gridOf(cards[0]);
    const limited = card.map((v) => Math.round(16 + (v * 219) / 255));
    const darker = card.map((v) => Math.max(0, v - 20));
    for (const g of [limited, darker]) expect(judgeGrid(g)).toBe("placeholder");
  });
});

describe("black frames", () => {
  it("are a frame black everywhere, including a decoder that reads limited range as full", () => {
    expect(judgeGrid(flat(0))).toBe("black");
    expect(judgeGrid(flat(16))).toBe("black");
    expect(isBlackFrame(flat(BLACK_MAX_LUMA))).toBe(true);
  });

  it("are not a dark frame with one lit cell in it — a lamp, a headlight or a caption", () => {
    const g = flat(4);
    g[GRID_W * 5 + 7] = BLACK_MAX_LUMA + 1;
    expect(isBlackFrame(g)).toBe(false);
    expect(judgeGrid(g)).toBe("picture");
  });

  it("never include a real night frame: the darkest still has a cell far above the line", () => {
    const night = roads.filter((f) => f.light === "night");
    for (const f of night) expect(isBlackFrame(gridOf(f)), label(f)).toBe(false);
    // Measured 2026-10-24 04:30 PDT: 114. Night in Los Angeles is not dark at 16x9.
    const darkest = Math.min(...night.map((f) => Math.max(...gridOf(f))));
    expect(darkest).toBeGreaterThan(BLACK_MAX_LUMA * 4);
  });
});

describe("lumaGrid", () => {
  const rgba = (w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(px(x, y), 4 * (y * w + x));
    return out;
  };

  it("averages by area: a canvas half white and half black is 255 and 0 by column", () => {
    const g = lumaGrid(rgba(DRAW_W, DRAW_H, (x) => (x < DRAW_W / 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), DRAW_W, DRAW_H)!;
    expect(Array.from(g.slice(0, GRID_W))).toEqual([...Array(8).fill(255), ...Array(8).fill(0)]);
  });

  it("counts a pixel split across two cells in both, by the share in each", () => {
    // 24 columns into 16 cells: every cell is 1.5 source columns wide, so cell 1 is
    // half of column 1 and all of column 2.
    const g = lumaGrid(rgba(24, 9, (x) => (x === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 24, 9)!;
    expect(g[0]).toBe(Math.round(255 / 3));
    expect(g[1]).toBe(Math.round(255 / 3));
    expect(g[2]).toBe(0);
  });

  it("uses Rec. 601 luma, so pure green is brighter than pure red, and red than blue", () => {
    const one = (c: [number, number, number]) => lumaGrid(rgba(GRID_W, GRID_H, () => [...c, 255]), GRID_W, GRID_H)![0];
    expect(one([0, 255, 0])).toBe(150);
    expect(one([255, 0, 0])).toBe(76);
    expect(one([0, 0, 255])).toBe(29);
  });

  it("refuses a picture that was not drawn: any transparent pixel means there is nothing to judge", () => {
    // A <video> with no current frame draws nothing onto a cleared canvas, which
    // reads back as transparent black. Judged, that would be a black frame — a strike
    // against a camera for a frame we never received.
    expect(lumaGrid(new Uint8ClampedArray(DRAW_W * DRAW_H * 4), DRAW_W, DRAW_H)).toBeNull();
    const almost = rgba(DRAW_W, DRAW_H, () => [0, 0, 0, 255]);
    almost[3] = 254;
    expect(lumaGrid(almost, DRAW_W, DRAW_H)).toBeNull();
  });

  it("refuses a buffer smaller than its stated size", () => {
    expect(lumaGrid(new Uint8ClampedArray(10), DRAW_W, DRAW_H)).toBeNull();
  });
});

describe("fingerprint", () => {
  it("has one trit per neighbouring pair: 15x9 across, then 16x8 down", () => {
    expect(fingerprint(flat(128))).toHaveLength((GRID_W - 1) * GRID_H + GRID_W * (GRID_H - 1));
  });

  it("calls a step of FLAT_LUMA flat, and one level more an edge", () => {
    const g = flat(100);
    g[1] = 100 + FLAT_LUMA;
    expect(fingerprint(g)[0]).toBe("0");
    g[1] = 100 + FLAT_LUMA + 1;
    expect(fingerprint(g)[0]).toBe("-");
    g[1] = 100 - FLAT_LUMA - 1;
    expect(fingerprint(g)[0]).toBe("+");
  });

  it("puts a malformed fingerprint as far from everything as it can be", () => {
    expect(fingerprintDistance("000", "0000")).toBe(4);
  });
});

describe("what the bench is told", () => {
  it("passes a card and a black frame through, and counts anything else as a picture", () => {
    expect(pictureOutcome("placeholder")).toBe("placeholder");
    expect(pictureOutcome("black")).toBe("black");
    expect(pictureOutcome("picture")).toBe(true);
  });

  it("never strikes a picture it could not read — a tainted canvas is unknown, not a failure", () => {
    expect(pictureOutcome("unknown")).toBe(true);
  });

  it("reads nothing outside a browser", () => {
    expect(readPicture({} as HTMLImageElement)).toBe("unknown");
  });
});
