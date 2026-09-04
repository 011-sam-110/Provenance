import { describe, expect, it } from "vitest";
// Side-effect import: registers every console widget exactly as the app does.
// Static (not dynamic-in-a-hook) so the cost lands in collection rather than
// against a hook timeout — the module graph behind these widgets is large.
import "@/lib/console/widgets";
import { listWidgetTypes } from "@/lib/console/registry";
import {
  allWidgetExplainers,
  isGeneratedCardId,
  orphanedWidgetExplainerIds,
  resolveWidgetHelp,
  undocumentedWidgetTypeIds,
  widgetExplainerFor,
} from "@/lib/console/help";
import { catalogByGroup, CORE_IDS } from "@/lib/sources/catalog";
import { genericCoreIds } from "@/lib/console/sourceWidgets";
import { allExplainers } from "@/lib/signals/explain";
import { SIGNALS } from "@/lib/signals/registry";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID } from "@/lib/console/presets";

// This file IS the feature, for widgets.
//
// tests/unit/signals-explain.test.ts already makes the source/confidence/
// limitations card impossible to skip for a SIGNAL layer. It could not see the
// bespoke widgets — cameras, aviation, satellites, headlines, markets, live news,
// anomaly, events, locate, the six recon tools — because they aren't signal
// layers, and an audit found the card reaching 2 of the 8 widgets on the default
// board: worse than the 8-of-20 competitor the whole feature is positioned
// against. These tests close that: registering a widget without being able to say
// what it CANNOT tell you now fails the build.
//
// Reading the LIVE registry is what makes this real rather than a list restated in
// two places — a new widget is caught the moment it exists.
const types = listWidgetTypes();
const ids = types.map((t) => t.id);

