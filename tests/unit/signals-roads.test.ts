import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadNotice } from "@/lib/roads/notice";
import { normalizeTflNotices, TFL_DISRUPTIONS_URL } from "@/lib/roads/tfl";
import { DRIVEBC_EVENTS_URL, normalizeOpen511 } from "@/lib/roads/open511";
import { NSW_FEEDS, nswFeedUrl } from "@/lib/roads/nsw";
import { digitrafficUrl } from "@/lib/roads/digitraffic";
import { readOutcome } from "@/lib/signals/outcome";
import { MAP_SIGNALS } from "@/lib/signals/registry";
import {
  CASTLEROCK_OPERATORS,
  DRIVEBC_OPERATOR,
  ROADS_GROUP,
  notAnswered,
  ROAD_CLOSURES_SOURCE,
  ROAD_INCIDENTS_SOURCE,
  ROAD_WORKS_SOURCE,
  roadLayerFeatures,
} from "@/lib/signals/roads";
import type { SignalFeature } from "@/lib/signals/types";

// The console's three road layers, held against three verbatim rows of TfL's
// /Road/all/Disruption answer (27 Oct 2026, 06:19 UTC; tests/fixtures/tfl-road-
// disruptions-mixed.json):
//   TIMS-237054  Works      A12, 7 segments Closed westbound and 13 Open
//   TIMS-236919  Hazards    A243 Hook Road, 12 segments Closed northbound
//   TIMS-237055  Emergency  A1201 Blackstock Road, 7 segments Closed both ways
const MIXED = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));
const NOTICES = normalizeTflNotices(MIXED);
// Four verbatim DriveBC Open511 events, 27 Oct 2026 07:56 UTC (see roads-open511.test.ts).
const BC = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/drivebc-open511-events.json"), "utf8"));
// Four verbatim Live Traffic NSW hazards, 27 Oct 2026 08:15 UTC (see roads-nsw.test.ts):
// a closed roadwork and a closed road with lines, an ended incident, a flood with a line.
const NSW = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/nsw-live-traffic-hazards.json"), "utf8"));
const EMPTY = { type: "FeatureCollection", features: [] };
// Five verbatim Digitraffic messages, 27 Oct 2026 08:24 UTC (see roads-digitraffic.test.ts):
// a closed road work, a point road work, a lane-closure road work, a closed-road accident
// report, and a general announcement with a line.
const FI = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/digitraffic-traffic-messages.json"), "utf8"));

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
      agency: "TfL",
      category: "Works",
      subCategory: "Utility works",
      severity: "Minimal",
      closure: "Closed, westbound",
      lastChange: "2026-10-27T05:56:23Z",
    });
    expect(closures[0].link).toBe("https://tfl.gov.uk/traffic/status/");
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

  it("are map layers in the Roads group, credited to each operator", () => {
    expect(SOURCES.map((s) => s.id)).toEqual(["road-works", "road-incidents", "road-closures"]);
    expect(SOURCES.map((s) => s.label)).toEqual(["Roadworks", "Road incidents", "Road closures"]);
    expect(SOURCES[0].attribution).toContain("Contains data from Transport for NSW (Live Traffic NSW), Creative Commons Attribution");
    expect(SOURCES[0].attribution).toContain("Contains data from Fintraffic / Digitraffic, licensed under CC BY 4.0");
    for (const s of SOURCES) {
      expect(MAP_SIGNALS).toContain(s);
      expect(s.group).toBe(ROADS_GROUP);
      expect(s.precision).toBe("exact");
      expect(s.attribution).toContain("Powered by TfL Open Data");
      expect(s.attribution).toContain("Contains information licensed under the Open Government Licence - British Columbia");
    }
  });

  it("keeps a failure reason short", () => {
    expect(notAnswered(["TfL", "DriveBC"])).toBe("TfL and DriveBC did not answer");
    const many = ["Transport for NSW (roadwork, incident, flood)", "Florida DOT (FL511)", "Georgia DOT (511GA)"];
    expect(notAnswered(many)).toBe("Transport for NSW (roadwork, incident, flood) and 2 more did not answer");
    expect(notAnswered(["x".repeat(70), "y"])).toBe("2 road operators did not answer");
  });

  it("names and links each DriveBC row as DriveBC's", () => {
    const [f] = roadLayerFeatures(normalizeOpen511(BC), "closures", DRIVEBC_OPERATOR);
    expect(f.id).toBe("bc:drivebc.ca/RIDE-102273:closed");
    expect(f.props).toMatchObject({ agency: "DriveBC", closure: "Closed, both directions" });
    expect(f.link).toBe("https://www.drivebc.ca/");
  });

  describe("fetch", () => {
    let calls = 0;
    let clock = Date.now();
    beforeEach(() => {
      calls = 0;
      // Past every file's shared read (Digitraffic's road works: 10 min), so each test
      // asks every operator again.
      clock += 20 * 60_000;
      vi.setSystemTime(clock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    /**
     * Answers every operator from the fixtures; `down` names what does not answer: "tfl",
     * "bc", "fi", "cr" (every Castle Rock system), "nsw" (all six NSW files) or
     * "nsw-<file>" (one of them). Castle Rock answers with empty lists.
     */
    const answer = (down: string[] = []) =>
      vi.stubGlobal("fetch", async (url: string) => {
        calls += 1;
        const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (url === TFL_DISRUPTIONS_URL && !down.includes("tfl")) return ok(MIXED);
        if (url === DRIVEBC_EVENTS_URL && !down.includes("bc")) return ok(BC);
        if (/\/List\/GetData\/|\/map\/mapIcons\//.test(url) && !down.includes("cr")) {
          return ok(url.includes("/List/GetData/") ? { data: [], recordsTotal: 0 } : { item2: [] });
        }
        if (url === digitrafficUrl("ROAD_WORK") && !down.includes("fi")) return ok(FI.roadWork);
        if (url === digitrafficUrl("TRAFFIC_ANNOUNCEMENT") && !down.includes("fi")) return ok(FI.announcement);
        for (const feed of NSW_FEEDS) {
          if (url === nswFeedUrl(feed) && !down.includes("nsw") && !down.includes(`nsw-${feed}`)) return ok(NSW[feed] ?? EMPTY);
        }
        return new Response("", { status: 503 });
      });

    it("asks each operator's files once for the three layers, and dates the data by the newest change", async () => {
      answer();
      const [w, i, c] = await Promise.all(SOURCES.map((s) => s.fetch()));
      // TfL 1, DriveBC 1, Live Traffic NSW 6, Digitraffic 2, and per Castle Rock list one
      // page and one map-points request.
      const castleRockLists = CASTLEROCK_OPERATORS.reduce((n, op) => n + op.feeds.length, 0);
      expect(castleRockLists).toBe(24);
      expect(calls).toBe(10 + 2 * castleRockLists);
      // Works: the A12's open stretch, DriveBC's night work on Highway 99, and two Finnish
      // road works. Incidents: DriveBC's washout, the NSW flood, and Fintraffic's general
      // announcement. Closures: TfL's three, DriveBC's two, NSW's two, Fintraffic's two.
      expect([w.length, i.length, c.length]).toEqual([4, 3, 9]);
      const out = readOutcome(c);
      expect(out?.ok).toBe(true);
      // The newest change of all: Fintraffic's accident report.
      expect(out?.sourceAt).toBe(Date.parse("2026-10-27T07:49:57.166Z"));
    });

    it("keeps the other operators' notices when one does not answer, and says which", async () => {
      answer(["bc"]);
      const c = await ROAD_CLOSURES_SOURCE.fetch();
      expect(c.map((f) => f.id.split(":")[0])).toEqual(["tfl", "tfl", "tfl", "nsw", "nsw", "fi", "fi"]);
      expect(readOutcome(c)).toMatchObject({ ok: false, reason: "DriveBC did not answer" });
    });

    it("names the one file of an operator that did not answer", async () => {
      answer(["nsw-flood"]);
      const i = await ROAD_INCIDENTS_SOURCE.fetch();
      expect(i.map((f) => f.id.split(":")[0])).toEqual(["bc", "fi"]);
      expect(readOutcome(i)).toMatchObject({ ok: false, reason: "Transport for NSW (flood) did not answer" });
    });

    it("says no operator answered, and draws nothing invented", async () => {
      answer(["tfl", "bc", "nsw", "fi", "cr"]);
      const c = await ROAD_CLOSURES_SOURCE.fetch();
      expect(c).toEqual([]);
      // Thirteen operators do not fit in a short reason, so it names the first.
      expect(readOutcome(c)).toMatchObject({ ok: false, reason: "TfL and 12 more did not answer" });
    });
  });
});
