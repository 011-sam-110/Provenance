import { describe, expect, it } from "vitest";
import {
  HOVER_QUERY_LAYERS,
  HOVER_SETTLE_MS,
  NO_HOVER,
  SIGNAL_LINE_DRAWN_LAYER,
  SIGNAL_LINE_HIT_LAYER,
  hoverChanged,
  resolveHover,
  shouldHitTest,
  canvasCursor,
  cursorOwner,
  type HoverFeature,
} from "@/lib/map/hover";
import { COUNTRY_HIT_LAYER, PIN_HIT_LAYERS } from "@/lib/map/hitTest";

const cable = (id: string, label?: string): HoverFeature => ({
  layer: SIGNAL_LINE_HIT_LAYER,
  id,
  ...(label === undefined ? {} : { label }),
});

describe("HOVER_QUERY_LAYERS", () => {
  it("covers every layer the click arbiter can decide on, plus the cable target", () => {
    for (const layer of PIN_HIT_LAYERS) expect(HOVER_QUERY_LAYERS).toContain(layer);
    expect(HOVER_QUERY_LAYERS).toContain(COUNTRY_HIT_LAYER);
    expect(HOVER_QUERY_LAYERS).toContain(SIGNAL_LINE_HIT_LAYER);
  });

  it("has no duplicates — a repeated id would double the query cost we just removed", () => {
    expect(new Set(HOVER_QUERY_LAYERS).size).toBe(HOVER_QUERY_LAYERS.length);
  });
});

describe("resolveHover", () => {
  it("returns the resting state for empty map", () => {
    expect(resolveHover([])).toEqual(NO_HOVER);
  });

  it("shows a pointer over any pin layer", () => {
    expect(resolveHover([{ layer: "camera-dots" }]).cursor).toBe("pointer");
    expect(resolveHover([{ layer: "user-pin-dots" }]).cursor).toBe("pointer");
  });

  it("ignores decoration layers entirely", () => {
    expect(resolveHover([{ layer: "country-borders" }, { layer: "place-labels" }])).toEqual(NO_HOVER);
  });

  it("washes the country under the cursor, keyed on feature.id", () => {
    const s = resolveHover([{ layer: COUNTRY_HIT_LAYER, featureId: 826 }]);
    expect(s.country).toBe(826);
    // The country fill alone is not a pointer target - it is the fallback surface.
    expect(s.cursor).toBe("");
  });

  it("ignores a country feature with no id, since setFeatureState needs one", () => {
    expect(resolveHover([{ layer: COUNTRY_HIT_LAYER }]).country).toBeNull();
  });

  it("names a cable over open water", () => {
    expect(resolveHover([cable("atlantic-1", "Atlantic Crossing 1")]).line)
      .toEqual({ id: "atlantic-1", label: "Atlantic Crossing 1" });
  });

  it("falls back to a generic label when the cable carries none", () => {
    expect(resolveHover([cable("x")]).line).toEqual({ id: "x", label: "Cable" });
  });

  it("lets a real pin beat the widened cable target", () => {
    const s = resolveHover([cable("atlantic-1"), { layer: "camera-dots" }]);
    expect(s.line).toBeNull();
    expect(s.cursor).toBe("pointer");
  });

  it("lets the country beat a cable that is merely NEAR the drawn line", () => {
    const s = resolveHover([cable("atlantic-1"), { layer: COUNTRY_HIT_LAYER, featureId: 250 }]);
    expect(s.line).toBeNull();
    expect(s.country).toBe(250);
  });

  it("lets the cable win over the country when the cursor is ON the drawn line", () => {
    const s = resolveHover([
      cable("atlantic-1", "AC-1"),
      { layer: SIGNAL_LINE_DRAWN_LAYER },
      { layer: COUNTRY_HIT_LAYER, featureId: 250 },
    ]);
    expect(s.line).toEqual({ id: "atlantic-1", label: "AC-1" });
    expect(s.cursor).toBe("pointer");
  });

  it("still washes the country while a cable is highlighted over it", () => {
    const s = resolveHover([
      cable("c"),
      { layer: SIGNAL_LINE_DRAWN_LAYER },
      { layer: COUNTRY_HIT_LAYER, featureId: 4 },
    ]);
    expect(s.country).toBe(4);
  });

  it("ignores a cable hit that carries no id — nothing to highlight or open", () => {
    expect(resolveHover([{ layer: SIGNAL_LINE_HIT_LAYER }]).line).toBeNull();
  });
});

