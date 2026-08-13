import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/gdacs-events.json";
import {
  normalizeGdacs,
  gdacsEventLabel,
  gdacsAlertColor,
  GDACS_SOURCE,
  GDACS_ENDPOINT,
  GDACS_EVENT_TYPES,
} from "@/lib/signals/gdacs";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes the GDACS multi-hazard FeatureCollection", () => {
  const out = normalizeGdacs(fixture as never);
  expect(out).toHaveLength(5); // FL, EQ, TC, WF, DR — all have coords + an event id
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["gdacs"]));

  const eq = out.find((f) => f.props?.hazard === "Earthquake");
  expect(eq).toBeDefined();
  expect(eq!.id).toMatch(/^gdacs:\d+:\d+$/);
  expect(eq!.title).toContain("Papua New Guinea");
  expect(eq!.color).toBe(gdacsAlertColor("Green"));
  expect(typeof eq!.ts).toBe("string"); // fromdate parsed as UTC
  expect(eq!.props?.country).toBe("Papua New Guinea");
});

test("skips features with missing/invalid coordinates", () => {
  const bad = { features: [{ geometry: { coordinates: [null, null] }, properties: { eventid: 1, eventtype: "EQ" } }] };
  expect(normalizeGdacs(bad as never)).toHaveLength(0);
});

test("dedupes repeated event+episode entries (GDACS lists the same event twice)", () => {
  const dup = {
    features: [
      { geometry: { coordinates: [10, 20] }, properties: { eventid: 42, episodeid: 3, eventtype: "TC", alertlevel: "Red" } },
      { geometry: { coordinates: [10, 20] }, properties: { eventid: 42, episodeid: 3, eventtype: "TC", alertlevel: "Red" } },
    ],
  };
  const out = normalizeGdacs(dup as never);
  expect(out).toHaveLength(1); // one id → one row (no duplicate React keys)
  expect(out[0].id).toBe("gdacs:42:3");
});

test("event-type labels and alert-level colours", () => {
  expect(gdacsEventLabel("TC")).toBe("Tropical cyclone");
  expect(gdacsEventLabel("WF")).toBe("Wildfire");
  expect(gdacsEventLabel("??")).toBe("Disaster");
  expect(gdacsAlertColor("Red")).toBe("#dc2626");
  expect(gdacsAlertColor("Orange")).toBe("#f59e0b");
  expect(gdacsAlertColor("Green")).toBe("#16a34a");
});

test("alertLevel maps to the expected magnitude (0–10 ramp)", () => {
  const make = (alertlevel: string) => ({
    features: [
      {
        geometry: { coordinates: [10, 20] },
        properties: { eventid: 1, episodeid: 1, eventtype: "EQ", alertlevel },
      },
    ],
  });
  expect(normalizeGdacs(make("Red") as never)[0].props?.magnitude).toBe(8);
  expect(normalizeGdacs(make("Orange") as never)[0].props?.magnitude).toBe(6);
  expect(normalizeGdacs(make("Green") as never)[0].props?.magnitude).toBe(3);
  expect(normalizeGdacs(make("Unknown") as never)[0].props?.magnitude).toBe(5);
});

test("declares GDACS's real alert score (0–3) as the metric and it resolves per feature", () => {
  expect(GDACS_SOURCE.metric).toEqual({ field: "alertScore", domain: [0, 3] });

  const out = normalizeGdacs(fixture as never);
  const eq = out.find((f) => f.props?.hazard === "Earthquake")!;
  // Real numeric scalar from the provider (not the 0–10 ramp), so rowMetric accepts it.
  expect(typeof eq.props?.alertScore).toBe("number");
  expect(Number.isFinite(eq.props?.alertScore as number)).toBe(true);

  const m = rowMetric(eq, GDACS_SOURCE.metric);
  expect(m).toBeDefined();
  expect(m!.value).toBe(1); // Green earthquake → GDACS alertscore 1
  expect(m!.domain).toEqual([0, 3]);
  expect(m!.label).toBe("1");

  // Every fixture feature carries a finite alert score → a bar, never a bare dot.
  for (const f of out) {
    expect(rowMetric(f, GDACS_SOURCE.metric)).toBeDefined();
  }
});

// ── Regression: the layer was silently empty in production ──────────────────
//
// GDACS began rejecting a bare event-list call with HTTP 400
// {"message":"Eventtype is required."}. Because GDACS_SOURCE.fetch() returns []
// on any non-ok response, the layer published a clean zero on every poll and
// looked identical to "no disasters today". The parser was never wrong; the URL
// was. These assert the URL, which is the thing that actually broke.

test("the event-list URL carries the mandatory eventtype parameter", () => {
  expect(GDACS_ENDPOINT).toContain("eventtype=");
  const value = new URL(GDACS_ENDPOINT).searchParams.get("eventtype");
  expect(value).toBeTruthy();
  expect(value).not.toBe("");
});

test("eventtype is semicolon-separated, which is the form GDACS accepts", () => {
  const value = new URL(GDACS_ENDPOINT).searchParams.get("eventtype")!;
  expect(value).toBe(GDACS_EVENT_TYPES.join(";"));
  // A comma-separated list is the obvious thing to reach for and it is wrong here.
  expect(value).not.toContain(",");
});

test("every hazard code we request is one the label map understands", () => {
  for (const code of GDACS_EVENT_TYPES) {
    expect(gdacsEventLabel(code)).not.toBe("Disaster"); // "Disaster" is the fallback
  }
});

test("requests all six hazard types, so the layer is not quietly single-hazard", () => {
  expect([...GDACS_EVENT_TYPES].sort()).toEqual(["DR", "EQ", "FL", "TC", "VO", "WF"]);
});
