import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/adsb-mil.json";
import { normalizeMilitaryAir, MILITARY_AIR_SOURCE } from "@/lib/signals/military-air";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes military ADS-B, skipping aircraft with no position", () => {
  const out = normalizeMilitaryAir(fixture as never);
  // 6 airborne + 1 grounded (has lat/lon) = 7; the position-less F16 is skipped.
  expect(out).toHaveLength(7);
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["military-air"]));
  expect(out.every((f) => f.id.startsWith("mil:"))).toBe(true);
});

test("maps callsign, type, altitude (incl. 'ground') and speed", () => {
  const out = normalizeMilitaryAir(fixture as never);
  const c17 = out.find((f) => f.props?.typeCode === "C17")!;
  expect(c17.title).toContain("RCH"); // a Reach military callsign
  expect(String(c17.props?.altitude)).toMatch(/ft$/);

  const grounded = out.find((f) => f.id === "mil:abc123")!;
  expect(grounded.props?.altitude).toBe("on ground");
  expect(grounded.props?.speed).toBe("0 kt");
  expect(grounded.ts).toBeUndefined(); // live snapshot, never time-filtered
});

test("declares an altitude metric that resolves to a finite number", () => {
  const out = normalizeMilitaryAir(fixture as never);

  // Source declares the REAL altitude scalar (not the radius proxy).
  const metric = MILITARY_AIR_SOURCE.metric!;
  expect(metric.field).toBe("altitudeFt");
  expect(metric.domain).toEqual([0, 45000]);

  // Airborne C17 (RCH4139 @ 15,000 ft) → the numeric prop is finite and resolves.
  const c17 = out.find((f) => f.props?.typeCode === "C17")!;
  expect(typeof c17.props?.altitudeFt).toBe("number");
  expect(Number.isFinite(c17.props?.altitudeFt as number)).toBe(true);
  const resolved = rowMetric(c17, metric)!;
  expect(resolved.value).toBe(15000);
  expect(resolved.domain).toEqual([0, 45000]);
  expect(resolved.label).toBe("15,000 ft"); // grouped: an altitude is read, not parsed

  // "ground" maps to a genuine 0 ft — still a finite metric, not a dot.
  const grounded = out.find((f) => f.id === "mil:abc123")!;
  expect(grounded.props?.altitudeFt).toBe(0);
  expect(rowMetric(grounded, metric)?.value).toBe(0);
});
