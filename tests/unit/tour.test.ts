import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  TOUR_CHAPTERS,
  TOUR_STEPS,
  TOUR_VERSION,
  allCleanup,
  allTourTargets,
  buildRun,
  chapterStart,
  chaptersInRun,
  cleanupBetween,
  clampStep,
  firstPresentTarget,
  isFramingStep,
  isLastStep,
  nextChapterStart,
  opensSomething,
  shouldAutoRunTour,
  targetsOf,
  type TourChapter,
} from "@/lib/console/tour";

/* ── Shape ─────────────────────────────────────────────────────────────── */

test("chapters and steps have stable, unique ids", () => {
  const chapterIds = TOUR_CHAPTERS.map((c) => c.id);
  expect(new Set(chapterIds).size).toBe(chapterIds.length);
  const stepIds = TOUR_STEPS.map((s) => s.id);
  expect(new Set(stepIds).size).toBe(stepIds.length);
});

test("every step carries real copy and a usable target", () => {
  for (const c of TOUR_CHAPTERS) {
    expect(c.title.length, `chapter "${c.id}" needs a title`).toBeGreaterThan(0);
    expect(c.summary.length, `chapter "${c.id}" needs a summary`).toBeGreaterThan(0);
    expect(c.steps.length, `chapter "${c.id}" needs steps`).toBeGreaterThan(1);
    for (const s of c.steps) {
      expect(s.title.length, `step "${s.id}" needs a title`).toBeGreaterThan(0);
      // Long enough to actually explain something. The tour this replaced had
      // steps that named a control without saying what it was for.
      expect(s.body.length, `step "${s.id}" body is too thin`).toBeGreaterThan(60);
      for (const t of targetsOf(s)) {
        expect(t.startsWith("."), `step "${s.id}" target "${t}" should be a class selector`).toBe(true);
      }
    }
  }
});

test("every chapter opens with a framing card, and the tour ends with one", () => {
  for (const c of TOUR_CHAPTERS) {
    // "settings" is the closing chapter — it opens on a control and ends on the card.
    if (c.id === "settings") continue;
    expect(isFramingStep(c.steps[0]), `chapter "${c.id}" should open with a framing card`).toBe(true);
  }
  const lastChapter = TOUR_CHAPTERS[TOUR_CHAPTERS.length - 1];
  expect(isFramingStep(lastChapter.steps[lastChapter.steps.length - 1])).toBe(true);
});

test("a step that opens a surface belongs to a chapter that closes it again", () => {
  for (const c of TOUR_CHAPTERS) {
    const opens = c.steps.flatMap((s) => (s.setup ?? []).filter((a) => a.kind === "ensure").map((a) => a.want));
    if (opens.length === 0) continue;
    const closes = new Set([
      ...(c.cleanup ?? []).map((a) => a.want),
      // A later step in the same chapter closing it counts too.
      ...c.steps.flatMap((s) => (s.setup ?? []).filter((a) => a.kind === "close").map((a) => a.want)),
    ]);
    for (const want of new Set(opens)) {
      expect(closes.has(want), `chapter "${c.id}" opens ${want} and never closes it`).toBe(true);
    }
  }
});

test("every action is idempotent by construction (conditional on the surface's state)", () => {
  const actions = [...TOUR_CHAPTERS.flatMap((c) => c.cleanup ?? []), ...TOUR_STEPS.flatMap((s) => s.setup ?? [])];
  expect(actions.length).toBeGreaterThan(0);
  for (const a of actions) {
    expect(["ensure", "close"]).toContain(a.kind);
    expect(a.want.startsWith(".")).toBe(true);
    expect(a.click.startsWith(".")).toBe(true);
    // An action that clicks the thing it is testing for would toggle rather than settle.
    if (a.kind === "ensure") expect(a.want).not.toBe(a.click);
  }
});

/* ── Anti-rot: every target must still exist in the app ────────────────── */

