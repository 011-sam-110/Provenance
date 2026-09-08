import { describe, it, expect } from "vitest";
import { wordEvent } from "@/lib/notify/wording";
import type { NotifyEvent } from "@/lib/notify/types";

const ev = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  ruleId: "rule:1", areaId: "area:1", sourceId: "earthquakes",
  kind: "appears", rowId: "q1", text: "", at: 1_000, ...over,
});

const ctx = {
  areaLabel: "Soho",
  sourceLabel: "Earthquakes",
  rowTitle: "M5.4 — 12 km NE of Ridgecrest",
  count: 4,
  level: 3,
};

describe("wordEvent — G4, every message names its area", () => {
  it("leads with the area, so two areas watching planes do not send two identical lines", () => {
    expect(wordEvent(ev(), ctx)).toMatch(/^Soho · /);
  });

  it("names the source after the area", () => {
    expect(wordEvent(ev(), ctx)).toContain("Soho · Earthquakes · ");
  });

  it("names the row for a row-scoped event", () => {
    expect(wordEvent(ev(), ctx)).toContain("M5.4 — 12 km NE of Ridgecrest");
  });

  it("says the count for a count event, which has no row", () => {
    const text = wordEvent(ev({ kind: "count", rowId: undefined }), ctx);
    expect(text).toContain("4");
    expect(text).not.toContain("undefined");
  });
});

describe("wordEvent — G5, a source's honesty rules travel with the message", () => {
  it("words a GDELT event as REPORTED and never asserts an incident, because those rows are coded news coverage", () => {
    const text = wordEvent(ev({ sourceId: "conflict" }), { ...ctx, sourceLabel: "Conflict coverage" });
    expect(text).toMatch(/report/i);
    expect(text).toContain("not a verified incident");
  });

  it("words an AIS disappearance as STOPPED BEING HEARD, because leaving coverage and switching off a transponder look identical", () => {
    const text = wordEvent(ev({ sourceId: "ais", kind: "disappears" }), { ...ctx, sourceLabel: "AIS vessels" });
    expect(text).toContain("stopped being heard");
    expect(text).not.toMatch(/\bleft\b|\bdeparted\b/);
  });

  it("names the country for an instability event, because the index is scored per country and cannot be narrower than the ring", () => {
    const text = wordEvent(
      ev({ sourceId: "instability", kind: "crosses" }),
      { ...ctx, sourceLabel: "Country instability", rowTitle: "Sudan", level: 60 },
    );
    expect(text).toContain("Sudan");
    expect(text).toMatch(/scored per country/i);
  });

  it("leaves an ordinary source unadorned, so the caveat machinery does not clutter every message", () => {
    const text = wordEvent(ev(), ctx);
    expect(text).not.toContain("not a verified incident");
    expect(text).not.toMatch(/scored per country/i);
  });
});
