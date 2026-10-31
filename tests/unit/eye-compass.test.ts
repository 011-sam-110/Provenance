import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPASS_SPAN, STRIP_DEGREES, compassDirection, compassLabel, compassOffset, compassTicks } from "@/lib/eye/compass";

/**
 * The compass along the God's eye view's bottom edge: ticks each 5 degrees, labels each 15 and at
 * the cardinals, a strip moved by a transform, a chip that says "032° NE". The wrap is the part
 * that fails silently: a strip with no marks past its end looks fine until the view turns through
 * north. tests/e2e/eye-hud-v2.spec.ts reads the chip after a real map rotation.
 */

const TICKS = compassTicks();
const CODE = readFileSync(resolve(__dirname, "../../components/eye/EyeCompass.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

/** The marks a window centred on this heading shows, as "where in the window: label". */
function inWindow(heading: number) {
  const offset = (compassOffset(heading) / 100) * STRIP_DEGREES;
  return TICKS.map((t) => ({ t, x: t.deg + COMPASS_SPAN / 2 + offset }))
    .filter(({ x }) => x >= 0 && x <= COMPASS_SPAN)
    .map(({ t, x }) => `${x.toFixed(3)}:${t.kind}:${t.label}`);
}

describe("the ticks", () => {
  it("stand every 5 degrees, from half a window before north to half a window past a full turn", () => {
    expect(TICKS[0].deg).toBe(-COMPASS_SPAN / 2);
    expect(TICKS[TICKS.length - 1].deg).toBe(360 + COMPASS_SPAN / 2);
    for (let i = 1; i < TICKS.length; i++) expect(TICKS[i].deg - TICKS[i - 1].deg).toBe(5);
  });

  it("run the strip's width from end to end", () => {
    expect(TICKS[0].at).toBe(0);
    expect(TICKS[TICKS.length - 1].at).toBe(100);
  });

  it("are labelled every 15 degrees and at the eight points of the compass", () => {
    const at = (deg: number) => TICKS.find((t) => t.deg === deg)!;
    expect(at(15)).toMatchObject({ kind: "major", label: "15" });
    expect(at(30)).toMatchObject({ kind: "major", label: "30" });
    expect(at(5)).toMatchObject({ kind: "minor", label: "" });
    expect(at(40)).toMatchObject({ kind: "minor", label: "" });
    for (const [deg, label] of [[45, "NE"], [90, "E"], [135, "SE"], [180, "S"], [225, "SW"], [270, "W"], [315, "NW"]] as const) {
      expect(at(deg)).toMatchObject({ kind: "cardinal", label });
    }
  });

  it("have north as the one kind of its own, at both ends of the turn", () => {
    expect(TICKS.filter((t) => t.kind === "north").map((t) => t.deg)).toEqual([0, 360]);
    expect(TICKS.filter((t) => t.kind === "north").every((t) => t.label === "N")).toBe(true);
  });

  it("repeat the same names past the turn, so the strip has no seam", () => {
    for (let deg = -COMPASS_SPAN / 2; deg < COMPASS_SPAN / 2; deg += 5) {
      const before = TICKS.find((t) => t.deg === deg)!;
      const after = TICKS.find((t) => t.deg === deg + 360)!;
      expect([after.kind, after.label]).toEqual([before.kind, before.label]);
    }
  });
});

describe("the strip", () => {
  it("stands at rest for north, and moves left as the heading grows", () => {
    expect(compassOffset(0)).toBeCloseTo(0, 10);
    expect(compassOffset(90)).toBeCloseTo((-90 / STRIP_DEGREES) * 100);
    expect(compassOffset(180)).toBeLessThan(compassOffset(90));
  });

  it("puts the heading in the middle of the window", () => {
    for (const heading of [0, 32, 90, 271, 359]) {
      const offset = (compassOffset(heading) / 100) * STRIP_DEGREES;
      expect(heading + COMPASS_SPAN / 2 + offset).toBeCloseTo(COMPASS_SPAN / 2);
    }
  });

  it("wraps through 0 and 360, and takes a negative bearing as MapLibre gives one", () => {
    expect(compassOffset(360)).toBeCloseTo(compassOffset(0), 10);
    expect(compassOffset(-68)).toBeCloseTo(compassOffset(292));
    expect(compassOffset(720.5)).toBeCloseTo(compassOffset(0.5));
  });

  it("shows the same marks just either side of the seam, and a full window at any heading", () => {
    expect(inWindow(0)).toEqual(inWindow(360));
    for (const heading of [0, 1, 74, 75, 76, 285, 286, 359.9]) {
      // 150 degrees at one mark each 5 is 30 marks, or 31 when one stands on each edge.
      expect(inWindow(heading).length, String(heading)).toBeGreaterThanOrEqual(30);
    }
    expect(inWindow(359.9).some((m) => m.endsWith(":north:N"))).toBe(true);
    expect(inWindow(0.1).some((m) => m.endsWith(":north:N"))).toBe(true);
  });
});

describe("the chip", () => {
  it("says the heading in three figures and the nearest of the eight points", () => {
    expect(compassLabel(32)).toBe("032° NE");
    expect(compassLabel(0)).toBe("000° N");
    expect(compassLabel(90)).toBe("090° E");
    expect(compassLabel(247)).toBe("247° SW");
    expect(compassLabel(292.4)).toBe("292° W");
    expect(compassLabel(293)).toBe("293° NW");
  });

  it("takes a negative bearing, and the last degree before north rounds to north", () => {
    expect(compassLabel(-68)).toBe("292° W");
    expect(compassLabel(359.6)).toBe("000° N");
    expect(compassDirection(359.9)).toBe("N");
    expect(compassDirection(22.4)).toBe("N");
    expect(compassDirection(22.6)).toBe("NE");
  });
});

describe("the component", () => {
  it("moves the strip with a transform and renders nothing per frame", () => {
    expect(CODE).toContain("style.transform");
    expect(CODE).not.toMatch(/useState/);
    expect(CODE).not.toMatch(/useSyncExternalStore/);
  });

  it("writes the chip only when its text changes", () => {
    expect(CODE).toMatch(/if \(text === shown/);
    expect(CODE).toContain("textContent = text");
  });

  it("stands clear of the marks and takes no pointer", () => {
    expect(CODE).toContain("data-eye-keep");
    const css = readFileSync(resolve(__dirname, "../../components/eye/EyeHud.module.css"), "utf8");
    expect(css).toMatch(/\n\.compass\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\n\.compass\s*\{[^}]*width:\s*min\(520px, 38vw\)/);
  });
});
