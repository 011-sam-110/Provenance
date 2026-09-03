import { describe, it, expect } from "vitest";
import {
  roadClaim,
  derivedRoad,
  weatherChip,
  placeNoun,
  frameAge,
  overlayDensity,
  shortAge,
  BANNED_IN_DERIVED,
  DERIVED_MARK,
  HIDE_BELOW_H,
  type ClaimInput,
} from "@/lib/console/widgets/camslot.conditions";
import type { PointWeather } from "@/lib/weather/pointWeather";
import type { SurfaceReading } from "@/lib/cameras/surface";

const NOW = Date.UTC(2026, 8, 3, 6, 0, 0);

function pw(over: Partial<PointWeather> = {}): PointWeather {
  return {
    key: "51.51,-0.13",
    tempC: 12,
    code: 3,
    isDay: true,
    precipMm: 0,
    rainMm: 0,
    snowMm: 0,
    timeZone: "Europe/London",
    utcOffsetSeconds: 3600,
    ...over,
  };
}

function base(over: Partial<ClaimInput> = {}): ClaimInput {
  return { kind: "camera", now: NOW, ...over };
}

describe("placeNoun", () => {
  it("says Road for a road camera and Ground for a webcam", () => {
    // A Windy webcam on a pedestrian square has no road in frame.
    expect(placeNoun("camera")).toBe("Road");
    expect(placeNoun("webcam")).toBe("Ground");
  });
});

describe("derivedRoad — the vocabulary", () => {
  it("names snow above rain when both fell", () => {
    const out = derivedRoad(pw({ precipMm: 1.2, rainMm: 0.4, snowMm: 0.8 }))!;
    expect(out.text).toContain("snow 1h");
    expect(out.text).not.toContain("rain 1h");
  });

  it("says rain when only rain fell", () => {
    expect(derivedRoad(pw({ precipMm: 0.4, rainMm: 0.4, snowMm: 0 }))!.text).toContain("rain 1h");
  });

  it("falls back to precip when neither component is broken out", () => {
    expect(derivedRoad(pw({ precipMm: 0.6, rainMm: 0, snowMm: 0 }))!.text).toContain("precip 1h");
  });

  it("mentions fog only when nothing fell", () => {
    expect(derivedRoad(pw({ code: 45 }))!.text).toContain("fog");
    // Rain outranks fog: what fell matters more to a road than what you can see.
    expect(derivedRoad(pw({ code: 45, precipMm: 1, rainMm: 1 }))!.text).not.toContain("fog");
  });

  it("says no rain 1h — never dry — when nothing fell", () => {
    const out = derivedRoad(pw())!;
    expect(out.text).toContain("no rain 1h");
    expect(out.text.toLowerCase()).not.toContain("dry");
  });

  it("appends a freezing note without ever claiming ice", () => {
    const out = derivedRoad(pw({ tempC: -2, precipMm: 0.4, rainMm: 0.4 }))!;
    expect(out.text).toContain("≤0°C");
    expect(out.text.toLowerCase()).not.toContain("ic");
  });

  it("says every phrase is derived from air", () => {
    for (const w of [pw(), pw({ snowMm: 1, precipMm: 1 }), pw({ code: 48 }), pw({ tempC: -5 })]) {
      expect(derivedRoad(w)!.text).toContain(DERIVED_MARK);
    }
  });

  it("returns null — not a confident zero — when precipitation is absent entirely", () => {
    const out = derivedRoad(pw({ precipMm: NaN, rainMm: NaN, snowMm: NaN }));
    expect(out).toBeNull();
  });

  it("distinguishes a measured zero from an absent reading", () => {
    expect(derivedRoad(pw({ precipMm: 0, rainMm: 0, snowMm: 0 }))).not.toBeNull();
    expect(derivedRoad(pw({ precipMm: NaN, rainMm: NaN, snowMm: NaN }))).toBeNull();
  });
});

