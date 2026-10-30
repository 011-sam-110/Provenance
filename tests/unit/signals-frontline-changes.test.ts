import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELAY_FEEDS, type RelayData } from "@/lib/relay/feeds";
import { putRelay, resetRelayStore } from "@/lib/relay/store";
import { readOutcome } from "@/lib/signals/outcome";
import { readSummary } from "@/lib/signals/summary";
import {
  FRONTLINE_CHANGES_SOURCE,
  FRONTLINE_SIDE_COLORS,
  SPAN_DAYS,
  WINDOW_DAYS,
  entrySides,
  frontlineChangesFrom,
  readFrontlineSummary,
} from "@/lib/signals/frontline-changes";
import { toSignalObjects } from "@/lib/map/signalObjects";
import { EMPTY_MARK_CONTEXT, markOf, pinSignals } from "@/lib/map/precisionMarks";

// A real envelope, captured whole on 2026-10-30 with
// `python -m sources push frontline-changes --dry-run --out` (NewsScraper sources/deepstate.py):
// 82 linked spots from 54 DeepState entries over 60 days.
const env = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "relay", "frontline-changes.json"), "utf8"));
const data = RELAY_FEEDS["frontline-changes"].schema.parse(env.data) as RelayData<"frontline-changes">;
const FETCHED = Date.parse(env.fetchedAt);

describe("front line changes: relay -> spots", () => {
  const { features, summary } = frontlineChangesFrom(data, FETCHED);

  it("puts the spots of the last 14 days on the map, all of them Russian advances", () => {
    expect(data.changes).toHaveLength(82);
    expect(features).toHaveLength(15);
    expect(summary.counts).toEqual({ ru: 15, ua: 0, unknown: 0 });
    expect(summary.updates).toBe(10);
    for (const f of features) {
      expect(Date.parse(f.ts!)).toBeGreaterThanOrEqual(FETCHED - WINDOW_DAYS * 86_400_000);
      expect(f.precision).toBe("area");
      expect(f.color).toBe(FRONTLINE_SIDE_COLORS.ru);
      expect(f.link).toMatch(/^https:\/\/deepstatemap\.live\/en#\d+\/[\d.]+\/[\d.]+$/);
    }
    expect(features[0]).toMatchObject({ title: "Maiske", lat: 48.6467764, lon: 37.7667016, ts: "2026-10-28T21:33:20Z" });
    expect(features[0].props?.deepState).toBe("The enemy has advanced near Maiske.");
  });

  it("draws a soft disc for each, never a pin: the spot is where DeepState centres its map", () => {
    const objs = toSignalObjects(features, FRONTLINE_CHANGES_SOURCE);
    expect(pinSignals(objs, EMPTY_MARK_CONTEXT)).toHaveLength(0);
    expect(new Set(objs.map((o) => markOf(o, EMPTY_MARK_CONTEXT)))).toEqual(new Set(["disc"]));
  });

  it("keeps all 60 days in the summary, one entry per DeepState update, newest first", () => {
    expect(summary.entries).toHaveLength(54);
    expect(summary.entries.reduce((n, e) => n + e.spots.length, 0)).toBe(82);
    const times = summary.entries.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(summary.newestAt).toBe("2026-10-28T21:33:20Z");
  });

  it("keeps each spot's own side when one update names both", () => {
    const mixed = summary.entries.find((e) => e.id === 1790655116)!;
    expect(mixed.spots.map((s) => [s.place, s.side])).toEqual([
      ["Kalynove", "ua"],
      ["Vasylivka", "ru"],
      ["Shevchenko", "ru"],
    ]);
    expect(entrySides(mixed)).toEqual(["ua", "ru"]);
    const clarified = summary.entries.find((e) => e.id === 1791744589)!;
    expect(entrySides(clarified)).toEqual(["ru", "unknown"]);
  });

  it("counts spots per day over the whole span, every day present", () => {
    expect(summary.perDay).toHaveLength(SPAN_DAYS + 1);
    expect(summary.perDay[SPAN_DAYS].day).toBe("2026-10-30");
    const total = summary.perDay.reduce((n, d) => n + d.ru + d.ua + d.unknown, 0);
    expect(total).toBe(82);
    expect(summary.perDay.find((d) => d.day === "2026-10-28")).toEqual({ day: "2026-10-28", ru: 1, ua: 0, unknown: 0 });
  });

  it("empties the map when DeepState stops logging, rather than keep old changes looking recent", () => {
    const later = frontlineChangesFrom(data, FETCHED + 30 * 86_400_000);
    expect(later.features).toHaveLength(0);
    expect(later.summary.counts).toEqual({ ru: 0, ua: 0, unknown: 0 });
    expect(later.summary.entries).toHaveLength(54);
  });

  it("the widget's reader accepts the summary after a JSON round trip and refuses another shape", () => {
    const sent = JSON.parse(JSON.stringify(summary));
    expect(readFrontlineSummary(sent)).toEqual(summary);
    expect(readFrontlineSummary({ ...sent, counts: { ru: 1 } })).toBeNull();
    expect(readFrontlineSummary({ ...sent, entries: [{ ...sent.entries[0], spots: [{ place: "X", side: "both" }] }] })).toBeNull();
  });
});

describe("front line changes: the source", () => {
  afterEach(() => {
    resetRelayStore();
    vi.useRealTimers();
  });

  it("says it has no snapshot yet before provenance-1 pushes one", async () => {
    const out = await FRONTLINE_CHANGES_SOURCE.fetch();
    expect(out).toHaveLength(0);
    expect(readOutcome(out)).toMatchObject({ ok: false });
  });

  it("serves the pushed snapshot with its summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FETCHED + 60_000);
    putRelay("frontline-changes", data, FETCHED, FETCHED + 1000);
    const out = await FRONTLINE_CHANGES_SOURCE.fetch();
    expect(out).toHaveLength(15);
    expect(readOutcome(out)).toMatchObject({ ok: true, at: FETCHED, sourceAt: Date.parse("2026-10-28T21:33:20Z") });
    expect(readFrontlineSummary(readSummary(out))?.entries).toHaveLength(54);
  });
});
