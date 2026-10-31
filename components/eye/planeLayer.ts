// The God's eye view's aircraft as 3D models of their real type: a MapLibre custom layer drawn
// with three.js on the map's own WebGL context and depth buffer, beside the boats' layer. The
// pure half (which model, what height, what the camera sees) is lib/eye/planeModels.ts. Pinned
// by tests/unit/eye-plane-models.test.ts and tests/e2e/eye-plane-models.spec.ts.
//
// THE RULES OF vesselLayer.ts HOLD HERE, AND FOR THE SAME REASONS. three.js is loaded by dynamic
// import inside onAdd and nowhere else. Nothing repaints per frame: the scene changes only when
// `setPlanes` runs, and that asks for one repaint. And it can fail: a plain model that will not
// load, a lost context, or a median draw time over 4 ms leaves state "failed", and EyeOverlay
// removes this layer and shows the chevron layer again.
//
// ONE DIFFERENCE: THE FILES COME ONE AT A TIME. There are 75 models and a view shows a handful of
// types, so the layer fetches the three plain models first (they make it ready) and a type's own
// file the first time that type is in the set. Until that file lands the plane is drawn as its
// plain model; a file that will not load leaves it plain, and only that plane's type is affected.
//
// EACH PLANE HAS A LINE AND A RING. The model is drawn at its capped height, so a thin line runs
// down to a ring on its real spot on the map. They use the map's depth buffer too, so a tower in
// front of a plane hides what it hides of a boat.
//
// THE FRAME is vesselLayer.ts's: metres east, north and up of an origin rebased to the map's
// centre at every `setPlanes`, under MapLibre's own matrix. `drawnAt` reuses the last matrix drawn,
// so a click is measured against what is on screen.

import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import type * as THREE from "three";
import type { Aircraft } from "@/lib/eye/traffic";
import {
  LOD1_BELOW_PX,
  MIN_DRAWN_PX,
  NEAREST_DRAWN_M,
  PLAIN_MODELS,
  RING_RADIUS_PX,
  depthAlongView,
  drawnHeightM,
  drawnPlaneLengthM,
  planeModelFile,
  planeModelFor,
  plainModelFor,
  viewGeometry,
  type ViewGeometry,
} from "@/lib/eye/planeModels";
import { mercator, metresPerMercatorUnit, placement, sunDirection } from "@/lib/eye/vesselModels";
import { EYE_LIGHT } from "@/lib/eye/look";

/** The custom layer's id: the chevron layer `eye-plane` is hidden while this one is ready. */
export const PLANE_LAYER_ID = "eye-plane-models";

export type PlaneLayerState = "loading" | "ready" | "failed";

export interface PlaneLayerStats {
  /** The median CPU time of the last 60 `render` calls, ms. */
  renderMedianMs: number;
  lastSetMs: number;
  /** Planes drawn, and how many meshes (draw calls) hold them. */
  planes: number;
  drawCalls: number;
  /** Which model each plane is drawn with now: model id to count. */
  byModel: Record<string, number>;
  /** Files that have landed. */
  loaded: string[];
}

export interface PlaneCustomLayer extends CustomLayerInterface {
  stats(): PlaneLayerStats;
}

export interface PlaneLayerHandle {
  layer: PlaneCustomLayer;
  setPlanes(planes: readonly Aircraft[]): void;
  /** Called on every change of state (not on registering). */
  onState(cb: (state: PlaneLayerState) => void): void;
  state(): PlaneLayerState;
  /** Where a plane is drawn on screen, in the map's own px, and how far its body reaches; null before a frame. */
  drawnAt(a: Aircraft): { x: number; y: number; radiusPx: number } | null;
  dispose(): void;
}

const SLOW_MS = 4;
const WINDOW = 60;
const START_CAPACITY = 16;
const LOAD_TIMEOUT_MS = 30_000;
const SUN_INTENSITY = (typeof EYE_LIGHT.intensity === "number" ? EYE_LIGHT.intensity : 0.74) * 1.1;
const AMBER = 0xfbbf24;

interface Lods {
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry;
}
interface Toolkit {
  three: typeof THREE;
  load(url: string): Promise<Lods>;
}

