import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPE_REQUESTS } from "@/lib/sources/adsb";
import { aircraftDetail } from "@/lib/eye/detail";
import type { Aircraft } from "@/lib/eye/traffic";
import { EYE_PLANE_CAP, EYE_PLANES_EVERY_MS, eyePlanesBody } from "@/lib/eye/planes";
import { MAX_SPAN } from "@/lib/eye/vessels";
import { clearPlanePool, notePlanePool, readPlanePool } from "@/lib/planes/pool";
import {
  HEIGHT_CAP_SHARE,
  METRES_PER_FOOT,
  MIN_DRAWN_PX,
  PLAIN_MODELS,
  depthAlongView,
  drawnHeightM,
  drawnPlaneLengthM,
  plainModelFor,
  planeModelFile,
  planeModelFor,
  viewGeometry,
} from "@/lib/eye/planeModels";
import { PLANE_MODEL_IDS, PLANE_TYPES } from "@/lib/eye/planeTypes.data";
import type { WorldObject } from "@/lib/world";

/**
 * The God's eye view's aircraft models: which model a plane gets, that each model agrees with its
 * published figures, how high and how long it is drawn, the packed files, the area feed, and the
 * source rules that keep the layer cheap. The gate runs this file; the layer in a browser is
 * tests/e2e/eye-plane-models.spec.ts (it is not).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

interface Figures {
  lengthM?: number;
  spanM?: number;
  heightM?: number;
  engines?: number;
  wing?: string;
  tail?: string;
  engine?: string;
  classCode?: string;
  source?: string;
  override?: Omit<Figures, "override"> | null;
}
interface Shape {
  arch: "jet" | "biz" | "prop" | "light" | "heli";
  eng?: number[];
  rear?: object;
  tailEng?: object;
  noseProp?: number;
  wingZ?: string;
  tail?: string;
  blades?: number;
  basis?: "overall";
}
const DIMENSIONS = JSON.parse(read("scripts/plane-models/dimensions.json")) as Record<string, Figures>;
const SHAPES = JSON.parse(read("scripts/plane-models/shapes.json")) as { models: Record<string, Shape>; closest: Record<string, string> };
const figures = (code: string): Figures => ({ ...DIMENSIONS[code], ...(DIMENSIONS[code]?.override ?? {}) });
const engineCount = (s: Shape) => 2 * (s.eng?.length ?? 0) + (s.rear ? 2 : 0) + (s.tailEng ? 1 : 0) + (s.noseProp ? 1 : 0);
const ASKED_FOR = TYPE_REQUESTS.flat();

describe("which model a plane gets", () => {
  it("has a row for every type code the pull asks for, and none it does not", () => {
    expect(ASKED_FOR.length).toBeGreaterThan(200);
    expect(Object.keys(PLANE_TYPES).sort()).toEqual([...new Set(ASKED_FOR)].sort());
  });

  it("draws every asked-for code with a model that exists", () => {
    for (const c of ASKED_FOR) {
      const choice = planeModelFor({ typeCode: c });
      expect(choice.named, c).toBe(true);
      expect(PLANE_MODEL_IDS, c).toContain(choice.model);
      expect(choice.lengthM, c).toBeGreaterThan(0);
    }
  });

  it("gives the type's own length, not its model's, to a type drawn with a close model", () => {
    const close = Object.entries(SHAPES.closest).filter(([c]) => !PLANE_TYPES[c].borrowed);
    expect(close.length).toBeGreaterThan(100);
    for (const [c, model] of close) {
      expect(PLANE_TYPES[c].model).toBe(model);
      expect(PLANE_TYPES[c].lengthM, c).toBe(figures(c).lengthM);
    }
  });

  it("reads the code as the feed sends it, in any case and with spaces", () => {
    expect(planeModelFor({ typeCode: "b738" }).model).toBe("B738");
    expect(planeModelFor({ typeCode: " A388 " }).model).toBe("A388");
  });

  it("never gives a named model to a type it does not hold", () => {
    for (const typeCode of [undefined, "", "   ", "ZZZZ", "B73", "B7388", "XXXX"]) {
      const choice = planeModelFor({ typeCode });
      expect(choice.named, String(typeCode)).toBe(false);
      expect(PLAIN_MODELS as readonly string[]).toContain(choice.model);
      // No length: the layer draws it at the floor size, a mark and not a measurement.
      expect(choice.lengthM).toBe(0);
    }
  });

  it("picks the plain model from the class label alone", () => {
    expect(plainModelFor("Helicopter")).toBe("plain-heli");
    expect(plainModelFor("Light")).toBe("plain-light");
    expect(plainModelFor("Airliner")).toBe("plain-jet");
    expect(plainModelFor("Regional")).toBe("plain-jet");
    expect(plainModelFor(undefined)).toBe("plain-jet");
    expect(planeModelFor({ typeCode: "ZZZZ", classLabel: "Helicopter" }).model).toBe("plain-heli");
  });
});

describe("every row has a source", () => {
  it("holds one row per asked-for code, each naming where its figures came from", () => {
    expect(Object.keys(DIMENSIONS).sort()).toEqual([...new Set(ASKED_FOR)].sort());
    for (const [c, row] of Object.entries(DIMENSIONS)) {
      // A person's correction names its own source.
      if (row.override) expect(row.override.source, c).toMatch(/^https:\/\//);
      const own = row.override?.source ?? row.source;
      // No page was found for a few codes: they state no figure of their own and borrow their model's.
      if (own) expect(own, c).toMatch(/^https:\/\//);
      else {
        expect(PLANE_TYPES[c].borrowed, c).toBe(true);
        expect(figures(PLANE_TYPES[c].model).source, c).toMatch(/^https:\/\//);
      }
    }
  });

  it("marks a length as borrowed exactly when the code has none of its own", () => {
    for (const [c, row] of Object.entries(PLANE_TYPES)) {
      expect(Boolean(row.borrowed), c).toBe(figures(c).lengthM == null);
      if (row.borrowed) expect(row.lengthM, c).toBe(figures(row.model).lengthM);
      else expect(row.lengthM, c).toBe(figures(c).lengthM);
    }
  });

  it("states lengths an aircraft can have", () => {
    for (const [c, row] of Object.entries(PLANE_TYPES)) {
      expect(row.lengthM, c).toBeGreaterThan(5);
      // The An-225 is 84 m, and nothing the pull asks for is longer.
      expect(row.lengthM, c).toBeLessThan(85);
    }
  });

  it("lists exactly the codes that have a model of their own, or a closest model, once each", () => {
    const own = Object.keys(SHAPES.models);
    const close = Object.keys(SHAPES.closest);
    expect(own.filter((c) => close.includes(c))).toEqual([]);
    expect([...own, ...close].sort()).toEqual(Object.keys(DIMENSIONS).sort());
    expect([...PLANE_MODEL_IDS].sort()).toEqual([...own].sort());
    for (const model of Object.values(SHAPES.closest)) expect(own).toContain(model);
  });
});

describe("each model agrees with its published figures", () => {
  const fixedWing = Object.entries(SHAPES.models).filter(([, s]) => s.arch !== "heli");
  const helis = Object.entries(SHAPES.models).filter(([, s]) => s.arch === "heli");

  it("has as many engines as the type", () => {
    for (const [c, s] of fixedWing) {
      const n = figures(c).engines;
      if (n != null) expect(engineCount(s), c).toBe(n);
    }
  });

  it("gives a type drawn with a close model the same number of engines", () => {
    for (const [c, model] of Object.entries(SHAPES.closest)) {
      const shape = SHAPES.models[model];
      const n = figures(c).engines;
      if (shape.arch !== "heli" && n != null) expect(engineCount(shape), `${c} as ${model}`).toBe(n);
    }
  });

  it("never draws a helicopter as a plane, or a plane as a helicopter", () => {
    for (const [c, model] of Object.entries(SHAPES.closest)) {
      const cls = figures(c).classCode;
      if (cls) expect(SHAPES.models[model].arch === "heli", `${c} as ${model}`).toBe(cls.startsWith("H"));
    }
    for (const [c] of helis) {
      const cls = figures(c).classCode;
      if (cls) expect(cls.startsWith("H"), c).toBe(true);
    }
  });

  it("puts the wing where the type has it", () => {
    for (const [c, s] of fixedWing) {
      const wing = figures(c).wing ?? "";
      if (wing.includes("High")) expect(s.wingZ, c).toBe("high");
      if (wing.includes("Low")) expect(s.wingZ, c).not.toBe("high");
    }
  });

  it("gives the tail the type has", () => {
    for (const [c, s] of fixedWing) {
      const tail = figures(c).tail ?? "";
      if (tail.startsWith("T-tail")) expect(s.tail, c).toBe("T");
      if (tail.startsWith("Cruciform")) expect(s.tail, c).toBe("cruci");
      // "Regular tail, high set" is how EUROCONTROL's Citation Excel row says a tailplane part way up the fin.
      if (/^Regular tail(?!, high set)/.test(tail)) expect(["T", "cruci"], c).not.toContain(s.tail);
    }
  });

  it("hangs the engines where the type has them", () => {
    for (const [c, s] of fixedWing) {
      const engine = figures(c).engine ?? "";
      if (engine.includes("rear fuselage")) expect(s.rear, c).toBeDefined();
      if (engine.startsWith("Underwing")) expect(s.rear, c).toBeUndefined();
      if (engine.startsWith("Nose")) expect(s.noseProp, c).toBeDefined();
      if (s.noseProp && engine) expect(engine, c).toMatch(/^Nose/);
    }
  });

  it("gives a helicopter the main rotor its row names", () => {
    const WORDS: Record<string, number> = { Two: 2, Three: 3, Four: 4, Five: 5, Six: 6 };
    for (const [c, s] of helis) {
      const word = /^(Two|Three|Four|Five|Six)-blade main rotor/.exec(figures(c).wing ?? "")?.[1];
      if (word) expect(s.blades, c).toBe(WORDS[word]);
    }
  });
});

/** The opening view of a preset, on an 800 px high window. */
const VIEW = { heightPx: 800, fovDeg: 36.87, zoom: 16, lat: 51.5, pitchDeg: 60, bearingDeg: 0 };

