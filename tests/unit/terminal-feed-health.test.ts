import { describe, it, expect } from "vitest";
import {
  buildFeedCells,
  feedBucket,
  isPlaceholderFeature,
  isPlaceholderOnly,
  FEED_COLOR,
  PLACEHOLDER_NOTICE_LAYERS,
  type BuildFeedCellsInput,
  type FeedCell,
  type FeedCounts,
} from "@/lib/terminal/feedHealth";
import { SIGNALS } from "@/lib/signals/registry";
import type { FreshKind } from "@/lib/sources/freshKind";

/**
 * Fold the cells into the five states.
 *
 * This USED to be `tally()`, exported from the module. The UI stopped
 * printing a numeric tally — the strip's counters and the footer ticker that
 * inherited them are both gone — which left that export with no caller in the
 * app and a full set of passing tests, i.e. exactly the green-suite-over-dead-code
 * shape this repo keeps finding and removing.
 *
 * So the fold moved here and the assertions did not, because what they actually
 * pin is `feedBucket()` — that "refused" lands in DOWN and never in KEY, that a
 * locked layer lands in KEY and never in DOWN, that a first visit is all dormant.
 * feedBucket() is very much alive: it picks every cell's colour on screen. The
 * rules are now tested against the function that runs, through a fold the test
 * owns.
 */
function tally(cells: readonly FeedCell[]): FeedCounts {
  const counts: FeedCounts = { live: 0, lag: 0, down: 0, key: 0, dormant: 0 };
  for (const cell of cells) counts[feedBucket(cell)] += 1;
  return counts;
}

// The FEED HEALTH strip is the highest-leverage place in this product to tell a
// lie: 37 small coloured cells that a reader takes in at a glance and trusts.
// These tests exist to pin the two failure modes that matter — painting a layer
// green that nobody ever fetched, and merging "we hold no key" with "the upstream
// rejected the key we hold".

const SIG = (id: string, title = id): { id: string; title: string } => ({ id, title });

function input(patch: Partial<BuildFeedCellsInput> = {}): BuildFeedCellsInput {
  return {
    signals: [SIG("earthquakes", "Earthquakes")],
    status: null,
    fresh: {},
    on: new Set<string>(),
    ...patch,
  };
}

/** One cell for a layer that is ON with the given observed freshness. */
function cellFor(kind: FreshKind, patch: Partial<BuildFeedCellsInput> = {}): FeedCell {
  return buildFeedCells(
    input({ on: new Set(["earthquakes"]), fresh: { earthquakes: kind }, ...patch }),
  )[0];
}

