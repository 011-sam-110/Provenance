import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FETCH_AGE_SHOWN_MS, changeText, fetchedText, newestChange, utcStamp } from "@/lib/roads/notice";
import { normalizeTflNotices, tflKind } from "@/lib/roads/tfl";
import { streetFeatures } from "@/lib/eye/streets";

// Three verbatim rows of TfL's /Road/all/Disruption answer, recorded 27 Oct 2026 at
// 06:19 UTC: works whose notice closes one stretch of the A12 and leaves the next open,
// a burst water main (category Hazards) with a closed street, and police activity
// (Emergency service incidents) that closes Blackstock Road.
const MIXED = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tfl-road-disruptions-mixed.json"), "utf8"));

describe("normalizeTflNotices: closed is per street", () => {
  const [a12, water, police] = normalizeTflNotices(MIXED);

  it("keeps TfL's words, and its own last-change time", () => {
    expect(a12).toMatchObject({ id: "TIMS-237054", category: "Works", severity: "Minimal", updated: "2026-10-27T05:56:23Z" });
    expect(water).toMatchObject({ id: "TIMS-236919", category: "Hazards", subCategory: "Burst water main" });
    expect(police).toMatchObject({ id: "TIMS-237055", category: "Emergency service incidents", severity: "No impact" });
  });

  it("splits a notice's segments by its own streets' closure words", () => {
    // TfL names two A12 stretches: one Closed westbound (7 segments), one Open (13).
    expect(MIXED[0].streets.map((s: { closure: string }) => s.closure)).toEqual(["Closed", "Open"]);
    expect(a12.closedLines).toHaveLength(7);
    expect(a12.openLines).toHaveLength(13);
    expect(a12.closure).toBe("Closed, westbound");
    // TfL's own notice-level flag says nothing is closed. The streets decide.
    expect(MIXED[0].hasClosures).toBe(false);
  });

  it("sends each segment once", () => {
    const counted = MIXED[0].streets.reduce((n: number, s: { segments: unknown[] }) => n + s.segments.length, 0);
    expect(a12.openLines.length + a12.closedLines.length).toBe(counted);
  });

  it("paints only the Closed stretch as closed; the open stretch keeps the notice's kind", () => {
    const feats = streetFeatures([a12]);
    const byPaint = (p: string) => feats.filter((f) => f.properties?.paint === p).length;
    expect(byPaint("closed")).toBe(7);
    expect(byPaint("works")).toBe(13);
    expect(byPaint("incident")).toBe(0);
  });

  it("draws every category but Works as an incident", () => {
    expect([a12.kind, water.kind, police.kind]).toEqual(["works", "incident", "incident"]);
    expect(tflKind("Works")).toBe("works");
    expect(tflKind("Collisions")).toBe("incident");
    expect(tflKind("Asset issues")).toBe("incident");
  });
});

describe("the two times", () => {
  const now = Date.parse("2026-10-27T06:20:00Z");

  it("take the newest change TfL wrote, and ignore a row with none or a bad one", () => {
    const notices = normalizeTflNotices(MIXED);
    expect(newestChange(notices)).toBe(Date.parse("2026-10-27T05:56:23Z"));
    expect(newestChange([{ updated: "not a date" }, {}])).toBeNull();
    expect(newestChange([])).toBeNull();
  });

  it("are stated in UTC, with the day when it is not today", () => {
    expect(utcStamp(Date.parse("2026-10-27T05:56:23Z"), now)).toBe("05:56 UTC");
    expect(utcStamp(Date.parse("2026-10-26T15:59:00Z"), now)).toBe("26 Oct 15:59 UTC");
    expect(changeText("TfL", Date.parse("2026-10-27T05:56:23Z"), now)).toBe("TfL's newest change 05:56 UTC");
  });

  it("add how long ago only once the fetch is old", () => {
    expect(fetchedText(now - 60_000, now)).toBe("fetched 06:19 UTC");
    expect(fetchedText(now - FETCH_AGE_SHOWN_MS, now)).toBe("fetched 06:15 UTC, 5 min ago");
    expect(fetchedText(now - 22 * 60_000, now)).toBe("fetched 05:58 UTC, 22 min ago");
  });

  it("never call a notice live", () => {
    const words = [utcStamp(now, now), fetchedText(now, now), changeText("TfL", now, now)].join(" ");
    expect(words).not.toMatch(/\blive\b/i);
  });
});