describe("what the camera can see", () => {
  it("puts the camera behind and above the view's centre, on the side away from the bearing", () => {
    const v = viewGeometry(VIEW);
    expect(v.camera.up).toBeGreaterThan(100);
    expect(v.camera.north).toBeLessThan(0);
    expect(Math.abs(v.camera.east)).toBeLessThan(1e-6);
    expect(v.cameraHeightM).toBeCloseTo(v.camera.up, 6);
    // Forward is a unit vector, pointing down and north.
    expect(Math.hypot(v.forward.east, v.forward.north, v.forward.up)).toBeCloseTo(1, 9);
    expect(v.forward.up).toBeLessThan(0);
    expect(v.forward.north).toBeGreaterThan(0);
  });

  it("turns with the bearing", () => {
    const east = viewGeometry({ ...VIEW, bearingDeg: 90 });
    expect(east.camera.east).toBeLessThan(0);
    expect(Math.abs(east.camera.north)).toBeLessThan(1e-6);
  });

  it("measures the depth of the view's centre as the camera's distance from it", () => {
    const v = viewGeometry(VIEW);
    const distance = Math.hypot(v.camera.east, v.camera.north, v.camera.up);
    expect(depthAlongView(v, 0, 0, 0)).toBeCloseTo(distance, 6);
    // Straight above the camera is behind it.
    expect(depthAlongView(v, v.camera.east, v.camera.north, v.camera.up + 500)).toBeLessThan(0);
  });

  it("goes higher as the map zooms out", () => {
    expect(viewGeometry({ ...VIEW, zoom: 12 }).cameraHeightM).toBeCloseTo(viewGeometry(VIEW).cameraHeightM * 16, 6);
  });
});

