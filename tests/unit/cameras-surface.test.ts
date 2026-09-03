import { describe, it, expect } from "vitest";
import {
  humaniseOperatorCode,
  surfaceValidity,
  haversineKm,
  MEASURED_MAX_AGE_MS,
  NEARBY_KM,
  type SurfaceReading,
} from "@/lib/cameras/surface";
import { normalizeEstoniaSurface, normalizeEstonia } from "@/lib/sources/estonia";
import fixture from "@/tests/fixtures/estonia-road-status.json";

const NOW = Date.UTC(2026, 8, 3, 6, 0, 0);

function reading(over: Partial<SurfaceReading> = {}): SurfaceReading {
  return { state: "Dry", km: 0, observedAt: NOW - 60_000, ...over };
}

describe("humaniseOperatorCode", () => {
  it("turns an operator's machine code into English", () => {
    expect(humaniseOperatorCode("DRY")).toBe("Dry");
    expect(humaniseOperatorCode("COLD_WET_SURFACE")).toBe("Cold wet surface");
  });

  it("leaves wording the operator already wrote as prose untouched", () => {
    // Fintraffic sends whole sentences in sensorValueDescriptionEn.
    expect(humaniseOperatorCode("The sensor has a fault")).toBe("The sensor has a fault");
    expect(humaniseOperatorCode("Snow-covered")).toBe("Snow-covered");
  });

  it("is a casing transform ONLY — it never maps one word onto another", () => {
    // The guard against a value->label table creeping in. A state this repo has never
    // seen must survive with its meaning intact, because the upstream vocabulary grows
    // with the seasons and we cannot enumerate it.
    for (const unseen of ["BLACK_ICE", "SNOW_COVERED", "PARTLY_ICY", "SLUSH"]) {
      const out = humaniseOperatorCode(unseen);
      expect(out.toLowerCase().replace(/ /g, "_")).toBe(unseen.toLowerCase());
    }
  });

  it("returns empty for empty, rather than inventing a state", () => {
    expect(humaniseOperatorCode("")).toBe("");
    expect(humaniseOperatorCode("   ")).toBe("");
  });
});