describe("the house rule: a derived claim may never describe a surface", () => {
  // The blanket guard. Every branch of the derived rule, crossed with temperature and
  // weather-code variants, asserted against the banned vocabulary. If someone later
  // "improves" the wording to "wet" or "icy", this is what stops it reaching prod.
  const codes = [0, 3, 45, 48, 61, 71, 95];
  const temps = [-10, -1, 0, 0.1, 12, 30];
  const precip: Array<Partial<PointWeather>> = [
    { precipMm: 0, rainMm: 0, snowMm: 0 },
    { precipMm: 0.4, rainMm: 0.4, snowMm: 0 },
    { precipMm: 1.2, rainMm: 0, snowMm: 1.2 },
    { precipMm: 0.6, rainMm: 0, snowMm: 0 },
  ];

  it("holds across every combination the rule can produce", () => {
    let checked = 0;
    for (const code of codes) {
      for (const tempC of temps) {
        for (const p of precip) {
          const out = derivedRoad(pw({ code, tempC, ...p }));
          if (!out) continue;
          checked += 1;
          expect(out.text, `derived text leaked a surface word: "${out.text}"`).not.toMatch(
            BANNED_IN_DERIVED,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("also holds for the full claim object, not just the phrase", () => {
    for (const tempC of [-5, 5]) {
      const claim = roadClaim(base({ weather: pw({ tempC, precipMm: 0.5, rainMm: 0.5 }) }));
      expect(claim.tier).toBe("derived");
      expect(claim.text).not.toMatch(BANNED_IN_DERIVED);
    }
  });

  it("does NOT ban those words from a measured reading, where they are the operator's", () => {
    const surface: SurfaceReading = { state: "Wet", km: 0, observedAt: NOW - 60_000, station: "Johvi" };
    const claim = roadClaim(base({ surface }));
    expect(claim.tier).toBe("measured");
    expect(claim.text).toContain("Wet"); // the operator's word, and allowed
  });
});

describe("roadClaim — tier selection", () => {
  const fresh: SurfaceReading = { state: "Wet", km: 0, observedAt: NOW - 60_000, station: "Johvi" };

  it("prefers a usable measured reading over the weather", () => {
    const claim = roadClaim(base({ surface: fresh, weather: pw({ precipMm: 5, rainMm: 5 }) }));
    expect(claim.tier).toBe("measured");
    expect(claim.text).toContain("Wet");
    expect(claim.title).toContain("operator's own wording");
  });

  it("shows the station distance once it is a kilometre or more", () => {
    const claim = roadClaim(base({ surface: { ...fresh, km: 6 } }));
    expect(claim.text).toContain("6 km");
  });

  it("omits a sub-kilometre distance as noise", () => {
    expect(roadClaim(base({ surface: { ...fresh, km: 0 } })).text).not.toContain("km");
  });

  it("REFUSES rather than substitutes when the station is too far", () => {
    // Sam's decision, 2026-09-03: cap it and say why. The refusal does NOT fall through
    // to the derived tier, and the tooltip names the reading it declined to show.
    const claim = roadClaim(base({ surface: { ...fresh, km: 36.8 }, weather: pw() }));
    expect(claim.tier).toBe("none");
    expect(claim.text).toBe("no data");
    expect(claim.title).toContain("36.8 km");
    expect(claim.title).toContain("Wet");
  });

  it("refuses when the operator flags the reading stale, and quotes the flag", () => {
    const claim = roadClaim(base({ surface: { ...fresh, operatorFlag: "OVER_2_HOURS" } }));
    expect(claim.tier).toBe("none");
    expect(claim.title).toContain("OVER_2_HOURS");
  });

  it("refuses on a sensor fault and does not repeat a fault as a road state", () => {
    const claim = roadClaim(
      base({ surface: { state: "The sensor has a fault", km: 0, operatorFlag: "The sensor has a fault" } }),
    );
    expect(claim.tier).toBe("none");
    expect(claim.title).toContain("sensor fault");
  });

  it("falls back to derived when the network publishes no reading at all", () => {
    const claim = roadClaim(base({ kind: "webcam", weather: pw({ precipMm: 0.4, rainMm: 0.4 }) }));
    expect(claim.tier).toBe("derived");
    expect(claim.label).toBe("Ground");
    expect(claim.text).toContain("rain 1h");
  });

  it("says no data — never a guess — when the place is unknown", () => {
    const claim = roadClaim(base({ kind: null, weather: pw() }));
    expect(claim.tier).toBe("none");
    expect(claim.text).toBe("no data");
    expect(claim.title).toContain("do not know where");
  });

  it("distinguishes still-loading from genuinely-nothing", () => {
    // Collapsing these would flash a false "no data" on every cold load.
    expect(roadClaim(base({ pending: true })).tier).toBe("pending");
    expect(roadClaim(base({ pending: true })).text).toBe("…");
    expect(roadClaim(base({ kind: null })).tier).toBe("none");
  });

  it("says the weather service failed, rather than pretending it is clear", () => {
    const claim = roadClaim(base({ weatherFailed: true }));
    expect(claim.tier).toBe("none");
    expect(claim.title).toContain("did not answer");
  });
});

describe("weatherChip", () => {
  it("puts the number on the tile and the word in the tooltip", () => {
    const chip = weatherChip(pw({ tempC: 3.4, code: 3 }))!;
    expect(chip.text).toContain("3°C");
    expect(chip.title).toContain("Overcast");
    // The condition word must NOT be on the tile — that is what keeps row 1 narrow.
    expect(chip.text).not.toContain("Overcast");
  });

  it("labels itself model output, not an observation", () => {
    expect(weatherChip(pw())!.title).toContain("not a station reading");
  });

  it("is null with nothing to show", () => {
    expect(weatherChip(undefined)).toBeNull();
  });
});

describe("frameAge — two clocks, two verbs", () => {
  it("says shot when the operator stamped the frame", () => {
    const out = frameAge(new Date(NOW - 3 * 60_000).toISOString(), 300, NOW);
    expect(out.text).toBe("shot 3m");
    expect(out.title).toContain("operator stamped");
  });

  it("says pulled when nobody published a capture time", () => {
    const out = frameAge(undefined, 300, NOW);
    expect(out.text.startsWith("pulled")).toBe(true);
    expect(out.title).toContain("do not know when this frame was taken");
  });

  it("never lets one verb wear the other's meaning", () => {
    const known = frameAge(new Date(NOW - 60_000).toISOString(), 300, NOW);
    const unknown = frameAge(undefined, 300, NOW);
    expect(known.text).not.toContain("pulled");
    expect(unknown.text).not.toContain("shot");
  });

  it("discloses the operator's refresh interval when the capture time is unknown", () => {
    expect(frameAge(undefined, 300, NOW).title).toContain("5 min");
  });
});

describe("overlayDensity", () => {
  it("gives the full two-row overlay only real room", () => {
    expect(overlayDensity(400, 220)).toBe("full");
    expect(overlayDensity(300, 170)).toBe("full");
  });

  it("drops to one row in a narrow tile", () => {
    expect(overlayDensity(260, 150)).toBe("compact");
    expect(overlayDensity(299, 169)).toBe("compact");
  });

  it("hides entirely rather than covering a third of a tiny frame", () => {
    expect(overlayDensity(400, HIDE_BELOW_H - 1)).toBe("hidden");
    expect(overlayDensity(400, 60)).toBe("hidden");
  });
});

describe("shortAge", () => {
  it("scales its unit", () => {
    expect(shortAge(45_000)).toBe("45s");
    expect(shortAge(8 * 60_000)).toBe("8m");
    expect(shortAge(3 * 3600_000)).toBe("3h");
    expect(shortAge(72 * 3600_000)).toBe("3d");
  });
});