describe("buildFeedCells — the layer count can never silently shrink", () => {
  it("returns exactly one cell per signal handed to it", () => {
    const signals = Array.from({ length: 12 }, (_, i) => SIG(`s${i}`));
    expect(buildFeedCells(input({ signals }))).toHaveLength(12);
  });

  it("returns a cell for every entry in the REAL registry, in registry order", () => {
    // Deliberately reads SIGNALS rather than a literal: the "35 signals" comment
    // in CLAUDE.md was already stale by two layers, and a strip sized from a
    // number instead of the registry would silently drop the newest layers.
    const signals = SIGNALS.map((s) => ({ id: s.id, title: s.label }));
    const cells = buildFeedCells(input({ signals }));
    expect(cells).toHaveLength(SIGNALS.length);
    expect(cells.map((c) => c.id)).toEqual(SIGNALS.map((s) => s.id));
  });

  it("preserves the order it was given rather than sorting by state", () => {
    const cells = buildFeedCells(
      input({
        signals: [SIG("a"), SIG("b"), SIG("c")],
        on: new Set(["b"]),
        fresh: { b: "live" },
      }),
    );
    expect(cells.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("gives every cell a colour, an opacity in 0..1, a readout and a tip", () => {
    const signals = SIGNALS.map((s) => ({ id: s.id, title: s.label }));
    for (const cell of buildFeedCells(input({ signals }))) {
      expect(cell.color).toMatch(/^var\(--tnx-/);
      expect(cell.opacity).toBeGreaterThan(0);
      expect(cell.opacity).toBeLessThanOrEqual(1);
      expect(cell.readout.length).toBeGreaterThan(0);
      expect(cell.tip.length).toBeGreaterThan(0);
    }
  });
});

describe("buildFeedCells — a layer nobody switched on is dormant, never green", () => {
  it("reports OFF for a layer with no freshness record at all", () => {
    const cell = buildFeedCells(input())[0];
    expect(cell.kind).toBe("off");
    expect(cell.color).toBe(FEED_COLOR.dormant);
    expect(cell.opacity).toBeLessThan(1);
    expect(cell.readout).toBe("EARTHQUAKES · DORMANT");
  });

  it("STILL reports OFF when a stale record is left in the freshness store", () => {
    // The store is written by <SignalFeed> in WorldMap and cleared on unmount,
    // but a record surviving a toggle-off must never resurface as a live cell.
    const cell = buildFeedCells(input({ fresh: { earthquakes: "live" }, on: new Set() }))[0];
    expect(cell.kind).toBe("off");
    expect(cell.color).toBe(FEED_COLOR.dormant);
  });

  it("counts a first visit — every layer off — as all dormant and nothing live", () => {
    const signals = SIGNALS.map((s) => ({ id: s.id, title: s.label }));
    const counts = tally(buildFeedCells(input({ signals })));
    expect(counts).toEqual({ live: 0, lag: 0, down: 0, key: 0, dormant: SIGNALS.length });
  });
});

describe("buildFeedCells — an unfetched layer is never live", () => {
  it("is unknown, not live, for a layer that is ON but has never reported", () => {
    const cell = buildFeedCells(input({ on: new Set(["earthquakes"]) }))[0];
    expect(cell.kind).toBe("unknown");
    expect(cell.color).toBe(FEED_COLOR.dormant);
    expect(cell.readout).toBe("EARTHQUAKES · CONNECTING…");
  });

  it("puts unknown in the dormant tally rather than inventing a failure", () => {
    expect(feedBucket({ kind: "unknown" })).toBe("dormant");
    expect(feedBucket({ kind: "unknown" })).not.toBe("down");
  });
});

describe("buildFeedCells — every observed state maps to one colour and opacity", () => {
  const cases: { kind: FreshKind; color: string; full: boolean; word: string }[] = [
    { kind: "live", color: FEED_COLOR.live, full: true, word: "LIVE" },
    { kind: "empty", color: FEED_COLOR.live, full: false, word: "NONE NOW" },
    { kind: "lagging", color: FEED_COLOR.lag, full: true, word: "LAGGING" },
    { kind: "stale", color: FEED_COLOR.down, full: true, word: "STALE" },
    { kind: "down", color: FEED_COLOR.down, full: true, word: "DOWN" },
    { kind: "unknown", color: FEED_COLOR.dormant, full: false, word: "CONNECTING…" },
    { kind: "off", color: FEED_COLOR.dormant, full: false, word: "DORMANT" },
  ];

  it.each(cases)("$kind → $color, readout '… · $word'", ({ kind, color, full, word }) => {
    const cell = cellFor(kind);
    expect(cell.kind).toBe(kind);
    expect(cell.color).toBe(color);
    expect(cell.opacity === 1).toBe(full);
    expect(cell.readout).toBe(`EARTHQUAKES · ${word}`);
  });

  it("dims empty to the live colour rather than giving it a colour of its own", () => {
    // Mirrors app/globals.css's .tn-fresh-empty dot: connected, but nothing in it.
    const empty = cellFor("empty");
    const live = cellFor("live");
    expect(empty.color).toBe(live.color);
    expect(empty.opacity).toBeLessThan(live.opacity);
  });

  it("says 'connected, nothing to report' for empty — not a failure", () => {
    expect(cellFor("empty").tip).toContain("nothing to report right now");
    expect(cellFor("empty").tip).toContain("not a failure");
  });

  it("counts stale with DOWN, not LAG, while the cell still reads STALE", () => {
    // A feed frozen for six refresh cycles is not "a bit behind". The tally
    // rounds against us; the hover text keeps the precise word.
    const cell = cellFor("stale");
    expect(feedBucket(cell)).toBe("down");
    expect(cell.readout).toContain("STALE");
    expect(cell.readout).not.toContain("DOWN");
  });
});

describe("buildFeedCells — locked is a key, not a fault", () => {
  const locked = () =>
    buildFeedCells(
      input({
        signals: [SIG("acled", "Conflict events (ACLED)")],
        status: { layers: [{ id: "acled", state: "locked" }] },
      }),
    )[0];

  it("marks the cell locked, colours it with the key token and dims it", () => {
    const cell = locked();
    expect(cell.locked).toBe(true);
    expect(cell.color).toBe(FEED_COLOR.key);
    expect(cell.opacity).toBeLessThan(1);
    expect(cell.readout).toBe("CONFLICT EVENTS (ACLED) · NEEDS A KEY");
  });

  it("counts as KEY and never as DOWN", () => {
    expect(tally([locked()])).toEqual({ live: 0, lag: 0, down: 0, key: 1, dormant: 0 });
  });

  it("keeps its honest freshness — nothing was ever fetched, so the state is off", () => {
    expect(locked().kind).toBe("off");
  });

  it("explains the reason as configuration rather than breakage", () => {
    expect(locked().tip).toContain("does not hold");
    expect(locked().tip).toContain("not broken");
  });

  it("stays KEY even if the layer is switched on and reports empty", () => {
    // Every key-gated signal layer is `kind: "required"`, so a locked layer
    // delivering nothing is explained by the missing key — not by a dead upstream.
    const cell = buildFeedCells(
      input({
        signals: [SIG("acled", "ACLED")],
        status: { layers: [{ id: "acled", state: "locked" }] },
        on: new Set(["acled"]),
        fresh: { acled: "empty" },
      }),
    )[0];
    expect(cell.locked).toBe(true);
    expect(feedBucket(cell)).toBe("key");
  });
});

describe("buildFeedCells — refused is a fault, and never a key", () => {
  const refused = () =>
    buildFeedCells(
      input({
        signals: [SIG("acled", "Conflict events (ACLED)")],
        status: { layers: [{ id: "acled", state: "refused" }] },
      }),
    )[0];

  it("is its own kind, coloured DOWN", () => {
    const cell = refused();
    expect(cell.kind).toBe("refused");
    expect(cell.color).toBe(FEED_COLOR.down);
    expect(cell.locked).toBe(false);
    expect(cell.readout).toBe("CONFLICT EVENTS (ACLED) · REFUSED");
  });

  it("counts as DOWN and never as KEY", () => {
    expect(tally([refused()])).toEqual({ live: 0, lag: 0, down: 1, key: 0, dormant: 0 });
  });

  it("never renders the same as a locked layer — different kind, colour and word", () => {
    const lockedCell = buildFeedCells(
      input({ signals: [SIG("acled")], status: { layers: [{ id: "acled", state: "locked" }] } }),
    )[0];
    const refusedCell = refused();
    expect(refusedCell.kind).not.toBe(lockedCell.kind);
    expect(refusedCell.color).not.toBe(lockedCell.color);
    expect(refusedCell.readout).not.toContain("NEEDS A KEY");
    expect(refusedCell.tip.toLowerCase()).not.toContain("does not hold");
  });

  it("says plainly that we HOLD a credential and the upstream rejected it", () => {
    const tip = refused().tip;
    expect(tip).toContain("HOLDS a credential");
    expect(tip).toContain("401/402/403");
    expect(tip).toContain("not the same as needing a key");
  });

  it("outranks the freshness store — a refusal is true whether or not the layer is on", () => {
    const cell = buildFeedCells(
      input({
        signals: [SIG("acled")],
        status: { layers: [{ id: "acled", state: "refused" }] },
        on: new Set(["acled"]),
        fresh: { acled: "empty" },
      }),
    )[0];
    expect(cell.kind).toBe("refused");
  });
});

describe("buildFeedCells — status shapes and the null case", () => {
  it("reads the real StatusReport shape (layers array)", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("ais")], status: { layers: [{ id: "ais", state: "locked" }] } }),
    )[0];
    expect(cell.locked).toBe(true);
  });

  it("also reads the pre-flattened map shape named in the contract", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("ais")], status: { sources: { ais: { state: "locked" } } } }),
    )[0];
    expect(cell.locked).toBe(true);
  });

  it("falls back to the capabilities array for a non-layer id", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("webcams")], status: { capabilities: [{ id: "webcams", state: "locked" }] } }),
    )[0];
    expect(cell.locked).toBe(true);
  });

  it("shows NO key badge when /api/status has not answered — never a guess", () => {
    const cell = buildFeedCells(input({ signals: [SIG("acled")], status: null }))[0];
    expect(cell.locked).toBe(false);
    expect(cell.color).toBe(FEED_COLOR.dormant);
    expect(cell.tip).toContain("has not answered");
  });

  it("earns no key badge from the states that mean 'this works'", () => {
    for (const state of ["keyless", "configured", "upgradable", "enhanced"]) {
      const cell = buildFeedCells(
        input({
          signals: [SIG("earthquakes")],
          status: { layers: [{ id: "earthquakes", state }] },
          on: new Set(["earthquakes"]),
          fresh: { earthquakes: "live" },
        }),
      )[0];
      expect(cell.locked).toBe(false);
      expect(cell.color).toBe(FEED_COLOR.live);
    }
  });

  it("drops the /api/status caveat once the report has answered", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("earthquakes")], status: { layers: [{ id: "earthquakes", state: "keyless" }] } }),
    )[0];
    expect(cell.tip).not.toContain("has not answered");
  });
});

