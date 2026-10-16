import { describe, expect, it, test } from "vitest";
// A REAL capture of IODA /v2/outages/events?entityType=country (2026-10-16 19:35 UTC,
// 24 h window, untrimmed). 69 events: 52 of them are one ping-slash24 burst that
// started in 52 countries at 2026-10-15 22:20 UTC (IODA's prober restarting), most
// of the rest had ended many hours before the capture, and four were still in
// progress: Papua New Guinea (bgp), Armenia (bgp), Lithuania (gtr), Barbados (bgp).
import fixture from "@/tests/fixtures/ioda-events-country.json";
import {
  BURST_RULE,
  dropProberBursts,
  eventState,
  groupOutages,
  groupSeverity,
  INTERNET_OUTAGES_SOURCE,
  normalizeOutages,
  outageBand,
  outageMagnitude,
  payloadUntil,
  type IodaEvent,
  type IodaEventsPayload,
} from "@/lib/signals/internet-outages";
import { rowMetric } from "@/lib/console/signals/signalCard";

const payload = fixture as IodaEventsPayload;
const UNTIL = payloadUntil(payload);

describe("the captured day", () => {
  it("drops the prober burst and every event that is over", () => {
    const out = normalizeOutages(payload);
    expect(out.map((f) => f.id).sort()).toEqual(["ioda:AM", "ioda:BB", "ioda:LT", "ioda:PG"]);
    expect(out.every((f) => f.props?.state === "ongoing")).toBe(true);
  });

  it("reads the query's own `until`, not the clock", () => {
    expect(UNTIL).toBe(1792179355);
  });

  it("removes the 22:20 ping-slash24 bin, except where BGP agrees", () => {
    const events = payload.data ?? [];
    const bin = Math.floor(Date.UTC(2026, 9, 15, 22, 20) / 1000 / BURST_RULE.binSec);
    const inBurst = events.filter(
      (e) => e.datasource === "ping-slash24" && Math.floor((e.start ?? 0) / BURST_RULE.binSec) === bin,
    );
    expect(inBurst.length).toBe(52);
    const kept = dropProberBursts(events);
    // Barbados is the one survivor: a BGP event was running there through the same
    // hours, so a second vantage point corroborates its probe drop.
    expect(kept.filter((e) => inBurst.includes(e)).map((e) => e.location)).toEqual(["country/BB"]);
    expect(kept.length).toBe(events.length - 51);
  });

  it("names the datasource and says when it started", () => {
    const lt = normalizeOutages(payload).find((f) => f.id === "ioda:LT")!;
    expect(lt.props?.datasources).toBe("gtr");
    expect(lt.props?.agreeing).toBe(1);
    expect(lt.props?.startedAt).toBe("2026-10-10T02:00:00.000Z");
    expect(lt.ts).toBe("2026-10-10T02:00:00.000Z");
    expect(lt.countryIso3).toBe("LTU");
  });
});

const ev = (location: string, datasource: string, start: number, duration: number, score = 1000): IodaEvent => ({
  location,
  location_name: location,
  datasource,
  start,
  duration,
  score,
});

describe("dropProberBursts", () => {
  const T = 1_800_000_000 - (1_800_000_000 % 600);

  it("keeps a burst event that another datasource corroborates at the same place", () => {
    const burst = Array.from({ length: 12 }, (_, i) => ev(`country/X${i}`, "ping-slash24", T + 30, 3600));
    const bgp = ev("country/X3", "bgp", T + 600, 600);
    const kept = dropProberBursts([...burst, bgp]);
    expect(kept.map((e) => `${e.location}:${e.datasource}`).sort()).toEqual(["country/X3:bgp", "country/X3:ping-slash24"]);
  });

  it("leaves a small cluster alone: nine places in one bin is not a burst", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ev(`country/X${i}`, "ping-slash24", T, 600));
    expect(dropProberBursts(nine)).toHaveLength(9);
  });

  it("never drops another datasource, however many places it hits", () => {
    const bgp = Array.from({ length: 20 }, (_, i) => ev(`country/X${i}`, "bgp", T, 600));
    expect(dropProberBursts(bgp)).toHaveLength(20);
  });
});

describe("eventState", () => {
  const until = 1_800_000_000;
  it("is ongoing when the event runs to the end of the window", () => {
    expect(eventState(ev("country/A", "bgp", until - 3600, 3600), until)).toBe("ongoing");
  });
  it("is recovering for two hours after it ends", () => {
    expect(eventState(ev("country/A", "bgp", until - 7200, 3600), until)).toBe("recovering");
  });
  it("is old news after that", () => {
    expect(eventState(ev("country/A", "bgp", until - 20_000, 3600), until)).toBeNull();
  });
});

