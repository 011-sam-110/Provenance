import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The God's eye view draws no sweep down the frame when a feed refreshes: Leon asked
 * for it to go (2026-10-28). The "refreshed N s ago" line stays, in the Sources tray.
 */

const ROOT = resolve(__dirname, "../..");
const code = (p: string) =>
  readFileSync(resolve(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("/eye has no sweep", () => {
  it("its stylesheet has no sweep rule or keyframes", () => {
    expect(code("components/eye/eye.module.css")).not.toMatch(/sweep/i);
  });

  it("its frames mount no sweep element", () => {
    expect(code("components/eye/EyeHud.tsx")).not.toMatch(/styles\.sweep/);
    expect(code("components/eye/EyeFilmFrame.tsx")).not.toMatch(/styles\.sweep/);
  });

  it("its tray still says how long ago the feeds arrived, and a film's frame too", () => {
    expect(code("components/eye/EyeSources.tsx")).toContain("refreshedText(");
    expect(code("components/eye/EyeFilmFrame.tsx")).toContain("refreshedText(");
  });
});
