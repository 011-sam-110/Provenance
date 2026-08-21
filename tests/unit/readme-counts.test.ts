import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "@/lib/console/widgets";
import { listWidgetTypes } from "@/lib/console/registry";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import { BUILTIN_VARIANTS } from "@/lib/variants/builtins";
import { SIGNALS } from "@/lib/signals/registry";
import { allExplainers } from "@/lib/signals/explain";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import { CASTLEROCK_SYSTEMS } from "@/lib/sources/castlerock";
import { DISCOVERED_FEEDS } from "@/lib/sources/discovered";

// The README is the first thing a recruiter, a client or a YC reader sees, and on
// 2026-08-18 an audit of it found four separate figures that had rotted: the test
// badge said 2,037 while the Run section said 1,726 (two different fossils, neither
// a typo), the camera row said "11 government camera networks" against a tree that
// shipped 14 feeds, and the truncation examples quoted an upstream fire count four
// days old.
//
// CLAUDE.md already carries the rule - "Never quote a count from memory, every
// figure below was measured, and each rots" - and the repo has solved this shape
// twice: console-presets + tour-board-copy pin the board count, and
// claude-md-counts pins the camera row of CLAUDE.md's table. Nothing was watching
// the README, which is the document with the widest audience of the three.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PIN, because getting this wrong would be
// worse than not testing at all: the LIVE measurements. The production table quotes
// camera totals, aircraft, satellites and per-layer truncation, and those are
// supposed to move - the camera total alone was observed between 12,866 and 19,208
// in one afternoon. Asserting them here would either fail constantly or, worse,
// pressure someone into "fixing" the README to match a stale expectation. Those
// figures carry a date and a commit SHA instead, which is what makes them checkable.
//
// So: STRUCTURAL counts, derivable from the code, are pinned. MEASURED counts are
// dated and left alone. The test count is also left alone - it is self-referential
// (this file changes it) and re-measuring it is a documented one-liner.

const ROOT = process.cwd();
const README = readFileSync(join(ROOT, "README.md"), "utf8");

/** Distinct ISO codes hard-coded by the camera adapters, as claude-md-counts reads them. */
function declaredCountries(): Set<string> {
  const dir = join(ROOT, "lib", "sources");
  const out = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/country:\s*"([A-Z]{2})"/g)) out.add(m[1]);
  }
  return out;
}

const REGISTRY_SRC = readFileSync(join(ROOT, "lib", "sources", "registry.ts"), "utf8");

/**
 * Feed key -> the adapter module that backs it, parsed out of registry.ts rather
 * than restated here, so a renamed or re-pointed feed shows up as an unmapped key
 * instead of a wrong total.
 */
