import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DROP_WORDS,
  EDGE_BAND_PX,
  EDGE_MAX_PX_S,
  FALL_MS,
  HANG_PX,
  HOME_MS,
  LIFT_MS,
  MISS_WORDS,
  NO_INDEX_WORDS,
  OFF_MAP_WORDS,
  OPENING_WORDS,
  PERSON_TITLE,
  PREVIEW_MS,
  RING_RADIUS_PX,
  SETTLE_MS,
  SWING_START,
  TIP_MS,
  TOUCH_LIFT_PX,
  cameraCountWords,
  camerasInRing,
  cardPlace,
  visibleMapBox,
  dropHref,
  dropOutcome,
  edgePan,
  edgePanArea,
  edgePanArmed,
  isDrag,
  legendHint,
  needsMarker,
  personHref,
  personName,
  personZoom,
  placeName,
  ringCountWords,
  ringPoint,
  spotAtPoint,
  swingAtRest,
  swingStep,
  swingTarget,
  targetOnMap,
  type PersonMap,
  type Swing,
} from "@/lib/console/eyePerson";
import { buildCoverageIndex, type CoveragePoint } from "@/lib/eye/coverage";
import { hideCoverage, showCoverage, COVERAGE_CORE, COVERAGE_HALO, COVERAGE_SRC } from "@/lib/map/coverageOverlay";
import { EYE_DEFAULT_TILT, EYE_MAX_LAT, EYE_MAX_ZOOM, EYE_SPOT_ZOOM, parseEyeLink } from "@/lib/eye/places";
import { withoutArrivalFlags } from "@/lib/console/sourcesLink";

/**
 * The person on the console's map (components/console/EyePerson.tsx): a click or a carry,
 * where the ring sits, what a drop opens, when a drop opens nothing, where the card goes and how
 * he swings. These are the rules behind it, held without a browser. Where a drop goes is in
 * tests/unit/eye-coverage.test.ts, and tests/e2e/eye-person.spec.ts drives the real drag on the
 * real map.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

/**
 * A globe as MapLibre's behaves: a disc of radius R at (cx, cy), and `unproject` off the
 * disc answers with the nearest point on the horizon. A plain "is it inside the map" check
 * would take that answer for a real place.
 */
function fakeGlobe({ cx = 500, cy = 400, R = 300, lat0 = 0, lon0 = 0 } = {}): PersonMap {
  const toRad = Math.PI / 180;
  return {
    getZoom: () => 1.5,
    getBearing: () => 0,
    getProjection: () => ({ type: "globe" }),
    getTerrain: () => null,
    unproject([x, y]) {
      let dx = (x - cx) / R;
      let dy = (cy - y) / R;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        dx /= d;
        dy /= d;
      }
      const z = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      return { lat: Math.asin(dy) / toRad, lng: lon0 + Math.atan2(dx, z) / toRad };
    },
    project([lng, lat]) {
      const la = lat * toRad;
      const lo = (lng - lon0) * toRad;
      return { x: cx + R * Math.cos(la) * Math.sin(lo), y: cy - R * Math.sin(la) };
    },
  };
}

/** A flat map with no world copies, 2 px to a degree, centred on 0,0 at (500, 400). */
function fakeFlat(): PersonMap {
  return {
    getZoom: () => 3,
    getBearing: () => 0,
    getProjection: () => ({ type: "mercator" }),
    getTerrain: () => null,
    unproject: ([x, y]) => ({ lat: (400 - y) / 2, lng: (x - 500) / 2 }),
    project: ([lng, lat]) => ({ x: 500 + lng * 2, y: 400 - lat * 2 }),
  };
}

const q = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("a click or a carry", () => {
  it("is a click until a mouse has moved 3 px", () => {
    expect(isDrag(0, 0, "mouse")).toBe(false);
    expect(isDrag(2, 0, "mouse")).toBe(false);
    expect(isDrag(3, 0, "mouse")).toBe(true);
    expect(isDrag(2, 3, "mouse")).toBe(true);
  });

  it("lets a finger wander further, so a tap stays a tap", () => {
    expect(isDrag(6, 6, "touch")).toBe(false);
    expect(isDrag(8, 8, "touch")).toBe(true);
  });

  it("measures the distance in any direction", () => {
    expect(isDrag(-8, 0, "mouse")).toBe(true);
    expect(isDrag(0, -8, "mouse")).toBe(true);
  });
});

describe("the ring", () => {
  it("is 58 px below a mouse: he hangs from the pointer, and the ring is under his feet", () => {
    expect(HANG_PX).toBe(58);
    expect(ringPoint(640, 300, "mouse")).toEqual({ x: 640, y: 358 });
    expect(ringPoint(640, 300, "pen")).toEqual({ x: 640, y: 358 });
  });

  it("sits above a finger, which would otherwise cover it", () => {
    expect(ringPoint(200, 500, "touch")).toEqual({ x: 200, y: 500 - TOUCH_LIFT_PX });
  });
});

