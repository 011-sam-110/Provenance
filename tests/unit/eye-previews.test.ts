import { describe, expect, it } from "vitest";
import { cardBox, insideFrame, type Box, type Frame } from "@/lib/eye/declutter";
import {
  EYE_PREFS_KEY,
  EYE_PREFS_VERSION,
  ICON_PHONE,
  ICON_WIDE,
  PREVIEWS_LABEL,
  PREVIEWS_PHONE_WORD,
  cardBoxBelow,
  closeLabel,
  openCardSide,
  previewsInEffect,
  readEyePrefs,
  showLabel,
} from "@/lib/eye/previews";

// The wide card's size, as EyeOverlay stands it (CARD_WIDE): 172 px, 181 px tall, 52 px stalk.
const CARD = { width: 172, height: 181, stalk: 52 };
const FRAME: Frame = { width: 1440, height: 900, top: 12, bottom: 12, side: 12 };
/** The HUD's header across the top, where the title and the clock stand. */
const HEADER: Box = { x0: 0, y0: 0, x1: 1440, y1: 104 };

describe("what is remembered", () => {
  it("is one versioned key, tn.eye.v1", () => {
    expect(EYE_PREFS_KEY).toBe("tn.eye.v1");
    expect(EYE_PREFS_VERSION).toBe(1);
  });

  it("turns previews off only for a stored { previews: false }", () => {
    expect(readEyePrefs({ previews: false })).toEqual({ previews: false });
    expect(readEyePrefs({ previews: true })).toEqual({ previews: true });
  });

  it("reads anything else as on", () => {
    expect(readEyePrefs(null)).toEqual({ previews: true });
    expect(readEyePrefs(undefined)).toEqual({ previews: true });
    expect(readEyePrefs("x")).toEqual({ previews: true });
    expect(readEyePrefs(0)).toEqual({ previews: true });
    expect(readEyePrefs({ previews: "no" })).toEqual({ previews: true });
    expect(readEyePrefs({ previews: 0 })).toEqual({ previews: true });
    expect(readEyePrefs({})).toEqual({ previews: true });
  });
});

describe("a film or a recording ignores the choice", () => {
  it("shows previews for a recording even when off is stored", () => {
    expect(previewsInEffect(false, { record: true, film: false })).toBe(true);
  });

  it("shows previews for a film even when off is stored", () => {
    expect(previewsInEffect(false, { record: false, film: true })).toBe(true);
  });

  it("honours off where there is neither, and on everywhere", () => {
    expect(previewsInEffect(false, { record: false, film: false })).toBe(false);
    expect(previewsInEffect(true, { record: false, film: false })).toBe(true);
    expect(previewsInEffect(true, { record: true, film: true })).toBe(true);
  });
});

describe("words", () => {
  it("names the switch and builds the labels from the camera's name", () => {
    expect(PREVIEWS_LABEL).toBe("Previews");
    expect(PREVIEWS_PHONE_WORD).toBe("Cameras");
    expect(showLabel("Parliament Square")).toBe("Show Parliament Square");
    expect(closeLabel("Parliament Square")).toBe("Close Parliament Square");
  });

  it("never says live: a still is never called live", () => {
    for (const w of [PREVIEWS_LABEL, PREVIEWS_PHONE_WORD, showLabel("Camera 1"), closeLabel("Camera 1")]) expect(w).not.toMatch(/\blive\b/i);
  });
});

describe("icon sizes", () => {
  it("are numbers, and the phone's hit area is at least 44 px", () => {
    for (const n of [...Object.values(ICON_WIDE), ...Object.values(ICON_PHONE)]) {
      expect(typeof n).toBe("number");
      expect(Number.isFinite(n)).toBe(true);
    }
    expect(ICON_PHONE.width).toBeGreaterThanOrEqual(44);
    expect(ICON_PHONE.height).toBeGreaterThanOrEqual(44);
  });

  it("allow more icons than cards, and fewer on a phone", () => {
    expect(ICON_WIDE.max).toBe(16);
    expect(ICON_PHONE.max).toBe(10);
    expect(ICON_PHONE.max).toBeLessThan(ICON_WIDE.max);
  });
});

describe("a card hung below its camera", () => {
  it("mirrors the card above: stalk first, then the plate, centred", () => {
    const above = cardBox(500, 600, CARD);
    const below = cardBoxBelow(500, 600, CARD);
    expect(below.x0).toBe(above.x0);
    expect(below.x1).toBe(above.x1);
    // The same height, flipped about the camera's spot.
    expect(below.y1 - below.y0).toBe(above.y1 - above.y0);
    expect(below.y0).toBeLessThan(600);
    expect(below.y1).toBeGreaterThan(600 + CARD.stalk + CARD.height);
    expect(above.y1 - 600).toBe(600 - below.y0);
  });
});

describe("which side an opened card takes", () => {
  it("stands above a camera in the middle of the frame", () => {
    expect(openCardSide(720, 600, CARD, FRAME, [HEADER])).toBe("above");
  });

  it("hangs below a camera just under the header, where above would cover it", () => {
    // Above would reach up to y = 250 - 52 - 181 - 6 = 11: into the header and out of the frame.
    expect(openCardSide(720, 250, CARD, FRAME, [HEADER])).toBe("below");
    expect(insideFrame(cardBoxBelow(720, 250, CARD), FRAME)).toBe(true);
  });

  it("hangs below only when it clears the header too", () => {
    // Just clear of the header: above would end at the header's edge and overlap it.
    const y = HEADER.y1 + CARD.stalk + CARD.height - 20;
    expect(openCardSide(720, y, CARD, FRAME, [HEADER])).toBe("below");
    // Far enough down that above clears the header.
    expect(openCardSide(720, HEADER.y1 + CARD.stalk + CARD.height + 20, CARD, FRAME, [HEADER])).toBe("above");
  });

  it("stays above where the frame is too short for either side", () => {
    const short: Frame = { width: 1440, height: 300, top: 12, bottom: 12, side: 12 };
    expect(openCardSide(720, 150, CARD, short, [])).toBe("above");
  });

  it("goes below when something else keeps the room above", () => {
    const sign: Box = { x0: 600, y0: 300, x1: 840, y1: 560 };
    expect(openCardSide(720, 600, CARD, FRAME, [sign])).toBe("below");
  });
});
