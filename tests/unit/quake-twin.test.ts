import { describe, expect, test } from "vitest";
import fixture from "@/tests/fixtures/quake-twin.rows.json";
import {
  QUAKE_LAYER_NAME,
  TWIN_MAX_KM,
  TWIN_MAX_MAG_DIFF,
  TWIN_MAX_SECONDS,
  findQuakeTwin,
  quakeFacts,
  quakeTwinView,
  twinLayerOf,
  twinLines,
  type FeedState,
  type QuakeFacts,
} from "@/lib/signals/quakeTwin";
import type { SignalFeature } from "@/lib/signals/types";

// Rows are VERBATIM from the two live layers (see _about in the fixture), so the
// cases below are the shapes production actually serves: two catalogues listing the
// same event seconds apart, a US swarm, a Hawaiian pair that fits two entries.
const USGS = fixture.usgs as unknown as SignalFeature[];
const EMSC = fixture.emsc as unknown as SignalFeature[];
const byId = (rows: SignalFeature[], id: string) => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`fixture lacks ${id}`);
  return r;
};
const usgs = (id: string) => byId(USGS, `usgs:${id}`);
const emsc = (id: string) => byId(EMSC, `emsc:${id}`);
const facts = (f: SignalFeature) => quakeFacts(f);

describe("findQuakeTwin — the same event in the other catalogue", () => {
  test("a USGS event finds its EMSC entry, seconds and a few km apart", () => {
    const v = findQuakeTwin(facts(usgs("us6000u0ws")), EMSC, USGS);
    expect(v.kind).toBe("match");
    if (v.kind !== "match") return;
    expect(v.twin.id).toBe("emsc:20261008_0000096");
    expect(v.seconds).toBeLessThan(1);
    expect(v.km).toBeLessThan(10);
    expect(v.magDiff).toBe(0);
  });

  test("the other way round: an EMSC event finds its USGS entry", () => {
    const v = findQuakeTwin(facts(emsc("20261008_0000096")), USGS, EMSC);
    expect(v.kind === "match" && v.twin.id).toBe("usgs:us6000u0ws");
  });

  test("an event USGS lists as an explosion still pairs: the match is about the event, not its label", () => {
    expect(usgs("nn00925437").props?.type).toBe("explosion");
    const v = findQuakeTwin(facts(usgs("nn00925437")), EMSC, USGS);
    expect(v.kind === "match" && v.twin.id).toBe("emsc:20261007_0000323");
  });

  test("it keeps the twin's credited network, because a catalogue can carry the other's solution", () => {
    const v = findQuakeTwin(facts(usgs("tx2026tueaim")), EMSC, USGS);
    expect(v.kind === "match" && v.twin.props?.agency).toBe("NEIC");
  });

  test("with two entries inside the rule it takes the closer one, not the first listed", () => {
    const twin = emsc("20261008_0000096");
    const farther = { ...twin, id: "emsc:farther", lat: twin.lat + 0.2, ts: new Date(Date.parse(twin.ts as string) + 60_000).toISOString() };
    for (const pool of [[farther, twin], [twin, farther]]) {
      const v = findQuakeTwin(facts(usgs("us6000u0ws")), pool, []);
      expect(v.kind === "match" && v.twin.id).toBe(twin.id);
    }
  });

  test("a swarm does not cross-pair: two quakes 3.5 minutes apart each get their own twin", () => {
    const a = findQuakeTwin(facts(usgs("tx2026tueaim")), EMSC, USGS);
    const b = findQuakeTwin(facts(usgs("tx2026tuedbl")), EMSC, USGS);
    expect(a.kind === "match" && a.twin.id).toBe("emsc:20261008_0000024");
    expect(b.kind === "match" && b.twin.id).toBe("emsc:20261008_0000028");
  });
});

