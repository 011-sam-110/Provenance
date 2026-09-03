import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkyCatalogue } from "@/lib/sky/catalog";
import { equatorialToVector, angularSeparationDeg } from "@/lib/sky/astro";
import { ASTERISMS, resolveStarRef, type StarRef } from "@/lib/sky/constellations.data";

// Read the real committed catalogue off disk — the same file `resolveStarRef` and the
// hero sky map resolve these asterisms against in production, not a hand-crafted stand-in
// that could drift from it. This is what stops a typo in constellations.data.ts from
// silently deleting half of Orion: every StarRef here is checked against the actual
// `names` block that ships.
const RAW = readFileSync(join(process.cwd(), "public", "sky", "naked-eye.json"), "utf8");
const cat = parseSkyCatalogue(JSON.parse(RAW));

const resolve = (ref: StarRef): number => resolveStarRef(ref, cat.names, cat.mag);

const sepDeg = (i: number, j: number): number =>
  angularSeparationDeg(
    equatorialToVector(cat.raDeg(i), cat.decDeg(i)),
    equatorialToVector(cat.raDeg(j), cat.decDeg(j)),
  );

describe("ASTERISMS — every StarRef resolves against the real catalogue", () => {
  it("resolves every star referenced by every asterism (a broken figure names every missing star at once)", () => {
    const bad: string[] = [];
    for (const ast of ASTERISMS) {
      for (const [a, b] of ast.lines) {
        for (const ref of [a, b]) {
          if (resolve(ref) === -1) bad.push(`${ast.name} (${ast.con}): [${ref[0]}, ${ref[1]}] did not resolve`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no asterism has zero lines", () => {
    const bad = ASTERISMS.filter((a) => a.lines.length === 0).map((a) => a.name);
    expect(bad).toEqual([]);
  });

  it("no line joins a star to itself", () => {
    const bad: string[] = [];
    for (const ast of ASTERISMS) {
      for (const [a, b] of ast.lines) {
        if (a[0] === b[0] && a[1] === b[1]) bad.push(`${ast.name}: [${a[0]}, ${a[1]}] joined to itself`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every constellation abbreviation used (the asterism's own `con` and every StarRef's) is exactly 3 characters", () => {
    const bad: string[] = [];
    for (const ast of ASTERISMS) {
      if (ast.con.length !== 3) bad.push(`asterism "${ast.name}": con="${ast.con}" is ${ast.con.length} chars`);
      for (const [a, b] of ast.lines) {
        for (const ref of [a, b]) {
          if (ref[1].length !== 3) bad.push(`${ast.name}: [${ref[0]}, ${ref[1]}] — "${ref[1]}" is not 3 chars`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("every line segment is under 45 degrees of arc — catches a Bayer letter resolving in the WRONG constellation, which draws a line across the entire sky", () => {
    const bad: string[] = [];
    for (const ast of ASTERISMS) {
      for (const [a, b] of ast.lines) {
        const ia = resolve(a);
        const ib = resolve(b);
        if (ia === -1 || ib === -1) continue; // already reported by the resolution test above
        const sep = sepDeg(ia, ib);
        if (!(sep < 45)) {
          bad.push(`${ast.name}: [${a[0]}, ${a[1]}] - [${b[0]}, ${b[1]}] is ${sep.toFixed(2)} deg apart`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("Orion's belt (Delta, Epsilon, Zeta Orionis — Mintaka, Alnilam, Alnitak) is mutually within about 3 degrees", () => {
    const mintaka = resolve(["Del", "Ori"]);
    const alnilam = resolve(["Eps", "Ori"]);
    const alnitak = resolve(["Zet", "Ori"]);
    expect(mintaka).toBeGreaterThanOrEqual(0);
    expect(alnilam).toBeGreaterThanOrEqual(0);
    expect(alnitak).toBeGreaterThanOrEqual(0);
    expect(sepDeg(mintaka, alnilam)).toBeLessThan(3);
    expect(sepDeg(alnilam, alnitak)).toBeLessThan(3);
    expect(sepDeg(mintaka, alnitak)).toBeLessThan(3);
  });
});

describe("resolveStarRef", () => {
  it("returns -1 for a star that does not exist in the given constellation", () => {
    expect(resolveStarRef(["Zzz", "Ori"], cat.names, cat.mag)).toBe(-1);
  });

  it("returns -1 for a constellation that does not exist", () => {
    expect(resolveStarRef(["Alp", "Zzz"], cat.names, cat.mag)).toBe(-1);
  });

  it('tolerates the "Alp-1" component suffix: a bare "Alp" lookup resolves to Rigil Kentaurus, catalogued only as "Alp-1"', () => {
    const idx = resolveStarRef(["Alp", "Cen"], cat.names, cat.mag);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(cat.nameFor(idx)?.b).toBe("Alp-1");
    expect(cat.nameFor(idx)?.n).toBe("Rigil Kentaurus");
  });

  it("an exact (unsuffixed) match always wins over a component match", () => {
    // Betelgeuse is catalogued as a bare "Alp" in Ori, which also has several
    // numbered Pi/Omicron/Theta components — confirm the bare lookup is not
    // somehow diverted onto one of those.
    const idx = resolveStarRef(["Alp", "Ori"], cat.names, cat.mag);
    expect(cat.nameFor(idx)?.n).toBe("Betelgeuse");
  });

  it("among several exact matches sharing one literal designation, the brightest wins", () => {
    // HYG catalogues Mizar and its close companion under the identical literal
    // "Zet" for Ursa Majoris (no numeric suffix at all on either row) — the
    // brighter one, Mizar itself, must be the one a line resolves to.
    const idx = resolveStarRef(["Zet", "UMa"], cat.names, cat.mag);
    expect(cat.nameFor(idx)?.n).toBe("Mizar");
  });

  it("among component matches, the lowest-numbered component wins", () => {
    // Scorpius has both Iota-1 and Iota-2; the bare lookup must prefer Iota-1.
    const idx = resolveStarRef(["Iot", "Sco"], cat.names, cat.mag);
    expect(cat.nameFor(idx)?.b).toBe("Iot-1");
  });

  it("accepts a ref that already carries an explicit suffix", () => {
    const idx = resolveStarRef(["Omi-2", "CMa"], cat.names, cat.mag);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(cat.nameFor(idx)?.b).toBe("Omi-2");
  });
});
