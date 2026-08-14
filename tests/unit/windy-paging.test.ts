import { expect, test } from "vitest";
import { WINDY_REGIONS, planPageJobs, type WindyRegion } from "@/lib/sources/windy";

// The paging arithmetic is what decides whether a dense region is silently
// truncated, so it is tested directly rather than through the network fan-out.

const LIMIT = 50;
const DEFAULT_PAGES = 2;

test("defaults to the module page count when a region does not override it", () => {
  const regions: WindyRegion[] = [{ name: "r", bbox: [1, 2, 3, 4] }];
  const jobs = planPageJobs(regions, DEFAULT_PAGES, LIMIT);
  expect(jobs).toEqual([
    { region: "r", bbox: [1, 2, 3, 4], offset: 0 },
    { region: "r", bbox: [1, 2, 3, 4], offset: 50 },
  ]);
});

test("honours a per-region page override and steps offsets by the page limit", () => {
  const regions: WindyRegion[] = [{ name: "dense", bbox: [1, 2, 3, 4], pages: 5 }];
  const jobs = planPageJobs(regions, DEFAULT_PAGES, LIMIT);
  expect(jobs.map((j) => j.offset)).toEqual([0, 50, 100, 150, 200]);
  expect(jobs.every((j) => j.region === "dense")).toBe(true);
});

test("an override of 0 or a negative asks for no pages rather than looping", () => {
  expect(planPageJobs([{ name: "off", bbox: [1, 2, 3, 4], pages: 0 }], DEFAULT_PAGES, LIMIT)).toEqual([]);
  expect(planPageJobs([{ name: "neg", bbox: [1, 2, 3, 4], pages: -3 }], DEFAULT_PAGES, LIMIT)).toEqual([]);
});

test("Brazil is registered with enough pages to carry the measured inventory", () => {
  const brazil = WINDY_REGIONS.find((r) => r.name === "brazil");
  expect(brazil).toBeDefined();
  // Measured 2026-08-14: bbox total=206, of which 135 are location.country "Brazil".
  // The default 2 pages ceilings at 100 and would drop roughly half the box.
  const capacity = (brazil!.pages ?? DEFAULT_PAGES) * LIMIT;
  expect(capacity).toBeGreaterThanOrEqual(206);
});

test("every Brazil offset stays inside the free tier's offset<=1000 limit", () => {
  const brazil = WINDY_REGIONS.find((r) => r.name === "brazil")!;
  const jobs = planPageJobs([brazil], DEFAULT_PAGES, LIMIT);
  expect(jobs.length).toBeGreaterThan(0);
  for (const job of jobs) expect(job.offset).toBeLessThanOrEqual(1000);
});

test("region names are unique, so a duplicate bbox cannot be added unnoticed", () => {
  const names = WINDY_REGIONS.map((r) => r.name);
  expect(new Set(names).size).toBe(names.length);
});
