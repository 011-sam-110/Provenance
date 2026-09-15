import { expect, test } from "vitest";
import {
  classifySignalFreshness,
  signalFreshAgeMs,
  signalFreshLabel,
  signalFreshnessFromPayload,
  type SignalFreshRecord,
} from "@/lib/signals/freshness";

const base = (over: Partial<SignalFreshRecord>): SignalFreshRecord => ({
  lastUpdate: 1_000_000,
  ok: true,
  count: 5,
  refreshMs: 60_000,
  ...over,
});

test("a fresh, non-empty fetch is live", () => {
  const r = base({ lastUpdate: 1_000_000, count: 5 });
  expect(classifySignalFreshness(r, 1_000_000 + 30_000)).toBe("live"); // < 2× refresh
});

test("fetched OK but zero features is 'empty', not stale or broken", () => {
  const r = base({ count: 0 });
  expect(classifySignalFreshness(r, 1_000_000 + 1_000)).toBe("empty");
  expect(signalFreshLabel("empty", "")).toBe("live · none right now");
});

test("ages into lagging then stale by multiples of the cadence", () => {
  const r = base({ count: 5, refreshMs: 60_000 });
  expect(classifySignalFreshness(r, 1_000_000 + 60_000 * 3)).toBe("lagging"); // 2×–6×
  expect(classifySignalFreshness(r, 1_000_000 + 60_000 * 7)).toBe("stale"); // ≥ 6×
});

test("stale takes precedence over empty once truly old", () => {
  const r = base({ count: 0, refreshMs: 60_000 });
  expect(classifySignalFreshness(r, 1_000_000 + 60_000 * 7)).toBe("stale");
});

test("failed fetch is down; never-fetched is unknown", () => {
  expect(classifySignalFreshness(base({ ok: false }), 2_000_000)).toBe("down");
  expect(classifySignalFreshness(base({ lastUpdate: null }), 2_000_000)).toBe("unknown");
  expect(signalFreshLabel("down", "")).toBe("unavailable");
  expect(signalFreshLabel("unknown", "")).toBe("connecting…");
});

test("age helper is null before first fetch, clamped non-negative otherwise", () => {
  expect(signalFreshAgeMs(base({ lastUpdate: null }), 5)).toBeNull();
  expect(signalFreshAgeMs(base({ lastUpdate: 1_000 }), 4_000)).toBe(3_000);
  expect(signalFreshAgeMs(base({ lastUpdate: 5_000 }), 4_000)).toBe(0); // clock skew → clamped
});

// Payload shapes below are what production /api/signals/<id> returned on 2026-09-12.
const classifyPayload = (d: { ok?: boolean; count: number }) =>
  classifySignalFreshness({ ...signalFreshnessFromPayload(d), lastUpdate: 1_000_000, refreshMs: 60_000 }, 1_000_000 + 1_000);

test("a declared failure with nothing to show is down, not 'live · none right now'", () => {
  expect(classifyPayload({ ok: false, count: 0 })).toBe("down"); // reliefweb/grid-load "no key", fire-active "http 400"
});

test("an upstream that answered with nothing is still the honest empty state", () => {
  expect(classifyPayload({ ok: true, count: 0 })).toBe("empty");
  expect(classifyPayload({ ok: true, count: 12 })).toBe("live");
});

test("an undeclared outcome with nothing to show is not read as healthy", () => {
  expect(classifyPayload({ count: 0 })).toBe("down");
});

test("a failure that still carries rows keeps its current reading until partial/last-good has a state", () => {
  // gdacs: "partial: VO failed (http 404)" with 36 fresh rows. Calling that layer
  // unavailable would swap one false label for another.
  expect(classifyPayload({ ok: false, count: 36 })).toBe("live");
});
