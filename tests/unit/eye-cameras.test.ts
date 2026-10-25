import { describe, expect, it } from "vitest";
import {
  ageText,
  cadenceText,
  cameraCredits,
  NEAR_KM,
  cameraLedgerRow,
  cardMeta,
  clipsToPlay,
  fallbackMedia,
  isStale,
  mediaLabel,
  nearCameras,
  preferredMedia,
  type CardMedia,
  type NearCamera,
} from "@/lib/eye/cameras";

const cam = (over: Partial<NearCamera> = {}): NearCamera => ({
  id: "tfl:JamCams_00001.04502",
  name: "Westminster Bridge/York Rd",
  lat: 51.5009,
  lon: -0.11762,
  available: true,
  live: false,
  clip: true,
  refreshSeconds: 300,
  attribution: "Powered by TfL Open Data",
  km: 0.29,
  ...over,
});

const NOW = Date.UTC(2026, 9, 24, 22, 42, 0);

describe("what a card shows", () => {
  it("asks for a stream, then a clip, then a still", () => {
    expect(preferredMedia(cam({ live: true }))).toBe("stream");
    expect(preferredMedia(cam())).toBe("clip");
    expect(preferredMedia(cam({ clip: false }))).toBe("still");
  });

  it("never asks for a stream in a film, which is drawn far slower than real time", () => {
    expect(preferredMedia(cam({ live: true }), true)).toBe("clip");
    expect(preferredMedia(cam({ live: true, clip: false }), true)).toBe("still");
    expect(preferredMedia(cam(), true)).toBe("clip");
  });

  it("falls back from a stream or a clip to the still, and from the still to nothing", () => {
    expect(fallbackMedia("stream")).toBe("still");
    expect(fallbackMedia("clip")).toBe("still");
    expect(fallbackMedia("still")).toBeNull();
  });
});

describe("which clips play", () => {
  const centre = { x: 500, y: 400 };
  const card = (id: string, media: CardMedia, x: number, y: number) => ({ id, media, x, y });
  const cards = [card("a", "clip", 100, 100), card("b", "clip", 520, 420), card("c", "still", 500, 400), card("d", "clip", 900, 700)];

  it("plays every clip while the view rests", () => {
    expect([...clipsToPlay(cards, centre, false)].sort()).toEqual(["a", "b", "d"]);
  });

  it("plays one clip while the view moves: the one nearest the middle of the frame", () => {
    expect([...clipsToPlay(cards, centre, true)]).toEqual(["b"]);
  });

  it("plays the clip of the camera the link opened on first", () => {
    expect([...clipsToPlay(cards, centre, true, "d")]).toEqual(["d"]);
    // A pinned camera showing a still does not take the place of a clip.
    expect([...clipsToPlay(cards, centre, true, "c")]).toEqual(["b"]);
  });

  it("holds every clip while a stream plays, because a stream is never held", () => {
    const withStream = [...cards, card("e", "stream", 50, 50)];
    expect(clipsToPlay(withStream, centre, true).size).toBe(0);
    expect([...clipsToPlay(withStream, centre, false)].sort()).toEqual(["a", "b", "d"]);
  });

  it("plays nothing when no card shows a clip", () => {
    expect(clipsToPlay([card("c", "still", 0, 0)], centre, true).size).toBe(0);
    expect(clipsToPlay([], centre, false).size).toBe(0);
  });
});

describe("a still is never called live", () => {
  it("labels only a playing stream Live", () => {
    expect(mediaLabel("stream")).toBe("Live");
    expect(mediaLabel("clip")).toBe("Clip");
    expect(mediaLabel("still")).toBe("Still");
  });

  it("never puts 'live' in a still's or a clip's words, at any age or cadence", () => {
    for (const showing of ["still", "clip"] as CardMedia[]) {
      for (const takenAt of [null, NOW, NOW - 4 * 60_000, NOW - 3 * 3_600_000]) {
        for (const refreshSeconds of [undefined, 30, 300, 7200]) {
          for (const phone of [false, true]) {
            const words = `${mediaLabel(showing)} ${cardMeta({ showing, takenAt, refreshSeconds, now: NOW, phone })}`;
            expect(words.toLowerCase()).not.toContain("live");
          }
        }
      }
    }
  });
});

describe("the age line", () => {
  it("says when the operator took the picture", () => {
    expect(ageText(NOW - 20_000, NOW)).toBe("just now");
    expect(ageText(NOW - 4 * 60_000, NOW)).toBe("4 min ago");
    expect(ageText(NOW - 125 * 60_000, NOW)).toBe("2 h ago");
    expect(ageText(NOW - 3 * 24 * 3_600_000, NOW)).toBe("3 days ago");
    expect(ageText(null, NOW)).toBeNull();
    // a clock slightly ahead of ours is "just now", not a negative age
    expect(ageText(NOW + 30_000, NOW)).toBe("just now");
  });

  it("states the operator's cadence", () => {
    expect(cadenceText(300)).toBe("every 5 min");
    expect(cadenceText(30)).toBe("every 30 s");
    expect(cadenceText(7200)).toBe("every 2 h");
    expect(cadenceText(undefined)).toBeNull();
    expect(cadenceText(0)).toBeNull();
  });

  it("gives the age and, on a wide screen, the cadence; with no time, the cadence alone", () => {
    const base = { showing: "clip" as const, refreshSeconds: 300, now: NOW };
    expect(cardMeta({ ...base, takenAt: NOW - 4 * 60_000, phone: false })).toBe("4 min ago, every 5 min");
    expect(cardMeta({ ...base, takenAt: NOW - 4 * 60_000, phone: true })).toBe("4 min ago");
    expect(cardMeta({ ...base, takenAt: null, phone: false })).toBe("every 5 min");
    expect(cardMeta({ showing: "stream", takenAt: null, now: NOW, phone: false })).toBe("stream");
  });

  it("calls a picture stale after three of its own cycles", () => {
    expect(isStale(NOW - 14 * 60_000, 300, NOW)).toBe(false);
    expect(isStale(NOW - 16 * 60_000, 300, NOW)).toBe(true);
    expect(isStale(null, 300, NOW)).toBe(false);
  });
});

describe("the ledger row", () => {
  it("counts the cards, of the available cameras nearby, and credits each feed once", () => {
    const near = [cam(), cam({ id: "tfl:2" }), cam({ id: "tfl:3", available: false }), cam({ id: "x:1", attribution: "Other operator" })];
    expect(cameraLedgerRow(2, near)).toEqual({
      kind: "cam",
      count: 2,
      label: "road cameras",
      detail: "of 3 nearby · Powered by TfL Open Data · Other operator",
      short: "road cameras",
    });
    expect(cameraLedgerRow(1, near).label).toBe("road camera");
    // Every camera nearby has its card up: no "of 3 nearby".
    expect(cameraLedgerRow(3, near).detail).toBe("Powered by TfL Open Data · Other operator");
    expect(cameraCredits([cam(), cam(), cam({ attribution: undefined })])).toEqual(["Powered by TfL Open Data"]);
  });
});

describe("nearCameras", () => {
  it("keeps what a frame can hold and drops the far ones /api/near also answers", () => {
    const at = (km: number) => ({ id: `c${km}`, km });
    expect(nearCameras([at(0.3), at(1.4), at(NEAR_KM), at(NEAR_KM + 0.01), at(287), at(Number.NaN)]).map((c) => c.km)).toEqual([
      0.3,
      1.4,
      NEAR_KM,
    ]);
  });
});
