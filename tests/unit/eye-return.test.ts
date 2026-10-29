import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EYE_PLACES,
  consoleHref,
  eyeLinkQuery,
  parseEyeLink,
  parseEyeReturn,
  type EyeTarget,
  type EyeView,
} from "@/lib/eye/places";
import { EYE_RETURN_LABEL, eyeReturnHint, eyeReturnName, eyeReturnStore } from "@/lib/console/eyeReturn";

/**
 * The way back from the console to God's eye view. The console's Sources link carries
 * `eye=`, the view's own link; the console reads it once, checks it, and offers a
 * button. These are the rules behind that, held without a browser.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const tower = EYE_PLACES.find((p) => p.id === "tower-bridge")!;
const MOVED: EyeView = { lat: 51.50531, lon: -0.08056, zoom: 15.7, tilt: 48, heading: 247 };
const CAMERA_ID = "tfl:JamCams_00001.04227";

const TARGETS: Array<[string, EyeTarget]> = [
  ["a place", { kind: "place", place: tower, view: tower.wide }],
  ["a camera", { kind: "camera", cameraId: CAMERA_ID, view: tower.wide }],
  ["a spot", { kind: "spot", view: tower.wide }],
];

/** What the console does: read `eye` out of the link it was opened with. */
const eyeParam = (href: string) => new URL(href, "https://x.test").searchParams.get("eye");

describe("the round trip", () => {
  for (const [name, target] of TARGETS) {
    it(`gets back to where ${name} was left, not to where the console map has moved since`, () => {
      const back = eyeLinkQuery(target, MOVED);
      const consoleLink = consoleHref({ lat: MOVED.lat, lon: MOVED.lon, zoom: MOVED.zoom }, { sources: true, back });
      const ret = parseEyeReturn(eyeParam(consoleLink));
      expect(ret).not.toBeNull();
      expect(ret!.href).toBe(`/eye?${back}`);
      expect(ret!.kind).toBe(target.kind);

      // And /eye opens that very view.
      const reopened = parseEyeLink(new URL(ret!.href, "https://x.test").searchParams, false);
      expect(reopened.kind).toBe(target.kind);
      expect(reopened.view).toEqual(MOVED);
    });
  }

  it("names the place for a place, and nothing for a camera or a spot", () => {
    const ret = parseEyeReturn(eyeLinkQuery(TARGETS[0][1], MOVED));
    expect(ret?.placeName).toBe("Tower Bridge");
    expect(parseEyeReturn(eyeLinkQuery(TARGETS[1][1], MOVED))?.placeName).toBeUndefined();
    expect(parseEyeReturn(eyeLinkQuery(TARGETS[2][1], MOVED))?.placeName).toBeUndefined();
  });

  it("takes a bare place as that place's own framing", () => {
    expect(parseEyeReturn("place=westminster")).toEqual({
      href: "/eye?place=westminster",
      kind: "place",
      placeName: "Westminster",
    });
  });
});

