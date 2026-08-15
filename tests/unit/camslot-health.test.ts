import { describe, it, expect } from "vitest";
import {
  isBenched,
  liveStreams,
  benchedNote,
  applyOutcome,
  FAILURES_BEFORE_DROP,
  RETRY_AFTER_MS,
  type HealthMap,
} from "@/lib/console/widgets/camslot.health";
import type { StreamRef } from "@/lib/console/widgets/camslot.model";

const T = 1_786_745_000_000;
const cam = (id: string): StreamRef => ({ k: "cam", id });

describe("applyOutcome", () => {
  it("counts consecutive failures", () => {
    const a = applyOutcome(undefined, false, T);
    expect(a.failures).toBe(1);
    expect(applyOutcome(a, false, T + 1000).failures).toBe(2);
  });

  it("a success wipes the streak — a camera that came back is not on two strikes", () => {
    const twoStrikes = applyOutcome(applyOutcome(undefined, false, T), false, T);
    expect(applyOutcome(twoStrikes, true, T).failures).toBe(0);
  });
});

describe("isBenched", () => {
  it("tolerates a single failure — one blip is not a dead camera", () => {
    expect(isBenched({ failures: 1, lastFailedAt: T }, T + 10)).toBe(false);
  });

  it("benches at the threshold", () => {
    expect(isBenched({ failures: FAILURES_BEFORE_DROP, lastFailedAt: T }, T + 10)).toBe(true);
  });

  it("un-benches after the retry window, so a recovered camera comes back", () => {
    const h = { failures: 5, lastFailedAt: T };
    expect(isBenched(h, T + RETRY_AFTER_MS - 1)).toBe(true);
    expect(isBenched(h, T + RETRY_AFTER_MS)).toBe(false);
  });

  it("treats an unknown stream as healthy", () => {
    expect(isBenched(undefined, T)).toBe(false);
  });
});

describe("liveStreams", () => {
  it("drops only the benched ones", () => {
    const streams = [cam("a"), cam("b"), cam("c")];
    const health: HealthMap = { "cam:b": { failures: 2, lastFailedAt: T } };
    expect(liveStreams(streams, health, T + 10).map((s) => (s as { id: string }).id)).toEqual(["a", "c"]);
  });

  it("can return an empty list — a slot where nothing answers must not silently rotate", () => {
    const streams = [cam("a")];
    const health: HealthMap = { "cam:a": { failures: 2, lastFailedAt: T } };
    expect(liveStreams(streams, health, T + 10)).toEqual([]);
  });
});

describe("benchedNote", () => {
  it("says nothing when everything is answering", () => {
    expect(benchedNote([cam("a")], {}, T)).toBeNull();
  });

  it("counts the skipped ones", () => {
    const streams = [cam("a"), cam("b"), cam("c")];
    const health: HealthMap = {
      "cam:b": { failures: 2, lastFailedAt: T },
      "cam:c": { failures: 3, lastFailedAt: T },
    };
    expect(benchedNote(streams, health, T + 10)).toBe("2 streams are not answering, so they are skipped.");
  });

  it("uses singular for one", () => {
    const health: HealthMap = { "cam:b": { failures: 2, lastFailedAt: T } };
    expect(benchedNote([cam("a"), cam("b")], health, T + 10)).toBe("1 stream is not answering, so it is skipped.");
  });

  it("says something different when NOTHING answers, rather than 'skipped'", () => {
    const health: HealthMap = { "cam:a": { failures: 2, lastFailedAt: T } };
    expect(benchedNote([cam("a")], health, T + 10)).toBe("This stream is not answering.");
  });

  it("never claims a camera is offline — only that we could not reach it", () => {
    const health: HealthMap = { "cam:a": { failures: 2, lastFailedAt: T } };
    const note = benchedNote([cam("a"), cam("b")], health, T + 10)!;
    expect(note.toLowerCase()).not.toContain("offline");
    expect(note.toLowerCase()).toContain("not answering");
  });
});