let kit: Promise<Toolkit> | null = null;
const files = new Map<string, Promise<Lods>>();

/** three.js and the glTF reader, once per page. A failure is forgotten so a later layer may try again. */
function loadKit(): Promise<Toolkit> {
  if (!kit) {
    const started = (async (): Promise<Toolkit> => {
      const [three, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/libs/meshopt_decoder.module.js"),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return {
        three,
        load: async (url) => {
          const gltf = await loader.loadAsync(url);
          gltf.scene.updateMatrixWorld(true);
          return { lod0: lodGeometry(three, gltf.scene, "lod0"), lod1: lodGeometry(three, gltf.scene, "lod1") };
        },
      };
    })();
    started.catch(() => {
      if (kit === started) kit = null;
    });
    kit = started;
  }
  return kit;
}

/** One model's file, once per page. A failure is forgotten, so the next visit to that type asks again. */
function loadFile(toolkit: Toolkit, model: string): Promise<Lods> {
  let p = files.get(model);
  if (!p) {
    const started = toolkit.load(planeModelFile(model));
    started.catch(() => {
      if (files.get(model) === started) files.delete(model);
    });
    files.set(model, started);
    p = started;
  }
  return p;
}

/**
 * The geometry of the mesh under the node `name`, in the scene's frame: the node's own transform
 * (gltfpack's dequantisation), then glTF's Y-up turned to the scene's Z-up, so the nose, at -Z in
 * the file, points along +Y. As in vesselLayer.ts.
 */
function lodGeometry(three: typeof THREE, scene: THREE.Object3D, name: string): THREE.BufferGeometry {
  const node = scene.getObjectByName(name);
  let mesh: THREE.Mesh | null = null;
  node?.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error(`no mesh under ${name}`);
  const src = (mesh as THREE.Mesh).geometry;
  const colour = src.getAttribute("color");
  const position = src.getAttribute("position");
  if (!colour || !position) throw new Error(`${name} has no colour or no position`);
  const m = new three.Matrix4().makeRotationX(Math.PI / 2).multiply((mesh as THREE.Mesh).matrixWorld);
  const v = new three.Vector3();
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    v.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(out, 3));
  geometry.setAttribute("color", colour);
  if (src.index) geometry.setIndex(src.index);
  return geometry;
}

interface Pool {
  mesh: THREE.InstancedMesh | null;
  capacity: number;
}

/** The camera as the map has it now. */
export function readView(map: MapLibreMap): ViewGeometry {
  return viewGeometry({
    heightPx: map.getContainer().clientHeight,
    fovDeg: map.getVerticalFieldOfView(),
    zoom: map.getZoom(),
    lat: map.getCenter().lat,
    pitchDeg: map.getPitch(),
    bearingDeg: map.getBearing(),
  });
}

