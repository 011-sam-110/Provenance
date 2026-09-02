import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/gdacs-events.json";
import {
  normalizeGdacs,
  gdacsEventLabel,
  gdacsAlertColor,
  gdacsEndpointFor,
  mergeGdacsResults,
  GDACS_SOURCE,
  GDACS_EVENT_TYPES,
  type GdacsTypeResult,
} from "@/lib/signals/gdacs";
import { readOutcome } from "@/lib/signals/outcome";
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

// ── Regression: the layer was silently empty in production, twice ───────────
//
// Round one (2026-08-13): GDACS began rejecting a bare event-list call with HTTP
// 400 {"message":"Eventtype is required."}. Round two (2026-08-28): the fix for
// round one — one request, all six codes semicolon-joined — started failing the
// same way with {"message":"Please specify only 1 eventtype."}. Both times
// GDACS_SOURCE.fetch() turned a hard 400 into a clean, quiet zero, indistinguishable
// from "no disasters today". The parser was never wrong either time; the request
// shape was. These assert the request shape, which is the thing that actually broke.

test("each hazard type gets its own single-type URL", () => {
  for (const type of GDACS_EVENT_TYPES) {
    const url = gdacsEndpointFor(type);
    const value = new URL(url).searchParams.get("eventtype");
    expect(value).toBe(type);
    // The round-two regression: GDACS now rejects more than one type per request.
    expect(value).not.toContain(";");
    expect(value).not.toContain(",");
  }
});

test("every hazard code we request is one the label map understands", () => {
  for (const code of GDACS_EVENT_TYPES) {
    expect(gdacsEventLabel(code)).not.toBe("Disaster"); // "Disaster" is the fallback
  }
});

test("requests all six hazard types, so the layer is not quietly single-hazard", () => {
  expect([...GDACS_EVENT_TYPES].sort()).toEqual(["DR", "EQ", "FL", "TC", "VO", "WF"]);
});

// ── mergeGdacsResults: the fan-out/fan-in this fix introduced ────────────────

const okResult = (type: string, eventId: number): GdacsTypeResult => ({
  type,
  ok: true,
  features: [
    { geometry: { coordinates: [10, 20] }, properties: { eventid: eventId, episodeid: 1, eventtype: type, alertlevel: "Green" } },
  ],
});
const failResult = (type: string, reason: string): GdacsTypeResult => ({ type, ok: false, reason });

test("all six types succeeding merges into one observed result", () => {
  const results = GDACS_EVENT_TYPES.map((t, i) => okResult(t, i + 1));
  const out = mergeGdacsResults(results, 1000);
  expect(readOutcome(out)).toMatchObject({ ok: true, at: 1000 });
  expect(out).toHaveLength(6);
});

test("all six types failing reports nothing, not a false quiet day", () => {
  const results = GDACS_EVENT_TYPES.map((t) => failResult(t, "http 400"));
  const out = mergeGdacsResults(results, 1000);
  expect(readOutcome(out)).toMatchObject({ ok: false, reason: "http 400", at: 1000 });
  expect(out).toHaveLength(0);
});

test("one type failing keeps the other five, flagged degraded rather than silently OK", () => {
  const results: GdacsTypeResult[] = [
    okResult("EQ", 1),
    okResult("TC", 2),
    okResult("FL", 3),
    okResult("VO", 4),
    okResult("DR", 5),
    failResult("WF", "http 500"),
  ];
  const out = mergeGdacsResults(results, 2000);
  const outcome = readOutcome(out);
  expect(outcome?.ok).toBe(false); // partial is not success, even with real rows attached
  expect(outcome?.reason).toContain("WF");
  expect(outcome?.reason).toContain("http 500");
  expect(out).toHaveLength(5); // the five that succeeded are not thrown away
});
