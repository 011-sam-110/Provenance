import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EYE_LIGHT, HEIGHT_RAMP } from "@/lib/eye/look";
import { shipTypeLabel } from "@/lib/signals/aisDigitraffic";
import {
  LENGTH_RANGE_M,
  LOD1_BELOW_PX,
  MIN_DRAWN_PX,
  STOPPED_TINT,
  VESSEL_MODEL_CLASSES,
  VESSEL_MODEL_FILES,
  VESSEL_PALETTE,
  drawnLengthM,
  hullRadiusPx,
  mercator,
  metresPerMercatorUnit,
  modelClassFor,
  placement,
  plausibleLengthM,
  pxPerMetreAt,
  sunDirection,
} from "@/lib/eye/vesselModels";

/**
 * The God's eye view's vessel models: which model a vessel gets, how big and where it is
 * drawn, the ten packed files, their licence rows, and the two source rules that keep the
 * layer cheap (three.js only by dynamic import, no repaint inside `render`). The gate runs
 * this file; the layer in a browser is tests/e2e/eye-vessel-models.spec.ts (it is not).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("which model a vessel gets", () => {
  it("maps every AIS type code from 0 to 99 to a class, and only codes 70 to 79 to cargo", () => {
    for (let code = 0; code <= 99; code++) {
      const cls = modelClassFor(shipTypeLabel(code));
      expect(VESSEL_MODEL_CLASSES).toContain(cls);
      expect(cls === "cargo").toBe(code >= 70 && code <= 79);
    }
  });

  it("names the class of every label shipTypeLabel can give", () => {
    const table: [string | undefined, string][] = [
      ["cargo", "cargo"],
      ["tanker", "tanker"],
      ["passenger", "passenger"],
      ["high-speed craft", "highspeed"],
      ["tug", "tug"],
      ["towing", "tug"],
      ["dredging", "tug"],
      ["pilot", "service"],
      ["search and rescue", "service"],
      ["law enforcement", "service"],
      ["fishing", "fishing"],
      ["sailing", "sailing"],
      ["pleasure craft", "pleasure"],
    ];
    for (const [label, cls] of table) expect(modelClassFor(label)).toBe(cls);
  });

  it("draws a vessel with no type, a military one and an unknown label as the plain hull, never as cargo", () => {
    for (const label of [undefined, "", "military", "submarine", "Cargo", "cargo ship"]) {
      expect(modelClassFor(label)).toBe("plain");
    }
  });

  it("has one packed file per class under /models/vessels/", () => {
    expect(Object.keys(VESSEL_MODEL_FILES).sort()).toEqual([...VESSEL_MODEL_CLASSES].sort());
    expect(VESSEL_MODEL_CLASSES).toHaveLength(10);
    for (const cls of VESSEL_MODEL_CLASSES) expect(VESSEL_MODEL_FILES[cls]).toBe(`/models/vessels/${cls}.glb`);
  });
});

describe("how long a vessel is drawn", () => {
  it("holds the constants the plan fixed", () => {
    expect(MIN_DRAWN_PX).toBe(28);
    expect(LOD1_BELOW_PX).toBe(48);
    expect(STOPPED_TINT).toBe(0.62);
    expect(LENGTH_RANGE_M).toEqual([2, 460]);
  });

  it("is never shorter than 28 px: an unknown length is the floor itself", () => {
    // 0.5 px to the metre: 28 px is 56 m.
    expect(drawnLengthM(undefined, 0.5)).toBeCloseTo(56, 9);
    // 20 m is 10 px there, so the floor wins.
    expect(drawnLengthM(20, 0.5)).toBeCloseTo(56, 9);
  });

  it("is the true length once that is longer than the floor", () => {
    expect(drawnLengthM(120, 0.5)).toBe(120);
    expect(drawnLengthM(460, 2)).toBe(460);
    // Zoomed in to 4 px to the metre, 12 m is 48 px and the floor is 7 m.
    expect(drawnLengthM(12, 4)).toBe(12);
  });

  it("ignores a length outside 2 to 460 m", () => {
    expect(plausibleLengthM(1.9)).toBe(0);
    expect(plausibleLengthM(461)).toBe(0);
    expect(plausibleLengthM(Number.NaN)).toBe(0);
    expect(plausibleLengthM(undefined)).toBe(0);
    expect(plausibleLengthM(2)).toBe(2);
    expect(plausibleLengthM(460)).toBe(460);
    expect(drawnLengthM(1, 0.5)).toBeCloseTo(56, 9);
    expect(drawnLengthM(900, 0.5)).toBeCloseTo(56, 9);
  });

  it("does not divide by a scale that is not a number of pixels", () => {
    expect(drawnLengthM(undefined, 0)).toBe(1);
    expect(drawnLengthM(80, Number.NaN)).toBe(80);
  });

  it("gives a click half the drawn length, in pixels: the contract with the boat click", () => {
    // 2 m a pixel. 20 m is 10 px, under the floor, so 28 px long: a radius of 14.
    expect(hullRadiusPx({ lengthM: 20 }, 2)).toBeCloseTo(14, 9);
    expect(hullRadiusPx({}, 2)).toBeCloseTo(14, 9);
    // 300 m is 150 px: a radius of 75.
    expect(hullRadiusPx({ lengthM: 300 }, 2)).toBeCloseTo(75, 9);
    expect(hullRadiusPx({ lengthM: 300 }, 0)).toBe(14);
  });
});

describe("pixels to the metre at a spot", () => {
  const SCALE = 1e6; // px per degree of the fake map
  const flat = ([lon, lat]: [number, number]) => ({ x: lon * SCALE, y: -lat * SCALE });

  it("is the longer of 10 m east and 10 m north, projected, over 10", () => {
    // At the equator both are 10 m = 8.9932e-5 degrees.
    const at = pxPerMetreAt(flat, 3, 0);
    expect(at).toBeCloseTo((SCALE * 10) / 6371008.8 / (Math.PI / 180) / 10, 6);
  });

  it("takes the north-south metre when a tilt makes it the longer", () => {
    const squashedEast = ([lon, lat]: [number, number]) => ({ x: lon * SCALE * 0.1, y: -lat * SCALE });
    expect(pxPerMetreAt(squashedEast, 3, 0)).toBeCloseTo(pxPerMetreAt(flat, 3, 0), 6);
    const squashedNorth = ([lon, lat]: [number, number]) => ({ x: lon * SCALE, y: -lat * SCALE * 0.1 });
    expect(pxPerMetreAt(squashedNorth, 3, 0)).toBeCloseTo(pxPerMetreAt(flat, 3, 0), 6);
  });

  it("makes 10 m of longitude a wider angle at high latitude, so a flat map reads larger there", () => {
    expect(pxPerMetreAt(flat, 0, 60)).toBeCloseTo(pxPerMetreAt(flat, 0, 0) / Math.cos((60 * Math.PI) / 180), 4);
  });
});

describe("Mercator and placement", () => {
  const CIRCUMFERENCE = 2 * Math.PI * 6371008.8;

  it("matches the Mercator square: the equator at the middle, the antimeridian at the edges", () => {
    expect(mercator(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(mercator(-180, 0).x).toBe(0);
    expect(mercator(180, 0).x).toBe(1);
    expect(mercator(0, 85.0511287798).y).toBeCloseTo(0, 6);
    expect(mercator(0, -85.0511287798).y).toBeCloseTo(1, 6);
    // London's latitude, by the inverse Gudermannian: y = 1/2 - asinh(tan(lat)) / (2 pi).
    expect(mercator(0, 51.5).y).toBeCloseTo(0.5 - Math.asinh(Math.tan((51.5 * Math.PI) / 180)) / (2 * Math.PI), 12);
    expect(mercator(0, 51.5).y).toBeCloseTo(0.332559, 6);
  });

  it("says how many metres a unit of Mercator length is, from the Earth's circumference", () => {
    expect(metresPerMercatorUnit(0)).toBeCloseTo(CIRCUMFERENCE, 3);
    expect(metresPerMercatorUnit(60)).toBeCloseTo(CIRCUMFERENCE / 2, 3);
  });

  it("puts a vessel east and north of the origin in metres, and turns it by minus its heading", () => {
    const origin = { lon: 0, lat: 0 };
    const east = placement({ lon: 0.001, lat: 0, rot: 0 }, origin);
    expect(east.east).toBeCloseTo((0.001 / 360) * CIRCUMFERENCE, 6); // 111.195 m
    expect(east.north).toBeCloseTo(0, 6);
    expect(east.rotZ).toBeCloseTo(0, 12);
    const north = placement({ lon: 0, lat: 0.001, rot: 90 }, origin);
    expect(north.east).toBeCloseTo(0, 6);
    expect(north.north).toBeGreaterThan(111);
    expect(north.north).toBeLessThan(111.4);
    expect(north.rotZ).toBeCloseTo(-Math.PI / 2, 12);
    // A south-west vessel: both offsets are negative.
    const sw = placement({ lon: -0.002, lat: -0.002, rot: 225 }, origin);
    expect(sw.east).toBeLessThan(0);
    expect(sw.north).toBeLessThan(0);
    expect(sw.rotZ).toBeCloseTo((-225 * Math.PI) / 180, 12);
  });

  it("scales the metres with the origin's latitude, as the layer's camera does", () => {
    const origin = { lon: 0, lat: 60 };
    // 0.001 degrees of longitude at 60 degrees north is half of 111.195 m.
    expect(placement({ lon: 0.001, lat: 60, rot: 0 }, origin).east).toBeCloseTo(55.5975, 3);
    // 0.001 degrees north there is still about 111.2 m: Mercator stretches y by the same 1/cos.
    expect(placement({ lon: 0, lat: 60.001, rot: 0 }, origin).north).toBeCloseTo(111.19, 1);
  });
});

describe("the sun and the colours", () => {
  it("points toward the sun from MapLibre's azimuth 215 and polar 35, in east, north and up", () => {
    const sun = sunDirection(EYE_LIGHT);
    expect(sun.east).toBeCloseTo(Math.sin((215 * Math.PI) / 180) * Math.sin((35 * Math.PI) / 180), 12);
    expect(sun.east).toBeCloseTo(-0.32899, 4);
    expect(sun.north).toBeCloseTo(-0.46985, 4);
    expect(sun.up).toBeCloseTo(0.81915, 4);
    expect(Math.hypot(sun.east, sun.north, sun.up)).toBeCloseTo(1, 12);
    expect(sunDirection()).toEqual(sun);
  });

  it("builds its palette from the building ramp, the camera rings and the ship colour", () => {
    expect(VESSEL_PALETTE).toEqual({ hull: HEIGHT_RAMP[3][1], deck: HEIGHT_RAMP[4][1], top: "#e8f1f8", waterline: "#2dd4bf" });
    expect(VESSEL_PALETTE.hull).toBe("#56778b");
    expect(VESSEL_PALETTE.deck).toBe("#8eabbd");
  });

  it("is the same palette in bake.py, which colours the files", () => {
    const body = /PALETTE = \{([^}]*)\}/.exec(read("scripts/vessel-models/bake.py"))![1];
    const baked = Object.fromEntries([...body.matchAll(/"(\w+)":\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1], m[2].toLowerCase()]));
    expect(baked).toEqual({ ...VESSEL_PALETTE });
  });

  it("is the colour EyeOverlay draws its chevrons in, so the waterline reads as the same ship", () => {
    const ship = /const COLOUR = \{ ship: "(#[0-9a-fA-F]{6})"/.exec(read("components/eye/EyeOverlay.tsx"))![1].toLowerCase();
    expect(ship).toBe(VESSEL_PALETTE.waterline);
  });
});

/** The JSON chunk of a .glb. */
function glb(path: string) {
  const data = readFileSync(resolve(ROOT, path));
  expect(data.subarray(0, 4).toString("latin1")).toBe("glTF");
  const length = data.readUInt32LE(12);
  const doc = JSON.parse(data.subarray(20, 20 + length).toString("utf8")) as {
    nodes: { name?: string; mesh?: number; children?: number[] }[];
    meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
    accessors: { count: number }[];
    extensionsUsed?: string[];
  };
  return { bytes: data.length, doc };
}

