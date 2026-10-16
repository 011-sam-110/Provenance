import { describe, expect, it } from "vitest";
// DERIVED from a REAL capture: Pulse's keyless CSV export
// (pulse.internetsociety.org/shutdowns/download/, 2026-10-16 19:50 UTC, 978 rows),
// trimmed to the 12 rows that were running or ended after 2026-10-02, and rewritten
// into the JSON shape of the keyed API (/shutdowns → { data: ShutdownSummary[] },
// Pulse OpenAPI v1.1.0). Same fields, same values: the CSV and the API share the
// schema, and the key is not ours to use for a capture.
import fixture from "@/tests/fixtures/pulse-shutdowns.json";
import {
  isVerifiedShutdown,
  matchPulseRegion,
  normalizePulse,
  PULSE_CREDIT,
  type PulseShutdown,
} from "@/lib/signals/pulse-shutdowns";

const NOW = Date.parse("2026-10-16T19:00:00Z");
const out = normalizePulse(fixture as { data: PulseShutdown[] }, NOW);

describe("normalizePulse", () => {
  it("keeps network shutdowns that are running or ended this week, never content blocking", () => {
    // 12 rows: the 6 content-blocking rows (GA, UG, TG, RU, MM, CN) are out, and so is
    // the Delhi shutdown of 2026-10-02, which ended 14 days before NOW.
    expect(out.every((f) => f.props?.shutdownType !== "content blocking")).toBe(true);
    expect(out.map((f) => f.id).sort()).toEqual([
      "pulse:1721433600:GQ",
      "pulse:1731628800:PK",
      "pulse:1739876400:IQ",
      "pulse:1754409600:PK",
      "pulse:1791554400:IN",
    ]);
  });

  it("drops a shutdown that ended more than a week ago", () => {
    // Delhi, 2026-10-02 01:00 to 13:00: 14 days before NOW.
    expect(out.find((f) => f.id === "pulse:1790902800:IN")).toBeUndefined();
  });

  it("places a regional shutdown inside the region Pulse names", () => {
    const delhi = out.find((f) => f.id === "pulse:1791554400:IN")!;
    expect(delhi.title).toBe("Internet shutdown (ended) — Delhi, India");
    expect(delhi.precision).toBe("area");
    expect(delhi.props?.region).toBe("Delhi");
    expect(delhi.props?.endedAt).toBe("2026-10-10T14:00:00.000Z");
    expect(delhi.countryIso3).toBeUndefined();
  });

  it("keeps an unmatched region at country level, without shading the country", () => {
    // "Balochistan" is spelled "Baluchistan" in the region table; no fuzzy match.
    const pk = out.find((f) => f.id === "pulse:1754409600:PK")!;
    expect(pk.precision).toBe("country");
    expect(pk.countryIso3).toBeUndefined();
    expect(pk.title).toBe("Internet shutdown — Pakistan");
    expect(pk.props?.affectedRegions).toBe("Balochistan");
  });

  it("carries Pulse's required credit on every pin", () => {
    expect(out.every((f) => f.props?.source === PULSE_CREDIT)).toBe(true);
    expect(PULSE_CREDIT).toBe("Provided by Internet Society");
  });

  it("rates a verified shutdown above an unconfirmed one", () => {
    const iq = out.find((f) => f.id === "pulse:1739876400:IQ")!; // acknowledged
    const gq = out.find((f) => f.id === "pulse:1721433600:GQ")!; // unconfirmed
    expect(iq.props?.severity).toBe("severe");
    expect(gq.props?.severity).toBe("elevated");
    expect(isVerifiedShutdown(iq)).toBe(true);
    expect(isVerifiedShutdown(gq)).toBe(false);
  });

  it("lets only a national shutdown shade its country", () => {
    const national = normalizePulse(
      { data: [{ country: "IQ", start_date: "2026-10-16T03:20:00+00:00", end_date: null, type: "national", verification_level: "acknowledged", cause: "exams", affected_regions: "", affected_services: [] }] },
      NOW,
    );
    expect(national).toHaveLength(1);
    expect(national[0].countryIso3).toBe("IRQ");
    expect(national[0].props?.affectedRegions).toBe("whole country");
    expect(national[0].props?.cause).toBe("exams");
  });
});

describe("matchPulseRegion", () => {
  it("matches a whole region name inside Pulse's text, in that country only", () => {
    expect(matchPulseRegion("IN", "National Capital Territory of Delhi")?.name).toBe("Delhi");
    expect(matchPulseRegion("PK", "Delhi")).toBeUndefined();
    expect(matchPulseRegion("IN", "")).toBeUndefined();
  });
});