describe("buildFeedCells — the three layers that publish a placeholder when broken", () => {
  it("names exactly conflict and protests", () => {
    // food-security was the third until 2026-09-05. It was removed as a layer because
    // WFP withdrew the keyless feed, so its placeholder was the only thing it could ever
    // publish -- a permanent notice, not an occasional one.
    expect([...PLACEHOLDER_NOTICE_LAYERS].sort()).toEqual(["conflict", "protests"]);
  });

  it("caveats a live cell for those layers — count > 0 is not proof of health", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("conflict", "Conflict")], on: new Set(["conflict"]), fresh: { conflict: "live" } }),
    )[0];
    expect(cell.kind).toBe("live"); // we do not downgrade on suspicion alone
    expect(cell.tip).toContain("labelled placeholder feature");
  });

  it("adds no such caveat to a normal layer", () => {
    expect(cellFor("live").tip).not.toContain("labelled placeholder");
  });

  it("reports DOWN once a caller has actually observed a placeholder-only payload", () => {
    const cell = buildFeedCells(
      input({
        signals: [SIG("food-security", "Food insecurity")],
        on: new Set(["food-security"]),
        fresh: { "food-security": "live" }, // count 1, ok — the classifier cannot know better
        placeholderOnly: new Set(["food-security"]),
      }),
    )[0];
    expect(cell.kind).toBe("down");
    expect(cell.color).toBe(FEED_COLOR.down);
    expect(cell.tip).toContain(`"no data" placeholder`);
  });

  it("ignores placeholder evidence for a layer that is switched off", () => {
    const cell = buildFeedCells(
      input({ signals: [SIG("conflict")], placeholderOnly: new Set(["conflict"]) }),
    )[0];
    expect(cell.kind).toBe("off");
  });
});

