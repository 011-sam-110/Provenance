import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTflNotices } from "@/lib/roads/tfl";
import { linkedCameras, normalizeCastleRock } from "@/lib/roads/castlerock";
import { CASTLEROCK_OPERATORS, ROAD_OPERATORS, TFL_OPERATOR, operatorsAt, roadTitle } from "@/lib/signals/roads";
import {
  CAMERA_ROAD_MAX,
  cameraRoadParam,
  cameraRoadTileWords,
  cameraRoadWords,
  distanceWords,
  linesDistanceM,
  noticeDistanceM,
  parseCameraRoadParam,
  pickCameraRoad,
  type CameraAt,
  type OperatorRead,
} from "@/lib/roads/nearCamera";
import { GET } from "@/app/api/camera-road/route";

// Three verbatim TfL rows (27 Oct 2026, 06:19 UTC) and Castle Rock's recorded rows, so
// the camera's road is held against what the operators really publish. Each camera here
// is placed from the notice's own geometry, not from typed coordinates.

const TFL_ROWS = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));
const NOTICES = normalizeTflNotices(TFL_ROWS);
const CR = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/castlerock-road-events.json"), "utf8"));
const READ_AT = Date.parse("2026-10-27T06:19:00Z");
const NOW = Date.parse("2026-10-27T06:30:00Z");
const TFL: OperatorRead = { operator: "TfL", credit: TFL_OPERATOR.credit, notices: NOTICES, readAt: READ_AT };

const byId = (id: string) => NOTICES.find((n) => n.id === id)!;
const hook = byId("TIMS-236919"); // [A243] HOOK ROAD, closed
const a12 = byId("TIMS-237054"); // [A12] EASTERN AVENUE EAST, one stretch closed, one open
const blackstock = byId("TIMS-237055"); // [A1201] BLACKSTOCK ROAD, closed

const at = (id: string, [lon, lat]: [number, number]): CameraAt => ({ id, lat, lon });

describe("the distance from a camera to a road", () => {
  const line: [number, number][][] = [[[0, 51.5], [0.01, 51.5]]];

  it("is the metres to the nearest point of the line", () => {
    expect(linesDistanceM({ lat: 51.5 + 100 / 111_195, lon: 0.005 }, line)).toBeCloseTo(100, 0);
    // Past the end of the line: to its end point, 0.001 degrees of longitude at 51.5 N.
    expect(linesDistanceM({ lat: 51.5, lon: -0.001 }, line)).toBeCloseTo(69.2, 0);
    expect(linesDistanceM({ lat: 51.5, lon: 0 }, [])).toBe(Infinity);
  });

  it("is to the notice's point when the notice gives no road", () => {
    const d = noticeDistanceM({ lat: 51.5 + 50 / 111_195, lon: 0 }, { lat: 51.5, lon: 0, openLines: [], closedLines: [] });
    expect(d.distanceM).toBeCloseTo(50, 0);
  });
});