describe("how high a plane is drawn", () => {
  const CAMERA_M = 500;
  const CAP = CAMERA_M * HEIGHT_CAP_SHARE;

  it("is its reported height while that is under the cap, with no note", () => {
    expect(drawnHeightM(0, CAMERA_M)).toEqual({ heightM: 0, note: null });
    expect(drawnHeightM(500, CAMERA_M)).toEqual({ heightM: 500 * METRES_PER_FOOT, note: null });
  });

  it("is the cap above that, and says it was lowered", () => {
    expect(drawnHeightM(37_000, CAMERA_M)).toEqual({ heightM: CAP, note: "lowered" });
  });

  it("is the cap with no altitude sent, and says so differently", () => {
    expect(drawnHeightM(null, CAMERA_M)).toEqual({ heightM: CAP, note: "unsent" });
    expect(drawnHeightM(Number.NaN, CAMERA_M)).toEqual({ heightM: CAP, note: "unsent" });
  });

  it("does not sink a plane below the ground for a negative altitude", () => {
    expect(drawnHeightM(-200, CAMERA_M).heightM).toBe(0);
  });

  it("keeps every drawn plane in front of a camera at the opening view", () => {
    const v = viewGeometry(VIEW);
    const { heightM } = drawnHeightM(37_000, v.cameraHeightM);
    expect(depthAlongView(v, 0, 0, heightM)).toBeGreaterThan(0);
    expect(heightM).toBeLessThan(v.cameraHeightM);
  });
});

