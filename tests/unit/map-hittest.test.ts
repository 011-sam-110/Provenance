import { describe, expect, it } from "vitest";
import {
  COUNTRY_HIT_LAYER,
  COUNTRY_SCOPED_SIGNALS,
  PIN_HIT_LAYERS,
  isCountryScopedSignal,
  resolveLineHit,
  resolveMapClickTarget,
  type MapClickHit,
} from "@/lib/map/hitTest";

/** queryRenderedFeatures order: topmost layer first, country hit-area last. */
const hits = (...list: MapClickHit[]): MapClickHit[] => list;
const country: MapClickHit = { layer: COUNTRY_HIT_LAYER };

describe("resolveMapClickTarget", () => {
  it("opens the country when only the country hit-area is under the cursor", () => {
    expect(resolveMapClickTarget(hits(country))).toBe("country");
  });

  it("opens nothing on empty ocean", () => {
    expect(resolveMapClickTarget(hits())).toBe("none");
  });

  it("lets a real pin win over the country beneath it", () => {
    expect(resolveMapClickTarget(hits({ layer: "camera-markers" }, country))).toBe("pin");
    expect(resolveMapClickTarget(hits({ layer: "plane-markers" }, country))).toBe("pin");
    expect(resolveMapClickTarget(hits({ layer: "user-pin-dots" }, country))).toBe("pin");
    expect(
      resolveMapClickTarget(hits({ layer: "signal-dots", signalId: "usgs" }, country)),
    ).toBe("pin");
  });

  // THE REGRESSION. The Country Instability Index plots a pin on every country
  // centroid; those pins were unconditional click guards, so the country dossier
  // was unreachable wherever one sat — which, at globe zoom, is most countries.
  it("opens the COUNTRY dossier for the instability pin (the regression)", () => {
    expect(
      resolveMapClickTarget(
        hits(
          { layer: "signal-icons", signalId: "instability" },
          { layer: "signal-dots", signalId: "instability" },
          country,
        ),
      ),
    ).toBe("country");
  });

  it("still opens the country next to the instability pin, not on it", () => {
    // Same country, cursor a few pixels off the centroid: only the fill is hit.
    expect(resolveMapClickTarget(hits(country))).toBe("country");
  });

  it("falls back to the instability pin's own dossier with no country under it", () => {
    // An unmapped territory, or the countries layer toggled off.
    expect(
      resolveMapClickTarget(hits({ layer: "signal-dots", signalId: "instability" })),
    ).toBe("pin");
  });

  it("lets a hazard pin stacked on the instability pin win", () => {
    // A quake on top of a country centroid opens the quake, not the country.
    expect(
      resolveMapClickTarget(
        hits(
          { layer: "signal-icons", signalId: "instability" },
          { layer: "signal-dots", signalId: "emsc" },
          country,
        ),
      ),
    ).toBe("pin");
  });

  it("ignores decoration layers — labels and borders are not clickable", () => {
    expect(
      resolveMapClickTarget(
        hits(
          { layer: "country-labels" },
          { layer: "signal-labels", signalId: "usgs" },
          { layer: "user-pin-labels" },
          { layer: "country-borders" },
          country,
        ),
      ),
    ).toBe("country");
  });

  it("is order-independent — the country hit-area may arrive first", () => {
    expect(resolveMapClickTarget(hits(country, { layer: "camera-dots" }))).toBe("pin");
    expect(
      resolveMapClickTarget(hits(country, { layer: "signal-dots", signalId: "instability" })),
    ).toBe("country");
  });

  it("no longer knows the cluster layers, because there are none", () => {
    // Cameras and webcams stopped clustering: every one is its own dot at every
    // zoom. These four ids can never appear in a hit list again, so PIN_HIT_LAYERS
    // does not carry them and a click on one falls through to whatever is beneath -
    // here the country polygon. Asserted rather than deleted so the removal is
    // visible: a reader who finds "camera-clusters" in an old branch can see here
    // that its absence is deliberate and not an oversight.
    for (const layer of ["camera-clusters", "camera-cluster-count", "webcam-clusters", "webcam-cluster-count"]) {
      expect(PIN_HIT_LAYERS).not.toContain(layer);
      expect(resolveMapClickTarget(hits({ layer }, country))).toBe("country");
    }
  });

  it("treats signal lines and areas as pins", () => {
    expect(
      resolveMapClickTarget(hits({ layer: "signal-line-paths", signalId: "cables" }, country)),
    ).toBe("pin");
    expect(
      resolveMapClickTarget(hits({ layer: "signal-fill-areas", signalId: "gpsjam" }, country)),
    ).toBe("pin");
  });
});

describe("isCountryScopedSignal", () => {
  it("only matches the registered country-scoped sources", () => {
    expect(isCountryScopedSignal("instability")).toBe(true);
    expect(isCountryScopedSignal("usgs")).toBe(false);
    expect(isCountryScopedSignal(undefined)).toBe(false);
    expect(isCountryScopedSignal(null)).toBe(false);
    expect(isCountryScopedSignal("")).toBe(false);
  });
});

describe("layer id tables", () => {
  it("never lists the country hit-area as a pin layer", () => {
    // If it did, every country click would resolve to "pin" and the dossier
    // would be unreachable again.
    expect(PIN_HIT_LAYERS).not.toContain(COUNTRY_HIT_LAYER);
  });

  it("keeps the country-scoped list non-empty (instability is the flagship)", () => {
    expect(COUNTRY_SCOPED_SIGNALS).toContain("instability");
  });
});

describe("the widened cable hit target", () => {
  // A submarine cable draws ~1px wide, so clicking one was luck and its (rich)
  // dossier was effectively unreachable. A transparent ~16px line layer fixes the
  // aiming problem and creates a stealing problem: "near the cable" must not
  // start winning clicks that belong to something exact.
  const CABLE = { id: "cable:apricot" };
  const base = { lineHits: [CABLE], onDrawnLine: false, otherPin: false, overCountry: false };

  it("claims a near-miss over open water — the case the whole thing exists for", () => {
    expect(resolveLineHit(base)).toBe(CABLE);
  });

  it("claims nothing when no cable is near", () => {
    expect(resolveLineHit({ ...base, lineHits: [] })).toBeNull();
  });

  it("takes the topmost cable when routes overlap", () => {
    const other = { id: "cable:aag" };
    expect(resolveLineHit({ ...base, lineHits: [CABLE, other] })).toBe(CABLE);
  });

  it("stands down for any other pin — a pin is exact, this target is not", () => {
    expect(resolveLineHit({ ...base, otherPin: true })).toBeNull();
    // Even on the drawn line: a camera pin sitting on a cable opens the camera.
    expect(resolveLineHit({ ...base, onDrawnLine: true, otherPin: true })).toBeNull();
  });

  it("stands down over land, so coastal country clicks do not regress", () => {
    expect(resolveLineHit({ ...base, overCountry: true })).toBeNull();
  });

  it("still wins over the country when the pointer is genuinely ON the line", () => {
    // This is the pre-existing behaviour of the drawn line layer, unchanged —
    // widening the target must not quietly take it away.
    expect(resolveLineHit({ ...base, onDrawnLine: true, overCountry: true })).toBe(CABLE);
  });
});