export function createPlaneLayer(map: MapLibreMap): PlaneLayerHandle {
  let state: PlaneLayerState = "loading";
  const listeners: ((s: PlaneLayerState) => void)[] = [];
  let disposed = false;
  let generation = 0;

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let tools: Toolkit | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.Camera | null = null;
  let material: THREE.MeshLambertMaterial | null = null;
  let lights: THREE.Light[] = [];
  const pools = new Map<string, Pool>();
  const geometries = new Map<string, Lods>();
  /** Type models asked for and not landed, so a re-apply does not ask twice. */
  const asked = new Set<string>();

  let lines: THREE.LineSegments | null = null;
  let lineCapacity = 0;
  let rings: THREE.InstancedMesh | null = null;
  let ringCapacity = 0;

  let basis: THREE.Matrix4 | null = null;
  let pending: readonly Aircraft[] | null = null;
  /** The last matrix drawn, for `drawnAt`: Mercator coordinates to clip space. */
  let lastMatrix: ArrayLike<number> | null = null;
  let metresUnit = 1;

  const draws: number[] = [];
  let lastSetMs = 0;
  let planeCount = 0;
  let drawCalls = 0;
  let byModel: Record<string, number> = {};

  const emit = (next: PlaneLayerState) => {
    if (state === next) return;
    state = next;
    if (disposed) return;
    for (const cb of listeners) cb(state);
  };
  const fail = () => {
    if (disposed || state === "failed") return;
    teardown();
    emit("failed");
  };
  const onContextLost = () => fail();

  function teardown() {
    for (const pool of pools.values()) {
      pool.mesh?.dispose();
      pool.mesh = null;
      pool.capacity = 0;
    }
    pools.clear();
    lines?.geometry.dispose();
    (lines?.material as THREE.Material | undefined)?.dispose();
    lines = null;
    lineCapacity = 0;
    rings?.dispose();
    (rings?.material as THREE.Material | undefined)?.dispose();
    rings?.geometry.dispose();
    rings = null;
    ringCapacity = 0;
    material?.dispose();
    material = null;
    for (const l of lights) l.dispose();
    lights = [];
    renderer?.dispose();
    renderer = null;
    scene = null;
    camera = null;
    gl?.canvas?.removeEventListener?.("webglcontextlost", onContextLost);
    draws.length = 0;
  }

  function build(three: typeof THREE) {
    const canvas = map.getCanvas();
    renderer = new three.WebGLRenderer({ canvas, context: gl as WebGLRenderingContext, antialias: false });
    renderer.autoClear = false;
    scene = new three.Scene();
    camera = new three.Camera();
    material = new three.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const sun = sunDirection();
    const key = new three.DirectionalLight(0xffffff, Math.PI * SUN_INTENSITY);
    key.position.set(sun.east, sun.north, sun.up).multiplyScalar(100);
    const fill = new three.HemisphereLight(0xdfeaf2, 0x2a3640, Math.PI * 0.62);
    fill.position.set(0, 0, 1);
    scene.add(key, fill);
    lights = [key, fill];
    canvas.addEventListener("webglcontextlost", onContextLost);
  }

  /** The pool for a model and level, with room for `need` instances (doubling, never shrinking). */
  function poolFor(model: string, lod: 0 | 1, need: number): Pool | null {
    if (!tools || !scene || !material) return null;
    const lods = geometries.get(model);
    if (!lods) return null;
    const key = `${model}:${lod}`;
    let pool = pools.get(key);
    if (!pool) {
      pool = { mesh: null, capacity: 0 };
      pools.set(key, pool);
    }
    if (need <= pool.capacity && pool.mesh) return pool;
    let capacity = Math.max(pool.capacity, START_CAPACITY);
    while (capacity < need) capacity *= 2;
    if (pool.mesh) {
      scene.remove(pool.mesh);
      pool.mesh.dispose();
    }
    const mesh = new tools.three.InstancedMesh(lod === 0 ? lods.lod0 : lods.lod1, material, capacity);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    pool.mesh = mesh;
    pool.capacity = capacity;
    return pool;
  }

  /** Room for `count` line segments and rings. */
  function sizeMarks(count: number) {
    if (!tools || !scene) return;
    const { three } = tools;
    if (count > lineCapacity || !lines) {
      lineCapacity = Math.max(lineCapacity, START_CAPACITY);
      while (lineCapacity < count) lineCapacity *= 2;
      if (lines) {
        scene.remove(lines);
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      }
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.BufferAttribute(new Float32Array(lineCapacity * 6), 3));
      lines = new three.LineSegments(geometry, new three.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.6, depthWrite: false }));
      lines.frustumCulled = false;
      scene.add(lines);
    }
    if (count > ringCapacity || !rings) {
      ringCapacity = Math.max(ringCapacity, START_CAPACITY);
      while (ringCapacity < count) ringCapacity *= 2;
      if (rings) {
        scene.remove(rings);
        rings.dispose();
        rings.geometry.dispose();
        (rings.material as THREE.Material).dispose();
      }
      rings = new three.InstancedMesh(
        new three.RingGeometry(0.72, 1, 24),
        new three.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthWrite: false, side: three.DoubleSide }),
        ringCapacity,
      );
      rings.frustumCulled = false;
      rings.count = 0;
      scene.add(rings);
    }
  }

  /** Ask for a type's file. It lands once, then the set is applied again with one repaint. */
  function askFile(model: string) {
    if (!tools || geometries.has(model) || asked.has(model)) return;
    asked.add(model);
    const mine = generation;
    loadFile(tools, model).then(
      (lods) => {
        asked.delete(model);
        if (disposed || mine !== generation) return;
        geometries.set(model, lods);
        apply();
      },
      () => {
        // This type stays plain. The layer is fine, and the next visit asks again.
        asked.delete(model);
      },
    );
  }

  function apply() {
    if (state !== "ready" || !tools || !scene || !pending) return;
    const t0 = performance.now();
    const { three } = tools;
    const centre = map.getCenter();
    const origin = { lon: centre.lng, lat: centre.lat };
    const om = mercator(origin.lon, origin.lat);
    metresUnit = 1 / metresPerMercatorUnit(origin.lat);
    basis = new three.Matrix4().makeTranslation(om.x, om.y, 0).multiply(new three.Matrix4().makeScale(metresUnit, -metresUnit, metresUnit));
    const view = readView(map);

    interface Item {
      model: string;
      lod: 0 | 1;
      east: number;
      north: number;
      rotZ: number;
      length: number;
      height: number;
      ringM: number | null;
    }
    const items: Item[] = [];
    const counts = new Map<string, number>();
    const seen: Record<string, number> = {};
    for (const a of pending) {
      const choice = planeModelFor(a);
      if (choice.named && !geometries.has(choice.model)) askFile(choice.model);
      // Until a type's own file has landed, and if it never does, the plane is its plain model.
      const model = geometries.has(choice.model) ? choice.model : plainModelFor(a.classLabel);
      const p = placement(a, origin);
      const { heightM } = drawnHeightM(a.feet, view.cameraHeightM);
      const depth = depthAlongView(view, p.east, p.north, heightM);
      if (depth <= NEAREST_DRAWN_M) continue;
      const length = drawnPlaneLengthM(choice.lengthM, depth, view, MIN_DRAWN_PX);
      const pxPerMetre = view.focalPx / depth;
      const lod: 0 | 1 = length * pxPerMetre < LOD1_BELOW_PX ? 1 : 0;
      const groundDepth = depthAlongView(view, p.east, p.north, 0);
      const ringM = groundDepth > NEAREST_DRAWN_M ? RING_RADIUS_PX / (view.focalPx / groundDepth) : null;
      items.push({ model, lod, east: p.east, north: p.north, rotZ: p.rotZ, length, height: heightM, ringM });
      const key = `${model}:${lod}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      seen[model] = (seen[model] ?? 0) + 1;
    }

    sizeMarks(items.length);
    const position = new three.Vector3();
    const quaternion = new three.Quaternion();
    const scale = new three.Vector3();
    const matrix = new three.Matrix4();
    const up = new three.Vector3(0, 0, 1);
    const none = new three.Quaternion();
    const filled = new Map<string, number>();
    for (const pool of pools.values()) if (pool.mesh) pool.mesh.count = 0;
    const lineAttr = lines?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    let lineCount = 0;
    let ringCount = 0;
    for (const it of items) {
      const key = `${it.model}:${it.lod}`;
      const pool = poolFor(it.model, it.lod, counts.get(key)!);
      if (pool?.mesh) {
        const i = filled.get(key) ?? 0;
        filled.set(key, i + 1);
        position.set(it.east, it.north, it.height);
        quaternion.setFromAxisAngle(up, it.rotZ);
        scale.setScalar(it.length);
        matrix.compose(position, quaternion, scale);
        pool.mesh.setMatrixAt(i, matrix);
      }
      if (it.ringM != null) {
        if (lineAttr) {
          lineAttr.setXYZ(lineCount * 2, it.east, it.north, it.height);
          lineAttr.setXYZ(lineCount * 2 + 1, it.east, it.north, 0);
          lineCount++;
        }
        if (rings) {
          position.set(it.east, it.north, 0.5);
          scale.setScalar(it.ringM);
          matrix.compose(position, none, scale);
          rings.setMatrixAt(ringCount, matrix);
          ringCount++;
        }
      }
    }
    if (lines && lineAttr) {
      lineAttr.needsUpdate = true;
      lines.geometry.setDrawRange(0, lineCount * 2);
    }
    if (rings) {
      rings.count = ringCount;
      rings.instanceMatrix.needsUpdate = true;
    }
    let calls = 0;
    for (const [key, n] of filled) {
      const mesh = pools.get(key)!.mesh!;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      calls++;
    }
    planeCount = items.length;
    drawCalls = calls;
    byModel = seen;
    lastSetMs = performance.now() - t0;
    // ONE repaint for this change. Never one per frame (vesselLayer.ts says why).
    map.triggerRepaint();
  }

  const layer: PlaneCustomLayer = {
    id: PLANE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, context) {
      gl = context;
      const mine = ++generation;
      const timer = setTimeout(() => {
        if (!disposed && mine === generation && state === "loading") fail();
      }, LOAD_TIMEOUT_MS);
      loadKit()
        .then(async (toolkit) => {
          // The plain models are what a plane falls back on, so they make the layer ready.
          const plain = await Promise.all(PLAIN_MODELS.map((m) => loadFile(toolkit, m).then((lods) => [m, lods] as const)));
          return { toolkit, plain };
        })
        .then(
          ({ toolkit, plain }) => {
            clearTimeout(timer);
            if (disposed || mine !== generation) return;
            tools = toolkit;
            for (const [m, lods] of plain) geometries.set(m, lods);
            try {
              build(toolkit.three);
            } catch {
              fail();
              return;
            }
            emit("ready");
            apply();
          },
          () => {
            clearTimeout(timer);
            if (!disposed && mine === generation) fail();
          },
        );
    },
    onRemove() {
      generation++;
      if (state === "failed") return;
      teardown();
      basis = null;
      lastMatrix = null;
      emit("loading");
    },
    render(context, args) {
      if (state !== "ready" || !renderer || !scene || !camera || !basis) return;
      const t0 = performance.now();
      const main = args.defaultProjectionData.mainMatrix as unknown as number[];
      lastMatrix = main;
      const projection = (camera as THREE.Camera).projectionMatrix;
      projection.fromArray(main).multiply(basis);
      (camera as THREE.Camera).projectionMatrixInverse.copy(projection).invert();
      renderer.resetState();
      renderer.setViewport(0, 0, context.drawingBufferWidth, context.drawingBufferHeight);
      renderer.render(scene, camera);
      draws.push(performance.now() - t0);
      if (draws.length > WINDOW) draws.shift();
      if (draws.length === WINDOW) {
        const sorted = [...draws].sort((a, b) => a - b);
        if (sorted[WINDOW >> 1] > SLOW_MS) fail();
      }
    },
    stats() {
      const sorted = [...draws].sort((a, b) => a - b);
      return {
        renderMedianMs: sorted.length ? sorted[sorted.length >> 1] : 0,
        lastSetMs,
        planes: planeCount,
        drawCalls,
        byModel,
        loaded: [...geometries.keys()],
      };
    },
  };

  return {
    layer,
    setPlanes(planes) {
      if (disposed || state === "failed") return;
      pending = planes;
      apply();
    },
    onState(cb) {
      listeners.push(cb);
    },
    state: () => state,
    drawnAt(a) {
      const m = lastMatrix;
      if (!m || state !== "ready") return null;
      const view = readView(map);
      const { heightM } = drawnHeightM(a.feet, view.cameraHeightM);
      const merc = mercator(a.lon, a.lat);
      const z = heightM * metresUnit;
      const w = m[3] * merc.x + m[7] * merc.y + m[11] * z + m[15];
      if (!(w > 0)) return null;
      const box = map.getContainer();
      const x = ((m[0] * merc.x + m[4] * merc.y + m[8] * z + m[12]) / w + 1) * 0.5 * box.clientWidth;
      const y = (1 - (m[1] * merc.x + m[5] * merc.y + m[9] * z + m[13]) / w) * 0.5 * box.clientHeight;
      const origin = map.getCenter();
      const p = placement(a, { lon: origin.lng, lat: origin.lat });
      const depth = depthAlongView(view, p.east, p.north, heightM);
      if (depth <= NEAREST_DRAWN_M) return null;
      const length = drawnPlaneLengthM(planeModelFor(a).lengthM, depth, view, MIN_DRAWN_PX);
      return { x, y, radiusPx: (length * view.focalPx) / depth / 2 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      listeners.length = 0;
      teardown();
    },
  };
}