describe("how long a plane is drawn", () => {
  const v = viewGeometry(VIEW);
  const pxPerMetre = (depth: number) => v.focalPx / depth;

  it("is its true length once that is longer than the floor", () => {
    const depth = 300;
    expect(pxPerMetre(depth) * 39.47).toBeGreaterThan(MIN_DRAWN_PX);
    expect(drawnPlaneLengthM(39.47, depth, v, MIN_DRAWN_PX)).toBe(39.47);
  });

  it("is never under the floor in px at its depth", () => {
    const depth = 20_000;
    const drawn = drawnPlaneLengthM(39.47, depth, v, MIN_DRAWN_PX);
    expect(drawn * pxPerMetre(depth)).toBeCloseTo(MIN_DRAWN_PX, 6);
  });

  it("draws an unknown type at the floor itself", () => {
    const depth = 1000;
    expect(drawnPlaneLengthM(0, depth, v, MIN_DRAWN_PX) * pxPerMetre(depth)).toBeCloseTo(MIN_DRAWN_PX, 6);
  });
});

/** The JSON chunk of a .glb. */
function glb(path: string) {
  const data = readFileSync(resolve(ROOT, path));
  expect(data.subarray(0, 4).toString("latin1")).toBe("glTF");
  const length = data.readUInt32LE(12);
  const doc = JSON.parse(data.subarray(20, 20 + length).toString("utf8")) as {
    nodes: { name?: string; mesh?: number; children?: number[]; scale?: number[] }[];
    meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
    accessors: { count: number; min?: number[]; max?: number[] }[];
    extensionsUsed?: string[];
  };
  return { bytes: data.length, doc };
}

function lodMesh(doc: ReturnType<typeof glb>["doc"], name: string) {
  const parent = doc.nodes.find((n) => n.name === name);
  expect(parent, `node ${name}`).toBeDefined();
  const holder = parent!.mesh != null ? parent! : doc.nodes[parent!.children![0]];
  const prim = doc.meshes[holder.mesh!].primitives[0];
  expect(prim.indices, `${name} is indexed`).toBeDefined();
  const position = doc.accessors[prim.attributes.POSITION];
  const scale = holder.scale ?? [1, 1, 1];
  return {
    tris: doc.accessors[prim.indices!].count / 3,
    attributes: Object.keys(prim.attributes),
    lengthAlongZ: (position.max![2] - position.min![2]) * scale[2],
  };
}

