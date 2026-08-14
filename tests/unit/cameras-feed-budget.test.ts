import { describe, it, expect } from "vitest";
import {
  CAMERA_FEEDS,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  feedBudgetMs,
} from "@/lib/sources/registry";

// Castle Rock's own docblock in lib/sources/registry.ts records it taking ~40s
// cold, and README.md records 18.5s for a full run. A uniform 10s ceiling meant
// it lost that race on EVERY refresh and was absent from production entirely —
// not intermittently, structurally. These tests pin the per-feed budget so the
// ceiling can never silently go back to killing the one feed that needs longer.

describe("feedBudgetMs", () => {
  it("gives a feed with no declared budget the shared default", () => {
    expect(feedBudgetMs({})).toBe(DEFAULT_UPSTREAM_TIMEOUT_MS);
  });

  it("honours a feed's own budget when it declares one", () => {
    expect(feedBudgetMs({ budgetMs: 45_000 })).toBe(45_000);
  });
});

describe("the real feed table", () => {
  it("gives castlerock more than its documented ~40s cold cost", () => {
    const castlerock = CAMERA_FEEDS.find((f) => f.key === "castlerock");
    expect(castlerock).toBeDefined();
    expect(feedBudgetMs(castlerock!)).toBeGreaterThan(40_000);
  });

  it("leaves every other feed on the default — the ceiling still bounds them", () => {
    const others = CAMERA_FEEDS.filter((f) => f.key !== "castlerock");
    expect(others.length).toBeGreaterThan(0);
    for (const feed of others) {
      expect(feedBudgetMs(feed)).toBe(DEFAULT_UPSTREAM_TIMEOUT_MS);
    }
  });
});
