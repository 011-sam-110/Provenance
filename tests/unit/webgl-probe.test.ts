import { describe, expect, it } from "vitest";
import { canUseWebGL, type CanvasMaker } from "@/lib/map/webgl";

/**
 * The probe the two map pages run before they mount MapLibre (lib/map/webgl.ts). With
 * no WebGL, /eye and /app used to show Next's "Application error" page; they now show
 * components/map/MapFallback.tsx. The browser half is tests/e2e/no-webgl.spec.ts.
 */

const docWith = (answers: Record<string, unknown>): CanvasMaker => ({
  createElement: () => ({ getContext: (kind: string) => answers[kind] ?? null }),
});

describe("canUseWebGL", () => {
  it("says yes for WebGL 2", () => {
    expect(canUseWebGL(docWith({ webgl2: {} }))).toBe(true);
  });

  it("falls back to WebGL 1 and to the old prefixed name", () => {
    expect(canUseWebGL(docWith({ webgl: {} }))).toBe(true);
    expect(canUseWebGL(docWith({ "experimental-webgl": {} }))).toBe(true);
  });

  it("says no when every kind answers null", () => {
    expect(canUseWebGL(docWith({}))).toBe(false);
  });

  it("says no when asking throws, and with no document", () => {
    const throwing: CanvasMaker = {
      createElement: () => ({
        getContext: () => {
          throw new Error("GPU process unavailable");
        },
      }),
    };
    expect(canUseWebGL(throwing)).toBe(false);
    expect(canUseWebGL(undefined)).toBe(false);
  });
});