describe("the packed models", () => {
  const dir = "public/models/planes";
  const ALL = [...PLANE_MODEL_IDS, ...PLAIN_MODELS];

  it("are exactly the types' models and the plain ones, and nothing else is in the folder", () => {
    expect(readdirSync(resolve(ROOT, dir)).sort()).toEqual(ALL.map((m) => `${m}.glb`).sort());
    expect(planeModelFile("B738")).toBe("/models/planes/B738.glb");
  });

  for (const model of ALL) {
    it(`${model}.glb has lod0 and lod1, meshopt, vertex colours, length 1, and fits its budgets`, () => {
      const { bytes, doc } = glb(`${dir}/${model}.glb`);
      expect(doc.extensionsUsed).toContain("EXT_meshopt_compression");
      const lod0 = lodMesh(doc, "lod0");
      const lod1 = lodMesh(doc, "lod1");
      expect(lod0.tris).toBeGreaterThan(0);
      expect(lod0.tris).toBeLessThanOrEqual(1200);
      expect(lod1.tris).toBeGreaterThan(0);
      expect(lod1.tris).toBeLessThanOrEqual(250);
      for (const m of [lod0, lod1]) {
        expect(m.attributes).toContain("COLOR_0");
        expect(m.attributes).toContain("POSITION");
        expect(m.attributes).not.toContain("NORMAL");
        expect(m.attributes).not.toContain("TEXCOORD_0");
      }
      // The layer scales a model by its length in metres, so a file must be one long. A helicopter
      // measured along its fuselage has a true rotor, which runs past the nose.
      const shape = SHAPES.models[model];
      const rotorPastTheNose = model === "plain-heli" || (shape?.arch === "heli" && shape.basis !== "overall");
      if (rotorPastTheNose) {
        expect(lod0.lengthAlongZ).toBeGreaterThanOrEqual(0.999);
        expect(lod0.lengthAlongZ).toBeLessThan(1.3);
      } else {
        expect(lod0.lengthAlongZ).toBeCloseTo(1, 3);
        expect(lod1.lengthAlongZ).toBeLessThanOrEqual(1.001);
        // A helicopter's far level has fewer blades, so it reaches less far.
        expect(lod1.lengthAlongZ).toBeGreaterThan(0.8);
      }
      expect(bytes).toBeLessThanOrEqual(12 * 1024);
    });
  }

  it("weigh at most 500 KB together, and one view fetches only the types it shows", () => {
    const total = ALL.reduce((sum, m) => sum + statSync(resolve(ROOT, `${dir}/${m}.glb`)).size, 0);
    expect(total).toBeLessThanOrEqual(500 * 1024);
  });

  it("are recorded in docs/IMAGE-LICENSES.md, with what is measured and what is judged", () => {
    const licences = read("docs/IMAGE-LICENSES.md");
    const section = licences.slice(licences.indexOf(`## Aircraft models (${ALL.length})`));
    expect(section).toContain(`## Aircraft models (${ALL.length})`);
    expect(section).toContain("scripts/plane-models/build.py");
    expect(section).toContain("scripts/plane-models/dimensions.json");
    expect(section).toMatch(/estimated by this project/i);
    for (const f of ["build.py", "pack.mjs", "dimensions.json", "shapes.json", "gen-types.mjs", "fetch-dimensions.mjs"]) {
      expect(existsSync(resolve(ROOT, "scripts/plane-models", f)), f).toBe(true);
    }
  });

  it("keep the build's raw output out of git", () => {
    expect(read("scripts/plane-models/.gitignore")).toContain(".raw/");
  });
});

const plane = (id: string, lat: number, lon: number): WorldObject =>
  ({ id, kind: "aircraft", lat, lon, label: id, meta: {} }) as unknown as WorldObject;