/**
 * The tour that shipped before this one pointed at `.tn-cw-col-left`, a class that
 * had not existed since the Terminal grid replaced the three-column shell.
 * resolveTourSteps drops a missing target SILENTLY, so the product quietly served a
 * seven-step tour and no test failed. This is that failing test.
 */
function sourceClassNames(): Set<string> {
  const roots = ["components", "app"];
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(p); continue; }
      if (!/\.(tsx|ts)$/.test(entry.name)) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/[\w-]*tnx?-[\w-]+/g)) found.add(m[0]);
    }
  };
  for (const r of roots) walk(join(process.cwd(), r));
  return found;
}

/**
 * The `tn-*` / `tnx-*` class tokens inside a selector, which are the only ones this
 * guard can check. State modifiers (`.is-active`) and descendant combinators are
 * split out and ignored: `is-active` is written as a bare literal inside a template
 * string in a dozen components, so its presence in the source proves nothing about
 * the element the tour is aiming at.
 */
function classParts(selector: string): string[] {
  return selector
    .split(".")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("tn-") || p.startsWith("tnx-"));
}

test("every selector the tour spotlights is a class the app actually renders", () => {
  const classes = sourceClassNames();
  const missing: string[] = [];
  for (const target of allTourTargets()) {
    for (const part of classParts(target)) if (!classes.has(part)) missing.push(`${target} → .${part}`);
  }
  expect(missing, `tour targets with no matching class in components/ or app/`).toEqual([]);
});

test("every selector an action clicks or tests for is a class the app actually renders", () => {
  const classes = sourceClassNames();
  const actions = [...TOUR_CHAPTERS.flatMap((c) => c.cleanup ?? []), ...TOUR_STEPS.flatMap((s) => s.setup ?? [])];
  const missing: string[] = [];
  for (const a of actions) {
    for (const sel of [a.want, a.click]) {
      for (const part of classParts(sel)) if (!classes.has(part)) missing.push(`${sel} → .${part}`);
    }
  }
  expect(missing, "tour actions referencing classes that no longer exist").toEqual([]);
});

/* ── Coverage: no unexplained control ──────────────────────────────────── */

/**
 * Every control a visitor can press in the console, and the tour target that
 * explains it. This is the list an independent reviewer walks: if a button exists
 * on screen and is not here, the tour has a hole; if it is here and the tour stops
 * pointing at it, this test fails.
 *
 * `via` is the selector the tour spotlights — usually the control itself, sometimes
 * the group it sits in (spotlighting six board tabs one at a time would be worse
 * than ringing the strip and naming all six in the copy).
 */
