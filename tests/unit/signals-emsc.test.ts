import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/emsc-quakes.json";
import { emscEndpoint, normalizeEmsc, EMSC_REQUEST_LIMIT, EMSC_WINDOW_HOURS } from "@/lib/signals/emsc";
import { readCoverage } from "@/lib/signals/coverage";
import { magnitudeColor } from "@/lib/signals/usgs";

test("normalizes EMSC quakes, skipping null-geometry events", () => {
  const out = normalizeEmsc(fixture as never);
  expect(out).toHaveLength(3); // 3 located events; the null-geometry "BADGEO" is skipped
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["earthquakes"])); // one of its catalogues

  const [top] = out;
  expect(top.id).toBe("emsc:20260627_0000100");
  expect(top.lat).toBeCloseTo(-8.9563, 4);
  expect(top.lon).toBeCloseTo(111.1499, 4);
  expect(top.props?.magnitude).toBe(5.2);
  expect(top.props?.depth).toBe("65.6 km");
  expect(top.props?.place).toBe("JAVA, INDONESIA");
  expect(top.color).toBe(magnitudeColor(5.2));
  expect(top.ts).toBe("2026-06-27T07:47:23.012Z");
  expect(top.link).toContain("20260627_0000100");
});

// The query used to have no starttime and asked for the newest 500 events of the
// whole catalogue, which reached back ~36 h on 2026-10-16 while 24 h held 328.
test("asks for a fixed 24-hour window, newest first, with room for a busy day", () => {
  const url = new URL(emscEndpoint(Date.parse("2026-10-16T18:30:00Z")));
  expect(EMSC_WINDOW_HOURS).toBe(24);
  expect(url.searchParams.get("starttime")).toBe("2026-10-15T18:30:00");
  expect(url.searchParams.get("limit")).toBe(String(EMSC_REQUEST_LIMIT));
  expect(url.searchParams.get("orderby")).toBe("time");
  expect(url.searchParams.get("format")).toBe("json");
});

test("a window under the limit is a complete answer, stated as the window", () => {
  const c = readCoverage(normalizeEmsc(fixture as never))!;
  expect(c).toMatchObject({ capped: false, availableExact: true, rule: "every EMSC event in the past 24 hours" });
});