describe("severity", () => {
  it("grows with the number of datasources that agree", () => {
    expect(groupSeverity({ score: 10, datasources: ["bgp"] })).toBe("localised");
    expect(groupSeverity({ score: 10, datasources: ["bgp", "ping-slash24"] })).toBe("elevated");
    expect(groupSeverity({ score: 10, datasources: ["bgp", "merit-nt", "ping-slash24"] })).toBe("severe");
  });
  it("still lets an extreme score speak for one datasource", () => {
    expect(groupSeverity({ score: 5e10, datasources: ["bgp"] })).toBe("severe");
  });
  it("groups two datasources at one place into one marker", () => {
    const until = 1_800_000_000;
    const groups = groupOutages(
      [ev("country/AM", "bgp", until - 600, 600), ev("country/AM", "ping-slash24", until - 1200, 1200)],
      until,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].datasources).toEqual(["bgp", "ping-slash24"]);
    expect(groups[0].startedAt).toBe(until - 1200);
  });
});

test("an unknown country code is skipped, not placed", () => {
  const until = 1_800_000_000;
  const out = normalizeOutages({ data: [ev("country/ZZ", "bgp", until - 60, 60)] }, until);
  expect(out).toEqual([]);
});

test("declares a readable metric and rowMetric resolves it", () => {
  const out = normalizeOutages(payload);
  const f = out[0];
  // The metric points at a real finite numeric prop. It USED to point at the raw
  // upstream score, which is unitless and unbounded — see the block at the bottom.
  // The raw score is still carried in props for the dossier.
  expect(INTERNET_OUTAGES_SOURCE.metric).toEqual({ field: "magnitude", domain: [0, 10] });
  expect(typeof f.props?.outageScore).toBe("number");
  const resolved = rowMetric(f, INTERNET_OUTAGES_SOURCE.metric);
  expect(resolved).toBeDefined();
  expect(resolved!.value).toBe(Number(f.props?.magnitude));
  expect(resolved!.value).toBeGreaterThanOrEqual(0);
  expect(resolved!.value).toBeLessThanOrEqual(10);
});

// ---------------------------------------------------------------------------
// The metric drives the monitor bar AND the number the anomaly widget prints, so
// it has to be readable. It was `outageScore` — unitless, unbounded, with live
// values around 5.7e10 against a declared ceiling of 100,000. The first row of
// the flagship "What's abnormal" widget read
// "Internet outages (IODA) · 56780505874", and three separate auditors flagged it
// independently.
// ---------------------------------------------------------------------------
describe("what the widget prints", () => {
  it("keeps the magnitude inside its declared domain at real-world scores", () => {
    // Measured live on 2026-08-10: Côte d'Ivoire 57,727,616,804.
    for (const score of [0, 1, 5_000, 100_000, 57_727_616_804, Number.MAX_SAFE_INTEGER]) {
      const m = outageMagnitude(score);
      expect(m, `score ${score}`).toBeGreaterThanOrEqual(0);
      expect(m, `score ${score}`).toBeLessThanOrEqual(10);
    }
  });

  it("keeps the ordering the raw score had", () => {
    expect(outageMagnitude(1e10)).toBeGreaterThan(outageMagnitude(1e7));
    expect(outageMagnitude(1e7)).toBeGreaterThan(outageMagnitude(1e3));
  });

  it("bands against the scale the upstream actually emits", () => {
    expect(outageBand(57_727_616_804)).toBe("severe");
    expect(outageBand(5e7)).toBe("elevated");
    expect(outageBand(1_000)).toBe("localised");
  });
});

// ---------------------------------------------------------------------------
// Regions. `ioda-events-region.json` is a REAL capture of the same endpoint with
// entityType=region (2026-10-16 19:36 UTC), TRIMMED from 813 events to 90: every
// event that was current or ended within two hours (50), plus the first 40 of the
// 602 ping-slash24 events in the 2026-10-15 22:20 burst bin.
// ---------------------------------------------------------------------------
import regionFixture from "@/tests/fixtures/ioda-events-region.json";
import { normalizeRegionOutages } from "@/lib/signals/internet-outages";
import { iodaRegion } from "@/lib/signals/ioda-regions.data";

describe("region outages", () => {
  const regions = normalizeRegionOutages(regionFixture as IodaEventsPayload);

  it("places each current regional event in its region, as an area", () => {
    expect(regions).toHaveLength(46);
    expect(regions.every((f) => f.id.startsWith("ioda-region:") && f.precision === "area")).toBe(true);
    const balu = regions.find((f) => f.id === "ioda-region:3082")!;
    expect(balu.title).toBe("Internet outage — Baluchistan, Pakistan");
    expect(balu.props?.region).toBe("Baluchistan");
    expect(balu.props?.country).toBe("Pakistan");
    // Inside Balochistan, not on Pakistan's country centroid (30, 70).
    expect(balu.lat).toBeCloseTo(28.32, 1);
    expect(balu.lon).toBeCloseTo(65.87, 1);
  });

  it("drops the 22:20 burst bin here too", () => {
    const burstStart = 1792102800;
    const fromBurst = regions.filter((f) => f.props?.startedAt === new Date(burstStart * 1000).toISOString());
    expect(fromBurst).toEqual([]);
  });

  it("never gives a region the country outline to shade", () => {
    expect(regions.every((f) => f.countryIso3 === undefined)).toBe(true);
  });

  it("skips a region id the table does not hold", () => {
    const until = 1_800_000_000;
    expect(iodaRegion("region/999999")).toBeUndefined();
    expect(normalizeRegionOutages({ data: [ev("region/999999", "bgp", until - 60, 60)] }, until)).toEqual([]);
  });
});