describe("where the card goes", () => {
  const card = { width: 204, height: 170 };
  const win = { width: 1440, height: 900 };
  const screenBox = (ring: { x: number; y: number }, c = card, w = win, type = "mouse") => {
    const p = cardPlace(ring, c, { left: 0, top: 0, right: w.width, bottom: w.height }, type);
    return { ...p, left: ring.x + p.x, top: ring.y + p.y, right: ring.x + p.x + c.width, bottom: ring.y + p.y + c.height };
  };

  it("hangs below the ring on a mouse, centred on it", () => {
    const b = screenBox({ x: 700, y: 300 });
    expect(b.side).toBe("below");
    expect(b.top).toBeGreaterThan(300);
    expect(b.left + card.width / 2).toBe(700);
    expect(b.arrowX).toBe(card.width / 2);
  });

  it("stands above the figure on a finger, which would cover anything below", () => {
    const b = screenBox({ x: 195, y: 500 }, card, { width: 390, height: 844 }, "touch");
    expect(b.side).toBe("above");
    expect(b.bottom).toBeLessThan(500 - 58);
  });

  it("flips at the bottom edge of the window, where Google's goes off the screen", () => {
    const b = screenBox({ x: 700, y: 860 });
    expect(b.side).toBe("above");
    expect(b.bottom).toBeLessThanOrEqual(win.height);
  });

  it("flips at the top edge for a finger", () => {
    const b = screenBox({ x: 195, y: 60 }, card, { width: 390, height: 844 }, "touch");
    expect(b.side).toBe("below");
    expect(b.top).toBeGreaterThanOrEqual(0);
  });

  it("slides along the left and right edges, with its arrow still on the ring", () => {
    const left = screenBox({ x: 10, y: 300 });
    expect(left.left).toBe(8);
    expect(left.left + left.arrowX).toBeGreaterThanOrEqual(10);
    const right = screenBox({ x: 1436, y: 300 });
    expect(right.right).toBe(win.width - 8);
    expect(right.left + right.arrowX).toBeLessThanOrEqual(1436);
    // The arrow stays on the card, even with the ring past its corner.
    expect(right.arrowX).toBeLessThanOrEqual(card.width - 16);
  });

  it.each([
    [0, 0],
    [1440, 0],
    [0, 900],
    [1440, 900],
    [720, 450],
  ])("stays on the screen with the ring at %i, %i", (x, y) => {
    const b = screenBox({ x, y });
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(win.width);
    expect(b.bottom).toBeLessThanOrEqual(win.height);
  });

  it("stays on a window too short for either side, on the roomier side", () => {
    const short = { width: 800, height: 240 };
    for (const y of [20, 120, 220]) {
      const b = screenBox({ x: 400, y }, card, short);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(short.height);
    }
  });

  it("keeps to the part of the map that shows, not to the window", () => {
    const area = { left: 232, top: 120, right: 1440, bottom: 900 };
    const near = cardPlace({ x: 240, y: 500 }, card, area, "mouse");
    expect(240 + near.x).toBe(232 + 8);
    expect(near.arrowX).toBeGreaterThan(0);
    const high = cardPlace({ x: 700, y: 130 }, card, area, "touch");
    expect(high.side).toBe("below");
    expect(130 + high.y).toBeGreaterThanOrEqual(120);
  });

  it("does not break on a card wider than the window", () => {
    const b = cardPlace({ x: 100, y: 100 }, { width: 500, height: 100 }, { left: 0, top: 0, right: 320, bottom: 500 }, "mouse");
    expect(100 + b.x).toBe(8);
  });
});

describe("the part of the map that shows", () => {
  const map = { left: 64, top: 48, right: 1440, bottom: 900 };
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  it("is the map's own box with nothing over it", () => {
    expect(visibleMapBox(map, {})).toEqual(map);
    // The closed sidebar sits beside the map, so it changes nothing.
    expect(visibleMapBox(map, { left: [box(0, 48, 64, 900)] })).toEqual(map);
  });

  it("starts past the open column, and past a panel slid along with it", () => {
    expect(visibleMapBox(map, { left: [box(0, 48, 232, 900)] }).left).toBe(232);
    expect(visibleMapBox(map, { left: [box(0, 48, 232, 900), box(232, 48, 684, 900)] }).left).toBe(684);
  });

  it("starts under a phone's pill, and ends at a phone's sheet", () => {
    const phone = { left: 0, top: 56, right: 390, bottom: 844 };
    const v = visibleMapBox(phone, { top: [box(8, 64, 52, 108), box(60, 64, 382, 108)], bottom: [box(0, 500, 390, 844)] });
    expect(v).toEqual({ left: 0, top: 108, right: 390, bottom: 500 });
  });

  it("never turns inside out", () => {
    const v = visibleMapBox(map, { left: [box(0, 0, 2000, 900)], top: [box(0, 0, 10, 2000)], bottom: [box(0, -5, 10, 0)] });
    expect(v.left).toBeLessThanOrEqual(v.right);
    expect(v.top).toBeLessThanOrEqual(map.bottom);
    expect(v.bottom).toBeGreaterThanOrEqual(map.top);
  });

  it("gives the edge pan its band there", () => {
    const v = visibleMapBox(map, { left: [box(0, 48, 232, 900)] });
    const y = 400;
    // 10 px past the column: panning left. 10 px past the window's own edge of the map: not.
    expect(edgePan({ x: 242, y }, { x: 242, y: y + HANG_PX }, v).x).toBeLessThan(0);
    expect(edgePan({ x: 300, y }, { x: 300, y: y + HANG_PX }, v).x).toBe(0);
  });
});