describe("coverage — no widget ships without a trust card", () => {
  it("registers a meaningful number of widget types (the import actually ran)", () => {
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("documents every registered widget type", () => {
    const missing = undocumentedWidgetTypeIds(ids);
    expect(
      missing,
      `these registered widgets have no trust card. Signal layers (signal:<id>) are documented in ` +
        `lib/signals/explain.ts; everything else belongs in WIDGET_EXPLAINERS in lib/console/help.ts:\n  ` +
        `${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no widget explainer for a widget that no longer exists", () => {
    expect(orphanedWidgetExplainerIds(ids)).toEqual([]);
  });

  it("accounts for every registered widget exactly once — one of the three card families", () => {
    // Three families, no overlap and no remainder: a signal layer, a card GENERATED
    // from the source catalog (the roll-ups + generic leaves the Source Catalog's ＋
    // creates — see lib/console/sourceCards.ts), or a hand-written bespoke entry.
    const signalTypes = ids.filter((id) => id.startsWith("signal:"));
    expect(signalTypes.length).toBe(SIGNALS.length);
    expect(allExplainers().length).toBe(SIGNALS.length);

    const catalogTypes = ids.filter((id) => id.startsWith("rollup:") || id.startsWith("source:"));
    // One roll-up per catalog category, plus a leaf for each core source that no
    // bespoke widget already shows. Derived from the catalog, not restated here.
    expect(catalogTypes.length).toBe(catalogByGroup().length + genericCoreIds(CORE_IDS).length);

    const bespoke = ids.filter((id) => !isGeneratedCardId(id));
    expect(bespoke.length).toBe(allWidgetExplainers().length);
    expect(signalTypes.length + catalogTypes.length + bespoke.length).toBe(ids.length);
  });

  it("gives every generated catalog card the same real content a bespoke one needs", () => {
    for (const id of ids.filter((x) => x.startsWith("rollup:") || x.startsWith("source:"))) {
      const e = widgetExplainerFor(id)!;
      expect(e, `${id} resolves no trust card`).toBeDefined();
      expect(e.whatItShows.length, `${id}.whatItShows is too thin`).toBeGreaterThan(40);
      expect(e.method.length, `${id}.method is too thin`).toBeGreaterThan(25);
      expect(e.limitations.length, `${id} lists no limitation`).toBeGreaterThan(0);
      for (const l of e.limitations) {
        expect(l.length, `${id} has a throwaway limitation: "${l}"`).toBeGreaterThan(40);
      }
    }
  });

  it("admits a category roll-up sums counts that share no unit", () => {
    // The one-big-number layout implies a measurement the sum is not. Softening
    // this is how a dashboard starts lying politely.
    const e = widgetExplainerFor(`rollup:${catalogByGroup()[0].group}`)!;
    expect(e.confidence).toBe("derived");
    expect(e.limitations.join(" ")).toMatch(/do not share a unit/i);
    expect(e.limitations.join(" ")).toMatch(/total goes down without anything having happened/i);
  });

  it("never falls back to the generic 'A live monitor panel' line", () => {
    for (const t of types) {
      const help = resolveWidgetHelp(t);
      expect(help.explainer, `${t.id} resolves no trust card`).toBeDefined();
      expect(help.what, `${t.id} is still using the generic fallback line`).not.toMatch(
        /^A live monitor panel:/,
      );
      // The declared one-liner is the popover's opening sentence — it has to say
      // something, not just repeat the title.
      expect(help.what.length, `${t.id} has a throwaway 'what'`).toBeGreaterThan(40);
    }
  });
});

describe("the default board — the panels a first-time visitor actually sees", () => {
  it("shows a first-time visitor NO panels at all", () => {
    const board = BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.build();
    // THE ANSWER IS NOW ZERO, AND THE TEST SAYS SO RATHER THAN BEING DELETED.
    // This assertion has been walked down twice. It first pinned `.toBe(8)`, which
    // described one particular landing board rather than a property worth keeping.
    // It was then loosened to "greater than zero". The landing board is now empty
    // by design — /app opens on a bare rotating globe — so "greater than zero" is
    // not merely unmet, it asserts the opposite of the product decision.
    //
    // Pinning the zero is what keeps this test honest instead of vacuous: a widget
    // reappearing on the landing board turns this red, and someone has to decide
    // whether they meant it. The trust-card guarantee it used to carry has not been
    // dropped — the very next test applies it to every widget on every board, which
    // is strictly stronger and never depended on the landing board being populated.
    expect(board.widgets, "the landing board must stay empty").toEqual([]);
  });

  it("gives every widget on every built-in board a real card", () => {
    const bare = new Set<string>();
    for (const preset of BUILTIN_PRESETS) {
      for (const w of preset.build().widgets) if (!widgetExplainerFor(w.type)) bare.add(w.type);
    }
    expect([...bare]).toEqual([]);
  });
});

describe("quality — an entry that says nothing is worse than none", () => {
  it("names at least one real limitation for every bespoke widget", () => {
    for (const e of allWidgetExplainers()) {
      expect(e.limitations.length, `${e.id} lists no limitation`).toBeGreaterThan(0);
      for (const l of e.limitations) {
        // Long enough to be an actual caveat rather than a shrug like "may vary".
        expect(l.length, `${e.id} has a throwaway limitation: "${l}"`).toBeGreaterThan(40);
      }
    }
  });

  it("says what a row is and how it is derived, for every bespoke widget", () => {
    for (const e of allWidgetExplainers()) {
      expect(e.whatItShows.length, `${e.id}.whatItShows is too thin`).toBeGreaterThan(40);
      expect(e.method.length, `${e.id}.method is too thin`).toBeGreaterThan(25);
      expect(e.coverage.length, `${e.id}.coverage is too thin`).toBeGreaterThan(5);
    }
  });

  it("has exactly one bespoke entry per id", () => {
    const entryIds = allWidgetExplainers().map((e) => e.id);
    expect(new Set(entryIds).size).toBe(entryIds.length);
  });

  it("keeps bespoke entries out of the signal namespace (those belong in explain.ts)", () => {
    for (const e of allWidgetExplainers()) expect(e.id.startsWith("signal:")).toBe(false);
  });
});

describe("the widget caveats we most need to be right about", () => {
  // Each of these is a real misreading the widget would otherwise invite, and
  // several correct help text that was actively wrong. Softening one should fail.
  const lims = (id: string) => widgetExplainerFor(id)!.limitations.join(" ");

  it("admits the aviation panel has no military flag, whatever the alert rule suggests", () => {
    expect(lims("aviation")).toMatch(/no military flag/i);
    expect(lims("aviation")).toMatch(/receiver coverage, not empty sky/i);
  });

  // This guard moved with the claim rather than retiring with the widget. The
  // grid it used to describe is gone; the seven-country limit it was written to
  // stop anyone softening is a fact about the registry, and the camera wall
  // inherited it word for word.
  it("admits the camera wall covers seven countries plus a partial sample, not the world", () => {
    const e = widgetExplainerFor("camslot")!;
    expect(e.coverage).toMatch(/seven countries/i);
    expect(e.limitations.join(" ")).toMatch(/not evidence that none exists|partial sample/i);
  });

  it("admits satellite positions are propagated in-browser, not observed", () => {
    expect(widgetExplainerFor("satellites")!.confidence).toBe("modelled");
    expect(lims("satellites")).toMatch(/propagated, not observed/i);
  });

  it("admits markets is delayed and must not be traded on", () => {
    expect(lims("markets")).toMatch(/not a trading feed/i);
    expect(lims("markets")).toMatch(/do not trade on it/i);
  });

  it("admits a headline cluster's source count is not corroboration", () => {
    expect(lims("headlines")).toMatch(/not corroboration|wire copy/i);
  });

  it("admits the anomaly ranking is ours, cross-layer, and scans only a slice of the map", () => {
    const e = widgetExplainerFor("anomaly")!;
    expect(e.confidence).toBe("derived");
    expect(e.limitations.join(" ")).toMatch(/share no unit|not the same thing/i);
    expect(e.limitations.join(" ")).toMatch(/eight layers out of the 37/i);
  });

  it("admits the events severity tier and impact radius are coarse stand-ins", () => {
    expect(lims("events")).toMatch(/interim scale|crude/i);
    expect(lims("events")).toMatch(/proximity flag, not a damage assessment/i);
  });

  it("admits photo geolocation is an uncalibrated estimate with a consent problem", () => {
    const e = widgetExplainerFor("locate")!;
    expect(e.confidence).toBe("modelled");
    expect(e.limitations.join(" ")).toMatch(/ESTIMATE from visual cues/i);
    expect(e.limitations.join(" ")).toMatch(/not calibrated|confidence score is not consent/i);
  });

  it("admits the recon tools are passive lookups of somebody else's stale data", () => {
    expect(lims("recon:ports")).toMatch(/HISTORICAL/);
    expect(lims("recon:ports")).toMatch(/No record is not the same as no exposure/i);
    expect(lims("recon:threat")).toMatch(/not a clean bill of health/i);
    expect(lims("recon:whois")).toMatch(/redacted/i);
    expect(lims("recon:certs")).toMatch(/not a live host/i);
    expect(lims("recon:dns")).toMatch(/split-horizon|geo-steered/i);
    expect(lims("recon:bgp")).toMatch(/no history here|current view/i);
  });
});