const CONSOLE_CONTROLS: { control: string; via: string }[] = [
  // Header
  { control: "brand mark + product name", via: ".tnx-hdr-brand" },
  { control: "the six board tabs", via: ".tnx-hdr-boards" },
  { control: "reset-board ⟲", via: ".tnx-hdr-boards" },
  // CONSOLE / WALL is gone — the control, its two keyboard shortcuts and the step
  // that explained them. Nothing left to cover.
  { control: "DARK / LIGHT skin toggle", via: ".tnx-hdr-skin" },
  { control: "☕ SUPPORT + <> SOURCE links", via: ".tnx-hdr-right" },
  { control: "⌘K SHORTCUTS trigger", via: ".tn-palette-trigger" },
  // Moved out of the header and into the profile popover; the class travelled with
  // the control, which is the only reason its two steps still resolve.
  { control: "⚙ settings trigger (in the profile menu)", via: ".tn-settings-trigger" },
  { control: "profile avatar", via: ".tn-profile-avatar" },
  { control: "profile popover: name, Sign in, Take the tour", via: ".tn-profile-menu" },

  // Feed health strip
  // Two entries, not one: the cells are a readout AND a toggle. An independent
  // review found the tour describing them as telemetry only, which made every
  // cell an undocumented control that silently switches a data layer.
  { control: "per-layer health cells (hover to name)", via: ".tnx-feed-cells" },
  { control: "health cell click = toggle that layer", via: ".tnx-feed-cells" },
  // No numeric tally anywhere any more. The five STATES still have to be taught,
  // because the colour is now the whole readout — so the entry stays and points at
  // the cells that carry it.
  { control: "the five feed states (colour = state)", via: ".tnx-feed-cells" },

  // The breaking banner and the 24px footer are both gone, and with them: the
  // banner's Read-article/dismiss pair, SEL, the live ticker and the key hints.
  // Removed from this manifest rather than re-pointed, because a manifest that
  // lists controls the product does not have is the padding the test below guards
  // against.

  // Stage. The first three are painted in the FEED HEALTH row rather than on the
  // stage bar, but they act on the stage, which is what the tour has to explain.
  { control: "3D / 2D projection switch", via: ".tnx-stage-proj" },
  { control: "basemap buttons", via: ".tnx-basemaps" },
  { control: "Solo — hide the widgets", via: ".tn-solo-btn" },
  { control: "restrict results to area", via: ".tn-aoi" },
  { control: "map search box", via: ".tnx-stage-search" },
  { control: "map legend", via: ".tnx-stage-legend" },
  // The cursor coordinate readout went with the stage's 22px bar and has no second
  // home, so it is not listed. WorldMap's `tn-map-cursor` publisher went with it.
  { control: "world-clock bar", via: ".tnx-stage-foot" },
  { control: "pin navigator", via: ".tn-pinnav" },
  { control: "stage move grip", via: ".tn-stage-grip" },

  // Widget frame
  { control: "widget header", via: ".tn-cw-head" },
  { control: "widget move grip", via: ".tn-cw-grip" },
  { control: "freshness chip", via: ".tn-cw-fresh" },
  { control: "? help button", via: ".tn-cw-help" },
  { control: "help popover + trust card", via: ".tn-cw-help-pop" },
  { control: "🔔 notify button", via: ".tn-cw-bell" },
  { control: "notify popover (channels + threshold)", via: ".tn-cw-notify-pop" },
  { control: "⤢ expand to stage", via: ".tn-cw-expand" },
  { control: "⋯ widget menu", via: ".tn-cw-menu" },
  { control: "menu: move / size / duplicate / export / remove", via: ".tn-cw-menu-pop" },
  { control: "widget resize handles", via: ".tn-seg-slot .tn-rz" },
  // The widget BODY. Every other entry here is chrome; these are the controls
  // inside a card (group-by chips, collapsible headings, the "N hidden" filter
  // chip, camera tiles). The tour cannot enumerate seventy widgets' insides, so
  // one step names the recurring patterns and points at the ? for the rest.
  { control: "widget body controls (chips, groups, N hidden)", via: ".tn-cw-body" },

  // Source Catalog rail
  { control: "≡ Sources launcher", via: ".tn-rail-fab" },
  { control: "source search box", via: ".tn-cat-search" },
  { control: "monitor preset chips", via: ".tn-monitor-chips" },
  { control: "layer preset buttons", via: ".tn-presets" },
  { control: "a source row", via: ".tn-layer-row" },
  { control: "＋ dock-as-widget toggle", via: ".tn-widget-toggle" },
  { control: "map on/off switch", via: ".tn-toggle" },
  { control: "camera feed + region filters", via: ".tn-cam-filters" },
  { control: "Global signals section", via: ".tn-signals-header" },
  { control: "time-window chips", via: ".tn-timewindow-chips" },
  { control: "provenance / confidence chip", via: ".tn-layer-prov" },
  { control: "locked (needs a key) badge", via: ".tn-layer-locked" },
  { control: "Coverage / Markets / Saved panels", via: ".tn-coverage-open" },
  { control: "rail collapse ‹", via: ".tn-rail-fab" },
  { control: "map zoom + / − / compass", via: ".tn-pinnav" },

  // Overlays
  { control: "command palette contents", via: ".tn-palette-root" },
  { control: "settings drawer contents", via: ".tn-settings" },
];

