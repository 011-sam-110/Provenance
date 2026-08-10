import { afterEach, expect, test, vi } from "vitest";
import fixture from "@/tests/fixtures/hungermap-food.json";
import {
  normalizeFoodSecurity,
  foodInsecurityColor,
  foodSecurityNotice,
  isFoodSecurityNotice,
  FOOD_SECURITY_NOTICE_ID,
  FOOD_SECURITY_SOURCE,
  HUNGERMAP_KEY_ENV,
} from "@/lib/signals/food-security";
import { centroidByIso3 } from "@/lib/signals/country-centroids.data";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes HungerMap food insecurity by country, skipping unknown/zero rows", () => {
  const out = normalizeFoodSecurity(fixture as never);
  expect(out).toHaveLength(6); // 6 real countries; the "ZZZ" / zero-people row is dropped
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["food-security"]));

  const afg = out.find((f) => f.id === "food:AFG")!;
  expect(afg.props?.insufficientFood).toBe((23_075_100).toLocaleString());
  expect(afg.props?.prevalence).toBe("57%"); // 0.5709… → 57%
  expect(afg.color).toBe(foodInsecurityColor(0.5709982309895716));
  expect(afg.ts).toBeUndefined(); // nowcast snapshot, never time-filtered
  const ctr = centroidByIso3("AFG")!;
  expect(afg.lon).toBe(ctr.lon);
});

test("FCS prevalence resolves as the real metric (finite % scalar, not the radius proxy)", () => {
  const out = normalizeFoodSecurity(fixture as never);
  const afg = out.find((f) => f.id === "food:AFG")!;

  // A finite numeric sibling prop must back the display string.
  expect(typeof afg.props?.prevalencePct).toBe("number");
  expect(Number.isFinite(afg.props?.prevalencePct as number)).toBe(true);
  expect(afg.props?.prevalencePct).toBe(57); // Math.round(0.5709… * 100)

  // The declared metric points at that field with a numeric-literal domain.
  expect(FOOD_SECURITY_SOURCE.metric).toEqual({ field: "prevalencePct", domain: [5, 50], unit: " %" });

  const m = rowMetric(afg, FOOD_SECURITY_SOURCE.metric)!;
  expect(m.value).toBe(57);
  expect(m.domain).toEqual([5, 50]);
  expect(m.label).toBe("57 %");
});

test("prevalence colour ramp", () => {
  expect(foodInsecurityColor(0.45)).toBe("#7f1d1d");
  expect(foodInsecurityColor(0.3)).toBe("#dc2626");
  expect(foodInsecurityColor(0.18)).toBe("#ea580c");
  expect(foodInsecurityColor(0.08)).toBe("#f59e0b");
  expect(foodInsecurityColor(0.02)).toBe("#fbbf24");
});

// --- dormancy: WFP withdrew the keyless feed (401 as of 2026-08-10) ----------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env[HUNGERMAP_KEY_ENV];
  vi.restoreAllMocks();
});

test("with no key the layer announces itself instead of silently rendering zero", async () => {
  delete process.env[HUNGERMAP_KEY_ENV];
  // No network call may happen at all when we know we have no credential.
  const spy = vi.fn();
  globalThis.fetch = spy as unknown as typeof fetch;

  const out = await FOOD_SECURITY_SOURCE.fetch();
  expect(spy).not.toHaveBeenCalled();

  // Not an empty array — an empty array reads as "no hunger anywhere".
  expect(out).toHaveLength(1);
  const notice = out[0];
  expect(isFoodSecurityNotice(notice)).toBe(true);
  expect(notice.id).toBe(FOOD_SECURITY_NOTICE_ID);
  expect(notice.title).toMatch(/no data/i);
  expect(notice.title).toMatch(/no longer public/i);
  expect(notice.props?.status).toMatch(/NOT a measurement/i);
  expect(notice.props?.needsEnvVar).toBe("HUNGERMAP_API_KEY");
  expect(notice.props?.reason).toContain("HUNGERMAP_API_KEY");
});

test("the notice can never be read as a measurement", () => {
  const notice = foodSecurityNotice("test reason");
  // The metric field is absent, so the monitor row falls back to a plain dot
  // rather than drawing a bar at some invented value.
  expect(notice.props?.prevalencePct).toBeUndefined();
  expect(notice.props?.magnitude).toBeUndefined();
  expect(notice.props?.insufficientFood).toBeUndefined();
  expect(rowMetric(notice, FOOD_SECURITY_SOURCE.metric)).toBeUndefined();
  // And it sits outside the severity ramp so it cannot be mistaken for a reading.
  const ramp = [0, 0.06, 0.2, 0.3, 0.5].map(foodInsecurityColor);
  expect(ramp).not.toContain(notice.color);
  expect(notice.props?.position).toMatch(/placeholder/i);
});

test("a rejected key is reported as a rejected key, not as an empty world", async () => {
  process.env[HUNGERMAP_KEY_ENV] = "not-a-real-key";
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
  ) as unknown as typeof fetch;

  const out = await FOOD_SECURITY_SOURCE.fetch();
  expect(out).toHaveLength(1);
  expect(isFoodSecurityNotice(out[0])).toBe(true);
  expect(out[0].props?.reason).toMatch(/rejected it \(HTTP 401\)/);
});

test("an upstream throw is dormant-safe — a notice, never a rejected promise", async () => {
  process.env[HUNGERMAP_KEY_ENV] = "not-a-real-key";
  globalThis.fetch = vi.fn(async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;

  const out = await FOOD_SECURITY_SOURCE.fetch();
  expect(out).toHaveLength(1);
  expect(out[0].props?.reason).toMatch(/could not be reached/i);
});

test("a working key wakes the layer back up unchanged", async () => {
  process.env[HUNGERMAP_KEY_ENV] = "pretend-this-works";
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(fixture), { status: 200 }),
  ) as unknown as typeof fetch;

  const out = await FOOD_SECURITY_SOURCE.fetch();
  expect(out).toHaveLength(6); // the same six countries the pure mapper yields
  expect(out.some(isFoodSecurityNotice)).toBe(false);
  expect(out.find((f) => f.id === "food:AFG")?.props?.prevalencePct).toBe(57);
});