/** Triangles of the mesh under the node named `name` (the node itself or its first child). */
function triangles(doc: ReturnType<typeof glb>["doc"], name: string): { tris: number; attributes: string[] } {
  const node = doc.nodes.find((n) => n.name === name);
  expect(node, `node ${name}`).toBeDefined();
  const meshIndex = node!.mesh ?? doc.nodes[node!.children![0]].mesh;
  const prim = doc.meshes[meshIndex!].primitives[0];
  expect(prim.indices, `${name} is indexed`).toBeDefined();
  return { tris: doc.accessors[prim.indices!].count / 3, attributes: Object.keys(prim.attributes) };
}

describe("the ten packed models", () => {
  const dir = "public/models/vessels";

  it("are exactly the ten classes, and nothing else is in the folder", () => {
    expect(readdirSync(resolve(ROOT, dir)).sort()).toEqual(VESSEL_MODEL_CLASSES.map((c) => `${c}.glb`).sort());
  });

  for (const cls of VESSEL_MODEL_CLASSES) {
    it(`${cls}.glb has lod0 and lod1, meshopt, vertex colours, and fits its triangle and byte budgets`, () => {
      const { bytes, doc } = glb(`${dir}/${cls}.glb`);
      expect(doc.extensionsUsed).toContain("EXT_meshopt_compression");
      const lod0 = triangles(doc, "lod0");
      const lod1 = triangles(doc, "lod1");
      expect(lod0.tris).toBeGreaterThan(0);
      expect(lod0.tris).toBeLessThanOrEqual(1200);
      expect(lod1.tris).toBeGreaterThan(0);
      expect(lod1.tris).toBeLessThanOrEqual(250);
      for (const a of [lod0.attributes, lod1.attributes]) {
        expect(a).toContain("COLOR_0");
        expect(a).toContain("POSITION");
        // No normals (the layer shades each face flat) and no texture coordinates.
        expect(a).not.toContain("NORMAL");
        expect(a).not.toContain("TEXCOORD_0");
      }
      expect(bytes).toBeLessThanOrEqual(40 * 1024);
    });
  }

  it("weigh at most 250 KB together", () => {
    const total = VESSEL_MODEL_CLASSES.reduce((sum, c) => sum + statSync(resolve(ROOT, `${dir}/${c}.glb`)).size, 0);
    expect(total).toBeLessThanOrEqual(250 * 1024);
  });

  it("are all named, with their maker and processing, in docs/IMAGE-LICENSES.md", () => {
    const licences = read("docs/IMAGE-LICENSES.md");
    const section = licences.slice(licences.indexOf("## Vessel models (10)"));
    expect(section).toContain("## Vessel models (10)");
    for (const cls of VESSEL_MODEL_CLASSES) expect(section, `${cls}.glb`).toContain(`\`${cls}.glb\``);
    expect(section).toContain("tripo3d/h3.1/text-to-3d");
    expect(section).toContain("scripts/vessel-models/bake.py");
    expect(existsSync(resolve(ROOT, "scripts/vessel-models/bake.py"))).toBe(true);
  });

  it("are served with the static-asset cache rule", () => {
    expect(read("next.config.ts")).toContain('rule("/models/:path*", assets)');
  });
});