describe("feedCounts", () => {
  it("sums to the number of cells — no state can fall between buckets", () => {
    const kinds: FreshKind[] = ["live", "empty", "lagging", "stale", "down", "unknown", "off"];
    const cells = [
      ...kinds.map((k) => cellFor(k)),
      ...buildFeedCells(
        input({
          signals: [SIG("acled"), SIG("ais")],
          status: { layers: [{ id: "acled", state: "refused" }, { id: "ais", state: "locked" }] },
        }),
      ),
    ];
    const counts = tally(cells);
    const total = counts.live + counts.lag + counts.down + counts.key + counts.dormant;
    expect(total).toBe(cells.length);
  });

  it("sums to SIGNALS.length over the whole real registry, whatever the mix", () => {
    const signals = SIGNALS.map((s) => ({ id: s.id, title: s.label }));
    const fresh: Record<string, FreshKind> = {};
    const rotation: FreshKind[] = ["live", "empty", "lagging", "stale", "down", "unknown"];
    signals.forEach((s, i) => {
      fresh[s.id] = rotation[i % rotation.length];
    });
    const cells = buildFeedCells(
      input({
        signals,
        fresh,
        on: new Set(signals.map((s) => s.id)),
        status: { layers: [{ id: "grid-load", state: "locked" }, { id: "ais", state: "refused" }] },
      }),
    );
    const counts = tally(cells);
    expect(counts.live + counts.lag + counts.down + counts.key + counts.dormant).toBe(SIGNALS.length);
    expect(counts.key).toBe(1); // grid-load
  });

  it("tallies a known mix exactly", () => {
    const cells = [
      cellFor("live"),
      cellFor("empty"), // healthy: connected with nothing to show
      cellFor("lagging"),
      cellFor("stale"), // folded into down
      cellFor("down"),
      cellFor("unknown"), // dormant, not a failure
      buildFeedCells(input({ signals: [SIG("a")] }))[0], // off
      buildFeedCells(input({ signals: [SIG("b")], status: { sources: { b: { state: "locked" } } } }))[0],
      buildFeedCells(input({ signals: [SIG("c")], status: { sources: { c: { state: "refused" } } } }))[0],
    ];
    expect(tally(cells)).toEqual({ live: 2, lag: 1, down: 3, key: 1, dormant: 2 });
  });

  it("is all zeroes for no cells", () => {
    expect(tally([])).toEqual({ live: 0, lag: 0, down: 0, key: 0, dormant: 0 });
  });
});

