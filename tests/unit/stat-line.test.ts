import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { statLine } from "@/lib/shell/statLine";

// The console's pulse line (`stat-line`): the screen-reader and smoke-test readout of
// what is on the map. Two rules: a layer that is off says "off", never "0"; and a still
// is never called live: video that played and refreshing pictures are counted apart.

const m = { liveCameras: 2378, stillCameras: 17022, webcams: 1500, planes: 3000, satellites: 412 };
const allOn = { livecams: true, staticcams: true, planes: true, satellites: true };

describe("statLine", () => {
  it("counts video that played as video, and stills (registry plus webcams) as stills", () => {
    expect(statLine(m, allOn)).toBe(
      `${(2378).toLocaleString()} video cams · ${(18522).toLocaleString()} still cams · ` +
        `${(3000).toLocaleString()} planes · 412 satellites`,
    );
  });

  it("never puts the word live beside a count", () => {
    expect(statLine(m, allOn)).not.toMatch(/live/i);
    expect(statLine({ ...m, liveCameras: 0 }, allOn)).not.toMatch(/live/i);
  });

  it("says off for a layer that is off, by the name its toggle carries", () => {
    expect(statLine(m, {})).toBe("live cams off · static cams off · planes off · satellites off");
  });

  it("is what both headers render", () => {
    for (const file of ["components/terminal/TerminalHeader.tsx", "components/shell/StatusBar.tsx"]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src, file).toContain("statLine(m, layers)");
      expect(src, file).not.toMatch(/live cams`/);
    }
  });
});