describe("a forged or broken eye=", () => {
  const rejected: Array<[string, string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["an outside URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example/eye"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an unknown place", "place=atlantis"],
    ["a latitude off the map", "lat=999&lon=0"],
    ["a longitude off the map", "lat=0&lon=999"],
    ["a latitude that is not a number", "lat=abc&lon=1"],
    ["one coordinate", "lat=51.5"],
    ["501 characters", `place=tower-bridge&${"x".repeat(501 - "place=tower-bridge&".length)}`],
  ];
  for (const [name, raw] of rejected) {
    it(`shows no button for ${name}`, () => {
      expect(parseEyeReturn(raw)).toBeNull();
    });
  }

  it("never lets the raw text reach the link it builds", () => {
    const hostile = [
      ...TARGETS.map(([, t]) => eyeLinkQuery(t, MOVED)),
      "place=tower-bridge&next=https://evil.example",
      "place=tower-bridge&lat=51.5&lon=-0.08&next=//evil.example",
      "lat=51.5&lon=-0.08&evil=%3Cscript%3E",
      "cam=tfl:x%22onmouseover=1&lat=51.5&lon=-0.08",
      "cam=%3Cscript%3E&lat=51.5&lon=-0.08",
    ];
    for (const raw of hostile) {
      const ret = parseEyeReturn(raw);
      expect(ret, raw).not.toBeNull();
      expect(ret!.href.startsWith("/eye?")).toBe(true);
      expect(ret!.href).not.toContain("//");
      expect(ret!.href).not.toMatch(/[<>"'\s]/);
      expect(ret!.href).not.toContain("evil");
    }
  });
});

describe("the button's words", () => {
  it("say where it goes, by kind", () => {
    expect(EYE_RETURN_LABEL).toBe("God's eye view");
    expect(eyeReturnHint({ kind: "place", placeName: "Tower Bridge" })).toBe("Back to Tower Bridge");
    expect(eyeReturnHint({ kind: "camera" })).toBe("Back to the camera");
    expect(eyeReturnHint({ kind: "spot" })).toBe("Back to the same spot");
    // A place with no name falls to the plain words rather than "Back to undefined".
    expect(eyeReturnHint({ kind: "place" })).toBe("Back to the same spot");
  });

  it("put the visible words, in order, inside the accessible name", () => {
    for (const r of [
      { kind: "place" as const, placeName: "Tower Bridge" },
      { kind: "camera" as const },
      { kind: "spot" as const },
    ]) {
      const name = eyeReturnName(r).toLowerCase();
      const label = EYE_RETURN_LABEL.toLowerCase();
      const hint = eyeReturnHint(r).toLowerCase();
      expect(name).toContain(label);
      expect(name).toContain(hint);
      expect(name.indexOf(label)).toBeLessThan(name.indexOf(hint));
    }
    expect(eyeReturnName({ kind: "place", placeName: "Tower Bridge" })).toBe("God's eye view: back to Tower Bridge");
  });

  it("use no em dash or en dash", () => {
    for (const s of [
      EYE_RETURN_LABEL,
      eyeReturnHint({ kind: "place", placeName: "Piccadilly Circus" }),
      eyeReturnHint({ kind: "camera" }),
      eyeReturnHint({ kind: "spot" }),
      eyeReturnName({ kind: "place", placeName: "Piccadilly Circus" }),
      eyeReturnName({ kind: "camera" }),
      eyeReturnName({ kind: "spot" }),
    ]) {
      expect(s).not.toMatch(/[–—]/);
    }
  });
});

describe("the store", () => {
  it("holds the value, tells a subscriber, and stops telling it once it leaves", () => {
    const ret = parseEyeReturn("place=tower-bridge")!;
    let calls = 0;
    const off = eyeReturnStore.subscribe(() => {
      calls += 1;
    });
    expect(eyeReturnStore.get()).toBeNull();
    eyeReturnStore.set(ret);
    expect(eyeReturnStore.get()).toBe(ret);
    expect(calls).toBe(1);
    off();
    eyeReturnStore.set(null);
    expect(eyeReturnStore.get()).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("the button's CSS", () => {
  const css = read("app", "globals.css");
  const start = css.indexOf("/* ── Back to God's eye view");
  const end = css.indexOf("/* ── end back to God's eye view");

  it("is one block, and is there", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("has no literal colour: tokens only", () => {
    // The block's own comment names no colour, so the whole slice can be held.
    const block = css.slice(start, end);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
    expect(block).not.toMatch(/\bhsla?\(/);
  });
});

describe("the wiring, read as source", () => {
  it("has the console read eye= through parseEyeReturn and drop both arrival flags", () => {
    const shell = read("components", "shell", "ConsoleShell.tsx");
    expect(shell).toContain("parseEyeReturn(");
    expect(shell).toContain("withoutArrivalFlags(");
    expect(shell).not.toContain("withoutSourcesFlag");
  });

  it("mounts the button on every board's map stage", () => {
    expect(read("components", "console", "StageHost.tsx")).toContain("<EyeReturn />");
  });

  it("draws a plain link, not a client-side route", () => {
    const comp = read("components", "console", "EyeReturn.tsx");
    expect(comp).not.toMatch(/from ["']next\/link["']/);
    expect(comp).toContain("<a ");
    expect(comp).toContain("href={back.href}");
  });

  it("has God's eye view send its own link along with the Sources link", () => {
    expect(read("components", "eye", "EyeApp.tsx")).toMatch(/\bback:\s/);
  });
});
