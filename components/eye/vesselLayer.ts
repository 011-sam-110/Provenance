// The God's eye view's vessels as stylised 3D models: a MapLibre custom layer drawn with
// three.js on the map's own WebGL context and depth buffer, so a tower in front of a boat
// hides it. The pure half (classes, sizes, placement, palette, sun) is
// lib/eye/vesselModels.ts. Pinned by tests/unit/eye-vessel-models.test.ts and
// tests/e2e/eye-vessel-models.spec.ts.
//
// THREE RULES THAT ARE NOT STYLE PREFERENCES:
//  1. three.js is loaded by dynamic import inside onAdd and nowhere else. A static value
//     import would put it in the page's bundle; `/` and `/app` never load it, and nor does
//     /eye until its first vessel report has landed. What it costs, measured on the built
//     site: four chunks, 827 KB raw, 205 KB gzipped (170 KB brotli), of which three itself is
//     185 KB gzipped. It is not tree-shaken: naming the classes in the import changed
//     nothing (tried), because the landing page's camera sphere imports the whole namespace
//     and webpack keeps what any importer might use.
//  2. NOTHING REPAINTS PER FRAME. The scene changes only when `setVessels` runs, and that
//     asks for ONE repaint. `render` never calls `map.triggerRepaint()`: a per-frame repaint
//     keeps MapLibre from ever going idle, and the reel recorder and the e2e wait for idle.
//  3. IT CAN FAIL, AND THEN THE CHEVRONS COME BACK. A model that will not load, a lost
//     context, or a median draw time over 4 ms leaves state "failed", and EyeOverlay removes
//     this layer and shows the chevron layer again.
//
// THE FRAME. The scene is metres east, north and up of an origin that is rebased to the
// map's centre at every `setVessels`. The camera is MapLibre's own matrix for Mercator
// coordinates times the origin's translation and a scale of one metre in Mercator units
// (with y flipped, because Mercator y grows southward): the layer's own camera, never
// three's. Lighting is computed in the scene frame, so the sun stays where the map says.
//
// THE MODELS. Ten files fetched once per page (`loadModels`, a module-level promise, so a
// basemap swap does not fetch again). Each holds `lod0` and `lod1` as group nodes, because
// gltfpack quantises positions to 16-bit integers and keeps the scale and offset that
// restore them on a child node. The loader here bakes that node transform and a turn of
// +PI/2 about x (glTF's Y is up, the scene's Z is) into each geometry once, so every
// instance only needs a position, a heading and a size. Per class there are two
// InstancedMesh, one per level of detail: at most 20 draw calls however many boats.

import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import type * as THREE from "three";
import type { Vessel } from "@/lib/eye/traffic";
import {
  LOD1_BELOW_PX,
  STOPPED_TINT,
  VESSEL_MODEL_CLASSES,
  VESSEL_MODEL_FILES,
  drawnLengthM,
  mercator,
  metresPerMercatorUnit,
  modelClassFor,
  placement,
  pxPerMetreAt,
  sunDirection,
  type VesselModelClass,
} from "@/lib/eye/vesselModels";
import { EYE_LIGHT } from "@/lib/eye/look";

/** The custom layer's id: the chevron layer `eye-ship` is hidden while this one is ready. */
export const VESSEL_LAYER_ID = "eye-ship-models";

export type VesselLayerState = "loading" | "ready" | "failed";

/** What the layer measured about itself, for the pull request's budgets and for debugging. */
export interface VesselLayerStats {
  /** The median CPU time of the last 60 `render` calls, ms. */
  renderMedianMs: number;
  /** How long the last `setVessels` took, ms, and the median of the last 20. */
  lastSetMs: number;
  setMedianMs: number;
  /** Vessels drawn, and how many meshes (draw calls) hold them. */
  vessels: number;
  drawCalls: number;
}

export interface VesselCustomLayer extends CustomLayerInterface {
  stats(): VesselLayerStats;
}

export interface VesselLayerHandle {
  layer: VesselCustomLayer;
  setVessels(vs: readonly Vessel[]): void;
  /** Called on every change of state (not on registering). */
  onState(cb: (state: VesselLayerState) => void): void;
  state(): VesselLayerState;
  /** Free everything the layer holds. After this it never calls back. */
  dispose(): void;
}