describe("the layer's source rules", () => {
  const layer = "components/eye/vesselLayer.ts";

  it("loads three.js only by dynamic import: no static value import of it anywhere in the view", () => {
    const sources = [...readdirSync(resolve(ROOT, "components/eye")).map((f) => `components/eye/${f}`), ...readdirSync(resolve(ROOT, "lib/eye")).map((f) => `lib/eye/${f}`)].filter(
      (f) => /\.(ts|tsx)$/.test(f),
    );
    for (const f of sources) {
      for (const line of code(f).split("\n")) {
        const staticImport = /^\s*import\s+(?!type\b)[^"']*from\s+["']three(\/[^"']*)?["']/.test(line);
        const bare = /^\s*import\s+["']three/.test(line);
        expect(staticImport || bare, `${f}: ${line.trim()}`).toBe(false);
      }
    }
    const src = code(layer);
    expect(src).toContain('import("three")');
    expect(src).toContain('import("three/addons/loaders/GLTFLoader.js")');
    expect(src).toContain('import("three/addons/libs/meshopt_decoder.module.js")');
    expect(src).toMatch(/import type \* as THREE from "three"/);
  });

  it("never asks the map for a repaint inside render: that would keep it from ever going idle", () => {
    const src = code(layer);
    const from = src.indexOf("render(context, args)");
    expect(from).toBeGreaterThan(0);
    const body = src.slice(from, src.indexOf("stats()", from));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toContain("triggerRepaint");
    // setVessels is what asks, once.
    expect(src).toContain("map.triggerRepaint()");
  });

  it("is a custom layer called eye-ship-models, drawn in 3d, and the Ships switch hides it with the chevrons", () => {
    const src = code(layer);
    expect(src).toContain('export const VESSEL_LAYER_ID = "eye-ship-models"');
    expect(src).toContain('type: "custom"');
    expect(src).toContain('renderingMode: "3d"');
    const overlay = code("components/eye/EyeOverlay.tsx");
    const hide = overlay.slice(overlay.indexOf("const applyHidden"), overlay.indexOf("const ensureLayers"));
    expect(hide).toContain("VESSEL_LAYER_ID");
    expect(hide).toContain('hid.has("ships")');
  });

  it("falls back to the chevrons: a failed layer is removed and not made again", () => {
    const overlay = code("components/eye/EyeOverlay.tsx");
    expect(overlay).toContain(`next === "failed" && map.getLayer(VESSEL_LAYER_ID)`);
    expect(overlay).toContain('modelState.current !== "failed"');
  });
});
