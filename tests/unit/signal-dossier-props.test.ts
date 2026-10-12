import { describe, it, expect } from "vitest";
import { visibleDossierProps } from "@/lib/signals/dossierProps";

describe("visibleDossierProps", () => {
  it("hides the magnitude proxy when the layer's real metric names a different field (GDACS-shaped)", () => {
    const props = {
      hazard: "Earthquake",
      alertLevel: "Orange",
      magnitude: 6, // the 3/6/8 alert-tier radius proxy, not the real Richter value
      alertScore: 2,
      severity: "Magnitude 7.7M, Depth:12.6km", // the real figure, under a different label
    };
    const out = visibleDossierProps(props, { field: "alertScore", domain: [0, 3] });
    const keys = out.map(([k]) => k);
    expect(keys).not.toContain("magnitude");
    expect(keys).toContain("alertScore");
    expect(keys).toContain("severity");
  });

  it("keeps magnitude when it IS the layer's own declared metric (USGS/EMSC: a real Richter value)", () => {
    const props = { magnitude: 6.2, place: "Panama" };
    const out = visibleDossierProps(props, { field: "magnitude", domain: [2, 8] });
    expect(out.map(([k]) => k)).toContain("magnitude");
  });

  it("hides magnitude when the layer declares no metric at all (fire-firms-shaped radius proxy)", () => {
    const props = { magnitude: 7, frp: 42 };
    const out = visibleDossierProps(props, undefined);
    expect(out.map(([k]) => k)).not.toContain("magnitude");
  });

  it("never touches any other key", () => {
    const props = { country: "Panama", from: "2026-10-09" };
    const out = visibleDossierProps(props, { field: "alertScore", domain: [0, 3] });
    expect(out).toEqual(Object.entries(props));
  });
});
