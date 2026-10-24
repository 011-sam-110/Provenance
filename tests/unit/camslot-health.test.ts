import { describe, it, expect } from "vitest";
import {
  isBenched,
  liveStreams,
  benchedNote,
  applyOutcome,
  streamHealth,
  failuresBeforeDrop,
  CARD_FAILURES_BEFORE_DROP,
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

// ── Reasons (2026-10-24) ─────────────────────────────────────────────────────
// A camera whose fetch WORKED but whose picture is black is benched by the same two
// strikes as a failed fetch. One whose picture is its operator's "unavailable" card
// is benched on the FIRST. Otherwise only the words differ.

describe("how many strikes each reason takes", () => {
  it("benches a known card on the FIRST strike: a fingerprint match is not a blip", () => {
    expect(isBenched({ failures: 1, lastFailedAt: T, reason: "placeholder" }, T + 10)).toBe(true);
    expect(failuresBeforeDrop("placeholder")).toBe(CARD_FAILURES_BEFORE_DROP);
    expect(CARD_FAILURES_BEFORE_DROP).toBe(1);
  });

  it("keeps two strikes for a black frame and a failed fetch: a camera switching source can send one", () => {
    for (const reason of ["black", "fetch", undefined] as const) {
      expect(isBenched({ failures: 1, lastFailedAt: T, reason }, T + 10), String(reason)).toBe(false);
      expect(isBenched({ failures: 2, lastFailedAt: T, reason }, T + 10), String(reason)).toBe(true);
      expect(failuresBeforeDrop(reason)).toBe(FAILURES_BEFORE_DROP);
    }
  });

  it("still retries a card benched on one strike after the retry window", () => {
    const h = applyOutcome(undefined, "placeholder", T);
    expect(isBenched(h, T + RETRY_AFTER_MS - 1)).toBe(true);
    expect(isBenched(h, T + RETRY_AFTER_MS)).toBe(false);
    // Back on screen and still the card: benched again at once, not after a dwell.
    expect(isBenched(applyOutcome(h, "placeholder", T + RETRY_AFTER_MS), T + RETRY_AFTER_MS + 1)).toBe(true);
  });
});

describe("applyOutcome with a reason", () => {
  it("counts a card and a black frame as failures, and remembers which", () => {
    const a = applyOutcome(undefined, "placeholder", T);
    expect(a).toEqual({ failures: 1, lastFailedAt: T, reason: "placeholder" });
    expect(applyOutcome(a, "black", T + 1).reason).toBe("black");
    expect(applyOutcome(undefined, false, T).reason).toBe("fetch");
  });

  it("shares the two strikes across kinds: a failed fetch then a black frame is a benched camera", () => {
    const h = applyOutcome(applyOutcome(undefined, false, T), "black", T + 1000);
    expect(isBenched(h, T + 2000)).toBe(true);
    expect(h.reason).toBe("black");
  });

  it("forgets the reason with the strikes when a real picture arrives", () => {
    const twoCards = applyOutcome(applyOutcome(undefined, "placeholder", T), "placeholder", T);
    expect(applyOutcome(twoCards, true, T)).toEqual({ failures: 0, lastFailedAt: 0 });
  });
});

describe("benchedNote with reasons", () => {
  const card = { failures: 2, lastFailedAt: T, reason: "placeholder" as const };
  const black = { failures: 2, lastFailedAt: T, reason: "black" as const };
  const fetch = { failures: 2, lastFailedAt: T, reason: "fetch" as const };

  it("says the approved words for cards", () => {
    const health: HealthMap = { "cam:b": card, "cam:c": card };
    expect(benchedNote([cam("a"), cam("b"), cam("c")], health, T + 10)).toBe(
      "2 cameras here show their operator's 'unavailable' card, so they are skipped.",
    );
    expect(benchedNote([cam("a"), cam("b")], { "cam:b": card }, T + 10)).toBe(
      "1 camera here shows its operator's 'unavailable' card, so it is skipped.",
    );
  });

  it("says the same shape of thing for black frames", () => {
    expect(benchedNote([cam("a"), cam("b")], { "cam:b": black }, T + 10)).toBe(
      "1 camera here sends only a black picture, so it is skipped.",
    );
    expect(benchedNote([cam("a"), cam("b"), cam("c")], { "cam:b": black, "cam:c": black }, T + 10)).toBe(
      "2 cameras here send only a black picture, so they are skipped.",
    );
  });

  it("gives one sentence per reason, in a fixed order, when they are mixed", () => {
    const health: HealthMap = { "cam:b": black, "cam:c": card, "cam:d": fetch, "cam:e": card };
    expect(benchedNote([cam("a"), cam("b"), cam("c"), cam("d"), cam("e")], health, T + 10)).toBe(
      "1 stream is not answering, so it is skipped. " +
        "2 cameras here show their operator's 'unavailable' card, so they are skipped. " +
        "1 camera here sends only a black picture, so it is skipped.",
    );
  });

  it("keeps the old words for a record written before reasons existed", () => {
    // `reason` is optional precisely so a record without one reads as what every
    // failure meant until now.
    const health: HealthMap = { "cam:b": { failures: 2, lastFailedAt: T } };
    expect(benchedNote([cam("a"), cam("b")], health, T + 10)).toBe("1 stream is not answering, so it is skipped.");
  });

  it("describes a tile whose every camera shows the card as that, not as 'skipped'", () => {
    expect(benchedNote([cam("a")], { "cam:a": card }, T + 10)).toBe("This camera shows its operator's 'unavailable' card.");
    expect(benchedNote([cam("a"), cam("b")], { "cam:a": card, "cam:b": card }, T + 10)).toBe(
      "All 2 cameras here show their operator's 'unavailable' card.",
    );
    expect(benchedNote([cam("a")], { "cam:a": black }, T + 10)).toBe("This camera sends only a black picture.");
  });

  it("says 'skipped' after all when the tile is showing another tile's camera instead", () => {
    expect(benchedNote([cam("a")], { "cam:a": card }, T + 10, { showingOther: true })).toBe(
      "1 camera here shows its operator's 'unavailable' card, so it is skipped.",
    );
  });

  it("still says nothing once the retry window has passed", () => {
    expect(benchedNote([cam("a")], { "cam:a": card }, T + RETRY_AFTER_MS)).toBeNull();
  });
});

describe("streamHealth.report", () => {
  it("benches a camera the first time it shows its card, and says why", () => {
    streamHealth.__reset();
    const ref = cam("card");
    streamHealth.report(ref, "placeholder", T);
    expect(isBenched(streamHealth.get()["cam:card"], T + 1)).toBe(true);
    expect(benchedNote([ref, cam("x")], streamHealth.get(), T + 1)).toContain("'unavailable' card");
    streamHealth.__reset();
  });

  it("leaves a camera on screen after one black frame, and benches it on the second", () => {
    streamHealth.__reset();
    const ref = cam("dark");
    streamHealth.report(ref, "black", T);
    expect(isBenched(streamHealth.get()["cam:dark"], T + 1)).toBe(false);
    streamHealth.report(ref, "black", T + 10_000);
    expect(isBenched(streamHealth.get()["cam:dark"], T + 10_001)).toBe(true);
    expect(benchedNote([ref, cam("x")], streamHealth.get(), T + 10_001)).toContain("black picture");
    streamHealth.__reset();
  });

  it("does not re-render the board for a success that changes nothing", () => {
    streamHealth.__reset();
    const before = streamHealth.get();
    streamHealth.report(cam("fine"), true, T);
    streamHealth.report(cam("fine"), true, T + 1);
    // The first report adds a record; the second must hand back the same snapshot.
    const after = streamHealth.get();
    streamHealth.report(cam("fine"), true, T + 2);
    expect(streamHealth.get()).toBe(after);
    expect(after).not.toBe(before);
    streamHealth.__reset();
  });
});