describe("the edge pan", () => {
  const box = { left: 100, top: 50, right: 1100, bottom: 750 };
  const at = (x: number, y: number) => edgePan({ x, y }, { x, y: y + HANG_PX }, box);

  it("does nothing in the middle of the map", () => {
    expect(at(600, 300)).toEqual({ x: 0, y: 0 });
  });

  it("pans towards the edge the pointer is near, on each axis", () => {
    expect(at(105, 300).x).toBeLessThan(0);
    expect(at(1095, 300).x).toBeGreaterThan(0);
    expect(at(600, 55).y).toBeLessThan(0);
  });

  it("starts about 30 px from the edge and reaches about 1,000 px/s at it", () => {
    expect(at(100 + EDGE_BAND_PX, 300).x).toBe(0);
    expect(at(100 + EDGE_BAND_PX - 1, 300).x).toBeLessThan(0);
    expect(at(100, 300).x).toBe(-EDGE_MAX_PX_S);
  });

  it("speeds up towards the edge", () => {
    expect(Math.abs(at(105, 300).x)).toBeGreaterThan(Math.abs(at(120, 300).x));
  });

  it("reads the bottom edge from the ring, or the ring could not reach it on the map", () => {
    expect(at(600, 750 - HANG_PX + 5).y).toBeGreaterThan(0);
    expect(at(600, 750 - HANG_PX - 40).y).toBe(0);
  });

  it("reads the top edge from a finger's ring, which is above the finger", () => {
    const finger = { x: 600, y: 120 };
    expect(edgePan(finger, ringPoint(finger.x, finger.y, "touch"), box).y).toBeLessThan(0);
  });

  it("stops once the pointer is well off the map, so a drag out to cancel does not spin the world", () => {
    expect(at(100 - EDGE_BAND_PX - 1, 300)).toEqual({ x: 0, y: 0 });
    expect(at(1100 + EDGE_BAND_PX + 1, 300)).toEqual({ x: 0, y: 0 });
    expect(at(600, 50 - HANG_PX - EDGE_BAND_PX - 1)).toEqual({ x: 0, y: 0 });
    // Past the band above the map, with the ring still on it.
    expect(at(600, 50 - EDGE_BAND_PX - 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("the edge pan's area", () => {
  // A window with the map at 100..1100 x 50..750, so its middle is (600, 400).
  const mapBox = { left: 100, top: 50, right: 1100, bottom: 750 };
  const middle = { x: 500, y: 350 };
  /** A globe of this radius in the map's px, at this zoom. */
  const globe = (radius: number, zoom: number) => ({
    ...fakeGlobe(),
    getZoom: () => zoom,
    unproject: ([x, y]: [number, number]) => {
      const d = Math.hypot(x - middle.x, y - middle.y);
      return d <= radius ? { lat: (middle.y - y) / 100, lng: (x - middle.x) / 100 } : { lat: 0, lng: 170 };
    },
    project: ([lng, lat]: [number, number]) =>
      lng === 170 ? { x: -9999, y: -9999 } : { x: lng * 100 + middle.x, y: middle.y - lat * 100 },
  });
  const pointerAt = (x: number, y: number) => ({ pointer: { x, y }, ring: { x, y: y + HANG_PX } });

  it("is the part of the map that shows, on a globe wider than the map", () => {
    const area = edgePanArea(globe(5000, 6), mapBox, mapBox);
    expect(area).toEqual({ from: mapBox, until: mapBox, speed: 1 });
  });

  it("is the same on a flat map", () => {
    const flat = { ...globe(100, 2), getProjection: () => ({ type: "mercator" }) };
    expect(edgePanArea(flat, mapBox, mapBox).from).toEqual(mapBox);
  });

  it("starts at the globe's own edge when the globe stops short of the map", () => {
    const area = edgePanArea(globe(430, 3), mapBox, mapBox);
    expect(area.from.right).toBeCloseTo(600 + 430, -1);
    expect(area.from.left).toBeCloseTo(600 - 430, -1);
    const { pointer, ring } = pointerAt(600 + 425, 380);
    expect(edgePan(pointer, ring, area.from, area.until).x).toBeGreaterThan(0);
  });

  it("still pans out to the map's edge when the space beside the globe is narrow", () => {
    const area = edgePanArea(globe(430, 3), mapBox, mapBox);
    expect(area.until.right).toBe(1100);
    const { pointer, ring } = pointerAt(1095, 380);
    expect(edgePan(pointer, ring, area.from, area.until).x).toBe(EDGE_MAX_PX_S);
  });

  it("does not spin for a pointer out in the wide space beside a small globe", () => {
    const area = edgePanArea(globe(120, 1), mapBox, mapBox);
    expect(area.until.right).toBeLessThan(800);
    const { pointer, ring } = pointerAt(1095, 380);
    expect(edgePan(pointer, ring, area.from, area.until)).toEqual({ x: 0, y: 0 });
    // At the small globe's own edge it does turn, towards the side that cannot be seen.
    const near = pointerAt(600 + 116, 380);
    expect(edgePan(near.pointer, near.ring, area.from, area.until).x).toBeGreaterThan(0);
  });

  it("turns a small globe no faster than about a radian a second", () => {
    expect(edgePanArea(globe(120, 1), mapBox, mapBox).speed).toBeCloseTo(0.12, 1);
    expect(edgePanArea(globe(430, 3), mapBox, mapBox).speed).toBeCloseTo(0.43, 1);
  });

  it("arms only once he is well inside, so a pick-up in the corner does not pan", () => {
    const area = edgePanArea(globe(430, 3), mapBox, mapBox);
    const corner = pointerAt(1080, 700);
    expect(edgePanArmed(corner.pointer, corner.ring, area)).toBe(false);
    const inside = pointerAt(600, 300);
    expect(edgePanArmed(inside.pointer, inside.ring, area)).toBe(true);
  });
});

describe("the swing", () => {
  const FRAME = 1000 / 60;
  /** Move at a steady speed, then stop, and report what the pendulum does after the stop. */
  function moveThenStop(vx: number) {
    let s: Swing = SWING_START;
    for (let t = 0; t < 600; t += FRAME) s = swingStep(s, vx, FRAME);
    const lean = s.angle;
    let peak = 0;
    let peakAt = 0;
    let restAt = 0;
    for (let t = FRAME; t < 2000; t += FRAME) {
      s = swingStep(s, 0, FRAME);
      if (-Math.sign(lean) * s.angle > peak) {
        peak = -Math.sign(lean) * s.angle;
        peakAt = t;
      }
      if (!restAt && swingAtRest(s)) restAt = t;
    }
    return { lean, peak, peakAt, restAt };
  }

  it("leans a little at about 150 px/s and strongly at about 1500 px/s", () => {
    expect(Math.abs(moveThenStop(150).lean)).toBeGreaterThan(3);
    expect(Math.abs(moveThenStop(150).lean)).toBeLessThan(9);
    expect(Math.abs(moveThenStop(1500).lean)).toBeGreaterThan(24);
    expect(Math.abs(moveThenStop(1500).lean)).toBeLessThanOrEqual(30);
  });

  it("trails: a move to the right sends the feet left, which is a positive rotation", () => {
    expect(moveThenStop(800).lean).toBeGreaterThan(0);
    expect(moveThenStop(-800).lean).toBeLessThan(0);
  });

  it("does not lean past its limit at any speed", () => {
    expect(Math.abs(swingTarget(100000))).toBeLessThanOrEqual(30);
  });

  it("overshoots on a stop, peaking at about +180 ms", () => {
    const { peak, peakAt, lean } = moveThenStop(1500);
    expect(peak).toBeGreaterThan(Math.abs(lean) * 0.15);
    expect(peakAt).toBeGreaterThan(150);
    expect(peakAt).toBeLessThan(250);
  });

  it("is at rest by about +800 ms, so the frames can stop", () => {
    const { restAt } = moveThenStop(1500);
    expect(restAt).toBeGreaterThan(600);
    expect(restAt).toBeLessThan(1000);
  });

  it("gives no lean to a vertical move: it reads only the horizontal speed it is given", () => {
    let s: Swing = SWING_START;
    for (let t = 0; t < 400; t += FRAME) s = swingStep(s, 0, FRAME);
    expect(s).toEqual({ angle: 0, speed: 0, vx: 0 });
    expect(swingAtRest(s)).toBe(true);
  });

  it("stays stable across a long frame", () => {
    let s: Swing = SWING_START;
    for (let i = 0; i < 20; i++) s = swingStep(s, 1500, 200);
    expect(Math.abs(s.angle)).toBeLessThan(45);
  });
});

describe("the point on the map", () => {
  it("gives the place under a point on the globe", () => {
    const s = spotAtPoint(fakeGlobe(), 500, 400);
    expect(s).not.toBeNull();
    expect(s!.lat).toBeCloseTo(0, 6);
    expect(s!.lon).toBeCloseTo(0, 6);
  });

  it("keeps a point close to the edge of the disc", () => {
    expect(spotAtPoint(fakeGlobe(), 500 + 299, 400)).not.toBeNull();
  });

  it("refuses the space off the globe, where unproject answers with the horizon", () => {
    const globe = fakeGlobe();
    // The guard is the round trip: unproject alone gives a real-looking place here.
    const fake = globe.unproject([980, 60]);
    expect(Number.isFinite(fake.lat)).toBe(true);
    expect(Math.abs(fake.lng)).toBeLessThanOrEqual(180);
    expect(spotAtPoint(globe, 980, 60)).toBeNull();
    expect(spotAtPoint(globe, 500 + 310, 400)).toBeNull();
  });

  it("wraps a longitude past the antimeridian on the globe", () => {
    const s = spotAtPoint(fakeGlobe({ lon0: 170 }), 500 + 200, 400);
    expect(s).not.toBeNull();
    expect(s!.lon).toBeLessThan(0);
    expect(s!.lon).toBeGreaterThan(-180);
  });

  it("refuses the blank beyond the edge of a flat world with no copies", () => {
    expect(spotAtPoint(fakeFlat(), 500 + 200, 400)).not.toBeNull();
    expect(spotAtPoint(fakeFlat(), 500 + 400, 400)).toBeNull();
  });

  it("refuses a latitude God's eye view would not open, which would land on the first preset", () => {
    const y = 400 - (EYE_MAX_LAT + 1) * 2;
    expect(spotAtPoint(fakeFlat(), 500, y)).toBeNull();
    expect(spotAtPoint(fakeFlat(), 500, 400 - (EYE_MAX_LAT - 1) * 2)).not.toBeNull();
  });

  it("does not refuse a point that terrain moves on the way back, however steep the ground", () => {
    const flat = fakeFlat();
    const shifted = { ...flat, project: (l: [number, number]) => ({ x: flat.project(l).x + 5, y: flat.project(l).y }) };
    expect(spotAtPoint(shifted, 500, 400)).toBeNull();
    const steep = { ...flat, project: (l: [number, number]) => ({ x: flat.project(l).x + 500, y: flat.project(l).y }) };
    expect(spotAtPoint({ ...steep, getTerrain: () => ({ source: "dem" }) }, 500, 400)).not.toBeNull();
  });

  it("still refuses the space off a globe if terrain is ever on there", () => {
    expect(spotAtPoint({ ...fakeGlobe(), getTerrain: () => ({ source: "dem" }) }, 980, 60)).toBeNull();
  });

  it("refuses a broken number", () => {
    const broken: PersonMap = { ...fakeFlat(), unproject: () => ({ lat: Number.NaN, lng: 0 }) };
    expect(spotAtPoint(broken, 10, 10)).toBeNull();
  });
});

describe("where a place is on screen", () => {
  it("answers on the near side of a globe", () => {
    expect(targetOnMap(fakeGlobe(), { lat: 10, lon: 10 })).not.toBeNull();
  });

  it("answers null round the far side, where `project` still gives a point on the disc", () => {
    expect(targetOnMap(fakeGlobe(), { lat: 0, lon: 170 })).toBeNull();
  });

  it("always answers on a flat map", () => {
    expect(targetOnMap(fakeFlat(), { lat: 10, lon: 20 })).toEqual({ x: 540, y: 380 });
  });

  it("needs a marker only when the place is not under the ring", () => {
    expect(needsMarker({ x: 100, y: 100 }, null)).toBe(false);
    expect(needsMarker({ x: 100, y: 100 }, { x: 110, y: 110 })).toBe(false);
    expect(needsMarker({ x: 100, y: 100 }, { x: 200, y: 100 })).toBe(true);
  });
});

describe("the address", () => {
  it("opens a city view whatever the console's zoom", () => {
    expect(personZoom(1.2)).toBe(EYE_SPOT_ZOOM);
    expect(personZoom(12)).toBe(EYE_SPOT_ZOOM);
    expect(personZoom(Number.NaN)).toBe(EYE_SPOT_ZOOM);
  });

  it("does not throw a visitor further out than they already were", () => {
    expect(personZoom(17.5)).toBe(17.5);
    expect(personZoom(25)).toBe(EYE_MAX_ZOOM);
  });

  it("is a spot /eye reads back as a spot, at that place, tilted, heading as the map does", () => {
    const href = personHref({ lat: 48.85837, lon: 2.29448 }, 3, -45);
    expect(href.startsWith("/eye?")).toBe(true);
    const target = parseEyeLink(q(href), false);
    expect(target.kind).toBe("spot");
    expect(target.view).toEqual({ lat: 48.85837, lon: 2.29448, zoom: EYE_SPOT_ZOOM, tilt: EYE_DEFAULT_TILT, heading: 315 });
  });

  it("opens a preset by its own link, so a crafted link is never what titles a page", () => {
    const place = { id: "westminster", area: "London", name: "Westminster" };
    const href = dropHref({ kind: "snap", place, spot: { lat: 1, lon: 2 } } as never, { lat: 3, lon: 4 }, 6, 0);
    expect(href).toBe("/eye?place=westminster");
  });

  it("opens a snap at its own spot and not at the ring", () => {
    const href = dropHref({ kind: "snap", spot: { lat: 55.8523, lon: -4.0888 } } as never, { lat: 3, lon: 4 }, 6, 20);
    const target = parseEyeLink(q(href!), false);
    expect(target.view).toMatchObject({ lat: 55.8523, lon: -4.0888, zoom: EYE_SPOT_ZOOM, heading: 20 });
  });

  it("opens a miss nowhere", () => {
    expect(dropHref({ kind: "miss", radiusKm: 500 }, { lat: 3, lon: 4 }, 6, 0)).toBeNull();
  });

  it("carries no words in any link it makes", () => {
    for (const href of [personHref({ lat: 35, lon: -40 }, 13, 0), dropHref({ kind: "exact" }, { lat: 35, lon: -40 }, 13, 0)!]) {
      const keys = [...q(href).keys()].sort();
      expect(keys).toEqual(["heading", "lat", "lon", "tilt", "z"]);
    }
  });
});

describe("a drop", () => {
  const close: PersonMap = { ...fakeFlat(), getZoom: () => 13 };

  it("opens the place under the ring at zoom 12 and closer, with the map's bearing", () => {
    const map: PersonMap = { ...close, getBearing: () => 30 };
    const out = dropOutcome(map, { x: 600, y: 300 }, null);
    expect(out.kind).toBe("open");
    if (out.kind !== "open") return;
    const p = q(out.href);
    expect(p.get("lat")).toBe("50");
    expect(p.get("lon")).toBe("50");
    expect(p.get("heading")).toBe("30");
    expect(p.get("tilt")).toBe(String(EYE_DEFAULT_TILT));
    expect(p.get("z")).toBe(String(EYE_SPOT_ZOOM));
  });

  it("opens the search's result wider out, not the point under the ring", () => {
    const index = buildCoverageIndex({ ok: true, regions: [""], cells: [[50.5, 50.5, 40, 0, "a:1", 0]] });
    const out = dropOutcome(fakeFlat(), { x: 600, y: 300 }, index);
    expect(out.kind).toBe("open");
    if (out.kind === "open") {
      expect(q(out.href).get("lat")).toBe("50.5");
      expect(q(out.href).get("lon")).toBe("50.5");
    }
  });

  it("opens nothing with nothing in range, so no bare ocean view", () => {
    const index = buildCoverageIndex({ ok: true, regions: [""], cells: [[-30, -30, 40, 0, "a:1", 0]] });
    expect(dropOutcome(fakeFlat(), { x: 600, y: 300 }, index)).toEqual({ kind: "cancel", why: "miss" });
  });

  it("opens at the ring when there is no index, wherever the zoom is", () => {
    const out = dropOutcome(fakeFlat(), { x: 600, y: 300 }, null);
    expect(out.kind).toBe("open");
    if (out.kind === "open") expect(q(out.href).get("lat")).toBe("50");
  });

  it("opens nothing off the map", () => {
    expect(dropOutcome(fakeFlat(), null, null)).toEqual({ kind: "cancel", why: "off-map" });
  });

  it("opens nothing off the globe", () => {
    expect(dropOutcome(fakeGlobe(), { x: 980, y: 60 }, null)).toEqual({ kind: "cancel", why: "off-globe" });
  });
});

describe("a camera in the ring", () => {
  const flat = fakeFlat();
  const point = (lat: number, lon: number, id: string, name = "A road"): CoveragePoint => [lat, lon, id, 0, name];
  const ring = { x: 500, y: 400 };

  it("is found within the ring's radius", () => {
    const px = RING_RADIUS_PX - 1;
    expect(camerasInRing(flat, ring, [point(0, px / 2, "a:1")])?.stillId).toBe("a:1");
  });

  it("is not found outside it", () => {
    const px = RING_RADIUS_PX + 1;
    expect(camerasInRing(flat, ring, [point(0, px / 2, "a:1")])).toBeNull();
  });

  it("takes the nearest, and says how many", () => {
    const hit = camerasInRing(flat, ring, [point(0, 3, "far:1"), point(0, 1, "near:1", "Near")]);
    expect(hit).toEqual({ stillId: "near:1", name: "Near", count: 2 });
  });

  it("prefers one with a picture, because the card shows it", () => {
    expect(camerasInRing(flat, ring, [point(0, 0, "", "Video"), point(0, 2, "s:1", "Still")])?.stillId).toBe("s:1");
  });
});

describe("the card's words", () => {
  it("say the count, and never live", () => {
    expect(cameraCountWords(55)).toBe("55 cameras");
    expect(cameraCountWords(1)).toBe("1 camera");
    expect(cameraCountWords(2629)).toBe("2,629 cameras");
    expect(ringCountWords(1)).toBe("A camera in the ring");
    expect(ringCountWords(3)).toBe("3 cameras in the ring");
    for (const s of [cameraCountWords(5), ringCountWords(5)]) expect(s).not.toMatch(/live/i);
  });

  it("name the place from the geocoder's town", () => {
    expect(placeName([{ name: "Carnoustie Street, Glasgow", locality: "Glasgow" }], "Strathclyde")).toBe("Glasgow");
  });

  it("fall back on the region when the lookup finds nothing", () => {
    expect(placeName([], "Strathclyde")).toBe("Strathclyde");
    expect(placeName(null, "Strathclyde")).toBe("Strathclyde");
    expect(placeName([{ name: "A82" }], "Strathclyde")).toBe("Strathclyde");
  });

  it("have no name at all when neither exists, and the count stands alone", () => {
    expect(placeName([], " ")).toBeNull();
  });
});

describe("the overlay", () => {
  function fakeMap() {
    const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
    const layers = new Map<string, { id: string; visibility: string }>();
    return {
      sources,
      layers,
      getSource: (id: string) => sources.get(id),
      addSource(id: string, spec: { data: unknown }) {
        const s = { data: spec.data, setData: (d: unknown) => (s.data = d) };
        sources.set(id, s);
      },
      getLayer: (id: string) => layers.get(id),
      addLayer(layer: { id: string }) {
        layers.set(layer.id, { id: layer.id, visibility: "visible" });
      },
      setLayoutProperty(id: string, name: string, value: string) {
        const l = layers.get(id)!;
        if (name === "visibility") l.visibility = value;
      },
    };
  }
  const asMap = (m: ReturnType<typeof fakeMap>) => m as never;

  it("adds nothing until it is asked", () => {
    const map = fakeMap();
    hideCoverage(asMap(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it("is one source and one pair of layers, a soft halo under a bright core", () => {
    const map = fakeMap();
    expect(showCoverage(asMap(map), { a: 1 })).toBe(true);
    expect([...map.sources.keys()]).toEqual([COVERAGE_SRC]);
    expect([...map.layers.keys()]).toEqual([COVERAGE_HALO, COVERAGE_CORE]);
  });

  it("draws nothing once it is hidden, and comes back without adding anything twice", () => {
    const map = fakeMap();
    showCoverage(asMap(map), { a: 1 });
    hideCoverage(asMap(map));
    expect([...map.layers.values()].map((l) => l.visibility)).toEqual(["none", "none"]);
    showCoverage(asMap(map), { a: 1 });
    expect([...map.layers.values()].map((l) => l.visibility)).toEqual(["visible", "visible"]);
    expect(map.layers.size).toBe(2);
  });

  it("sends the worker new data only when the data changed", () => {
    const map = fakeMap();
    const first = { a: 1 };
    showCoverage(asMap(map), first);
    const source = map.sources.get(COVERAGE_SRC)!;
    source.data = "untouched";
    showCoverage(asMap(map), first);
    expect(source.data).toBe("untouched");
    showCoverage(asMap(map), { a: 2 });
    expect(source.data).toEqual({ a: 2 });
  });

  it("comes back after a basemap swap wiped the style", () => {
    const map = fakeMap();
    showCoverage(asMap(map), { a: 1 });
    map.sources.clear();
    map.layers.clear();
    expect(showCoverage(asMap(map), { a: 1 })).toBe(true);
    expect(map.layers.size).toBe(2);
  });

  it("says so when a style in the middle of a swap will not take it", () => {
    const map = { ...fakeMap(), getSource: () => undefined, addSource: () => { throw new Error("Style is not done loading"); } };
    expect(showCoverage(asMap(map as never), { a: 1 })).toBe(false);
  });
});

describe("the timing, as Google's was measured", () => {
  it("lifts in about 216 ms, falls in 300 ms and flies home in 500 ms", () => {
    expect(LIFT_MS).toBe(216);
    expect(FALL_MS).toBe(300);
    expect(HOME_MS).toBe(500);
    const css = read("components", "console", "EyePerson.module.css");
    expect(css).toContain("personLift 216ms");
    expect(css).toContain("transform 300ms cubic-bezier(0.33, 0, 0.67, 0.33)");
    expect(css).toContain("transform 500ms ease");
  });

  it("settles the ring first, then shows the card about 200 ms after the last move", () => {
    expect(SETTLE_MS).toBeLessThan(PREVIEW_MS);
    expect(PREVIEW_MS).toBe(200);
  });

  it("gives the tooltip about a second", () => {
    expect(TIP_MS).toBe(1000);
  });
});

describe("the words", () => {
  it("are the ones Sam's plan names", () => {
    expect(DROP_WORDS).toBe("Drop to open God's eye view");
    expect(MISS_WORDS).toBe("No cameras near here");
  });

  it("say what the button does in each state", () => {
    expect(personName(false)).toMatch(/^Show camera coverage/);
    expect(personName(false)).toMatch(/Drag onto the map/);
    expect(personName(true)).toMatch(/^Hide camera coverage/);
    expect(personName(true)).toMatch(/Arrow keys/);
    expect(personName(true)).toMatch(/Enter/);
    expect(PERSON_TITLE).toMatch(/^Drag/);
    expect(PERSON_TITLE).toMatch(/Click/);
  });

  it("say tap on a finger and click on a mouse", () => {
    expect(legendHint(true)).toMatch(/^Tap the map/);
    expect(legendHint(false)).toMatch(/^Click the map/);
  });

  it("use no em dash or en dash, and never call anything live", () => {
    for (const s of [DROP_WORDS, MISS_WORDS, NO_INDEX_WORDS, OFF_MAP_WORDS, OPENING_WORDS, PERSON_TITLE, personName(true), personName(false), legendHint(true)]) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/\blive\b/i);
    }
  });
});

describe("the wiring, read as source", () => {
  const person = code("components", "console", "EyePerson.tsx");
  const stage = code("components", "console", "StageHost.tsx");

  it("stands on the map's stage, and not on an expanded widget or a map with no WebGL", () => {
    expect(stage).toContain("<EyePerson />");
    // Both early returns come before the map's branch, which is the one that mounts it.
    expect(stage.indexOf("<WidgetDetail")).toBeLessThan(stage.indexOf("<EyePerson />"));
    expect(stage.indexOf("gl === false")).toBeLessThan(stage.indexOf("<EyePerson />"));
    expect(stage.indexOf("<MapBoundary")).toBeLessThan(stage.indexOf("<EyePerson />"));
  });

  it("is not on the Streets wall", () => {
    expect(person).toMatch(/mode !== "wall"/);
  });

  it("opens with a full page load, like every way in to /eye", () => {
    expect(person).toContain("window.location.assign(");
    expect(person).not.toMatch(/from "next\/link"/);
    expect(person).not.toMatch(/from "next\/navigation"/);
  });

  it("uses the map through the one registry, and moves with a transform", () => {
    expect(person).toContain("getMapInstance()");
    expect(person).toContain("translate3d(");
  });

  it("holds Escape while it carries or while coverage is on, through the inspector's own protocol", () => {
    expect(person).toContain("data-owns-escape");
    expect(person).toMatch(/addEventListener\("keydown", [a-zA-Z]+, true\)/);
    expect(person).toContain("e.stopPropagation()");
  });

  it("sits in the corner directly above the credit, whatever else the corner holds", () => {
    expect(person).toContain("insertBefore(");
    expect(person).toContain("ATTRIB_CONTROL_CLASS");
  });

  it("captures the pointer", () => {
    expect(person).toContain("setPointerCapture(");
    expect(read("components", "console", "EyePerson.module.css")).toContain("touch-action: none");
  });

  it("asks for motion only where the visitor allows it", () => {
    const css = read("components", "console", "EyePerson.module.css");
    const allowed = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(allowed).toBeGreaterThan(-1);
    // Nothing transitions or animates outside that block. The only rotations out here read
    // --swing, which the frame loop does not write with reduced motion, or are the card's arrow.
    const outside = css.slice(0, allowed);
    expect(outside).not.toMatch(/\btransition\s*:/);
    expect(outside).not.toMatch(/\banimation\s*:/);
    expect(person).toMatch(/!r\.aim && !reduced\(\)/);
  });

  it("writes per frame without React: the frame loop sets no state of its own", () => {
    expect(person).toContain("requestAnimationFrame(tick)");
    expect(person).toContain("--swing");
  });

  it("asks the network only through its one client, and never with the pointer's place", () => {
    expect(person).not.toContain("fetch(");
    const client = code("lib", "console", "eyeCoverageClient.ts");
    expect(client.match(/fetch\(/g)).toHaveLength(3);
    expect(client).toContain("/api/eye/coverage");
    expect(client).toContain("/api/geocode");
  });

  it("carries no name in a link, so a crafted link cannot title a page", () => {
    expect(code("lib", "console", "eyePerson.ts")).not.toMatch(/\.set\("(name|title|label)"/);
    expect(code("lib", "eye", "places.ts")).not.toMatch(/\.set\("(name|title|label)"/);
  });

  it("takes a click on the map before MapLibre does, while coverage is on", () => {
    expect(person).toMatch(/addEventListener\("click", [a-zA-Z]+, true\)/);
  });
});

describe("the old buttons are gone", () => {
  it("the console no longer reads eye=, it only leaves the address", () => {
    const shell = code("components", "shell", "ConsoleShell.tsx");
    expect(shell).not.toContain("parseEyeReturn");
    expect(shell).not.toContain("eyeReturnStore");
    expect(shell).toContain("withoutArrivalFlags(");
  });

  it("an old link's eye= never stays in the address, whatever it holds", () => {
    for (const raw of ["place%3Dtower-bridge", "https%3A%2F%2Fevil.example", "%3Cscript%3E", ""]) {
      expect(withoutArrivalFlags("/app", `?lat=51.5&lon=-0.1&eye=${raw}`)).toBe("/app?lat=51.5&lon=-0.1");
    }
    expect(withoutArrivalFlags("/app", "?eye=x&sources=open")).toBe("/app");
  });

  it("Map settings has no God's eye view section and no zoom gate", () => {
    const tool = read("components", "shell", "inspector", "tools", "SettingsTool.tsx");
    expect(tool).not.toMatch(/title="God's eye/);
    expect(tool).not.toContain("eyeSpotHref");
    expect(tool).not.toContain("EYE_LINK_MIN_CONSOLE_ZOOM");
  });

  it("the chip's rules left the stylesheet", () => {
    for (const sheet of ["globals.css", "console-sidebar.css"]) expect(read("app", sheet)).not.toContain("tn-eye-return");
  });
});
