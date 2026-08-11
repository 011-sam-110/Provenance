import { describe, expect, test } from "vitest";
import { toWebcams } from "@/lib/webcams/normalize";
import { describeWebcamSample, type WebcamSample } from "@/lib/webcams/fetch";
import type { WindyWebcam } from "@/lib/sources/windy";

// Round 4 wired the coverage contract into lib/sources/windy.ts's fetchWebcams(),
// which has no live caller. The real /api/webcams response is built by
// fetchWebcamSample() (lib/webcams/fetch.ts) → toWebcams() (lib/webcams/normalize.ts),
// which capped at MAX_WEBCAMS and disclosed nothing — the live count was a ceiling
// presented as a measurement. This file proves the fix: toWebcams() now measures
// the true pre-cap total instead of stopping the moment it hits the cap, and that
// total survives onto WebcamMapping.coverage / WebcamSample.coverage / the
// describeWebcamSample() note.

/** A minimal valid row — only webcamId + coordinates are required to normalize. */
function row(webcamId: number, extra: Partial<WindyWebcam> = {}): WindyWebcam {
  return {
    webcamId,
    location: { latitude: 10, longitude: 20 },
    urls: { detail: `https://windy.com/webcams/${webcamId}` },
    ...extra,
  };
}

describe("toWebcams — coverage over the cap (regression for the dead-path defect)", () => {
  test("more rows than the cap: available is the TRUE pre-cap total, not the cap", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(1000 + i));
    const m = toWebcams(rows, 5);

    expect(m.webcams).toHaveLength(5);
    expect(m.coverage.returned).toBe(5);
    expect(m.coverage.capped).toBe(true);
    expect(m.coverage.cap).toBe(5);
    // The whole point: 10 valid unique rows existed, not 5.
    expect(m.coverage.available).toBe(10);
    expect(m.coverage.availableExact).toBe(true);
  });

  test("a row set under the cap does not claim truncation", () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(2000 + i));
    const m = toWebcams(rows, 5);

    expect(m.webcams).toHaveLength(3);
    expect(m.coverage.capped).toBe(false);
    expect(m.coverage.available).toBe(3);
    expect(m.coverage.returned).toBe(3);
  });

  test("a row set exactly AT the cap does not claim truncation", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(2500 + i));
    const m = toWebcams(rows, 5);

    expect(m.webcams).toHaveLength(5);
    expect(m.coverage.capped).toBe(false);
    expect(m.coverage.available).toBe(5);
  });

  test("duplicates and unmappable rows PAST the cap boundary are still counted (the old bug)", () => {
    // Old behaviour: the loop `break`s the instant 2 valid webcams accumulate, so
    // rows after that point — including this duplicate and this unmappable row —
    // were never even visited, and duplicates/unmappable silently undercounted.
    const rows: WindyWebcam[] = [
      row(3000),
      row(3001),
      row(3002), // pushes the valid pool to 3, past cap=2
      { ...row(3000) }, // duplicate of an already-seen id
      { webcamId: 3999, location: null }, // unmappable: no usable coords
    ];
    const m = toWebcams(rows, 2);

    expect(m.webcams).toHaveLength(2);
    expect(m.coverage.available).toBe(3); // the true valid, deduped pool
    expect(m.coverage.capped).toBe(true);
    expect(m.duplicates).toBe(1);
    expect(m.unmappable).toBe(1);
  });

  test("empty input never throws and reports zero available, uncapped", () => {
    const m = toWebcams([], 5);
    expect(m.webcams).toEqual([]);
    expect(m.coverage.available).toBe(0);
    expect(m.coverage.capped).toBe(false);
  });
});

describe("describeWebcamSample — tells the same truth as the coverage record", () => {
  const base: WebcamSample = {
    webcams: [],
    dormant: false,
    pagesOk: 0,
    pagesFailed: 0,
    statuses: [],
    mapping: null,
  };

  test("a capped sample's note says 'N of M', not a bare ceiling", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(4000 + i));
    const mapping = toWebcams(rows, 4);
    const note = describeWebcamSample({
      ...base,
      webcams: mapping.webcams,
      pagesOk: 1,
      mapping,
      coverage: mapping.coverage,
    });
    expect(note).toContain("4 of 10 webcams");
  });

  test("an uncapped sample's note has no 'of' denominator", () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(5000 + i));
    const mapping = toWebcams(rows, 10);
    const note = describeWebcamSample({
      ...base,
      webcams: mapping.webcams,
      pagesOk: 1,
      mapping,
      coverage: mapping.coverage,
    });
    expect(note).toContain("3 webcams from");
    expect(note).not.toContain(" of ");
  });
});
