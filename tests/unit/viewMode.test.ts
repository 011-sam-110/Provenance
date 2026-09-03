// tests/unit/viewMode.test.ts
import { describe, it, expect } from "vitest";
import { coerceViewMode, DEFAULT_VIEW_MODE } from "@/lib/shell/viewMode";

describe("coerceViewMode", () => {
  it("defaults to explore, matching the default board's stage", () => {
    // Kept in agreement with the `overview` board in lib/console/presets.ts, which is
    // what actually decides how /app opens (StageHost overwrites this store from the
    // board's stage on mount). If those two disagree, this constant is a lie rather
    // than a default.
    expect(DEFAULT_VIEW_MODE).toBe("explore");
    expect(coerceViewMode(null)).toBe("explore");
    expect(coerceViewMode("nonsense")).toBe("explore");
  });
  it("keeps a valid saved mode", () => {
    expect(coerceViewMode("explore")).toBe("explore");
    expect(coerceViewMode("console")).toBe("console");
  });
});