describe("the area feed", () => {
  const BOX: [number, number, number, number] = [-1, 51, 1, 52];
  const NOW = 1_800_000_000_000;
  const inside = plane("in", 51.5, 0);
  const outside = plane("out", 40, 10);
  const sample = plane("sampled", 51.6, 0.1);

  it("serves the whole pool for the box, not the sample", () => {
    const body = eyePlanesBody({
      box: BOX,
      clamped: false,
      snapshot: { planes: [sample], fetchedAt: NOW },
      pool: { objects: [inside, outside], fetchedAt: NOW },
    });
    expect(body.ok).toBe(true);
    expect(body.sampled).toBe(false);
    expect(body.planes.map((p) => p.id)).toEqual(["in"]);
    expect(body.count).toBe(1);
    expect(body.fetchedAt).toBe(NOW);
  });

  it("falls back on the sample, and says so, when the process has no pool", () => {
    const body = eyePlanesBody({ box: BOX, clamped: false, snapshot: { planes: [sample, outside], fetchedAt: NOW }, pool: null });
    expect(body.sampled).toBe(true);
    expect(body.planes.map((p) => p.id)).toEqual(["sampled"]);
  });

  it("passes over a pool older than the snapshot", () => {
    const body = eyePlanesBody({
      box: BOX,
      clamped: false,
      snapshot: { planes: [sample], fetchedAt: NOW },
      pool: { objects: [inside], fetchedAt: NOW - 1 },
    });
    expect(body.sampled).toBe(true);
    expect(body.planes.map((p) => p.id)).toEqual(["sampled"]);
    expect(body.fetchedAt).toBe(NOW);
  });

  it("serves nothing when the snapshot was withheld as too old, whatever the pool holds", () => {
    const body = eyePlanesBody({
      box: BOX,
      clamped: false,
      snapshot: { planes: [], staleness: { reason: "too-old" } as never },
      pool: { objects: [inside], fetchedAt: NOW },
    });
    expect(body.ok).toBe(false);
    expect(body.planes).toEqual([]);
  });

  it("says when no pull has succeeded yet", () => {
    const body = eyePlanesBody({ box: BOX, clamped: false, snapshot: { planes: [] }, pool: null });
    expect(body.ok).toBe(false);
    expect(body.fetchedAt).toBeUndefined();
  });

  it("keeps the 500 nearest the middle of the box, and says how many it heard", () => {
    const objects = Array.from({ length: EYE_PLANE_CAP + 40 }, (_, i) => plane(`p${i}`, 51 + (i / (EYE_PLANE_CAP + 40)) * 0.5, 0));
    const body = eyePlanesBody({ box: BOX, clamped: false, snapshot: { planes: [], fetchedAt: NOW }, pool: { objects, fetchedAt: NOW } });
    expect(body.count).toBe(EYE_PLANE_CAP);
    expect(body.coverage.capped).toBe(true);
    expect(body.coverage.available).toBe(EYE_PLANE_CAP + 40);
    // The ones furthest from 51.5 are the low-numbered ones.
    expect(body.planes.map((p) => p.id)).not.toContain("p0");
    expect(body.planes.map((p) => p.id)).toContain(`p${EYE_PLANE_CAP + 39}`);
  });

  it("asks again on the pull's own clock", () => {
    expect(EYE_PLANES_EVERY_MS).toBe(90_000);
    expect(read("lib/sources/opensky.ts")).toMatch(/REVALIDATE_S = 90\b/);
  });
});

describe("the pool", () => {
  beforeEach(() => clearPlanePool());

  it("is empty until a pull notes one, and each pull replaces the last whole", () => {
    expect(readPlanePool()).toBeNull();
    notePlanePool([plane("a", 1, 1)], 10);
    notePlanePool([plane("b", 2, 2)], 20);
    expect(readPlanePool()?.fetchedAt).toBe(20);
    expect(readPlanePool()?.objects.map((p) => p.id)).toEqual(["b"]);
  });

  it("is filled by the pull, from what it held before the cap", () => {
    const src = code("lib/sources/opensky.ts");
    expect(src).toContain("notePlanePool(merged.objects, snapshot.fetchedAt!)");
  });

  it("is held in memory and writes no file: /privacy says nothing this site serves writes one", () => {
    const src = code("lib/planes/pool.ts");
    expect(src).not.toMatch(/writeFile|node:fs|from "fs"/);
  });
});