/** The weak-GPU guard: this median CPU time over the last WINDOW draws is too slow. */
const SLOW_MS = 4;
const WINDOW = 60;
const START_CAPACITY = 32;
/** A model that has not arrived by now is given up on, so the chevrons stay and `ready` is not held. */
const LOAD_TIMEOUT_MS = 30_000;
/** The map's own sun strength (EYE_LIGHT), a little more, because three has no ambient occlusion here. */
const SUN_INTENSITY = (typeof EYE_LIGHT.intensity === "number" ? EYE_LIGHT.intensity : 0.74) * 1.1;

interface Lods {
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry;
}
interface Loaded {
  three: typeof THREE;
  geometries: Map<VesselModelClass, Lods>;
}

let loading: Promise<Loaded> | null = null;

/**
 * three.js and the ten models, once per page. A failure is forgotten so a later layer may
 * try again; the caller decides what a failure means (the chevrons stay).
 */
function loadModels(): Promise<Loaded> {
  if (!loading) {
    const started = (async (): Promise<Loaded> => {
      const [three, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/libs/meshopt_decoder.module.js"),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const pairs = await Promise.all(
        VESSEL_MODEL_CLASSES.map(async (cls) => {
          const gltf = await loader.loadAsync(VESSEL_MODEL_FILES[cls]);
          gltf.scene.updateMatrixWorld(true);
          return [cls, { lod0: lodGeometry(three, gltf.scene, "lod0"), lod1: lodGeometry(three, gltf.scene, "lod1") }] as const;
        }),
      );
      return { three, geometries: new Map(pairs) };
    })();
    started.catch(() => {
      if (loading === started) loading = null;
    });
    loading = started;
  }
  return loading;
}

/**
 * The geometry of the mesh under the node `name`, in the scene's frame: the node's own
 * transform (gltfpack's dequantisation), then glTF's Y-up turned to the scene's Z-up so
 * the bow, at -Z in the file, points along +Y. Positions become floats here because the
 * file's are 16-bit integers that a matrix cannot be applied to in place.
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

/** One level of detail of one class: its instanced mesh and how many instances it holds. */
interface Pool {
  mesh: THREE.InstancedMesh | null;
  capacity: number;
}