test("every interactive control in the console is explained by some tour step", () => {
  const covered = new Set(allTourTargets());
  const gaps = CONSOLE_CONTROLS.filter((c) => !covered.has(c.via));
  expect(gaps.map((g) => `${g.control} (${g.via})`), "controls with no tour step").toEqual([]);
});

test("the coverage manifest is not padded with selectors the tour never uses", () => {
  // Guards the inverse failure: a manifest that agrees with the tour because both
  // were edited to agree, rather than because the tour covers the product.
  //
  // THE FLOOR CAME DOWN FROM 54 TO 50, and that is the one edit this test exists to
  // make someone justify. It is not a manifest that was trimmed to go green — it is
  // six controls that no longer exist in the product: CONSOLE/WALL and its two
  // single-key shortcuts, the breaking banner's Read-article and dismiss pair, SEL,
  // the live ticker, the keyboard-hint strip, and the cursor coordinate readout.
  // Their bands were removed. A manifest still listing them would fail the test
  // ABOVE this one, which checks every entry against a class the app actually
  // renders — so the two guards were doing opposite jobs and both had to be
  // satisfied honestly. Measured after the fact, not chosen to pass: 50 entries,
  // 45 distinct selectors.
  expect(CONSOLE_CONTROLS.length).toBeGreaterThanOrEqual(50);
  const vias = new Set(CONSOLE_CONTROLS.map((c) => c.via));
  expect(vias.size).toBeGreaterThanOrEqual(45);
});

/* ── Pure helpers ──────────────────────────────────────────────────────── */

test("targetsOf normalises the three ways a target can be written", () => {
  expect(targetsOf({ id: "a", target: "", title: "t", body: "b" })).toEqual([]);
  expect(targetsOf({ id: "a", target: ".x", title: "t", body: "b" })).toEqual([".x"]);
  expect(targetsOf({ id: "a", target: [".x", ".y"], title: "t", body: "b" })).toEqual([".x", ".y"]);
});

test("firstPresentTarget picks the preferred hook, then the fallback", () => {
  const step = { id: "a", target: [".precise", ".fallback"], title: "t", body: "b" };
  expect(firstPresentTarget(step, (s) => s === ".precise")).toBe(".precise");
  expect(firstPresentTarget(step, (s) => s === ".fallback")).toBe(".fallback");
  expect(firstPresentTarget(step, () => false)).toBe(null);
});

const FIXTURE: TourChapter[] = [
  {
    id: "one", title: "One", summary: "s", icon: "1",
    cleanup: [{ kind: "close", want: ".panel", click: ".panel-x" }],
    steps: [
      { id: "one-lead", target: "", title: "t", body: "b" },
      { id: "one-a", target: ".here", title: "t", body: "b" },
      { id: "one-b", target: ".gone", title: "t", body: "b" },
      { id: "one-c", target: ".panel", title: "t", body: "b", setup: [{ kind: "ensure", want: ".panel", click: ".open" }] },
      // Setup that only CLOSES something: it cannot create ".gone", so this step
      // must be dropped exactly like a bare one with a missing target.
      { id: "one-d", target: ".gone", title: "t", body: "b", setup: [{ kind: "close", want: ".panel", click: ".panel-x" }] },
    ],
  },
  {
    id: "two", title: "Two", summary: "s", icon: "2",
    steps: [
      { id: "two-lead", target: "", title: "t", body: "b" },
      { id: "two-a", target: ".gone", title: "t", body: "b" },
    ],
  },
];

test("buildRun keeps present targets and setup-backed steps, drops absent ones", () => {
  const run = buildRun(FIXTURE, (s) => s === ".here");
  expect(run.map((f) => f.step.id)).toEqual(["one-lead", "one-a", "one-c"]);
});

test("only an `ensure` setup exempts a step — a close-only setup creates nothing", () => {
  expect(opensSomething(FIXTURE[0].steps[3])).toBe(true);  // one-c: ensure
  expect(opensSomething(FIXTURE[0].steps[4])).toBe(false); // one-d: close only
  const run = buildRun(FIXTURE, (s) => s === ".here");
  expect(run.map((f) => f.step.id)).not.toContain("one-d");
});