describe("the route", () => {
  it("answers a missing or bad box with a 400, and asks adsb.lol for nothing", async () => {
    vi.resetModules();
    const fetchAircraftSnapshot = vi.fn(async () => ({ planes: [], fetchedAt: 1 }));
    vi.doMock("@/lib/sources/opensky", () => ({ fetchAircraftSnapshot }));
    const { GET } = await import("@/app/api/eye/planes/route");
    expect((await GET(new Request("http://x/api/eye/planes"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/eye/planes?bbox=nonsense"))).status).toBe(400);
    expect(fetchAircraftSnapshot).not.toHaveBeenCalled();

    clearPlanePool();
    const res = await GET(new Request("http://x/api/eye/planes?bbox=-0.123456,51.5,-0.1,51.51"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { box: number[]; sampled: boolean };
    // Snapped outward to the 0.01 degree grid, as /privacy says.
    expect(body.box[0]).toBeCloseTo(-0.13, 9);
    expect(body.box[2]).toBeCloseTo(-0.1, 9);
    expect(body.sampled).toBe(true);
    expect(fetchAircraftSnapshot).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/sources/opensky");
  });

  it("cuts a wide box down about its centre, and says it did", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sources/opensky", () => ({ fetchAircraftSnapshot: async () => ({ planes: [], fetchedAt: 1 }) }));
    const { GET } = await import("@/app/api/eye/planes/route");
    const res = await GET(new Request("http://x/api/eye/planes?bbox=-20,30,20,60"));
    const body = (await res.json()) as { box: number[]; clamped: boolean };
    expect(body.clamped).toBe(true);
    expect(body.box[2] - body.box[0]).toBeLessThanOrEqual(MAX_SPAN.lon + 1e-9);
    expect(body.box[3] - body.box[1]).toBeLessThanOrEqual(MAX_SPAN.lat + 1e-9);
    vi.doUnmock("@/lib/sources/opensky");
  });

  it("reads the box and nothing else from the request", () => {
    const src = code("app/api/eye/planes/route.ts");
    expect(src).toContain('searchParams.get("bbox")');
    expect(src).not.toMatch(/req\.headers|req\.json|req\.text|cookies\(|headers\(\)/);
    expect(src).not.toMatch(/console\.(log|warn|error|info)/);
  });

  it("makes no request of its own, so adsb.lol's small bucket is not touched", () => {
    for (const f of ["app/api/eye/planes/route.ts", "lib/eye/planes.ts", "lib/planes/pool.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/\bfetch\(/);
      expect(src, f).not.toContain("hostLane");
    }
  });
});

describe("the details panel", () => {
  const A = {
    id: "ae1234",
    hex: "ae1234",
    lat: 51.5,
    lon: 0,
    rot: 90,
    feet: 37_000,
    callsign: "BAW1",
    ageMs: 1000,
  } as unknown as Aircraft;
  const groups = (drawn: "lowered" | "unsent" | null) => JSON.stringify(aircraftDetail(A, 2_000, 1_000, drawn));

  it("says a plane is drawn lower than its real height, and keeps the real height", () => {
    const text = groups("lowered");
    expect(text).toContain("Drawn lower than its real height");
    expect(text).toContain("37,000");
  });

  it("says when it sent no height at all", () => {
    expect(groups("unsent")).toContain("Drawn at the highest this view shows");
  });

  it("says nothing about the map when the plane is where it reported", () => {
    const text = groups(null);
    expect(text).not.toContain("Drawn lower");
    expect(text).not.toContain("Drawn at the highest");
  });
});

describe("the layer's source rules", () => {
  const layer = "components/eye/planeLayer.ts";

  it("loads three.js only by dynamic import", () => {
    const src = code(layer);
    expect(src).toContain('import("three")');
    expect(src).toMatch(/import type \* as THREE from "three"/);
    for (const line of src.split("\n")) {
      expect(/^\s*import\s+(?!type\b)[^"']*from\s+["']three(\/[^"']*)?["']/.test(line), line.trim()).toBe(false);
    }
  });

  it("never asks the map for a repaint inside render: that would keep it from ever going idle", () => {
    const src = code(layer);
    const from = src.indexOf("render(context, args)");
    expect(from).toBeGreaterThan(0);
    const body = src.slice(from, src.indexOf("stats()", from));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toContain("triggerRepaint");
    expect(src).toContain("map.triggerRepaint()");
  });

  it("is reached from the God's eye view alone, so / and /app load no three.js for it", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${name.name}`;
        if (name.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name.name) && /planeLayer"/.test(read(p))) importers.push(p);
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    expect(importers).toEqual(["components/eye/EyeOverlay.tsx"]);
  });

  it("is a custom layer in 3d, and the Planes switch hides it with the chevrons", () => {
    const src = code(layer);
    expect(src).toContain('export const PLANE_LAYER_ID = "eye-plane-models"');
    expect(src).toContain('type: "custom"');
    expect(src).toContain('renderingMode: "3d"');
    const overlay = code("components/eye/EyeOverlay.tsx");
    const hide = overlay.slice(overlay.indexOf("const applyHidden"), overlay.indexOf("const ensureLayers"));
    expect(hide).toContain("PLANE_LAYER_ID");
    expect(hide).toContain('hid.has("planes")');
  });

  it("falls back to the chevrons: a failed layer is removed and not made again", () => {
    const overlay = code("components/eye/EyeOverlay.tsx");
    expect(overlay).toContain(`next === "failed" && map.getLayer(PLANE_LAYER_ID)`);
    expect(overlay).toContain('planeState.current !== "failed"');
  });

  it("asks for the aircraft by box, not for the worldwide sample", () => {
    const overlay = code("components/eye/EyeOverlay.tsx");
    expect(overlay).toContain("/api/eye/planes?bbox=");
    expect(overlay).not.toContain('"/api/planes"');
  });
});
