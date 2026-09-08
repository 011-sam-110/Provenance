import { describe, expect, it } from "vitest";
import { MIN_VERTICES } from "@/lib/map/aoi";
import type { DrawState } from "@/lib/map/aoi";
import {
  MIN_BANNER_PX,
  drawBannerModel,
  placeBanner,
  type BannerAnchors,
} from "@/lib/shell/drawBanner";

const polygon = (n: number): DrawState => ({
  active: true,
  tool: "polygon",
  vertices: Array.from({ length: n }, (_, i) => [i, i] as [number, number]),
});

const allText = (d: DrawState) => {
  const m = drawBannerModel(d);
  return [m.lead, m.value?.text ?? "", m.value?.label ?? "", ...m.steps.flatMap((s) => [s.text, ...s.keys])].join(" ");
};

describe("drawBannerModel — the polygon branch", () => {
  it("gives the placed count its own value, so it is not buried in a sentence", () => {
    expect(drawBannerModel(polygon(13)).value).toEqual({ text: "13", label: "points" });
  });

  it("prints a zero rather than hiding the count until something lands", () => {
    // The banner exists because "it is hard to tell if you have clicked". A count
    // that only appears once it is non-zero is silent at exactly that moment.
    expect(drawBannerModel(polygon(0)).value).toEqual({ text: "0", label: "points" });
  });

  it("says point, not points, at one", () => {
    expect(drawBannerModel(polygon(1)).value).toEqual({ text: "1", label: "point" });
  });

  it("always says how to plot", () => {
    expect(drawBannerModel(polygon(0)).steps[0].text).toBe("Click the map to place your first point");
    expect(drawBannerModel(polygon(5)).steps[0].text).toBe("Click the map to add a point");
  });

  it("names how many MORE are needed below the minimum, not how many are placed", () => {
    // The question at this stage is "when does this become an area". The count
    // beside it already answers "how far have I come", so this line must not.
    const step = drawBannerModel(polygon(MIN_VERTICES - 1)).steps[1];
    expect(step.text).toBe("1 more to make an area");
    expect(step.text).not.toContain(`${MIN_VERTICES - 1} placed`);
  });

  it("states the requirement rather than a shortfall when nothing is placed", () => {
    expect(drawBannerModel(polygon(0)).steps[1].text).toBe(`${MIN_VERTICES} points make an area`);
  });

  it("names BOTH ways to confirm once the shape is an area, and Enter as a key", () => {
    const [, finish] = drawBannerModel(polygon(MIN_VERTICES)).steps;
    expect(finish.text).toContain("Double-click");
    expect(finish.keys).toEqual(["Enter"]);
  });

  it("never offers a finish the gesture would refuse", () => {
    for (let n = 0; n < MIN_VERTICES; n += 1) {
      expect(allText(polygon(n))).not.toContain("Enter");
    }
  });
});

describe("drawBannerModel — the radius and circle branches", () => {
  const radius: DrawState = { active: true, tool: "radius", vertices: [] };
  const circle: DrawState = { active: true, tool: "circle", vertices: [] };

  it("reports no measurement before a centre exists", () => {
    // "0 m" would be stating a reading that has not been taken.
    expect(drawBannerModel(radius).value).toBeNull();
    expect(drawBannerModel(circle).value).toBeNull();
  });

  it("promotes the live radius to the value slot once there is a centre", () => {
    const live: DrawState = { ...radius, center: [0, 0], radiusKm: 4.25 };
    expect(drawBannerModel(live).value).toEqual({ text: "4.3 km", label: "radius" });
  });

  it("keeps a different verb for the external circle tool, which is a drag", () => {
    expect(drawBannerModel(circle).steps[0].text).toContain("drag");
    expect(drawBannerModel(radius).steps[0].text).toContain("Click");
    expect(drawBannerModel({ ...circle, center: [0, 0], radiusKm: 1 }).steps[0].text).toBe("Release to set it");
    expect(drawBannerModel({ ...radius, center: [0, 0], radiusKm: 1 }).steps[0].text).toBe(
      "Click again to set the edge",
    );
  });

  it("counts no points in either — there are none to count", () => {
    expect(allText(radius)).not.toContain("point");
    expect(allText(circle)).not.toContain("point");
  });

  it("names its own gesture in the lead", () => {
    expect(drawBannerModel(radius).lead).toBe("Drawing a radius");
    expect(drawBannerModel(circle).lead).toBe("Drawing a circle");
    expect(drawBannerModel(polygon(2)).lead).toBe("Drawing an area");
  });
});

describe("placeBanner", () => {
  const at = (over: Partial<BannerAnchors> = {}): BannerAnchors => ({
    stage: { left: 0, width: 1440, top: 56 },
    above: null,
    viewport: 1440,
    ...over,
  });

  it("centres on the stage, not on the viewport", () => {
    // The Sources rail insets the console by up to 602px. The old banner was
    // `left: 50%` of the VIEWPORT and did not move when that happened.
    const shifted = placeBanner(at({ stage: { left: 602, width: 838, top: 56 } }));
    expect(shifted.left).toBe(602 + 838 / 2);
    expect(shifted.left).not.toBe(720);
  });

  it("follows the stage back when the rail closes", () => {
    expect(placeBanner(at()).left).toBe(720);
  });

  it("hangs the pill off the top of the stage", () => {
    expect(placeBanner(at({ stage: { left: 0, width: 1440, top: 120 } })).top).toBe(134);
  });

  it("stacks under another top-centred banner instead of covering it", () => {
    // A camera pick BY AREA runs a draw inside a pick, so .tn-arm-hint and this
    // are both up. It carries the only "Esc to stop" on screen.
    const placed = placeBanner(at({ above: { bottom: 108 } }));
    expect(placed.top).toBeGreaterThanOrEqual(108);
    expect(placed.top).toBe(116);
  });

  it("ignores a banner that is already clear of the stage top", () => {
    expect(placeBanner(at({ stage: { left: 0, width: 1440, top: 400 }, above: { bottom: 108 } })).top).toBe(414);
  });

  it("keeps the pill inside the stage it is centred on", () => {
    const p = placeBanner(at({ stage: { left: 602, width: 838, top: 56 } }));
    expect(p.maxWidth).toBeLessThanOrEqual(838);
    expect(p.left - p.maxWidth / 2).toBeGreaterThanOrEqual(602);
    expect(p.left + p.maxWidth / 2).toBeLessThanOrEqual(602 + 838);
  });

  it("refuses to squeeze below the floor, and clamps the overhang into the viewport", () => {
    // A 180px stage cannot hold the pill. Overhanging a rail costs nothing — the
    // banner is pointer-events:none apart from its Cancel button — but running off
    // the screen would take that button with it.
    const p = placeBanner(at({ stage: { left: 1260, width: 180, top: 56 } }));
    expect(p.maxWidth).toBe(MIN_BANNER_PX);
    expect(p.left + p.maxWidth / 2).toBeLessThanOrEqual(1440);
    expect(p.left - p.maxWidth / 2).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the viewport when the stage has no width yet", () => {
    // First paint, or a stage stowed behind a focused widget.
    expect(placeBanner(at({ stage: { left: 0, width: 0, top: 56 } })).left).toBe(720);
  });

  it("centres and overhangs evenly when even the viewport cannot hold the floor", () => {
    const p = placeBanner(at({ stage: { left: 0, width: 200, top: 56 }, viewport: 200 }));
    expect(p.maxWidth).toBe(MIN_BANNER_PX);
    expect(p.left).toBe(100);
  });
});