describe("hoverChanged", () => {
  it("is false for two equal states", () => {
    expect(hoverChanged(NO_HOVER, { cursor: "", country: null, line: null })).toBe(false);
    const a = { cursor: "pointer" as const, country: 1, line: { id: "x", label: "X" } };
    const b = { cursor: "pointer" as const, country: 1, line: { id: "x", label: "X" } };
    expect(hoverChanged(a, b)).toBe(false);
  });

  it("notices each field independently", () => {
    const base = { cursor: "" as const, country: null, line: null };
    expect(hoverChanged(base, { ...base, cursor: "pointer" })).toBe(true);
    expect(hoverChanged(base, { ...base, country: 3 })).toBe(true);
    expect(hoverChanged(base, { ...base, line: { id: "a", label: "A" } })).toBe(true);
  });

  it("notices a different cable and a renamed cable", () => {
    const a = { cursor: "pointer" as const, country: null, line: { id: "a", label: "A" } };
    expect(hoverChanged(a, { ...a, line: { id: "b", label: "A" } })).toBe(true);
    expect(hoverChanged(a, { ...a, line: { id: "a", label: "B" } })).toBe(true);
  });
});

describe("shouldHitTest", () => {
  const gate = (over: Partial<Parameters<typeof shouldHitTest>[0]> = {}) =>
    shouldHitTest({ moving: false, nowMs: 1000, movingUntilMs: 0, ...over });

  it("runs when the camera is at rest", () => {
    expect(gate()).toBe(true);
  });

  it("is suppressed for the whole gesture — this is the freeze fix", () => {
    expect(gate({ moving: true })).toBe(false);
  });

  it("stays suppressed through the settle window after moveend", () => {
    expect(gate({ nowMs: 1000, movingUntilMs: 1000 + HOVER_SETTLE_MS })).toBe(false);
    expect(gate({ nowMs: 1000 + HOVER_SETTLE_MS, movingUntilMs: 1000 + HOVER_SETTLE_MS })).toBe(true);
  });

  it("honours an optional minimum gap between tests", () => {
    expect(gate({ nowMs: 1000, lastRunMs: 995, minGapMs: 16 })).toBe(false);
    expect(gate({ nowMs: 1000, lastRunMs: 980, minGapMs: 16 })).toBe(true);
  });

  it("ignores the gap when the caller does not ask for one", () => {
    expect(gate({ nowMs: 1000, lastRunMs: 999 })).toBe(true);
  });
});

describe("cursorOwner + canvasCursor", () => {
  const overPin = resolveHover([{ layer: PIN_HIT_LAYERS[0] }]);
  const owner = (drawing: boolean, picking: boolean) => cursorOwner({ drawing, picking });
  const want = (drawing: boolean, picking: boolean, hover = overPin) =>
    canvasCursor(hover, owner(drawing, picking));

  // THE TRUTH TABLE. Three gestures paint a crosshair and they do it two different
  // ways, which is why there are three owners rather than one boolean:
  //   • picking          — a CLASS, `.world-map.tn-picking` in globals.css
  //   • polygon / radius — INLINE, by lib/map/aoi.ts's beginGesture
  //   • circle           — INLINE, by lib/console/widgets/camslot.circle.ts
  // A class is cleared by clearing the inline write on top of it. An inline
  // crosshair is destroyed by exactly the same act, so it needs the opposite answer.

  it("lets the hover decide when nothing else is running", () => {
    expect(owner(false, false)).toBe("hover");
    expect(want(false, false)).toBe("pointer");
    expect(want(false, false, NO_HOVER)).toBe("");
  });

  it("clears the inline pointer for a CLASS-painted mode, so the class shows through", () => {
    // The pins ARE the target of a camera pick, so an inline `pointer` beat
    // `.world-map.tn-picking`'s crosshair for most of every pick.
    expect(owner(false, true)).toBe("mode");
    expect(want(false, true)).toBe("");
    expect(want(false, true, NO_HOVER)).toBe("");
  });

  it("writes NOTHING for an INLINE-painted gesture, so a draw keeps its crosshair", () => {
    // aoi.ts and camslot.circle.ts write `crosshair` on the canvas themselves and
    // restore it in their own teardown. Clearing to "" here would wipe it and leave
    // the default arrow — a worse result than the `pointer` this set out to fix.
    expect(owner(true, false)).toBe("gesture");
    expect(want(true, false)).toBeNull();
    expect(want(true, false, NO_HOVER)).toBeNull();
  });

  it("gives a live gesture precedence over a mode, because a camera AREA pick is both", () => {
    // startAreaPick arms picking AND runs a draw. If the mode won, the draw's own
    // inline crosshair would be cleared, and the moment picking ended first the
    // remaining draw would have no crosshair at all.
    expect(owner(true, true)).toBe("gesture");
    expect(want(true, true)).toBeNull();
  });

  it("never writes the crosshair itself, so it owns no teardown", () => {
    // The class belongs to React and the inline value belongs to the gesture. This
    // function writing one would outrank both and could survive an unmount mid-draw.
    for (const drawing of [false, true]) {
      for (const picking of [false, true]) {
        for (const hover of [NO_HOVER, overPin]) {
          expect(want(drawing, picking, hover)).not.toBe("crosshair");
        }
      }
    }
  });
});
