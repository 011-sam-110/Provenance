import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadNotice } from "@/lib/roads/notice";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { readOutcome } from "@/lib/signals/outcome";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import {
  ROADS_GROUP,
  ROAD_CLOSURES_SOURCE,
  ROAD_INCIDENTS_SOURCE,
  ROAD_WORKS_SOURCE,
  roadLayerFeatures,
} from "@/lib/signals/roads-london";
import type { SignalFeature } from "@/lib/signals/types";

// The console's three London road layers, held against three verbatim rows of TfL's
// /Road/all/Disruption answer (27 Oct 2026, 06:19 UTC; tests/fixtures/tfl-road-
// disruptions-mixed.json):
//   TIMS-237054  Works      A12, 7 segments Closed westbound and 13 Open
//   TIMS-236919  Hazards    A243 Hook Road, 12 segments Closed northbound
//   TIMS-237055  Emergency  A1201 Blackstock Road, 7 segments Closed both ways
const MIXED = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));
const NOTICES = normalizeTflNotices(MIXED);

const linesOf = (f: SignalFeature): number =>
  f.geometry?.type === "MultiLineString" ? f.geometry.coordinates.length : f.geometry?.type === "LineString" ? 1 : 0;

/** A notice with no street line, as TfL sends for some: built here, not TfL's data. */
const pointNotice = (over: Partial<RoadNotice>): RoadNotice => ({
  id: "TIMS-POINT",
  kind: "incident",
  category: "Collisions",
  severity: "Moderate",
  lat: 51.5,
  lon: -0.1,
  openLines: [],
  closedLines: [],
  ...over,
});

describe("roadLayerFeatures: one TfL read, three layers", () => {
  const works = roadLayerFeatures(NOTICES, "works");
  const incidents = roadLayerFeatures(NOTICES, "incidents");
  const closures = roadLayerFeatures(NOTICES, "closures");

  it("draws the open stretch of a works notice as dashes", () => {
    expect(works.map((f) => f.id)).toEqual(["tfl:TIMS-237054"]);
    expect(works[0].line).toBe("dash");
    // TfL's 13 open segments, joined end to end into one line (lib/roads/tfl.ts).
    expect(linesOf(works[0])).toBe(1);
    expect(works[0].signalId).toBe("road-works");
  });

  it("draws every street TfL marks Closed as bars, whatever the notice's kind", () => {
    expect(closures.map((f) => f.id)).toEqual(["tfl:TIMS-237054:closed", "tfl:TIMS-236919:closed", "tfl:TIMS-237055:closed"]);
    expect(closures.map(linesOf)).toEqual([1, 1, 1]);
    for (const f of closures) expect(f.line).toBe("bar");
  });

  it("draws a notice whose every street is Closed once, in the closures layer", () => {
    // The burst water main and the police activity close every street they name.
    expect(incidents).toEqual([]);
  });

  it("draws each TfL street once across the three layers", () => {
    // Four streets with segments: the A12's closed and open stretches, Hook Road and
    // Blackstock Road. Each one's segments join into one line.
    const streets = MIXED.flatMap((d: { streets: { segments: unknown[] }[] }) => d.streets).filter(
      (s: { segments: unknown[] }) => s.segments.length > 0,
    ).length;
    const drawn = [...works, ...incidents, ...closures].reduce((n, f) => n + linesOf(f), 0);
    expect(streets).toBe(4);
    expect(drawn).toBe(streets);
  });

  it("is never a solid line", () => {
    for (const f of [...works, ...incidents, ...closures]) expect(["dash", "dot", "bar"]).toContain(f.line);
  });

  it("keeps TfL's words and TfL's own last change", () => {
    expect(closures[0].props).toMatchObject({
      category: "Works",
      subCategory: "Utility works",
      severity: "Minimal",
      closure: "Closed, westbound",
      tflLastChange: "2026-10-27T05:56:23Z",
    });
    expect(closures[0].ts).toBe("2026-10-27T05:56:23Z");
    // The label stops at TfL's postcodes; the dossier keeps the whole location.
    expect(closures[2].title).toBe("Police activity, [A1201] BLACKSTOCK ROAD");
    expect(closures[2].props?.location).toBe("[A1201] BLACKSTOCK ROAD (N4 ,N5 ) (Hackney,Haringey,Islington)");
  });

  it("puts a notice with no street line at TfL's point, in one layer only", () => {
    const crash = pointNotice({});
    const shut = pointNotice({ id: "TIMS-SHUT", closure: "Closed" });
    expect(roadLayerFeatures([crash, shut], "incidents").map((f) => f.id)).toEqual(["tfl:TIMS-POINT"]);
    expect(roadLayerFeatures([crash, shut], "closures").map((f) => f.id)).toEqual(["tfl:TIMS-SHUT:closed"]);
    const [pt] = roadLayerFeatures([crash], "incidents");
    expect(pt.geometry).toBeUndefined();
    expect(pt.line).toBeUndefined();
    expect([pt.lat, pt.lon]).toEqual([51.5, -0.1]);
  });

  it("draws an incident's open streets as dots", () => {
    const n = pointNotice({ openLines: [[[-0.1, 51.5], [-0.11, 51.51]]] });
    const [f] = roadLayerFeatures([n], "incidents");
    expect(f.line).toBe("dot");
    expect(f.geometry).toEqual({ type: "LineString", coordinates: [[-0.1, 51.5], [-0.11, 51.51]] });
  });
});

describe("the three sources", () => {
  const SOURCES = [ROAD_WORKS_SOURCE, ROAD_INCIDENTS_SOURCE, ROAD_CLOSURES_SOURCE];

  it("are map layers in the Roads group, credited to TfL, London only", () => {
    expect(SOURCES.map((s) => s.id)).toEqual(["road-works", "road-incidents", "road-closures"]);
    for (const s of SOURCES) {
      expect(MAP_SIGNALS).toContain(s);
      expect(s.group).toBe(ROADS_GROUP);
      expect(s.precision).toBe("exact");
      expect(s.attribution).toContain("Powered by TfL Open Data");
      expect(s.label).toMatch(/\(London\)$/);
    }
  });

  describe("fetch", () => {
    let calls = 0;
    let clock = Date.now();
    beforeEach(() => {
      calls = 0;
      // Past the shared read's 60 s, so each test asks TfL again.
      clock += 10 * 60_000;
      vi.setSystemTime(clock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it("asks TfL once for the three layers, and dates the data by TfL's newest change", async () => {
      vi.stubGlobal("fetch", async () => {
        calls += 1;
        return new Response(JSON.stringify(MIXED), { status: 200 });
      });
      const [w, i, c] = await Promise.all(SOURCES.map((s) => s.fetch()));
      expect(calls).toBe(1);
      expect([w.length, i.length, c.length]).toEqual([1, 0, 3]);
      const out = readOutcome(c);
      expect(out?.ok).toBe(true);
      expect(out?.sourceAt).toBe(Date.parse("2026-10-27T05:56:23Z"));
    });

    it("says TfL did not answer, and draws nothing invented", async () => {
      vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
      const c = await ROAD_CLOSURES_SOURCE.fetch();
      expect(c).toEqual([]);
      expect(readOutcome(c)).toMatchObject({ ok: false, reason: "TfL did not answer" });
    });
  });
});