test("buildRun drops a chapter with nothing real left to point at", () => {
  // Chapter "two" survives only as its framing card once .gone is absent — a card
  // of prose about controls that are not on screen is worse than no chapter.
  const run = buildRun(FIXTURE, (s) => s === ".here");
  expect(chaptersInRun(run)).toEqual(["one"]);
});

test("buildRun numbers chapters and steps over what survived, not what was authored", () => {
  const run = buildRun(FIXTURE, () => true);
  expect(run[0].chapterNumber).toBe(1);
  expect(run[0].chapterCount).toBe(2);
  expect(run[0].stepCount).toBe(5);
  const twoA = run.find((f) => f.step.id === "two-a")!;
  expect(twoA.chapterNumber).toBe(2);
  expect(twoA.stepNumber).toBe(2);
});

test("buildRun can scope the run to a single chapter", () => {
  const run = buildRun(FIXTURE, () => true, "two");
  expect(chaptersInRun(run)).toEqual(["two"]);
  expect(run[0].chapterCount).toBe(1);
});

test("cleanupBetween fires only when the run actually leaves a chapter", () => {
  const run = buildRun(FIXTURE, () => true);
  const lastOfOne = run.findIndex((f) => f.step.id === "one-c");
  const firstOfTwo = run.findIndex((f) => f.step.id === "two-lead");
  expect(cleanupBetween(FIXTURE, run, lastOfOne, firstOfTwo)).toHaveLength(1);
  // Moving inside a chapter cleans up nothing …
  expect(cleanupBetween(FIXTURE, run, 1, 2)).toEqual([]);
  // … and stepping backwards out of a chapter still tidies it.
  expect(cleanupBetween(FIXTURE, run, firstOfTwo, lastOfOne)).toEqual([]);
  // Walking off the end counts as leaving.
  expect(cleanupBetween(FIXTURE, run, lastOfOne, run.length)).toHaveLength(1);
});

test("allCleanup collects every chapter's teardown for the close-at-any-point path", () => {
  expect(allCleanup(FIXTURE)).toHaveLength(1);
  // The real tour opens several surfaces; closing from step 3 must tidy all of them.
  expect(allCleanup(TOUR_CHAPTERS).length).toBeGreaterThanOrEqual(4);
});

test("nextChapterStart and chapterStart bracket the chapter an index sits in", () => {
  const run = buildRun(FIXTURE, () => true);
  const i = run.findIndex((f) => f.step.id === "one-b");
  expect(chapterStart(run, i)).toBe(0);
  expect(nextChapterStart(run, i)).toBe(run.findIndex((f) => f.step.id === "two-lead"));
  const last = run.length - 1;
  expect(nextChapterStart(run, last)).toBe(run.length);
});

test("shouldAutoRunTour: fires for a first-ever visitor and after a version bump only", () => {
  expect(shouldAutoRunTour(null)).toBe(true);
  expect(shouldAutoRunTour(TOUR_VERSION)).toBe(false);
  expect(shouldAutoRunTour(TOUR_VERSION - 1)).toBe(true);
  expect(shouldAutoRunTour(TOUR_VERSION + 1)).toBe(false);
});

test("the version was bumped, so everyone who saw the old tour is re-invited once", () => {
  expect(TOUR_VERSION).toBeGreaterThan(1);
});

test("clampStep keeps an index inside the run", () => {
  expect(clampStep(-3, 5)).toBe(0);
  expect(clampStep(9, 5)).toBe(4);
  expect(clampStep(2, 5)).toBe(2);
  expect(clampStep(0, 0)).toBe(0);
});

test("isLastStep flags the final index", () => {
  expect(isLastStep(4, 5)).toBe(true);
  expect(isLastStep(3, 5)).toBe(false);
  expect(isLastStep(0, 0)).toBe(false);
});