describe("findQuakeTwin — when it must not claim", () => {
  test("an entry that two events could both claim goes to the closer one; the other is not matched", () => {
    // EMSC 0000097 fits USGS hv75052082 (same second, same place) and also
    // hv75052077 (90 s earlier, 40 km away). Only the first is its twin.
    const near = findQuakeTwin(facts(usgs("hv75052082")), EMSC, USGS);
    expect(near.kind === "match" && near.twin.id).toBe("emsc:20261008_0000097");
    const far = findQuakeTwin(facts(usgs("hv75052077")), EMSC, USGS);
    expect(far.kind).toBe("ambiguous");
  });

  test("nothing fits inside the span the other list covers: 'none', not a verdict about the event", () => {
    const v = findQuakeTwin(facts(emsc("20261008_0000235")), USGS, EMSC); // M3.3 off Western Australia
    expect(v.kind).toBe("none");
  });

  test("an event older than the oldest row of the other list is 'outside': that list cannot speak to it", () => {
    const v = findQuakeTwin(facts(emsc("20261007_0000100")), USGS, EMSC); // 07:00 on the 7th; USGS starts 18:33
    expect(v.kind).toBe("outside");
  });

  test("an event newer than the newest row of the other list is 'outside' too: that list may just be behind", () => {
    const behind = EMSC.filter((e) => Date.parse(e.ts as string) <= Date.parse("2026-10-08T17:00:00Z"));
    const v = findQuakeTwin(facts(usgs("ci41345159")), behind, USGS); // 18:11
    expect(v.kind).toBe("outside");
  });

  test("an empty other list says nothing", () => {
    expect(findQuakeTwin(facts(usgs("us6000u0ws")), [], USGS).kind).toBe("outside");
  });

  test("a subject with no time or a non-finite place cannot be compared", () => {
    const base = facts(usgs("us6000u0ws"));
    expect(findQuakeTwin({ ...base, ts: undefined }, EMSC, USGS).kind).toBe("unusable");
    expect(findQuakeTwin({ ...base, ts: "not a date" }, EMSC, USGS).kind).toBe("unusable");
    expect(findQuakeTwin({ ...base, lat: Number.NaN }, EMSC, USGS).kind).toBe("unusable");
  });
});

describe("findQuakeTwin — the tolerances", () => {
  const base: QuakeFacts = facts(usgs("us6000u0ws"));
  const twin = emsc("20261008_0000096");
  const t0 = Date.parse(twin.ts as string);
  const at = (secs: number): QuakeFacts => ({ ...base, ts: new Date(t0 + secs * 1000).toISOString() });

  test("the time limit is TWIN_MAX_SECONDS from the twin's own time, both sides", () => {
    expect(findQuakeTwin(at(TWIN_MAX_SECONDS - 1), [twin], []).kind).toBe("match");
    expect(findQuakeTwin(at(-(TWIN_MAX_SECONDS - 1)), [twin], []).kind).toBe("match");
    // Past the limit the list still covers the moment only if other rows bracket it.
    const bracket = [{ ...twin, id: "emsc:early", ts: new Date(t0 - 3_600_000).toISOString(), lat: 0, lon: 0 }, twin, { ...twin, id: "emsc:late", ts: new Date(t0 + 3_600_000).toISOString(), lat: 0, lon: 0 }];
    expect(findQuakeTwin(at(TWIN_MAX_SECONDS + 5), bracket, []).kind).toBe("none");
  });

  test("the distance limit is TWIN_MAX_KM", () => {
    const degPerKm = 1 / 111.19;
    const moved = (km: number): QuakeFacts => ({ ...facts(twin), ts: twin.ts as string, lat: twin.lat + km * degPerKm, magnitude: base.magnitude });
    expect(findQuakeTwin(moved(TWIN_MAX_KM - 2), [twin], []).kind).toBe("match");
    const bracket = [{ ...twin, id: "emsc:early", ts: new Date(t0 - 3_600_000).toISOString() }, twin, { ...twin, id: "emsc:late", ts: new Date(t0 + 3_600_000).toISOString() }];
    expect(findQuakeTwin(moved(TWIN_MAX_KM + 2), bracket.map((r) => (r === twin ? r : { ...r, lat: 0, lon: 0 })), []).kind).toBe("none");
  });

  test("the numbers themselves are pinned: changing the rule is a decision, and it needs a new measurement", () => {
    // Chosen from one live snapshot (see the header of lib/signals/quakeTwin.ts).
    expect([TWIN_MAX_SECONDS, TWIN_MAX_KM, TWIN_MAX_MAG_DIFF]).toEqual([120, 60, 0.8]);
  });

  test("longitude counts toward the distance: an entry 100 km east at the same moment is not the twin", () => {
    const east = { ...twin, lon: twin.lon + 100 / (111.19 * Math.cos((twin.lat * Math.PI) / 180)) };
    expect(findQuakeTwin({ ...base, ts: twin.ts as string }, [east], []).kind).not.toBe("match");
  });

  test("the distance is measured across the antimeridian, not around the world", () => {
    const west = { ...twin, lat: 0, lon: 179.9 };
    const east = { ...twin, lat: 0, lon: -179.9 }; // 22 km away, on the other side of the 180th meridian
    const subject: QuakeFacts = { lat: 0, lon: 179.9, ts: twin.ts as string, magnitude: twin.props?.magnitude as number };
    expect(findQuakeTwin(subject, [east], []).kind).toBe("match");
    expect(findQuakeTwin({ ...subject, lon: -179.9 }, [west], []).kind).toBe("match");
  });

  test("the magnitude limit is TWIN_MAX_MAG_DIFF", () => {
    const m = (d: number): QuakeFacts => ({ ...base, ts: twin.ts as string, magnitude: (twin.props?.magnitude as number) + d });
    expect(findQuakeTwin(m(TWIN_MAX_MAG_DIFF - 0.05), [twin], []).kind).toBe("match");
    expect(findQuakeTwin(m(TWIN_MAX_MAG_DIFF + 0.1), [twin], []).kind).not.toBe("match");
  });

  test("a magnitude of 0 is 'unknown' (the adapters turn a missing one into 0), so it neither blocks nor decides", () => {
    expect(findQuakeTwin({ ...base, magnitude: 0 }, [twin], []).kind).toBe("match");
    const zeroTwin = { ...twin, props: { ...twin.props, magnitude: 0 } };
    const v = findQuakeTwin(base, [zeroTwin], []);
    expect(v.kind === "match" && v.magDiff).toBe(null);
  });
});