describe("the camera's road", () => {
  it("is the nearest notice within 250 m, with its closure where the closed street is by the camera", () => {
    const cam = at("tfl:cam-hook", hook.closedLines[0][0]);
    const road = pickCameraRoad(cam, ["TfL"], [TFL], roadTitle);
    expect(road.state).toBe("notice");
    if (road.state !== "notice") return;
    expect(road.notice).toMatchObject({ title: roadTitle(hook), closure: hook.closure, linked: false, operator: "TfL", distanceM: 0 });
    expect(road.readAt).toBe(READ_AT);
    expect(road.credits).toEqual([TFL_OPERATOR.credit]);

    const words = cameraRoadWords(road, NOW)!;
    expect(words.tone).toBe("closed");
    expect(words.head).toBe(roadTitle(hook));
    expect(words.detail).toBe(`${hook.closure} · Minimal · under 10 m from this camera`);
    expect(words.when).toBe("TfL 05:23 UTC");
  });

  it("does not call an open stretch closed because the same notice closes another", () => {
    // A point on the A12's open stretch more than 300 m from its closed one.
    const open = a12.openLines.flat().find((p) => linesDistanceM({ lat: p[1], lon: p[0] }, a12.closedLines) > 300);
    expect(open).toBeDefined();
    const road = pickCameraRoad(at("tfl:cam-a12", open!), ["TfL"], [TFL], roadTitle);
    expect(road.state).toBe("notice");
    if (road.state !== "notice") return;
    expect(road.notice.title).toBe(roadTitle(a12));
    expect(road.notice.closure).toBeUndefined();
    expect(cameraRoadWords(road, NOW)!.tone).toBe("notice");
  });

  it("says no notice within 250 m, and how far the nearest is when it is within 2 km", () => {
    const [lon, lat] = blackstock.closedLines[0][0];
    const cam = { id: "tfl:cam-east", lat, lon: lon + 0.009 };
    const d = Math.min(...NOTICES.map((n) => noticeDistanceM(cam, n).distanceM));
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(2000);
    const road = pickCameraRoad(cam, ["TfL"], [TFL], roadTitle);
    expect(road).toMatchObject({ state: "none", nearestM: Math.round(d), operators: ["TfL"] });
    const words = cameraRoadWords(road, NOW)!;
    expect(words.head).toBe("No TfL notice within 250 m");
    expect(words.detail).toBe(`nearest ${distanceWords(d)}`);
    expect(cameraRoadTileWords(road, NOW)).toMatchObject({ tone: "none", text: "No TfL notice within 250 m", aside: "" });

    // Westminster is kilometres from all three: no distance is said.
    const far = pickCameraRoad({ id: "tfl:cam-far", lat: 51.5007, lon: -0.1246 }, ["TfL"], [TFL], roadTitle);
    expect(far.state).toBe("none");
    expect("nearestM" in far).toBe(false);
    expect(cameraRoadWords(far, NOW)!.detail).toBe("none within 2.0 km");
  });

  it("puts first the notice the operator links to this camera, however far its point is", () => {
    const rows = CR.fl.Closures;
    const fl = normalizeCastleRock(rows.rows, rows.icons, "Closures", { system: "fl" });
    const linked = fl.find((n) => n.cameras?.includes("castlerock:fl:1696"))!;
    expect(linked.cameras).toEqual(["castlerock:fl:1696", "castlerock:fl:1369"]);
    // Camera 1696's own place, from the same row (I-95 @ MM 376.7 Weigh Station).
    const cam = { id: "castlerock:fl:1696", lat: 30.673691, lon: -81.669561 };
    const op = CASTLEROCK_OPERATORS.find((o) => o.key === "cr-fl")!;
    const read: OperatorRead = { operator: op.name, credit: op.credit, notices: fl, readAt: READ_AT };
    const road = pickCameraRoad(cam, [op.name], [read], roadTitle);
    expect(road.state).toBe("notice");
    if (road.state !== "notice") return;
    expect(road.notice).toMatchObject({ title: roadTitle(linked), linked: true, operator: "Florida DOT (FL511)" });
    expect(cameraRoadWords(road, NOW)!.detail).toContain("Florida DOT (FL511) links this camera to it");
    expect(cameraRoadTileWords(road, NOW)!.aside).toBe("linked");

    // Another camera on the same spot is not linked: only distance can put a notice on it.
    const other = pickCameraRoad({ ...cam, id: "castlerock:fl:9999" }, [op.name], [read], roadTitle);
    if (other.state === "notice") expect(other.notice.linked).toBe(false);
  });

  it("reads a Castle Rock row's camera ids as the camera adapter's ids", () => {
    expect(linkedCameras({ cameraIds: "1696, 1369,1696" }, "fl")).toEqual(["castlerock:fl:1696", "castlerock:fl:1369"]);
    expect(linkedCameras({ cameras: [{ id: 5 }, { id: "x" }, null] }, "on")).toEqual(["castlerock:on:5"]);
    expect(linkedCameras({}, "fl")).toEqual([]);
  });

  it("says nothing where no operator is read, and names the operator that did not answer", () => {
    expect(pickCameraRoad({ id: "hk:1", lat: 22.3, lon: 114.17 }, [], [], roadTitle)).toEqual({ state: "uncovered" });
    expect(cameraRoadWords({ state: "uncovered" }, NOW)).toBeNull();
    expect(cameraRoadTileWords({ state: "uncovered" }, NOW)).toBeNull();
    const down = pickCameraRoad({ id: "tfl:1", lat: 51.5, lon: -0.12 }, ["TfL"], [], roadTitle);
    expect(down).toEqual({ state: "unread", operators: ["TfL"] });
    expect(cameraRoadWords(down, NOW)!.head).toBe("TfL did not answer");
  });

  it("never says a speed", () => {
    const cam = at("tfl:cam-hook", hook.closedLines[0][0]);
    const words = cameraRoadWords(pickCameraRoad(cam, ["TfL"], [TFL], roadTitle), NOW)!;
    expect(Object.values(words).join(" ")).not.toMatch(/km\/h|mph|speed|flow|traffic is/i);
  });
});

describe("the words for a distance", () => {
  it("round to 10 m, and to 0.1 km past 1 km", () => {
    expect(distanceWords(4)).toBe("under 10 m");
    expect(distanceWords(74)).toBe("70 m");
    expect(distanceWords(1234)).toBe("1.2 km");
  });
});

describe("the operators a camera's road reads", () => {
  it("are the ones whose area holds the camera, and none in Hong Kong", () => {
    const names = (lat: number, lon: number) => operatorsAt(lat, lon).map((o) => o.name);
    expect(names(51.5, -0.12)).toEqual(["TfL"]);
    expect(names(49.28, -123.12)).toEqual(["DriveBC"]);
    expect(names(60.17, 24.94)).toEqual(["Fintraffic"]);
    expect(names(28.54, -81.38)).toEqual(["Florida DOT (FL511)"]);
    expect(names(22.3, 114.17)).toEqual([]);
  });

  it("each has a real box", () => {
    for (const op of ROAD_OPERATORS) {
      const [w, s, e, n] = op.area;
      expect(w, op.name).toBeLessThan(e);
      expect(s, op.name).toBeLessThan(n);
    }
  });
});

describe("GET /api/camera-road", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the cameras from c=lat,lon,id and asks no operator for a camera none covers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cam = { id: "hk:TD/K109F", lat: 22.30951, lon: 114.16516 };
    expect(parseCameraRoadParam(cameraRoadParam(cam))).toEqual(cam);
    expect(parseCameraRoadParam("95,0,x")).toBeNull();
    expect(parseCameraRoadParam("nonsense")).toBeNull();
    const url = `https://x/api/camera-road?c=${encodeURIComponent(cameraRoadParam(cam))}&c=bad`;
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ roads: { [cam.id]: { state: "uncovered" } } });
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(CAMERA_ROAD_MAX).toBe(40);
  });
});
