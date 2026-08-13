// Provenance classing — the layer's declared `confidence` is now rendered on the
// layer row itself, not only inside the expanded trust card, so it has to be
// right at a glance rather than right on inspection.
//
// WHY THESE TESTS EXIST. `signals-explain.test.ts` already proves every registered
// layer HAS an explainer. It cannot prove the explainer is honest. The bug this
// file was written for got past that check comfortably: `military-air` graded
// itself `measured` while its own `method` sentence admitted the military
// classification came from community-maintained registration lists. Every word of
// prose on the card was true; the one machine-readable field was wrong, and the
// chip is generated from the field. That is the "every Dash 8 marked military"
// complaint reaching users through a trust feature specifically built to prevent
// it — the worst place for it to come from.
//
// So the invariant below is narrow and deliberately literal: if a layer's own
// text says the classification is somebody else's, the layer may not claim an
// instrument measured it. It encodes one real defect rather than trying to
// adjudicate provenance in general, which a unit test cannot do.

import { describe, it, expect } from "vitest";
import { SIGNALS } from "@/lib/signals/registry";
import {
  allExplainers,
  explainerFor,
  confidenceChip,
  confidenceLabel,
  type Confidence,
} from "@/lib/signals/explain";

const CLASSES: Confidence[] = ["measured", "official", "reported", "modelled", "derived"];

/** Longest chip we will render inline; the expanded label must exceed it. */
const CHIP_MAX = 10;

/**
 * Phrases that mean "the classification in this layer is not ours and no
 * instrument produced it". Kept as an explicit list rather than something
 * cleverer, because a false negative here ships the exact bug back.
 */
const INHERITED_CLAIM =
  /community[- ]maintained|community tracker|third[- ]party|inherited unchanged|volunteer[- ]maintained/i;

describe("provenance classing — every rendered chip is real", () => {
  it("resolves a valid class for every REGISTERED layer", () => {
    const missing: string[] = [];
    for (const s of SIGNALS) {
      const e = explainerFor(s.id);
      if (!e || !CLASSES.includes(e.confidence)) missing.push(s.id);
    }
    expect(missing).toEqual([]);
  });

  it("gives every class a chip short enough to sit in a layer row", () => {
    for (const c of CLASSES) {
      const chip = confidenceChip(c);
      expect(chip.length).toBeGreaterThan(0);
      expect(chip.length).toBeLessThanOrEqual(CHIP_MAX);
    }
  });

  it("keeps the chip distinct per class, so two classes never read alike", () => {
    const chips = CLASSES.map(confidenceChip);
    expect(new Set(chips).size).toBe(CLASSES.length);
  });

  it("keeps the long label available for the chip's tooltip", () => {
    for (const c of CLASSES) expect(confidenceLabel(c).length).toBeGreaterThan(CHIP_MAX);
  });
});

describe("a layer may not borrow an instrument's credibility for someone else's call", () => {
  it("never grades a layer `measured` when its own text says the classification is inherited", () => {
    const offenders = allExplainers()
      .filter((e) => e.confidence === "measured")
      .filter((e) => INHERITED_CLAIM.test([e.method, e.whatItShows, ...e.limitations].join(" ")))
      .map((e) => e.id);

    // If this fails, the layer is not necessarily wrong to exist — it is wrong to
    // be graded `measured`. `reported` is almost always the honest class: someone
    // curated it, and we are passing their judgement through unchanged.
    expect(offenders).toEqual([]);
  });

  it("classes military-air as reported, because only its POSITION is measured", () => {
    const e = explainerFor("military-air");
    expect(e).toBeDefined();
    expect(e!.confidence).toBe("reported");
    // The prose must keep saying why, or the class looks arbitrary to a reader.
    expect(e!.method).toMatch(INHERITED_CLAIM);
  });

  it("still classes a genuine instrument layer as measured, so the fix did not over-correct", () => {
    expect(explainerFor("earthquakes")?.confidence).toBe("measured");
    expect(explainerFor("air-quality-stations")?.confidence).toBe("measured");
  });
});

describe("the classes actually discriminate", () => {
  it("uses more than one class across the registry", () => {
    const used = new Set(SIGNALS.map((s) => explainerFor(s.id)?.confidence).filter(Boolean));
    // A rail where everything reads `measured` communicates nothing. The whole
    // point of the chip is that layers differ.
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  it("does not grade a machine-coded news layer as an observation", () => {
    // GDELT is the layer users report miscategorisation on. It must never read as
    // measured or official — it is a model over news text.
    for (const id of ["conflict", "protests"]) {
      const c = explainerFor(id)?.confidence;
      expect(c).toBeDefined();
      expect(["modelled", "derived", "reported"]).toContain(c);
    }
  });
});