export function createVesselLayer(map: MapLibreMap): VesselLayerHandle {
  let state: VesselLayerState = "loading";
  const listeners: ((s: VesselLayerState) => void)[] = [];
  let disposed = false;
  /** Bumped by every onAdd/onRemove, so a late load never builds into a layer that left. */
  let generation = 0;

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let loaded: Loaded | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.Camera | null = null;
  let material: THREE.MeshLambertMaterial | null = null;
  let lights: THREE.Light[] = [];
  const pools = new Map<string, Pool>();
  /** The origin matrix: Mercator translation of the origin, then one metre in Mercator units. */
  let basis: THREE.Matrix4 | null = null;
  let pending: readonly Vessel[] | null = null;

  const draws: number[] = [];
  const sets: number[] = [];
  let lastSetMs = 0;
  let vesselCount = 0;
  let drawCalls = 0;

  const emit = (next: VesselLayerState) => {
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

  /** Free the GPU side: instanced meshes, the material, the lights, the renderer. Geometries stay cached. */
  function teardown() {
    for (const pool of pools.values()) {
      pool.mesh?.dispose();
      pool.mesh = null;
      pool.capacity = 0;
    }
    pools.clear();
    if (loaded) for (const g of loaded.geometries.values()) {
      g.lod0.dispose();
      g.lod1.dispose();
    }
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
    sets.length = 0;
  }

  function build(l: Loaded) {
    const { three } = l;
    const canvas = map.getCanvas();
    renderer = new three.WebGLRenderer({ canvas, context: gl as WebGLRenderingContext, antialias: false });
    renderer.autoClear = false;
    scene = new three.Scene();
    camera = new three.Camera();
    material = new three.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const sun = sunDirection();
    // three's lights are in physical units: pi is a surface facing the light, lit as its own colour.
    const key = new three.DirectionalLight(0xffffff, Math.PI * SUN_INTENSITY);
    key.position.set(sun.east, sun.north, sun.up).multiplyScalar(100);
    const fill = new three.HemisphereLight(0xdfeaf2, 0x2a3640, Math.PI * 0.62);
    fill.position.set(0, 0, 1);
    scene.add(key, fill);
    lights = [key, fill];
    canvas.addEventListener("webglcontextlost", onContextLost);
  }

  /** The pool for a class and level, with room for `need` instances (doubling, never shrinking). */
  function poolFor(cls: VesselModelClass, lod: 0 | 1, need: number): Pool | null {
    if (!loaded || !scene || !material) return null;
    const key = `${cls}:${lod}`;
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
    const geometry = loaded.geometries.get(cls)![lod === 0 ? "lod0" : "lod1"];
    const mesh = new loaded.three.InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false; // the instances move; a box round the origin would cull them wrongly
    mesh.count = 0;
    scene.add(mesh);
    pool.mesh = mesh;
    pool.capacity = capacity;
    return pool;
  }

  function apply() {
    if (state !== "ready" || !loaded || !scene || !pending) return;
    const t0 = performance.now();
    const { three } = loaded;
    const centre = map.getCenter();
    const origin = { lon: centre.lng, lat: centre.lat };
    const om = mercator(origin.lon, origin.lat);
    const unit = 1 / metresPerMercatorUnit(origin.lat);
    basis = new three.Matrix4().makeTranslation(om.x, om.y, 0).multiply(new three.Matrix4().makeScale(unit, -unit, unit));

    interface Item {
      cls: VesselModelClass;
      lod: 0 | 1;
      east: number;
      north: number;
      rotZ: number;
      length: number;
      tint: number;
    }
    const items: Item[] = [];
    const counts = new Map<string, number>();
    const project = (ll: [number, number]) => map.project(ll);
    for (const v of pending) {
      const ppm = pxPerMetreAt(project, v.lon, v.lat);
      const length = drawnLengthM(v.lengthM, ppm);
      const lod: 0 | 1 = length * ppm < LOD1_BELOW_PX ? 1 : 0;
      const cls = modelClassFor(v.type);
      const p = placement(v, origin);
      items.push({ cls, lod, east: p.east, north: p.north, rotZ: p.rotZ, length, tint: v.moving ? 1 : STOPPED_TINT });
      const key = `${cls}:${lod}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const position = new three.Vector3();
    const quaternion = new three.Quaternion();
    const scale = new three.Vector3();
    const matrix = new three.Matrix4();
    const colour = new three.Color();
    const up = new three.Vector3(0, 0, 1);
    const filled = new Map<string, number>();
    // A pool with no vessel keeps its mesh at zero instances, so it draws nothing.
    for (const pool of pools.values()) if (pool.mesh) pool.mesh.count = 0;
    for (const it of items) {
      const key = `${it.cls}:${it.lod}`;
      const pool = poolFor(it.cls, it.lod, counts.get(key)!);
      if (!pool?.mesh) continue;
      const i = filled.get(key) ?? 0;
      filled.set(key, i + 1);
      position.set(it.east, it.north, 0);
      quaternion.setFromAxisAngle(up, it.rotZ);
      scale.setScalar(it.length);
      matrix.compose(position, quaternion, scale);
      pool.mesh.setMatrixAt(i, matrix);
      colour.setScalar(it.tint);
      pool.mesh.setColorAt(i, colour);
    }
    let calls = 0;
    for (const [key, n] of filled) {
      const mesh = pools.get(key)!.mesh!;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      calls++;
    }
    vesselCount = items.length;
    drawCalls = calls;
    lastSetMs = performance.now() - t0;
    sets.push(lastSetMs);
    if (sets.length > 20) sets.shift();
    // ONE repaint for this change. Never one per frame (see the header).
    map.triggerRepaint();
  }

  const layer: VesselCustomLayer = {
    id: VESSEL_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, context) {
      gl = context;
      const mine = ++generation;
      const timer = setTimeout(() => {
        if (!disposed && mine === generation && state === "loading") fail();
      }, LOAD_TIMEOUT_MS);
      loadModels().then(
        (l) => {
          clearTimeout(timer);
          if (disposed || mine !== generation) return;
          loaded = l;
          try {
            build(l);
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
      emit("loading");
    },
    render(context, args) {
      if (state !== "ready" || !renderer || !scene || !camera || !basis) return;
      const t0 = performance.now();
      const projection = (camera as THREE.Camera).projectionMatrix;
      projection.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(basis);
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
      const setSorted = [...sets].sort((a, b) => a - b);
      return {
        renderMedianMs: sorted.length ? sorted[sorted.length >> 1] : 0,
        lastSetMs,
        setMedianMs: setSorted.length ? setSorted[setSorted.length >> 1] : 0,
        vessels: vesselCount,
        drawCalls,
      };
    },
  };

  return {
    layer,
    setVessels(vs) {
      if (disposed || state === "failed") return;
      pending = vs;
      apply();
    },
    onState(cb) {
      listeners.push(cb);
    },
    state: () => state,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      listeners.length = 0;
      teardown();
    },
  };
}
