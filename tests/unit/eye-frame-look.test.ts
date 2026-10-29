import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The God's eye view's frame, as Leon asked on 2026-10-28: no CRT look ("Remove CRT
 * looking filter on gods eye view": the scan lines) and no camera frame ("Remove the
 * corner elements that look like a camera frame": the corner brackets). The vignette
 * and the scrims under the words stay, because the faint ink's contrast was measured
 * over them (eye.module.css), and so does the imagery grade (lib/eye/look.ts, pinned by
 * eye-look.test.ts).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const CSS = read("components/eye/eye.module.css");
const HUD = read("components/eye/EyeHud.tsx");

describe("the God's eye view's frame", () => {
  it("draws no scan lines", () => {
    expect(CSS).not.toMatch(/\.scan\b/);
    expect(CSS).not.toContain("repeating-linear-gradient");
    expect(HUD).not.toContain("styles.scan");
  });

  it("draws no camera-frame corners", () => {
    expect(CSS).not.toMatch(/\.corner\b/);
    expect(HUD).not.toContain("styles.corner");
  });

  it("keeps the vignette and the scrims under the words", () => {
    const rules = CSS.match(/\.hud::before\s*\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(3); // wide, phone, 9:16 recording
    for (const rule of rules) {
      expect(rule).toContain("radial-gradient(ellipse");
      expect(rule.match(/linear-gradient\(/g)).toHaveLength(2);
    }
  });
});
