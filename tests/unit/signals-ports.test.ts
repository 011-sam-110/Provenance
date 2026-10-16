import { expect, test } from "vitest";
import { normalizePorts, portRegion } from "@/lib/signals/ports";
import { MAJOR_PORTS } from "@/lib/signals/ports.data";

test("normalizes the curated major-ports list to namespaced point features", () => {
  const out = normalizePorts(MAJOR_PORTS);
  expect(out.length).toBe(MAJOR_PORTS.length);
  expect(out.length).toBeGreaterThan(60);
  expect(out.every((f) => f.signalId === "ports")).toBe(true);
  expect(out.every((f) => f.geometry === undefined)).toBe(true); // points only

  const shanghai = out.find((f) => f.title === "Shanghai");
  expect(shanghai?.id).toBe("port:shanghai");
  expect(shanghai?.props?.country).toBe("CN");
  expect(shanghai?.lat).toBeCloseTo(31.23, 2);
  expect(shanghai?.props?.region).toBe("East Asia");
});

test("claims no rank (the file order is not a throughput order) and every port has a known region", () => {
  const out = normalizePorts(MAJOR_PORTS);
  // The file is regional after ~#30, so a rank from the array index would be false.
  expect(out.every((f) => f.props?.rank === undefined)).toBe(true);
  // No port falls through the region map into "Other".
  expect(out.every((f) => f.props?.region && f.props.region !== "Other")).toBe(true);
});

test("portRegion buckets known maritime nations and falls back honestly", () => {
  expect(portRegion("NL")).toBe("Europe");
  expect(portRegion("us")).toBe("North America"); // case-insensitive
  expect(portRegion("PA")).toBe("Latin America");
  expect(portRegion("ZZ")).toBe("Other");
  expect(portRegion(undefined)).toBe("Other");
});

test("drops records with out-of-range coordinates", () => {
  const out = normalizePorts([
    { name: "Good", country: "XX", lat: 10, lon: 20 },
    { name: "Bad", country: "XX", lat: 200, lon: 20 },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0].title).toBe("Good");
});

test("port ids are unique", () => {
  const out = normalizePorts(MAJOR_PORTS);
  expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
});
