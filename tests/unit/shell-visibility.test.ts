import { describe, it, expect } from "vitest";
import { isHidden, onVisible, shouldRefreshOnVisible } from "@/lib/shell/visibility";

const NOW = 1_700_000_000_000;

describe("shouldRefreshOnVisible", () => {
  it("refreshes when we have never had a successful load", () => {
    expect(shouldRefreshOnVisible(null, 60_000, NOW)).toBe(true);
  });

  // Flicking between two tabs must not re-fetch 35 layers each time.
  it("does not stampede when the data is still within its cadence", () => {
    expect(shouldRefreshOnVisible(NOW - 1_000, 60_000, NOW)).toBe(false);
    expect(shouldRefreshOnVisible(NOW - 59_999, 60_000, NOW)).toBe(false);
  });

  it("refreshes once the data is older than its own cadence", () => {
    expect(shouldRefreshOnVisible(NOW - 60_000, 60_000, NOW)).toBe(true);
    expect(shouldRefreshOnVisible(NOW - 3_600_000, 60_000, NOW)).toBe(true);
  });

  it("floors the cadence so a pathological refreshMs cannot cause a hot loop", () => {
    expect(shouldRefreshOnVisible(NOW - 500, 0, NOW)).toBe(false);
    expect(shouldRefreshOnVisible(NOW - 1_000, 0, NOW)).toBe(true);
  });
});

describe("server safety", () => {
  // These run in vitest's node environment: there is no `document` at all, which
  // is exactly the SSR case. Both must degrade rather than throw.
  it("reports nothing hidden and subscribes to nothing when there is no document", () => {
    expect(typeof document).toBe("undefined");
    expect(isHidden()).toBe(false);
    const off = onVisible(() => {
      throw new Error("must never fire on the server");
    });
    expect(() => off()).not.toThrow();
  });
});