describe("placeholder detection", () => {
  it("recognises the GDELT dormant notice by id and by props.status", () => {
    expect(isPlaceholderFeature({ id: "conflict:unavailable" })).toBe(true);
    expect(isPlaceholderFeature({ id: "x", props: { status: "unavailable" } })).toBe(true);
  });

  it("recognises the food-security notice", () => {
    expect(
      isPlaceholderFeature({
        id: "food-security:unavailable",
        props: { status: "STATUS NOTICE — not a measurement" },
      }),
    ).toBe(true);
  });

  it("does not mistake a real feature for a notice", () => {
    expect(isPlaceholderFeature({ id: "conflict:UA-1234", props: { count: 12 } })).toBe(false);
    expect(isPlaceholderFeature(null)).toBe(false);
  });

  it("is placeholder-only when every feature is a notice", () => {
    expect(isPlaceholderOnly([{ id: "protests:unavailable" }])).toBe(true);
    expect(isPlaceholderOnly([{ id: "protests:unavailable" }, { id: "protests:UA-1" }])).toBe(false);
  });

  it("treats an EMPTY payload as not placeholder-only — zero rows is the honest 'empty'", () => {
    expect(isPlaceholderOnly([])).toBe(false);
    expect(isPlaceholderOnly(null)).toBe(false);
  });
});