describe("twinLayerOf", () => {
  test("pairs the two quake layers and nothing else", () => {
    expect(twinLayerOf("earthquakes")).toBe("emsc-quakes");
    expect(twinLayerOf("emsc-quakes")).toBe("earthquakes");
    expect(twinLayerOf("gdacs")).toBeUndefined();
    expect(twinLayerOf(undefined)).toBeUndefined();
    expect(twinLayerOf("constructor")).toBeUndefined();
    expect(twinLayerOf("toString")).toBeUndefined();
  });
});

describe("quakeTwinView — what the panel is allowed to say", () => {
  const ready = (features: SignalFeature[]): FeedState => ({ features, status: "idle", updatedAt: 1, ok: true });
  const subject = facts(usgs("tx2026tueaim"));

  test("a layer with no pair shows nothing", () => {
    expect(quakeTwinView("gdacs", subject, ready(EMSC), ready(USGS)).kind).toBe("hidden");
  });

  test("before either list has loaded once it says it is checking, and claims nothing", () => {
    const loading: FeedState = { features: [], status: "loading", updatedAt: null, ok: true };
    expect(quakeTwinView("earthquakes", subject, loading, ready(USGS)).kind).toBe("checking");
    expect(quakeTwinView("earthquakes", subject, ready(EMSC), loading).kind).toBe("checking");
    // The hook starts "idle" with no features before its effect runs.
    const fresh: FeedState = { features: [], status: "idle", updatedAt: null, ok: true };
    expect(quakeTwinView("earthquakes", subject, fresh, ready(USGS)).kind).toBe("checking");
  });

  test("a failed read of either list is 'unavailable', even when stale rows are still held: no claim from old data", () => {
    const failed: FeedState = { features: EMSC, status: "error", updatedAt: 1, ok: false };
    expect(quakeTwinView("earthquakes", subject, failed, ready(USGS)).kind).toBe("unavailable");
    expect(quakeTwinView("earthquakes", subject, ready(EMSC), { ...ready(USGS), status: "error", ok: false }).kind).toBe("unavailable");
  });

  test("a refresh that failed after a good read is 'unavailable' too: the feed keeps its old rows and reports ok:false, status idle", () => {
    // What useSignalFeed holds after a declared failure: last-good rows, status "idle", ok false.
    const stale: FeedState = { ...ready(EMSC), ok: false };
    expect(quakeTwinView("earthquakes", subject, stale, ready(USGS)).kind).toBe("unavailable");
    expect(quakeTwinView("earthquakes", subject, ready(EMSC), { ...ready(USGS), ok: false }).kind).toBe("unavailable");
  });

  test("the status alone also withdraws the claim, whatever ok says (the pure function does not lean on the hook's invariant)", () => {
    const odd: FeedState = { ...ready(EMSC), status: "error" };
    expect(quakeTwinView("earthquakes", subject, odd, ready(USGS)).kind).toBe("unavailable");
    expect(quakeTwinView("earthquakes", subject, ready(EMSC), { ...ready(USGS), status: "error" }).kind).toBe("unavailable");
  });

  test("a first read that failed (nothing ever loaded) is 'unavailable', not 'checking' forever", () => {
    const never: FeedState = { features: [], status: "error", updatedAt: null, ok: false };
    expect(quakeTwinView("earthquakes", subject, never, ready(USGS)).kind).toBe("unavailable");
  });

  test("with both lists read it returns the verdict", () => {
    const v = quakeTwinView("earthquakes", subject, ready(EMSC), ready(USGS));
    expect(v.kind).toBe("match");
  });
});

