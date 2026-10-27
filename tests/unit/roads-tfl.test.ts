import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FETCH_AGE_SHOWN_MS, changeText, fetchedText, newestChange, utcStamp } from "@/lib/roads/notice";
import { joinLines, normalizeTflNotices, tflKind } from "@/lib/roads/tfl";
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
    // Each street's segments join into one line.
    expect(MIXED[0].streets.map((s: { closure: string }) => s.closure)).toEqual(["Closed", "Open"]);
    expect(a12.closedLines).toHaveLength(1);
    expect(a12.openLines).toHaveLength(1);
    expect(a12.closure).toBe("Closed, westbound");
    // TfL's own notice-level flag says nothing is closed. The streets decide.
    expect(MIXED[0].hasClosures).toBe(false);
  });

  it("keeps every point TfL sent, each on the line of its own street", () => {
    const pointsOf = (street: { segments: { lineString: string }[] }) =>
      street.segments.flatMap((s) => JSON.parse(s.lineString) as [number, number][]);
    const on = (line: [number, number][], [x, y]: [number, number]) =>
      line.some(([lx, ly]) => Math.abs(lx - x) < 1e-9 && Math.abs(ly - y) < 1e-9);
    for (const p of pointsOf(MIXED[0].streets[0])) expect(on(a12.closedLines[0], p)).toBe(true);
    for (const p of pointsOf(MIXED[0].streets[1])) expect(on(a12.openLines[0], p)).toBe(true);
  });

  it("paints only the Closed stretch as closed; the open stretch keeps the notice's kind", () => {
    const feats = streetFeatures([a12]);
    const byPaint = (p: string) => feats.filter((f) => f.properties?.paint === p).length;
    expect(byPaint("closed")).toBe(1);
    expect(byPaint("works")).toBe(1);
    expect(byPaint("incident")).toBe(0);
  });

  it("draws every category but Works as an incident", () => {
    expect([a12.kind, water.kind, police.kind]).toEqual(["works", "incident", "incident"]);
    expect(tflKind("Works")).toBe("works");
    expect(tflKind("Collisions")).toBe("incident");
    expect(tflKind("Asset issues")).toBe("incident");
  });
});

describe("joinLines: a dash stays a dash", () => {
  // MapLibre starts a dash pattern again at the start of every line, so a street sent as
  // short pieces draws solid. TfL sends its pieces out of order and in either direction.
  const A: [number, number] = [0, 0];
  const B: [number, number] = [1, 0];
  const C: [number, number] = [2, 0];
  const D: [number, number] = [3, 0];

  it("joins pieces end to end, in any order and either direction", () => {
    expect(joinLines([[C, D], [A, B], [C, B]])).toEqual([[D, C, B, A]]);
  });

  it("takes two points within about a metre as one", () => {
    expect(joinLines([[A, B], [[1.000004, 0.000003], C]])).toEqual([[A, B, C]]);
  });

  it("never bridges a gap", () => {
    expect(joinLines([[A, B], [C, D]])).toEqual([[A, B], [C, D]]);
  });

  it("drops a piece that repeats another, forwards or backwards", () => {
    expect(joinLines([[A, B], [B, A], [A, B]])).toEqual([[A, B]]);
  });

  it("at a fork joins two pieces and keeps the third apart", () => {
    const E: [number, number] = [1, 1];
    expect(joinLines([[A, B], [B, C], [B, E]])).toHaveLength(2);
  });

  it("joins every street in the recorded rows into one line", () => {
    for (const d of MIXED) {
      for (const street of d.streets) {
        const pieces = street.segments.map((s: { lineString: string }) => JSON.parse(s.lineString));
        expect(joinLines(pieces), `${d.id} ${street.name}`).toHaveLength(1);
      }
    }
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
