import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DROP_WORDS,
  OFF_MAP_WORDS,
  OPENING_WORDS,
  PERSON_NAME,
  PERSON_TITLE,
  TOUCH_LIFT_PX,
  centreSpot,
  dropOutcome,
  isDrag,
  labelAbove,
  labelShift,
  personHref,
  personZoom,
  ringPoint,
  spotAtPoint,
  type PersonMap,
} from "@/lib/console/eyePerson";
import { EYE_DEFAULT_TILT, EYE_MAX_LAT, EYE_MAX_ZOOM, EYE_SPOT_ZOOM, parseEyeLink } from "@/lib/eye/places";
import { withoutArrivalFlags } from "@/lib/console/sourcesLink";

/**
 * The person on the console's map (components/console/EyePerson.tsx): a tap or a drag,
 * where the ring sits, what a drop opens, and when a drop opens nothing. These are the
 * rules behind it, held without a browser; tests/e2e/eye-person.spec.ts drives the real
 * drag on the real map.
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
    getCenter: () => ({ lat: lat0, lng: lon0 }),
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
    getCenter: () => ({ lat: 0, lng: 0 }),
    getZoom: () => 3,
    getBearing: () => 0,
    getProjection: () => ({ type: "mercator" }),
    getTerrain: () => null,
    unproject: ([x, y]) => ({ lat: (400 - y) / 2, lng: (x - 500) / 2 }),
    project: ([lng, lat]) => ({ x: 500 + lng * 2, y: 400 - lat * 2 }),
  };
}

const q = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("a tap or a drag", () => {
  it("is a tap until the pointer has moved past the threshold", () => {
    expect(isDrag(0, 0, "mouse")).toBe(false);
    expect(isDrag(3, 3, "mouse")).toBe(false);
    expect(isDrag(4, 4, "mouse")).toBe(true);
  });

  it("lets a finger wander further than a mouse before it counts as a drag", () => {
    expect(isDrag(6, 6, "mouse")).toBe(true);
    expect(isDrag(6, 6, "touch")).toBe(false);
    expect(isDrag(8, 8, "touch")).toBe(true);
  });

  it("measures the distance in any direction", () => {
    expect(isDrag(-8, 0, "mouse")).toBe(true);
    expect(isDrag(0, -8, "mouse")).toBe(true);
  });
});

describe("the ring", () => {
  it("sits exactly under a mouse", () => {
    expect(ringPoint(640, 300, "mouse")).toEqual({ x: 640, y: 300 });
    expect(ringPoint(640, 300, "pen")).toEqual({ x: 640, y: 300 });
  });

  it("sits above a finger, which would otherwise cover it", () => {
    expect(ringPoint(200, 500, "touch")).toEqual({ x: 200, y: 500 - TOUCH_LIFT_PX });
  });
});

describe("the label", () => {
  it("stays inside the window at both edges and is left alone in the middle", () => {
    expect(labelShift(200, 180, 390)).toBe(0);
    expect(labelShift(10, 180, 390)).toBe(88); // centre moves to 98: half the label plus 8
    expect(labelShift(385, 180, 390)).toBe(-93); // centre moves to 292
  });

  it("centres itself when the window is narrower than the label", () => {
    expect(labelShift(10, 400, 390)).toBe(185);
  });

  it("goes below the ring for a mouse and above the figure for a finger", () => {
    expect(labelAbove(400, "mouse", 900)).toBe(false);
    expect(labelAbove(400, "touch", 900)).toBe(true);
  });

  it("changes side when there is no room on its usual side", () => {
    expect(labelAbove(890, "mouse", 900)).toBe(true);
    expect(labelAbove(40, "touch", 900)).toBe(false);
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

  it("does not refuse a point that terrain moves a few pixels on the way back", () => {
    const flat = fakeFlat();
    const shifted = { ...flat, project: (l: [number, number]) => ({ x: flat.project(l).x + 5, y: flat.project(l).y }) };
    expect(spotAtPoint(shifted, 500, 400)).toBeNull();
    expect(spotAtPoint({ ...shifted, getTerrain: () => ({ source: "dem" }) }, 500, 400)).not.toBeNull();
  });

  it("refuses a broken number", () => {
    const broken: PersonMap = { ...fakeFlat(), unproject: () => ({ lat: Number.NaN, lng: 0 }) };
    expect(spotAtPoint(broken, 10, 10)).toBeNull();
  });
});

describe("the centre of the map, for a tap", () => {
  it("is the map's own centre", () => {
    expect(centreSpot(fakeGlobe({ lat0: 12.5, lon0: 45 }))).toEqual({ lat: 12.5, lon: 45 });
  });

  it("stays a place /eye will open, wherever the camera has gone", () => {
    const polar: PersonMap = { ...fakeFlat(), getCenter: () => ({ lat: 89, lng: 200 }) };
    expect(centreSpot(polar)).toEqual({ lat: EYE_MAX_LAT, lon: -160 });
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

  it("opens the middle of the ocean the same way, because a spot has no name to get wrong", () => {
    const target = parseEyeLink(q(personHref({ lat: 35, lon: -40 }, 2, 0)), false);
    expect(target.kind).toBe("spot");
    expect(target.view.zoom).toBe(EYE_SPOT_ZOOM);
  });
});

describe("a drop", () => {
  it("opens the place under the ring, with the map's bearing", () => {
    const map: PersonMap = { ...fakeFlat(), getBearing: () => 30 };
    const out = dropOutcome(map, { x: 600, y: 300 });
    expect(out.kind).toBe("open");
    if (out.kind !== "open") return;
    const p = q(out.href);
    expect(p.get("lat")).toBe("50");
    expect(p.get("lon")).toBe("50");
    expect(p.get("heading")).toBe("30");
    expect(p.get("tilt")).toBe(String(EYE_DEFAULT_TILT));
    expect(p.get("z")).toBe(String(EYE_SPOT_ZOOM));
  });

  it("opens nothing off the map", () => {
    expect(dropOutcome(fakeFlat(), null)).toEqual({ kind: "cancel", why: "off-map" });
  });

  it("opens nothing off the globe", () => {
    expect(dropOutcome(fakeGlobe(), { x: 980, y: 60 })).toEqual({ kind: "cancel", why: "off-globe" });
  });
});

describe("the words", () => {
  it("are the ones Sam's plan names", () => {
    expect(DROP_WORDS).toBe("Drop to open God's eye view");
  });

  it("say what a tap does in the name, and what a drag does in the title", () => {
    expect(PERSON_NAME).toMatch(/God's eye view/);
    expect(PERSON_NAME).toMatch(/centre of the map/);
    expect(PERSON_TITLE).toMatch(/^Drag/);
  });

  it("use no em dash or en dash", () => {
    for (const s of [DROP_WORDS, OFF_MAP_WORDS, OPENING_WORDS, PERSON_NAME, PERSON_TITLE]) {
      expect(s).not.toMatch(/[–—]/);
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

  it("holds Escape only while it carries, through the inspector's own protocol", () => {
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
    // Nothing tilts or transitions outside that block.
    const outside = css.slice(0, allowed);
    expect(outside).not.toMatch(/\btransition\s*:/);
    expect(outside).not.toMatch(/\brotate\(/);
    expect(outside).not.toMatch(/\banimation\s*:/);
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
    expect(tool).not.toMatch(/God's eye/);
    expect(tool).not.toContain("eyeSpotHref");
    expect(tool).not.toContain("EYE_LINK_MIN_CONSOLE_ZOOM");
  });

  it("the chip's rules left the stylesheet", () => {
    expect(read("app", "globals.css")).not.toContain("tn-eye-return");
  });
});
