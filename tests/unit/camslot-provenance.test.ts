import { describe, it, expect } from "vitest";
import {
  provenanceReport,
  OPEN_METEO_CREDIT,
  type ProvenanceInput,
} from "@/lib/console/widgets/camslot.provenance";
import { BANNED_IN_DERIVED } from "@/lib/console/widgets/camslot.conditions";
import type { PointWeather } from "@/lib/weather/pointWeather";
import type { SurfaceReading } from "@/lib/cameras/surface";

const NOW = Date.UTC(2026, 8, 3, 6, 0, 0);

function pw(over: Partial<PointWeather> = {}): PointWeather {
  return {
    key: "60.17,24.94",
    tempC: 12,
    code: 3,
    isDay: true,
    precipMm: 0,
    rainMm: 0,
    snowMm: 0,
    timeZone: "Europe/Helsinki",
    utcOffsetSeconds: 10800,
    ...over,
  };
}

function reading(over: Partial<SurfaceReading> = {}): SurfaceReading {
  return {
    state: "Moist",
    station: "vt4_Lahti",
    km: 2,
    observedAt: NOW - 5 * 60 * 1000,
    ...over,
  };
}

function input(over: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return { kind: "camera", refreshSeconds: 60, now: NOW, ...over };
}

/** Every string the panel would put on screen, for whole-report assertions. */
function allText(r: ReturnType<typeof provenanceReport>): string {
  return [
    r.claim.text,
    r.claim.title,
    ...r.rows.flatMap((row) => [row.term, row.value, row.note ?? ""]),
    r.refused?.reason ?? "",
    ...r.credits,
  ].join(" | ");
}

describe("provenanceReport — disclosure of a refused reading", () => {
  // This is the whole reason the panel exists. The TILE refuses a disqualified
  // reading and says "no data"; refusing to assert it is not the same as hiding
  // that it exists, and the panel is where the evidence is shown.
  it("discloses a reading the tile refused, while still not claiming it", () => {
    const r = provenanceReport(input({ surface: reading({ km: 12 }), weather: pw() }));

    expect(r.claim.tier).toBe("none");
    expect(r.claim.text).toBe("no data");

    expect(r.refused).not.toBeNull();
    expect(r.refused!.state).toBe("Moist");
    expect(r.refused!.why).toBe("far");
  });

  it("says the distance rule is OURS, so a reader can disagree with us and not the operator", () => {
    const r = provenanceReport(input({ surface: reading({ km: 12 }) }));

    expect(r.refused!.ruleOwner).toBe("ours");
    // The gap is named, so a reader can weigh it against our threshold themselves.
    expect(r.refused!.reason).toMatch(/12(\.0)? km/);
    // And the threshold is named as ours, in the figure we actually applied.
    expect(r.refused!.rule).toBe("our 10 km limit");
  });

  it("says the staleness rule is the OPERATOR'S when the operator is the one refusing", () => {
    const r = provenanceReport(input({ surface: reading({ operatorFlag: "OVER_2_HOURS" }) }));

    expect(r.refused!.why).toBe("stale");
    expect(r.refused!.ruleOwner).toBe("operator");
    expect(r.refused!.reason).toMatch(/OVER_2_HOURS/);
  });

  it("has nothing to disclose when the reading was used", () => {
    const r = provenanceReport(input({ surface: reading() }));

    expect(r.claim.tier).toBe("measured");
    expect(r.refused).toBeNull();
  });
});

describe("provenanceReport — the operator's own words", () => {
  it("reports the operator's state verbatim, never a word of ours", () => {
    const r = provenanceReport(input({ surface: reading({ state: "Cold wet surface" }) }));
    const stated = r.rows.find((row) => row.value.includes("Cold wet surface"));

    expect(stated).toBeDefined();
    // Not "Damp", not "Wet", not a severity. Exactly what the network published.
    expect(stated!.value).toContain("Cold wet surface");
  });

  it("names the station and its distance from the camera", () => {
    const r = provenanceReport(input({ surface: reading({ station: "vt4_Lahti", km: 3.4 }) }));
    const text = allText(r);

    expect(text).toContain("vt4_Lahti");
    expect(text).toMatch(/3\.4 km/);
  });
});

describe("provenanceReport — both timestamps", () => {
  // The station's reading and the picture are two different moments, and conflating
  // them is how a two-hour-old measurement passes as a description of a live frame.
  it("separates when the station measured from when the frame was taken", () => {
    const r = provenanceReport(
      input({
        surface: reading({ observedAt: NOW - 45 * 60 * 1000 }),
        lastSampledAt: new Date(NOW - 60 * 1000).toISOString(),
      }),
    );

    const station = r.rows.find((row) => /station/i.test(row.term) && /45m/.test(row.value));
    const frame = r.rows.find((row) => /frame/i.test(row.term));

    expect(station).toBeDefined();
    expect(frame).toBeDefined();
    expect(frame!.value).toMatch(/shot 1m/);
  });

  it("says the frame was PULLED, not shot, when the operator stamps no capture time", () => {
    const r = provenanceReport(input({ surface: reading(), lastSampledAt: undefined }));
    const frame = r.rows.find((row) => /frame/i.test(row.term));

    expect(frame!.value).toMatch(/^pulled /);
  });
});

describe("provenanceReport — a derived report stays derived", () => {
  it("never uses a surface word anywhere in the panel", () => {
    const r = provenanceReport(input({ weather: pw({ rainMm: 0.4, precipMm: 0.4 }) }));

    expect(r.claim.tier).toBe("derived");
    expect(allText(r)).not.toMatch(BANNED_IN_DERIVED);
  });

  it("states that the precipitation figure is a preceding-hour sum, not an instant", () => {
    const r = provenanceReport(input({ weather: pw({ rainMm: 0.4, precipMm: 0.4 }) }));

    expect(allText(r)).toMatch(/preceding hour/i);
  });
});

describe("provenanceReport — credit", () => {
  it("credits Open-Meteo whenever an air-weather reading was used", () => {
    const r = provenanceReport(input({ weather: pw() }));

    expect(r.credits).toContain(OPEN_METEO_CREDIT);
  });

  it("does not credit a source it never read", () => {
    const r = provenanceReport(input({ kind: null }));

    expect(r.credits).toEqual([]);
  });
});

describe("provenanceReport — nothing invented", () => {
  it("offers no evidence rows for a stream with no place", () => {
    const r = provenanceReport(input({ kind: null }));

    expect(r.claim.tier).toBe("none");
    expect(r.rows).toEqual([]);
    expect(r.refused).toBeNull();
  });

  it("says it is still looking rather than reporting an absence, while pending", () => {
    const r = provenanceReport(input({ pending: true }));

    expect(r.claim.tier).toBe("pending");
    expect(r.rows).toEqual([]);
  });
});
