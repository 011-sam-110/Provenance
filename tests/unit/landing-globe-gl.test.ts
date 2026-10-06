import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUCKET, FAMILIES, G, HALO_WIDTH, LAYERS, W_ALL, contentStyle, mixArr, type GlobeSpec, type Poly, type Still } from "@/lib/marketing/landingGlobe";
import { GL_PROGRAMS, createGlobeGL, dotPasses, opacityUnder, segmentVertices } from "@/lib/marketing/landingGlobeGL";

/**
 * The landing globe's dots and lines have two painters: the 2D one in `landingGlobe.ts` and
 * the WebGL one in `landingGlobeGL.ts`. The page uses the WebGL one and falls back to the
 * 2D one. So the same globe state must mean the same picture in both, and the page must
 * still draw when WebGL is not there.
 *
 * WHAT A NODE TEST CAN AND CANNOT SEE. There is no WebGL here, so nothing in this file
 * compiles a shader or looks at a pixel. `tests/e2e/landing.spec.ts` does that in a browser
 * (not in the gate), and `scripts/landing-look.mjs` puts the two painters side by side.
 * What IS checked here is everything that is plain data before it reaches the context:
 *
 *   - `contentStyle`, the one table both painters read;
 *   - `dotPasses`, the channel each layer of dots is gathered in and the order, where a
 *     mistake shows as dimmer cities and nowhere else;
 *   - the vertex layout of the lines;
 *   - the shader sources against the names the code asks for. WebGL answers a misspelt
 *     uniform with `null` and then ignores every write to it: no error, a wrong picture;
 *   - that `createGlobeGL` says "no" (null) and does not throw when the context cannot run it.
 */

const globe = (o: Partial<GlobeSpec> = {}): GlobeSpec => G({ cx: 400, cy: 300, R: 260, ...o });
const only = (id: string, strong = 1, ghost = 0): Float32Array => {
  const w = new Float32Array(LAYERS.length + 1);
  for (let i = 0; i < LAYERS.length; i++) w[i] = LAYERS[i].id === id ? strong : ghost;
  return w;
};

describe("contentStyle: the one table both painters read", () => {
  it("is light on the night globe and ink on paper, and switches at the midpoint", () => {
    expect(contentStyle(globe({ pp: 0 })).paper).toBe(false);
    expect(contentStyle(globe({ pp: 0.5 })).paper).toBe(false);
    expect(contentStyle(globe({ pp: 0.51 })).paper).toBe(true);
    // Camera blue on the night globe, the darker blue on paper.
    const cam = FAMILIES.indexOf("cam");
    expect(contentStyle(globe({ pp: 0 })).fam[cam]).toEqual([0x4c, 0xc9, 0xff]);
    expect(contentStyle(globe({ pp: 1 })).fam[cam]).toEqual([0x16, 0x48, 0xc8]);
  });

  it("lists every layer that is on, in draw order, and leaves out a layer that is off", () => {
    const all = contentStyle(globe());
    expect(all.dots.map((d) => LAYERS[d.i].id)).toEqual(LAYERS.map((l) => l.id));
    const cams = contentStyle(globe({ w: only("cameras") }));
    expect(cams.dots.map((d) => LAYERS[d.i].id)).toEqual(["cameras"]);
    expect(cams.cableA, "the cables are off when their weight is 0").toBe(0);
  });

  it("the camera highlight brings the cameras forward and quiets the rest", () => {
    const off = contentStyle(globe({ hl: 0 }));
    const on = contentStyle(globe({ hl: 1 }));
    const pick = (s: typeof off, id: string) => s.dots.find((d) => LAYERS[d.i].id === id)!;
    expect(pick(on, "cameras").alpha).toBe(pick(off, "cameras").alpha);
    expect(pick(on, "cameras").size).toBeGreaterThan(pick(off, "cameras").size);
    expect(pick(on, "planes").alpha).toBeLessThan(pick(off, "planes").alpha * 0.2);
    expect(on.coastA).toBeLessThan(off.coastA);
  });

  it("scales with the globe: a small globe has thinner lines and smaller dots, inside fixed limits", () => {
    const small = contentStyle(globe({ R: 80 }));
    const big = contentStyle(globe({ R: 700 }));
    expect(small.coastW).toBe(0.5);
    expect(big.coastW).toBe(1.2);
    expect(small.dots[0].size).toBeLessThan(big.dots[0].size);
    // The lens magnifies: the style follows R * zoom, and the content is clipped to the disc.
    const lens = contentStyle(globe({ R: 64, zoom: 2.55 }));
    expect(lens.lens).toBe(true);
    expect(lens.coastW).toBeCloseTo(contentStyle(globe({ R: 64 * 2.55 })).coastW, 6);
    expect(contentStyle(globe()).lens).toBe(false);
  });

  it("Antarctica fades as the globe unrolls", () => {
    expect(contentStyle(globe({ u: 0 })).south).toBe(1);
    expect(contentStyle(globe({ u: 1 })).south).toBe(0);
  });
});

