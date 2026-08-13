import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG } from "@/lib/sources/catalog";
import {
  buildWall,
  formatCadence,
  marqueePublishers,
  wallCount,
} from "@/lib/marketing/wall";

const FIXTURE = [
  { id: "a", kind: "core" as const, label: "A", group: "One", color: "#111", attribution: "Agency A — a feed", refreshMs: 30_000 },
  { id: "b", kind: "signal" as const, label: "B", group: "Two", color: "#222", attribution: "Agency B · detail", refreshMs: 300_000 },
  { id: "c", kind: "signal" as const, label: "C", group: "One", color: "#333", attribution: "Agency A — another feed", refreshMs: 86_400_000 },
];

describe("formatCadence", () => {
  it("keeps sub-minute intervals in seconds", () => {
    expect(formatCadence(1_000)).toBe("1s");
    expect(formatCadence(12_000)).toBe("12s");
    expect(formatCadence(59_999)).toBe("60s");
  });

  it("uses minutes below an hour and hours above it", () => {
    expect(formatCadence(60_000)).toBe("1m");
    expect(formatCadence(300_000)).toBe("5m");
    expect(formatCadence(3_600_000)).toBe("1h");
    expect(formatCadence(86_400_000)).toBe("24h");
  });

  it("never renders a bogus cadence for a missing interval", () => {
    expect(formatCadence(0)).toBe("—");
    expect(formatCadence(Number.NaN)).toBe("—");
    expect(formatCadence(-5)).toBe("—");
  });

  it("rounds up rather than showing 0s for a very short interval", () => {
    expect(formatCadence(200)).toBe("1s");
  });
});

describe("buildWall", () => {
  it("groups by the registry's own group, in first-seen order", () => {
    const wall = buildWall(FIXTURE);
    expect(wall.map((g) => g.group)).toEqual(["One", "Two"]);
    expect(wall[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(wall[1].entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("carries the adapter's own attribution and a formatted cadence", () => {
    const [one] = buildWall(FIXTURE);
    expect(one.entries[0].attribution).toBe("Agency A — a feed");
    expect(one.entries[0].cadence).toBe("30s");
    expect(one.entries[1].cadence).toBe("24h");
  });

  it("emits every catalog source exactly once, so nothing is silently uncited", () => {
    const wall = buildWall();
    const ids = wall.flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).toHaveLength(SOURCE_CATALOG.length);
    expect(new Set(ids).size).toBe(SOURCE_CATALOG.length);
    for (const s of SOURCE_CATALOG) expect(ids).toContain(s.id);
  });

  it("gives every real source a non-empty label, attribution and cadence", () => {
    for (const entry of buildWall().flatMap((g) => g.entries)) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.attribution.length).toBeGreaterThan(0);
      expect(entry.cadence).not.toBe("—");
    }
  });
});

describe("wallCount", () => {
  it("counts the live registry rather than a hardcoded number", () => {
    expect(wallCount()).toBe(SOURCE_CATALOG.length);
    expect(wallCount(FIXTURE)).toBe(3);
  });
});

describe("marqueePublishers", () => {
  it("dedupes on the publisher clause before the credit's descriptive tail", () => {
    expect(marqueePublishers(FIXTURE)).toEqual(["Agency A", "Agency B"]);
  });

  it("returns fewer names than sources, and no duplicates, on the real registry", () => {
    const names = marqueePublishers();
    expect(names.length).toBeGreaterThan(5);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });
});