function feedAdapterModules(): Map<string, string> {
  const fnToModule = new Map<string, string>();
  for (const m of REGISTRY_SRC.matchAll(
    /import\s*\{\s*fetchRegistry as (\w+)\s*\}\s*from\s*"@\/lib\/sources\/([\w.-]+)"/g,
  )) {
    fnToModule.set(m[1], m[2]);
  }
  const byKey = new Map<string, string>();
  for (const m of REGISTRY_SRC.matchAll(/\{\s*key:\s*"([\w-]+)",\s*fetch:\s*(\w+)/g)) {
    const mod = fnToModule.get(m[2]);
    if (mod) byKey.set(m[1], mod);
  }
  // Discovered networks have NO adapter module of their own, and that is the point of
  // the subsystem: `lib/sources/discovered.ts` is the behaviour once, and each admitted
  // network is a committed row of data rather than a new module and a new import.
  //
  // This function originally parsed registry.ts alone, which was complete when every
  // feed was a literal line in SOURCES. The first admitted network made it wrong in a
  // way no README edit could fix — `feedAdapterModules().size` stayed at 14 while
  // CAMERA_FEED_COUNT went to 15. Reading the admitted rows here restores what the
  // function claims to return: an accounting of every registered feed.
  for (const feed of DISCOVERED_FEEDS) byKey.set(feed.key, "discovered");
  return byKey;
}

/**
 * How many distinct agency networks the camera feeds actually cover.
 *
 * A feed is not a network. Castle Rock is ONE feed carrying NINE 511 deployments,
 * which is the whole reason the README states both numbers, and a reader who
 * conflates them gets a different answer.
 *
 * The obvious formula - feeds - 1 + CASTLEROCK_SYSTEMS.length - is right today for
 * the wrong reason: it hardcodes "castlerock is the only feed that fans out". Add a
 * second aggregator and it under-counts silently while this test stays green, which
 * is precisely the failure this file exists to stop. So both terms are derived: an
 * adapter that declares agencies contributes however many it declares, and one that
 * does not contributes itself.
 *
 * LIMIT, and read this before "fixing" a red here. It sees LITERAL `agency: "..."`
 * assignments, which is every adapter today. One that BUILT its agency names from
 * upstream data would be invisible to it, and this would then be asserting a wrong
 * number rather than catching one. Same caveat, and the same wording, as the country
 * scan in tests/unit/claude-md-counts.test.ts: a red means go and re-measure, not
 * automatically "the README lies".
 */
function agencyNetworkCount(): number {
  const dir = join(ROOT, "lib", "sources");
  let total = 0;
  for (const [, mod] of feedAdapterModules()) {
    // An admitted network is exactly one agency: it was reviewed as one operator, and
    // reading discovered.ts for `agency:` literals would count the SHARED adapter once
    // for all of them. Counted per feed here instead.
    if (mod === "discovered") {
      total += 1;
      continue;
    }
    const src = readFileSync(join(dir, `${mod}.ts`), "utf8");
    const declared = new Set([...src.matchAll(/agency:\s*"([^"]+)"/g)].map((m) => m[1]));
    total += declared.size > 0 ? declared.size : 1;
  }
  return total;
}

describe("README camera figures", () => {
  // "14 camera feeds, 22 agency networks, 9 countries". All three terms are
  // separately checkable, which is the only reason the sentence is allowed to state
  // three numbers: feeds != networks here, because castlerock is ONE feed carrying
  // NINE 511 deployments, and a reader who conflates them gets a different number.
  it("states the feed, agency and country counts the code actually ships", () => {
    const m = README.match(
      /\*\*(\d+) camera feeds, (\d+) agency networks, (\d+) countries/,
    );
    expect(m, "the camera bullet no longer states feeds/agencies/countries").not.toBeNull();

    const [, feeds, agencies, countries] = m!;
    expect(Number(feeds)).toBe(CAMERA_FEED_COUNT);
    expect(Number(countries)).toBe(declaredCountries().size);
    expect(Number(agencies)).toBe(agencyNetworkCount());
  });

  // The mapping is what makes agencyNetworkCount trustworthy: an unmapped feed would
  // be counted as a single agency by default, quietly under-reporting a fan-out.
  it("can account for every registered feed with an adapter module", () => {
    expect(feedAdapterModules().size).toBe(CAMERA_FEED_COUNT);
  });

  it("states the number of 511 deployments castlerock really fans out to", () => {
    const m = README.match(/Castle Rock alone carries nine separate 511 deployments/);
    expect(m, "the castlerock fan-out sentence is gone").not.toBeNull();
    // The word is spelled out in prose, so assert the code still matches the word.
    expect(CASTLEROCK_SYSTEMS.length).toBe(9);
  });
});

describe("README layer figures", () => {
  // "41 live layers" = 4 core (cameras, webcams, aircraft, satellites) + 37 signals.
  const CORE_LAYERS = 4;

  it("states a layer total that is the core layers plus the signal registry", () => {
    const m = README.match(/\*\*(\d+) live layers on one globe\*\*/);
    expect(m, "the intro no longer states a layer total").not.toBeNull();
    expect(Number(m![1])).toBe(CORE_LAYERS + SIGNALS.length);
  });

  it("states the same total in the Features bullet", () => {
    const m = README.match(/- \*\*(\d+) layers, each independently attributed\*\*/);
    expect(m, "the layers bullet no longer states a total").not.toBeNull();
    expect(Number(m![1])).toBe(CORE_LAYERS + SIGNALS.length);
  });

  it("states the signal-layer count the registry ships", () => {
    const m = README.match(/plus (\d+) global-signal layers/);
    expect(m, "the layers bullet no longer states a signal count").not.toBeNull();
    expect(Number(m![1])).toBe(SIGNALS.length);
  });

  // The confidence split is the most quietly rot-prone figure in the file: adding one
  // layer changes exactly one of five numbers, and nothing else in the repo notices.
  it("states the confidence split the explainers actually declare", () => {
    const m = README.match(
      /confidence class \(today (\d+) official, (\d+) reported, (\d+) measured, (\d+) modelled, (\d+) derived\)/,
    );
    expect(m, "the provenance-card bullet no longer states a confidence split").not.toBeNull();

    const counted: Record<string, number> = {};
    for (const e of allExplainers()) {
      counted[e.confidence] = (counted[e.confidence] ?? 0) + 1;
    }
    const [, official, reported, measured, modelled, derived] = m!;
    expect(Number(official)).toBe(counted.official ?? 0);
    expect(Number(reported)).toBe(counted.reported ?? 0);
    expect(Number(measured)).toBe(counted.measured ?? 0);
    expect(Number(modelled)).toBe(counted.modelled ?? 0);
    expect(Number(derived)).toBe(counted.derived ?? 0);

    // The five classes must also account for every layer, or the split is a subset
    // that happens to add up on its own terms.
    const stated = [official, reported, measured, modelled, derived].reduce(
      (a, b) => a + Number(b),
      0,
    );
    expect(stated).toBe(allExplainers().length);
  });
});

describe("README console figures", () => {
  it("states the widget-type count the registry ships", () => {
    const m = README.match(/(\d+) widget types in a/);
    expect(m, "the console bullet no longer states a widget count").not.toBeNull();
    expect(Number(m![1])).toBe(listWidgetTypes().length);
  });

  it("states the monitor-variant count the registry ships", () => {
    const m = README.match(/(\d+) monitor variants/);
    expect(m, "the console bullet no longer states a variant count").not.toBeNull();
    expect(Number(m![1])).toBe(BUILTIN_VARIANTS.length);
  });

  // Spelled as a word in prose, so this asserts the word rather than parsing a digit.
  it("still describes seven boards, matching the preset list", () => {
    expect(README).toContain("seven boards");
    expect(BUILTIN_PRESETS.length).toBe(7);
  });
});

describe("README honesty markers", () => {
  // Every live figure in the status table is a point-in-time sample, so the table has
  // to say WHEN and against WHAT. Losing either turns a measurement back into a
  // floating claim, which is the exact failure this file exists to stop.
  it("dates the production table and pins it to a commit", () => {
    const m = README.match(/production actually returned on \*\*(\d{4}-\d{2}-\d{2})\*\*, against `([0-9a-f]{7,40})`/);
    expect(m, "the status line lost its date or its commit SHA").not.toBeNull();
  });

  it("keeps the warning that the figures drift", () => {
    expect(README).toContain("Every figure above will drift");
  });
});