describe("dotPasses: the order the dots are gathered in", () => {
  const states = [
    globe(),
    globe({ hl: 1 }),
    globe({ w: only("volcanoes", 1, 0.13) }),
    globe({ w: mixArr(W_ALL, only("cameras", 1, 0.3), 0.6), R: 80 }),
    globe({ pp: 1, u: 1 }),
  ];

  /* The gather can only REPLACE a pixel with the set's strength. Two layers in one channel
     would not add where they overlap, as they do on the 2D canvas: the stronger one would
     win, and a faint layer drawn after a bright one would pull the bright dots down wherever
     the faint ones sit on them. Nothing errors. The picture is just dimmer in the cities. */
  it("gives every layer a channel to itself, four layers a round", () => {
    for (const g of states) {
      const owner = new Map<string, number>();
      for (const p of dotPasses(contentStyle(g))) {
        expect(p.ch === 0 || p.ch === 1 || p.ch === 2 || p.ch === 3, `channel ${p.ch}`).toBe(true);
        const slot = `${p.round}:${p.ch}`;
        expect(owner.get(slot) ?? p.i, `two layers in round ${p.round}, channel ${p.ch}`).toBe(p.i);
        owner.set(slot, p.i);
      }
      expect(new Set(owner.values()).size, "a layer in two channels is drawn twice").toBe(owner.size);
    }
  });

  /* On paper a later layer covers an earlier one, and the rounds go to the canvas in order.
     On the night globe the order of the layers does not matter, and this one does: */
  it("keeps the 2D painter's layer order, and in each layer the halo goes before the core", () => {
    for (const g of states) {
      const s = contentStyle(g);
      const passes = dotPasses(s);
      const order = passes.map((p) => p.i).filter((i, k, all) => k === 0 || all[k - 1] !== i);
      expect(order).toEqual(s.dots.map((d) => d.i));
      const place = passes.map((p) => p.round * 4 + p.ch);
      expect(place, "the passes are not in round and channel order").toEqual([...place].sort((a, b) => a - b));
      for (let k = 1; k < passes.length; k++) {
        if (passes[k].i !== passes[k - 1].i) continue;
        expect(passes[k - 1].share, "the halo is the wide pass").toBeGreaterThan(passes[k].share);
        expect(passes[k - 1].strength, "a core drawn before its halo is pulled down to it").toBeLessThan(passes[k].strength);
      }
    }
  });

  it("takes the colour from the layer's family, whatever its channel", () => {
    const s = contentStyle(globe());
    for (const p of dotPasses(s)) expect(FAMILIES[p.fam]).toBe(LAYERS[p.i].fam);
  });

  it("on the night globe a layer is a wide halo pass and a core pass", () => {
    const passes = dotPasses(contentStyle(globe({ w: only("volcanoes") })));
    expect(passes.map((p) => p.share)).toEqual([HALO_WIDTH / 2, 0.5]);
    const halo = LAYERS.find((l) => l.id === "volcanoes")!.halo;
    // A core sits on its own halo, so a covered pixel holds both.
    expect(passes[1].strength / passes[0].strength).toBeCloseTo((1 + halo) / halo, 5);
  });

  it("on paper there is no halo, as in the 2D painter", () => {
    const passes = dotPasses(contentStyle(globe({ pp: 1, u: 1 })));
    expect(passes.length).toBe(LAYERS.length);
    expect(passes.every((p) => p.share === 0.5)).toBe(true);
  });

  it("drops a halo too faint to change a pixel, and keeps its core", () => {
    // A ghost layer at 0.13: its halo is about one part in a hundred of full strength.
    const passes = dotPasses(contentStyle(globe({ w: only("volcanoes", 1, 0.13) })));
    const cameras = LAYERS.findIndex((l) => l.id === "cameras");
    expect(passes.filter((p) => p.i === cameras).map((p) => p.share)).toEqual([0.5]);
  });

  it("never asks the target to hold more than it can", () => {
    for (const g of [globe(), globe({ hl: 1 }), globe({ pp: 1 })]) {
      for (const p of dotPasses(contentStyle(g))) {
        expect(p.strength).toBeGreaterThan(0);
        expect(p.strength).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("segmentVertices: the lines, as the vertex shader reads them", () => {
  const poly = (pts: Array<[number, number, 0 | 1]>): Poly => ({
    n: pts.length,
    lam: Float32Array.from(pts.map((p) => p[0])),
    phi: Float32Array.from(pts.map((p) => p[1])),
    cph: Float32Array.from(pts.map((p) => Math.cos(p[1]))),
    sph: Float32Array.from(pts.map((p) => Math.sin(p[1]))),
    brk: Uint8Array.from(pts.map((p) => p[2])),
  });

  it("makes one quad per segment and none across a break between two lines", () => {
    // Two polylines: three points, then two points. Three segments, not four.
    const v = segmentVertices(poly([[0, 0, 1], [0.1, 0, 0], [0.2, 0.1, 0], [1, 1, 1], [1.1, 1, 0]]));
    expect(v.length).toBe(3 * 6 * 6);
    const seg = (k: number) => Array.from(v.slice(k * 36, k * 36 + 4)).map((x) => Math.round(x * 100) / 100);
    expect(seg(0)).toEqual([0, 0, 0.1, 0]);
    expect(seg(1)).toEqual([0.1, 0, 0.2, 0.1]);
    expect(seg(2)).toEqual([1, 1, 1.1, 1]);
  });

  it("gives every vertex both ends of its segment and one corner of the quad", () => {
    const v = segmentVertices(poly([[0, 0, 1], [0.5, 0.25, 0]]));
    const corners = new Set<string>();
    for (let k = 0; k < 6; k++) {
      expect(Array.from(v.slice(k * 6, k * 6 + 4))).toEqual([0, 0, 0.5, 0.25]);
      corners.add(`${v[k * 6 + 4]},${v[k * 6 + 5]}`);
    }
    // Two triangles that cover all four corners.
    expect([...corners].sort()).toEqual(["0,-1", "0,1", "1,-1", "1,1"]);
  });

  it("is empty for an empty set, so a layer the snapshot lacks draws nothing", () => {
    expect(segmentVertices(poly([])).length).toBe(0);
  });
});

describe("opacityUnder: what the dots of light are added to", () => {
  const still = (o: Partial<Still>): Still => ({ img: {} as CanvasImageSource, cx: 400, cy: 300, s: 800, a: 1, ...o });

  it("is the ocean disc when there is nothing else", () => {
    expect(opacityUnder(globe({ disc: 1 }), [])).toBe(1);
    expect(opacityUnder(globe({ disc: 0 }), [])).toBe(0);
    expect(opacityUnder(globe({ disc: 1, a: 0.5 }), [])).toBe(0.5);
  });

  it("counts the Earth photograph the globe sits on, and only when the globe is on it", () => {
    // In the hero the disc is still closing while the photograph is at full strength.
    expect(opacityUnder(globe({ disc: 0.26 }), [still({})])).toBe(1);
    expect(opacityUnder(globe({ disc: 0 }), [still({ cx: 2000 })])).toBe(0);
    // A still that has not loaded draws nothing, so it hides nothing.
    expect(opacityUnder(globe({ disc: 0 }), [still({ img: null })])).toBe(0);
  });
});

describe("the shaders and the names the code asks them for", () => {
  /* WebGL does not report a uniform that is asked for and not declared. `getUniformLocation`
     returns null, every write to null is ignored, and the picture is wrong with a clean
     console. This is the only check of that in the repo. */
  for (const [name, prog] of Object.entries(GL_PROGRAMS)) {
    const src = prog.vs + "\n" + prog.fs;
    const declared = (kind: string) => [...src.matchAll(new RegExp(`${kind}\\s+\\w+\\s+(\\w+)\\s*;`, "g"))].map((m) => m[1]);

    it(`${name}: every uniform it is asked for is declared, and every declared one is asked for`, () => {
      expect([...new Set(declared("uniform"))].sort()).toEqual([...prog.uniforms].sort());
    });

    it(`${name}: every attribute it is asked for is declared`, () => {
      expect([...new Set(declared("attribute"))].sort()).toEqual([...prog.attributes].sort());
    });

    it(`${name}: what the vertex shader hands over is what the fragment shader takes`, () => {
      const vary = (s: string) => [...s.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]).sort();
      expect(vary(prog.fs)).toEqual(vary(prog.vs));
    });

    it(`${name}: the vertex shader writes every value it hands over`, () => {
      // A varying that is declared and never written is not an error. The fragment shader
      // reads whatever the driver left there.
      const vary = [...prog.vs.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      expect(vary.filter((v) => !new RegExp(`\\b${v}\\s*=[^=]`).test(prog.vs))).toEqual([]);
    });

    it(`${name}: no fragment shader finds its pixel with gl_FragCoord`, () => {
      // WebGL 1 declares gl_FragCoord mediump. On a GPU whose mediump is a 16-bit float it
      // cannot tell two pixels apart past column 1024, and the pass to the canvas would read
      // its neighbour's texel. The position comes from a varying (`vUv`).
      expect(prog.fs).not.toContain("gl_FragCoord");
    });

    it(`${name}: no variable is named with a word GLSL keeps for itself`, () => {
      // Found the hard way: a float named "half" stops the shader compiling, and the only
      // sign is a page that falls back to the slow painter.
      const RESERVED = new Set(["half", "input", "output", "sample", "filter", "fixed", "common", "partition", "active", "superp", "inline", "noinline", "volatile", "public", "static", "extern", "external", "interface", "long", "short", "double", "unsigned", "packed", "goto", "switch", "default", "class", "union", "enum", "typedef", "template", "this", "using", "namespace", "sizeof", "cast", "asm", "flat", "hvec2", "hvec3", "hvec4", "dvec2", "dvec3", "dvec4", "fvec2", "fvec3", "fvec4"]);
      const names = [...src.matchAll(/\b(?:float|vec2|vec3|vec4|int|bool|sampler2D)\s+(\w+)\s*[;=,)(]/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(3);
      expect(names.filter((n) => RESERVED.has(n))).toEqual([]);
    });
  }

  it("the depth bands in the shader are the 2D painter's", () => {
    for (const b of BUCKET) expect(GL_PROGRAMS.dot.vs).toContain(Number.isInteger(b) ? b.toFixed(1) : String(b));
  });
});

describe("createGlobeGL: a context that cannot run it gets a null, not an exception", () => {
  /* The caller treats null as "use the 2D painter". An exception here would stop the whole
     landing stage, and the page would have no globe at all.

     The fake answers every call with something truthy, so it is a context that CAN run the
     painter. Each case then takes one thing away, and that one thing must be what turns the
     answer into null. */
  const fake = (o: Record<string, unknown> = {}) => {
    const base: Record<string, unknown> = {
      isContextLost: () => false,
      getShaderPrecisionFormat: () => ({ precision: 23 }),
      getParameter: (p: unknown) => (p === "points" ? new Float32Array([1, 1024]) : 4096),
      ALIASED_POINT_SIZE_RANGE: "points",
      ...o,
    };
    return new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => ({})) }) as unknown as WebGLRenderingContext;
  };

  it("a context that can run it gets a painter", () => {
    expect(createGlobeGL(fake())).not.toBeNull();
  });
  it("a lost context", () => {
    expect(createGlobeGL(fake({ isContextLost: () => true }))).toBeNull();
  });
  it("no high precision in the fragment shader", () => {
    expect(createGlobeGL(fake({ getShaderPrecisionFormat: () => ({ precision: 0 }) }))).toBeNull();
  });
  it("points too small for a halo", () => {
    expect(createGlobeGL(fake({ getParameter: (p: unknown) => (p === "points" ? new Float32Array([1, 63]) : 4096) }))).toBeNull();
  });
  it("a shader that does not compile", () => {
    expect(createGlobeGL(fake({ getShaderParameter: () => false, getShaderInfoLog: () => "syntax error" }))).toBeNull();
  });
  it("a program that does not link", () => {
    expect(createGlobeGL(fake({ getProgramParameter: () => false, getProgramInfoLog: () => "link error" }))).toBeNull();
  });
});

describe("the two painters stay one picture", () => {
  it("the WebGL painter holds no style number of its own", () => {
    /* Every width, alpha, size and colour comes from contentStyle. A hex colour or a
       `LAYERS[..].size` in the WebGL file is a second source of truth, and the two painters
       then drift apart one edit at a time. */
    const src = readFileSync(join(process.cwd(), "lib", "marketing", "landingGlobeGL.ts"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(src).not.toMatch(/\.halo\s*\*\s*\d|\bly\.size\b/);
    expect(src).toMatch(/contentStyle\(g\)/);
  });
});