describe("twinLines — the words", () => {
  const ready = (features: SignalFeature[]): FeedState => ({ features, status: "idle", updatedAt: 1, ok: true });

  test("a match names the other catalogue, the gap, and who it credits", () => {
    const view = quakeTwinView("earthquakes", facts(usgs("tx2026tueaim")), ready(EMSC), ready(USGS));
    const l = twinLines(view, "earthquakes");
    expect(l?.headline).toMatch(/^Also listed by EMSC: M3\.6, \d+ s and [\d.]+ km from this one\.$/);
    expect(l?.note).toContain("EMSC credits NEIC");
    expect(l?.caveat).toMatch(/not independent confirmation/);
  });

  test("seen from EMSC the note names the USGS event id, not an author", () => {
    const view = quakeTwinView("emsc-quakes", facts(emsc("20261008_0000096")), ready(USGS), ready(EMSC));
    const l = twinLines(view, "emsc-quakes");
    expect(l?.headline).toMatch(/^Also listed by USGS: M5\.5/);
    expect(l?.note).toBe("USGS event us6000u0ws.");
  });

  test("'none' states the rule it used and does not claim the event is unique to this list", () => {
    const view = quakeTwinView("emsc-quakes", facts(emsc("20261008_0000235")), ready(USGS), ready(EMSC));
    const l = twinLines(view, "emsc-quakes");
    expect(l?.headline).toBe(
      `No matching event in the USGS list (within ${TWIN_MAX_SECONDS / 60} min, ${TWIN_MAX_KM} km, ${TWIN_MAX_MAG_DIFF} magnitude).`,
    );
    expect(l?.headline).not.toMatch(/only|unique|not confirmed/i);
  });

  test("the other states have one plain line each, and 'hidden' has none", () => {
    expect(twinLines({ kind: "outside" }, "earthquakes")?.headline).toBe("Outside the span of the EMSC list, so not compared.");
    expect(twinLines({ kind: "ambiguous" }, "earthquakes")?.headline).toBe("No single EMSC event can be matched to this one.");
    expect(twinLines({ kind: "unavailable" }, "earthquakes")?.headline).toBe("Could not read EMSC to compare.");
    expect(twinLines({ kind: "checking" }, "earthquakes")).toBeNull();
    expect(twinLines({ kind: "hidden" }, "earthquakes")).toBeNull();
    expect(twinLines({ kind: "unusable" }, "earthquakes")).toBeNull();
    expect(QUAKE_LAYER_NAME).toEqual({ earthquakes: "USGS", "emsc-quakes": "EMSC" });
  });
});
