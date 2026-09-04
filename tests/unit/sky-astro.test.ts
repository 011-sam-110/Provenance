import { describe, it, expect } from "vitest";
import {
  angularSeparationDeg,
  equatorialToVector,
  gmstDegrees,
  precessFromJ2000,
  projectSky,
  projectSkyInto,
  skyBasis,
  stereographicScale,
  vectorToEquatorial,
} from "@/lib/sky/astro";

/**
 * The sky behind the hero globe.
 *
 * The whole module exists to answer one question — given that the camera is
 * looking at the point (lng, lat) on Earth at time t, WHICH WAY IS THE SKY? — and
 * there is exactly one way to get that wrong that nobody notices: a mirrored sky.
 * A mirror image of the real sky has the right stars at the right separations with
 * the right colours and the right brightnesses. Every plausibility check passes.
 * It is simply backwards, and it stays backwards until an astronomer looks at it.
 *
 * So the handedness test below is the point of this file, and it is derived from
 * first principles rather than copied off a chart.
 */

const J2000 = new Date("2000-01-01T12:00:00Z");

describe("gmstDegrees", () => {
  it("advances one sidereal revolution per sidereal day, not per solar day", () => {
    // A sidereal day is 23h56m04.0905s. This is the definitional property of GMST
    // and it is what makes the sky drift against the clock, so it is worth pinning
    // independently of any absolute epoch value.
    const t0 = new Date("2026-03-01T00:00:00Z");
    const t1 = new Date(t0.getTime() + 86_400_000);
    const advanced = ((gmstDegrees(t1) - gmstDegrees(t0)) % 360 + 360) % 360;
    // 360.98564736629 deg per solar day, i.e. 0.98564736629 deg more than a full turn.
    expect(advanced).toBeCloseTo(0.98564736629, 3);
  });

  it("is roughly 280.46 degrees at the J2000.0 epoch", () => {
    // 280.46061837 is the constant term of the standard GMST series, defined AT
    // JD 2451545.0 = 2000-01-01 12:00 TT. We pass UTC, which trails TT by ~64s,
    // and the sky turns 0.0042 deg per second, so ~0.27 deg of slack is expected
    // and is not an error. Wide tolerance on purpose: this test is here to catch a
    // wrong epoch or a radians/degrees slip, not to measure leap seconds.
    expect(gmstDegrees(J2000)).toBeGreaterThan(279.5);
    expect(gmstDegrees(J2000)).toBeLessThan(281);
  });

  it("lines up with the equinoxes and solstices — an external check on the whole time base", () => {
    // The strongest test in this file, because none of it is derived from the code.
    // GMST equals the Sun's right ascension plus 12 hours, so at 0h UT it lands on
    // known values through the year: about 0h at the September equinox, 12h at the
    // March equinox, 18h at the June solstice, 6h at the December solstice. If the
    // epoch, the sidereal rate or a degrees/hours conversion were wrong, these four
    // would not all fall into place at once.
    const hours = (d: Date) => gmstDegrees(d) / 15;
    const bad: string[] = [];
    const expected: [string, number][] = [
      ["2026-09-22T00:00:00Z", 0],
      ["2026-12-21T00:00:00Z", 6],
      ["2026-03-20T00:00:00Z", 12],
      ["2026-06-21T00:00:00Z", 18],
    ];
    for (const [iso, want] of expected) {
      const got = hours(new Date(iso));
      // Within 15 minutes of sidereal time. The slack absorbs the equinox not
      // falling exactly at 0h UT on the date used, not any error in the series.
      const off = Math.min(Math.abs(got - want), 24 - Math.abs(got - want));
      if (off > 0.25) bad.push(`${iso}: expected ~${want}h, got ${got.toFixed(3)}h`);
    }
    expect(bad).toEqual([]);
  });

  it("always returns a bearing in [0, 360)", () => {
    const bad: string[] = [];
    for (let d = 0; d < 400; d += 7) {
      const t = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000);
      const g = gmstDegrees(t);
      if (!(g >= 0 && g < 360)) bad.push(`${t.toISOString()} -> ${g}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("equatorialToVector", () => {
  it("puts the coordinate axes where the frame says they are", () => {
    expect(equatorialToVector(0, 0)).toEqual([expect.closeTo(1), expect.closeTo(0), expect.closeTo(0)]);
    expect(equatorialToVector(90, 0)).toEqual([expect.closeTo(0), expect.closeTo(1), expect.closeTo(0)]);
    expect(equatorialToVector(0, 90)).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(1)]);
  });

  it("round-trips through vectorToEquatorial", () => {
    const bad: string[] = [];
    for (const ra of [0, 45, 123.456, 270, 359.9]) {
      for (const dec of [-89, -30, 0, 12.5, 67, 89]) {
        const back = vectorToEquatorial(equatorialToVector(ra, dec));
        if (Math.abs(back.raDeg - ra) > 1e-6 || Math.abs(back.decDeg - dec) > 1e-6) {
          bad.push(`${ra},${dec} -> ${back.raDeg},${back.decDeg}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("preserves angular separation — Orion's belt stays 1.4 degrees wide", () => {
    // Alnitak and Alnilam, J2000, from the catalogue this ships.
    const alnitak = equatorialToVector(85.1897, -1.9426);
    const alnilam = equatorialToVector(84.0534, -1.2019);
    expect(angularSeparationDeg(alnitak, alnilam)).toBeCloseTo(1.35, 1);
  });
});

describe("skyBasis — where the camera is pointed", () => {
  it("looks at the ANTIPODE of the sub-observer point", () => {
    // The camera is outside Earth looking at its centre, and stars are at infinity.
    // So the sky behind the globe is exactly the sky at the zenith of the point on
    // the far side of the planet. That is the whole claim this feature makes, and
    // it is checkable in any planetarium app.
    const bad: string[] = [];
    const cases = [
      { lngDeg: 0, latDeg: 0, gmstDeg: 0 },
      { lngDeg: 8, latDeg: 8, gmstDeg: 0 },
      { lngDeg: -75, latDeg: 40, gmstDeg: 123.4 },
      { lngDeg: 151, latDeg: -33.9, gmstDeg: 287.1 },
    ];
    for (const c of cases) {
      const basis = skyBasis(c);
      const lst = c.gmstDeg + c.lngDeg;
      const antipode = equatorialToVector(lst + 180, -c.latDeg);
      const p = projectSky(antipode, basis, stereographicScale(60, 100));
      if (!p || Math.hypot(p.x, p.y) > 1e-6) {
        bad.push(`${JSON.stringify(c)} -> ${JSON.stringify(p)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("is orthonormal and right-handed", () => {
    const b = skyBasis({ lngDeg: 33, latDeg: -12, gmstDeg: 200 });
    const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    expect(dot(b.forward, b.forward)).toBeCloseTo(1, 9);
    expect(dot(b.up, b.up)).toBeCloseTo(1, 9);
    expect(dot(b.right, b.right)).toBeCloseTo(1, 9);
    expect(dot(b.forward, b.up)).toBeCloseTo(0, 9);
    expect(dot(b.forward, b.right)).toBeCloseTo(0, 9);
    expect(dot(b.up, b.right)).toBeCloseTo(0, 9);
  });

  it("keeps the celestial pole straight up, and nearer the centre the further SOUTH the globe is centred", () => {
    const scale = stereographicScale(60, 100);
    const ncp = equatorialToVector(0, 90);

    // "Up" is defined as the north celestial pole flattened into the view plane, so
    // the pole is directly above the sky centre in every view — x is 0 and y is
    // negative (screen y grows downward). What actually varies, and what carries
    // the physics, is HOW FAR up it sits: centring the globe on a southern latitude
    // puts the NORTHERN sky behind it, so the pole comes close to the middle of the
    // frame. Centring on a northern latitude pushes it far off the top.
    const north = projectSky(ncp, skyBasis({ lngDeg: 0, latDeg: 60, gmstDeg: 0 }), scale)!;
    const equator = projectSky(ncp, skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 }), scale)!;
    const south = projectSky(ncp, skyBasis({ lngDeg: 0, latDeg: -60, gmstDeg: 0 }), scale)!;

    for (const p of [north, equator, south]) {
      expect(p.x).toBeCloseTo(0, 9);
      expect(p.y).toBeLessThan(0);
    }
    expect(Math.abs(south.y)).toBeLessThan(Math.abs(equator.y));
    expect(Math.abs(equator.y)).toBeLessThan(Math.abs(north.y));
  });
});

describe("handedness — the silent failure", () => {
  /**
   * Derivation, so this test is not folk wisdom.
   *
   * Frame: x -> RA 0 / Dec 0, y -> RA 90, z -> north celestial pole. Right-handed.
   * Put the globe at lat 0 with local sidereal time 0. The sub-observer direction
   * is then r = (1,0,0), the camera looks the other way, so forward = (-1,0,0),
   * and screen up is the pole, up = (0,0,1).
   *
   *   right = forward x up = (-1,0,0) x (0,0,1) = (0,1,0) = RA 90
   *
   * A star at RA 170 is (cos170, sin170, 0) = (-0.985, +0.174, 0), so v.right is
   * POSITIVE and it renders to the RIGHT of centre.
   * A star at RA 190 is (-0.985, -0.174, 0), v.right is NEGATIVE, so it renders
   * to the LEFT.
   *
   * Increasing RA therefore runs LEFTWARD across the screen. That is the
   * mirror-of-a-map property every real star chart has, and it falls out of the
   * geometry rather than being asserted.
   */
  it("runs increasing right ascension LEFTWARD across the screen", () => {
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 });
    const scale = stereographicScale(60, 100);

    const lower = projectSky(equatorialToVector(170, 0), basis, scale);
    const centre = projectSky(equatorialToVector(180, 0), basis, scale);
    const higher = projectSky(equatorialToVector(190, 0), basis, scale);

    expect(centre!.x).toBeCloseTo(0, 9);
    expect(lower!.x).toBeGreaterThan(0);
    expect(higher!.x).toBeLessThan(0);
    // and symmetric about the centre
    expect(lower!.x).toBeCloseTo(-higher!.x, 9);
  });

  it("keeps Orion the right way round — Betelgeuse sits LEFT of Rigel", () => {
    // Betelgeuse RA 88.79, Rigel RA 78.63 (J2000, both from the shipped catalogue).
    // Betelgeuse has the greater RA, so by the rule above it must render to the
    // LEFT of Rigel. This is the same fact stated on a real constellation rather
    // than on two synthetic points, so a sign error cannot pass both.
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 84 - 180 });
    const scale = stereographicScale(60, 100);
    const betelgeuse = projectSky(equatorialToVector(88.7929, 7.4071), basis, scale);
    const rigel = projectSky(equatorialToVector(78.6345, -8.2016), basis, scale);
    expect(betelgeuse!.x).toBeLessThan(rigel!.x);
  });
});

describe("projectSky", () => {
  it("drops stars behind the viewer instead of folding them into the frame", () => {
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 });
    const scale = stereographicScale(60, 100);
    // Sky centre is RA 180; RA 0 is directly behind the camera.
    expect(projectSky(equatorialToVector(0, 0), basis, scale)).toBeNull();
  });

  it("is conformal — a small shape keeps its aspect ratio away from the centre", () => {
    // This is why stereographic and not gnomonic: constellation shapes have to
    // survive being 40 degrees off axis, because the hero shows a wide sky.
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 });
    const scale = stereographicScale(60, 100);
    const d = 0.05;
    const at = (ra: number, dec: number) => projectSky(equatorialToVector(ra, dec), basis, scale)!;

    for (const [ra, dec] of [
      [180, 0],
      [200, 20],
      [140, -35],
    ]) {
      // A small square in the tangent plane must stay square.
      const o = at(ra, dec);
      const dRa = at(ra + d / Math.cos((dec * Math.PI) / 180), dec);
      const dDec = at(ra, dec + d);
      const wide = Math.hypot(dRa.x - o.x, dRa.y - o.y);
      const tall = Math.hypot(dDec.x - o.x, dDec.y - o.y);
      expect(wide / tall).toBeCloseTo(1, 2);
    }
  });

  it("scales so the requested angle lands on the requested radius", () => {
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 });
    const scale = stereographicScale(45, 300);
    // 45 degrees off the sky centre (RA 180) must land 300px out.
    const p = projectSky(equatorialToVector(180 - 45, 0), basis, scale)!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(300, 6);
  });
});

describe("precessFromJ2000", () => {
  it("moves the sky about a third of a degree between J2000 and 2026", () => {
    // General precession is ~50.3 arcsec/yr, so ~26 years is ~0.36 deg. This is the
    // reason the correction exists at all: it is roughly six times larger than the
    // worst proper motion in the shipped catalogue (0.0588 deg / 30 yr, Groombridge
    // 1830), which is why that one is ignored and this one is not.
    const v = equatorialToVector(88.7929, 7.4071);
    const moved = precessFromJ2000(v, new Date("2026-01-01T00:00:00Z"));
    const sep = angularSeparationDeg(v, moved);
    expect(sep).toBeGreaterThan(0.25);
    expect(sep).toBeLessThan(0.5);
  });

  it("moves the equinox the right WAY — westward, so a star's RA increases", () => {
    // Direction is the half of precession a magnitude test cannot catch: getting the
    // sign backwards still moves the sky 0.36 degrees, just the wrong way, and 0.36
    // degrees is invisible by eye. So it is pinned against the published rate.
    // General precession in RA at the equator is ~46.1 arcsec/yr, which over the 26
    // years to 2026 is ~0.333 deg, and the declination term is ~0.145 deg.
    const at2026 = vectorToEquatorial(precessFromJ2000(equatorialToVector(0, 0), new Date("2026-01-01T00:00:00Z")));
    expect(at2026.raDeg).toBeGreaterThan(0.30);
    expect(at2026.raDeg).toBeLessThan(0.37);
    expect(at2026.decDeg).toBeGreaterThan(0.12);
    expect(at2026.decDeg).toBeLessThan(0.17);
  });

  it("is a rotation — it never changes the angle between two stars", () => {
    const a = equatorialToVector(85.1897, -1.9426);
    const b = equatorialToVector(84.0534, -1.2019);
    const t = new Date("2026-09-03T00:00:00Z");
    expect(angularSeparationDeg(precessFromJ2000(a, t), precessFromJ2000(b, t))).toBeCloseTo(
      angularSeparationDeg(a, b),
      6,
    );
  });

  it("does nothing at J2000 itself", () => {
    const v = equatorialToVector(123, 45);
    expect(angularSeparationDeg(v, precessFromJ2000(v, J2000))).toBeLessThan(1e-4);
  });
});

/**
 * `projectSkyInto` exists ONLY to take the allocation out of the per-frame path —
 * Starfield calls it once per catalogue star per tick.
 *
 * BE CLEAR ABOUT WHAT THIS DOES AND DOES NOT CATCH. `projectSky` is currently a
 * thin wrapper over `projectSkyInto`, so for as long as that holds, this compares
 * one implementation with itself and CANNOT see a bug in the shared body. That was
 * checked rather than assumed: perturbing `out.x` by one part in 10^7 leaves these
 * two cases green and is caught instead by "scales so the requested angle lands on
 * the requested radius" above. The maths is guarded by those tests, not by this one.
 *
 * What this pins is the WRAPPER RELATIONSHIP, which is the thing most likely to be
 * broken by a future edit: give `projectSky` its own copy of the maths again — an
 * easy-looking revert, or a well-meant "inline it for speed" — and the two drift
 * apart with only the hero's sky to show for it. It also covers two boundaries the
 * cases above do not reach: the behind-the-camera cull and the zero-length
 * direction. Equality is exact, not approximate: sharing an implementation means
 * any difference at all is a divergence rather than drift.
 */
describe("projectSkyInto (the allocation-free path)", () => {
  it("returns exactly what projectSky returns, across the sphere and past the cull", () => {
    const basis = skyBasis({ lngDeg: 12, latDeg: 41, gmstDeg: 233, bearingDeg: 27 });
    const scale = stereographicScale(60, 220);
    const out = { x: 0, y: 0 };
    let culled = 0;
    let projected = 0;

    for (let ra = 0; ra < 360; ra += 7) {
      for (let dec = -87; dec <= 87; dec += 6) {
        const v = equatorialToVector(ra, dec);
        const want = projectSky(v, basis, scale);
        const ok = projectSkyInto(v[0], v[1], v[2], basis, scale, out);

        expect(ok).toBe(want !== null);
        if (!want) {
          culled += 1;
          continue;
        }
        projected += 1;
        expect(out.x).toBe(want.x);
        expect(out.y).toBe(want.y);
      }
    }
    // Guard the guard: a sweep that never projected anything, or never hit the
    // behind-the-camera cull, would pass while proving nothing.
    expect(projected).toBeGreaterThan(500);
    expect(culled).toBeGreaterThan(0);
  });

  it("matches projectSky's degenerate branch for a zero-length direction", () => {
    const basis = skyBasis({ lngDeg: 0, latDeg: 0, gmstDeg: 0 });
    const scale = stereographicScale(60, 100);
    const out = { x: 0, y: 0 };
    const want = projectSky([0, 0, 0], basis, scale);
    expect(projectSkyInto(0, 0, 0, basis, scale, out)).toBe(want !== null);
    if (want) {
      expect(out.x).toBe(want.x);
      expect(out.y).toBe(want.y);
    }
  });
});