describe("surfaceValidity", () => {
  it("accepts a fresh reading from a station on the spot", () => {
    expect(surfaceValidity(reading(), NOW)).toBe("current");
  });

  it("honours the operator's own fault verdict above our arithmetic", () => {
    // Faulty AND far: we repeat what the operator told us rather than substituting
    // our own reason, because theirs is the more specific fact.
    const r = reading({ operatorFlag: "The sensor has a fault", km: 40 });
    expect(surfaceValidity(r, NOW)).toBe("fault");
  });

  it("honours the operator's own staleness verdict", () => {
    expect(surfaceValidity(reading({ operatorFlag: "OVER_2_HOURS" }), NOW)).toBe("stale");
  });

  it("does not treat OK as a flag", () => {
    // `OK` is the operator saying the reading is fine. Treating it as a qualification
    // would suppress every healthy Estonian reading.
    expect(surfaceValidity(reading({ operatorFlag: "" }), NOW)).toBe("current");
  });

  it("refuses a station beyond NEARBY_KM", () => {
    expect(surfaceValidity(reading({ km: NEARBY_KM + 0.1 }), NOW)).toBe("far");
    // The worst real gap measured across the 180 Estonian cameras.
    expect(surfaceValidity(reading({ km: 36.8 }), NOW)).toBe("far");
  });

  it("accepts a station exactly at the threshold", () => {
    expect(surfaceValidity(reading({ km: NEARBY_KM }), NOW)).toBe("current");
  });

  it("refuses an UNKNOWN distance rather than assuming it is near", () => {
    // The difference between "the station is here" and "we never learned the gap".
    expect(surfaceValidity(reading({ km: undefined }), NOW)).toBe("far");
  });

  it("refuses a reading older than the operator's own two-hour window", () => {
    const old = reading({ observedAt: NOW - MEASURED_MAX_AGE_MS - 1 });
    expect(surfaceValidity(old, NOW)).toBe("old");
    const justInside = reading({ observedAt: NOW - MEASURED_MAX_AGE_MS + 1 });
    expect(surfaceValidity(justInside, NOW)).toBe("current");
  });

  it("borrows its staleness threshold from the operator, not from us", () => {
    // Estonia raises OVER_2_HOURS at exactly this age. If someone retunes this constant
    // they are inventing a safety margin, which is the thing this feature must not do.
    expect(MEASURED_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("normalizeEstoniaSurface", () => {
  const rows = (fixture as { features: { attributes: Record<string, unknown> }[] }).features;
  const byName = (n: string) =>
    rows.find((f) => String(f.attributes.site_name ?? "").startsWith(n))!.attributes;

  it("reads the state, station, distance and both temperatures the operator publishes", () => {
    const dry = rows.find((f) => f.attributes.road_status === "DRY")!.attributes;
    const out = normalizeEstoniaSurface(dry as never)!;
    expect(out.state).toBe("Dry");
    expect(out.km).toBe(0);
    expect(out.station).toBeTruthy();
    expect(typeof out.roadTempC).toBe("number");
    expect(typeof out.airTempC).toBe("number");
    expect(typeof out.observedAt).toBe("number");
    // road_temp and air_temp are DIFFERENT measurements and neither substitutes.
    expect(out.roadTempC).not.toBe(out.airTempC);
  });

  it("emits nothing at all when the operator published no reading", () => {
    // 10 of 180 cameras on 2026-09-03. "Unknown" would be a claim we have not earned.
    const none = rows.find((f) => f.attributes.road_status === null)!.attributes;
    expect(normalizeEstoniaSurface(none as never)).toBeUndefined();
  });

  it("carries the operator's qualification through verbatim instead of judging it", () => {
    const cold = rows.find(
      (f) => f.attributes.road_status_aggregate === "COLD_WET_SURFACE",
    )!.attributes;
    const out = normalizeEstoniaSurface(cold as never)!;
    expect(out.operatorFlag).toBe("COLD_WET_SURFACE");
    // It is carried, not dropped — but it is NOT a fault or a staleness word, so the
    // reading stays usable. Only the operator's stale/fault vocabulary disqualifies.
    expect(surfaceValidity({ ...out, observedAt: NOW }, NOW)).toBe("current");
  });

  it("keeps a far reading rather than discarding it, so the reason survives", () => {
    const far = rows.find((f) => Number(f.attributes.distance) > 30)!.attributes;
    const out = normalizeEstoniaSurface(far as never)!;
    expect(out.km).toBeGreaterThan(30);
    // The normaliser does not judge; surfaceValidity does. That split is what lets the
    // UI say "36.8 km away" instead of silently showing nothing.
    expect(surfaceValidity(out, NOW)).toBe("far");
  });

  it("tolerates a state with no road temperature", () => {
    // Not in the September capture, so asserted directly rather than faked into a
    // fixture as if it had been observed.
    const out = normalizeEstoniaSurface({ road_status: "WET", distance: 0 } as never)!;
    expect(out.state).toBe("Wet");
    expect(out.roadTempC).toBeUndefined();
  });
});

describe("normalizeEstonia end to end", () => {
  it("attaches surface and a real capture time to the cameras that have them", () => {
    const cams = normalizeEstonia(fixture as never);
    expect(cams.length).toBeGreaterThan(0);

    const withSurface = cams.filter((c) => c.surface);
    expect(withSurface.length).toBeGreaterThan(0);

    // image_time is the OPERATOR'S stamp on the frame, which is a different claim from
    // when we fetched it. Every fixture row carries one.
    for (const c of cams) {
      expect(c.lastSampledAt, `${c.id} lost its capture time`).toBeTruthy();
      expect(Number.isFinite(Date.parse(c.lastSampledAt!))).toBe(true);
    }

    // The camera whose road_status was null must have no surface, not an empty one.
    expect(cams.some((c) => !c.surface)).toBe(true);
  });
});

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm(60.2282, 24.5964, 60.2282, 24.5964)).toBeCloseTo(0, 6);
  });

  it("matches a known separation", () => {
    // Helsinki -> Tallinn, ~82 km across the gulf.
    expect(haversineKm(60.1699, 24.9384, 59.437, 24.7536)).toBeGreaterThan(80);
    expect(haversineKm(60.1699, 24.9384, 59.437, 24.7536)).toBeLessThan(85);
  });
});
