import { describe, it, expect } from "vitest";
import { clearAreaLabel, needsClearArea } from "@/lib/shell/clearArea";

/**
 * THE ONLY ESCAPE HATCH FROM A PERSISTED FILTER.
 *
 * An `aoi` scope survives a reload — `coerceSavedScope` keeps it on purpose,
 * and its own comment says that is safe because the drawn area "IS both
 * settable and clearable from the map rail". The map rail's flyout held the
 * single `clearAoi` caller in the product. With it gone, the Sources rail's
 * context switcher is the only control that can put a filtered console back to
 * World, so the rule for WHEN that control appears is worth pinning rather than
 * leaving to a `&&` in a component with no test coverage of its own.
 *
 * The case that makes this more than a formality is the second one below: the
 * rail is pointed at World (`editing === null`) and the console is STILL
 * filtered, because the scope and the Inspector's areas are separate models —
 * lib/map/aoi.ts says so at length. That is exactly the state a returning user
 * is in, and a control gated on `editing` alone would leave them stranded.
 */
describe("needsClearArea", () => {
  it("offers the control while the rail is pointed at a drawn area", () => {
    expect(needsClearArea("area:1", "world")).toBe(true);
  });

  it("offers it when an aoi scope is filtering the console, even from World", () => {
    expect(needsClearArea(null, "aoi")).toBe(true);
  });

  it("offers it when both are true", () => {
    expect(needsClearArea("area:1", "aoi")).toBe(true);
  });

  it("stays hidden on an unfiltered World, so nothing dead is on screen", () => {
    expect(needsClearArea(null, "world")).toBe(false);
  });

  it("stays hidden for the centre-based scopes, which it cannot clear", () => {
    // near-me and region never survive a reload (coerceSavedScope drops both),
    // and this control does not set or clear them. Showing an ✕ that does
    // nothing to the state on screen is the dead-control bug, not a fix for it.
    expect(needsClearArea(null, "near-me")).toBe(false);
    expect(needsClearArea(null, "region")).toBe(false);
  });
});

describe("clearAreaLabel", () => {
  it("names the area it clears, so the control is not a bare glyph", () => {
    expect(clearAreaLabel("Drawn area (5 points)")).toBe(
      "Clear Drawn area (5 points) and go back to World",
    );
  });

  it("says what it clears when no area is being edited", () => {
    expect(clearAreaLabel(null)).toBe("Clear the drawn area and go back to World");
  });

  it("never returns an empty or glyph-only name", () => {
    for (const input of [null, "", "Kharkiv"]) {
      const label = clearAreaLabel(input || null);
      expect(label.length).toBeGreaterThan(10);
      expect(label).toMatch(/World/);
    }
  });
});
