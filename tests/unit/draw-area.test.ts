import { describe, it, expect } from "vitest";
import { AREA_CAP_MESSAGE, atAreaCap } from "@/lib/shell/drawArea";
import { AREA_CAP } from "@/lib/shell/inspector";

/**
 * THE CAP IS A SILENT DELETE IF NOBODY CHECKS IT.
 *
 * `inspectorStore.add` is `[area, ...rest].slice(0, AREA_CAP)`. At the cap that
 * does not refuse the new area — it drops the OLDEST one off the end, along with
 * every source configured on it, with nothing on screen saying so. Both controls
 * that can start a draw now ask this first and refuse with a reason.
 *
 * The boundary is the only interesting part and it is an off-by-one waiting to
 * happen, so it is pinned at exactly AREA_CAP - 1, AREA_CAP and above.
 */
describe("atAreaCap", () => {
  it("has room while below the cap", () => {
    expect(atAreaCap(0)).toBe(false);
    expect(atAreaCap(AREA_CAP - 1)).toBe(false);
  });

  it("refuses AT the cap, not one past it — the 41st is what overwrites the 1st", () => {
    expect(atAreaCap(AREA_CAP)).toBe(true);
  });

  it("stays refused above the cap", () => {
    expect(atAreaCap(AREA_CAP + 5)).toBe(true);
  });
});

describe("AREA_CAP_MESSAGE", () => {
  it("states the real limit, derived rather than retyped", () => {
    // A hand-typed number here would still read correctly the day AREA_CAP moves,
    // which is the failure mode this repo already fixed once for WIDGET_LIMIT_MESSAGE.
    expect(AREA_CAP_MESSAGE).toContain(String(AREA_CAP));
    expect(AREA_CAP_MESSAGE).toMatch(/remove one/i);
  });
});
