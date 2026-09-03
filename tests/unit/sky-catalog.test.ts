import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkyCatalogue, skyAttribution, SKY_CATALOGUE_URL, type SkyCatalogue } from "@/lib/sky/catalog";

// Read the real committed dataset off disk — no fixture, no mock. This is the
// exact file `loadSkyCatalogue` fetches at SKY_CATALOGUE_URL in the browser, so
// parsing it here with node:fs (the vitest "node" env has no fetch/DOM to fake)
// is what makes the parser's own claims checkable against the actual data that
// ships, not a hand-crafted stand-in that could drift from it.
const RAW = readFileSync(join(process.cwd(), "public", "sky", "naked-eye.json"), "utf8");
const JSON_DATA = JSON.parse(RAW);
// A fresh parse per malformed-input test, so mutating one test's copy can never
// leak into another's.
const freshJson = () => JSON.parse(RAW);

describe("parseSkyCatalogue — dataset integrity (guards public/sky/naked-eye.json)", () => {
  const cat: SkyCatalogue = parseSkyCatalogue(JSON_DATA);

  it("has at least 8000 stars — a FLOOR, not the exact count, because a re-run of scripts/gen-sky.mjs against a newer HYG release can legitimately add stars; a floor still catches a catastrophic truncation of the shipped file", () => {
    expect(cat.count).toBeGreaterThanOrEqual(8000);
  });

  it("every row is finite, in-range and within the stated magnitude limit", () => {
    const bad: string[] = [];
    for (let i = 0; i < cat.count; i++) {
      const ra = cat.raDeg(i);
      const dec = cat.decDeg(i);
      const mag = cat.mag(i);
      const ci = cat.colourIndex(i);
      if (![ra, dec, mag, ci].every(Number.isFinite)) {
        bad.push(`row ${i}: non-finite value ra=${ra} dec=${dec} mag=${mag} ci=${ci}`);
        continue;
      }
      if (!(ra >= 0 && ra < 360)) bad.push(`row ${i}: ra=${ra} outside [0, 360)`);
      if (!(Math.abs(dec) <= 90)) bad.push(`row ${i}: dec=${dec} outside [-90, 90]`);
      if (mag > cat.provenance.magnitudeLimit) {
        bad.push(`row ${i}: mag=${mag} exceeds magnitudeLimit=${cat.provenance.magnitudeLimit}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never places a star at exactly ra=0, dec=0 — the "Null Island" of the celestial sphere', () => {
    // HYG id 0 IS the Sun: magnitude -26.7, brighter than every real star by 25
    // magnitudes, so it would clear any magnitude cut and sort first. It has no
    // meaningful direction of its own on this catalogue's frame, which is why it
    // would otherwise render at RA 0 / Dec 0. `_provenance.notes` and
    // `_provenance.dropped.sun` both say the generator excludes it — this proves
    // that stayed true of the shipped rows, rather than trusting the note.
    const bad: string[] = [];
    for (let i = 0; i < cat.count; i++) {
      if (cat.raDeg(i) === 0 && cat.decDeg(i) === 0) bad.push(`row ${i} sits at ra=0, dec=0`);
    }
    expect(bad).toEqual([]);
    expect(JSON_DATA._provenance.dropped.sun).toBeGreaterThanOrEqual(1);
  });

  it("is sorted brightest-first: magnitude is non-decreasing down the array", () => {
    const bad: string[] = [];
    for (let i = 1; i < cat.count; i++) {
      if (cat.mag(i) < cat.mag(i - 1)) {
        bad.push(`row ${i} (mag=${cat.mag(i)}) is brighter than row ${i - 1} (mag=${cat.mag(i - 1)})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every key in names is a valid index into stars", () => {
    const bad: string[] = [];
    for (const idx of cat.names.keys()) {
      if (!(idx >= 0 && idx < cat.count)) bad.push(`names key ${idx} is out of range [0, ${cat.count})`);
    }
    expect(bad).toEqual([]);
  });

  it("has no duplicate HR (Yale Bright Star) numbers among named stars", () => {
    const firstSeenAt = new Map<number, number>();
    const bad: string[] = [];
    for (const [idx, name] of cat.names) {
      if (name.hr == null) continue;
      const first = firstSeenAt.get(name.hr);
      if (first !== undefined) bad.push(`HR ${name.hr} duplicated at indices ${first} and ${idx}`);
      else firstSeenAt.set(name.hr, idx);
    }
    expect(bad).toEqual([]);
  });

  it("Sirius survives as the brightest star, mag -1.44", () => {
    expect(cat.mag(0)).toBeCloseTo(-1.44, 2);
    expect(cat.nameFor(0)?.n).toBe("Sirius");
  });

  it("Vega has colour index exactly 0.00 — Vega DEFINES the zero point of the UBV system, so this single assertion validates the whole colour column", () => {
    let vegaIdx = -1;
    for (let i = 0; i < cat.count; i++) {
      if (cat.nameFor(i)?.n === "Vega") {
        vegaIdx = i;
        break;
      }
    }
    expect(vegaIdx).toBeGreaterThanOrEqual(0);
    expect(cat.colourIndex(vegaIdx)).toBe(0);
  });

  it("Betelgeuse survives at its catalogue position with the correct HR number", () => {
    let idx = -1;
    for (let i = 0; i < cat.count; i++) {
      if (cat.nameFor(i)?.n === "Betelgeuse") {
        idx = i;
        break;
      }
    }
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(cat.raDeg(idx)).toBeCloseTo(88.79, 1);
    expect(cat.decDeg(idx)).toBeCloseTo(7.41, 1);
    expect(cat.nameFor(idx)?.hr).toBe(2061);
  });
});

describe("parseSkyCatalogue — rejects malformed input rather than coercing it", () => {
  it("rejects a non-object", () => {
    expect(() => parseSkyCatalogue(null)).toThrow();
    expect(() => parseSkyCatalogue("not json")).toThrow();
    expect(() => parseSkyCatalogue(42)).toThrow();
  });

  it("rejects a missing _provenance block", () => {
    const bad = freshJson();
    delete bad._provenance;
    expect(() => parseSkyCatalogue(bad)).toThrow(/_provenance/);
  });

  it("rejects a _provenance block missing a required key", () => {
    const bad = freshJson();
    delete bad._provenance.licence;
    expect(() => parseSkyCatalogue(bad)).toThrow(/licence/);
  });

  it("rejects a star row with the wrong arity", () => {
    const bad = freshJson();
    bad.stars[5] = [1, 2, 3]; // missing the colour index
    expect(() => parseSkyCatalogue(bad)).toThrow(/stars\[5\]/);
  });

  it("rejects ra outside [0, 360)", () => {
    const bad = freshJson();
    bad.stars[5] = [360, 0, 3, 0];
    expect(() => parseSkyCatalogue(bad)).toThrow(/ra=360/);
  });

  it("rejects |dec| > 90", () => {
    const bad = freshJson();
    bad.stars[5] = [10, 91, 3, 0];
    expect(() => parseSkyCatalogue(bad)).toThrow(/dec=91/);
  });

  it("rejects a non-finite value in a star row", () => {
    const bad = freshJson();
    bad.stars[5] = [10, 10, NaN, 0];
    expect(() => parseSkyCatalogue(bad)).toThrow(/stars\[5\]/);
  });

  it("rejects a names entry keyed by a non-integer", () => {
    const bad = freshJson();
    bad.names["not-a-number"] = { n: "Ghost" };
    expect(() => parseSkyCatalogue(bad)).toThrow(/names/);
  });
});

describe("skyAttribution — derived from provenance, so it cannot drift from the data", () => {
  it("the provenance block states a licence and a retrieval date", () => {
    const { provenance } = parseSkyCatalogue(JSON_DATA);
    expect(provenance.licence.length).toBeGreaterThan(0);
    expect(provenance.retrieved.length).toBeGreaterThan(0);
    // Not just non-empty — an actual calendar date, so "retrieved" cannot silently
    // decay into a free-text placeholder.
    expect(Number.isNaN(Date.parse(provenance.retrieved))).toBe(false);
  });

  it("the attribution string names both the dataset and the licence", () => {
    const { provenance } = parseSkyCatalogue(JSON_DATA);
    const attribution = skyAttribution(provenance);
    expect(attribution).toContain(provenance.dataset);
    expect(attribution).toContain("CC BY-SA 4.0");
  });
});

describe("SKY_CATALOGUE_URL", () => {
  it("points at the committed public dataset path", () => {
    expect(SKY_CATALOGUE_URL).toBe("/sky/naked-eye.json");
  });
});
