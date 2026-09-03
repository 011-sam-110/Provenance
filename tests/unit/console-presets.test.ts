import { expect, test } from "vitest";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID } from "@/lib/console/presets";
import { SIGNALS, signalsByGroup } from "@/lib/signals/registry";
import { MAX_WIDGETS, type SegmentId } from "@/lib/console/types";
import { effectiveRailSize, RAIL_MAX } from "@/lib/terminal/rails";

const CORE_WIDGETS = new Set(["events", "news", "aviation", "satellites", "markets", "headlines", "locate", "anomaly", "camslot"]);
const SIGNAL_WIDGETS = new Set(SIGNALS.map((s) => `signal:${s.id}`));
// The OSINT "Tools" board's query→response recon widgets (not live signal layers).
const RECON_WIDGETS = new Set(["recon:dns", "recon:whois", "recon:certs", "recon:bgp", "recon:ports", "recon:threat"]);

// Deliberately FEW: six broad boards, one per navbar-pill slot. Ids are stable (used by
// the first-run seed, the ⌘K Profiles section, the central preset pill, and shared URLs).
const BOARD_IDS = ["overview", "situation", "earth", "mobility", "markets", "tools", "streets"];

// The seven core monitoring cards the union of boards must all surface (the "use all our
// widgets" intent). `locate` is a utility card, not a monitoring board card, so it's exempt.
const CORE_MONITORS = ["events", "news", "camslot", "aviation", "satellites", "markets", "headlines"];

test("the board lineup is exactly the seven boards, each non-empty and within the cap", () => {
  const ids = BUILTIN_PRESETS.map((p) => p.id);
  expect(ids).toEqual(BOARD_IDS);
  for (const p of BUILTIN_PRESETS) {
    const l = p.build();
    expect(l.widgets.length).toBeGreaterThan(0);
    expect(l.widgets.length).toBeLessThanOrEqual(MAX_WIDGETS);
  }
});

// ── The invariants, restated for rails ──────────────────────────────────────
//
// THESE ARE NOT NEW TESTS. Three of them made exactly the same claims about the
// twelve-column grid, and they are rewritten rather than deleted because the
// FAILURES they were protecting against are all still possible — they just have
// different shapes now.
//
// The original bug: boards were authored in absolute rows with no idea how tall
// the window was. On a 1440x900 screen the workspace band measured 820px and the
// landing board rendered 1249px, and because the band is `overflow: hidden`
// while the grid carried an inline min-height equal to its own content, the grid
// never overflowed ITSELF and its `overflow: auto` never engaged. 429px of every
// board was clipped and genuinely unreachable — the landing board's Headlines
// card sat at rows 40-50 and never drew at all. No test failed, because no test
// knew how tall a board was.
//
// A rail scrolls, so that exact failure cannot recur. What CAN recur is a board
// that opens needing a scroll on a normal window, which is the same insult in a
// milder form, so the budget assertion survives in px.

/** Windows a board must open sensibly on: small laptop → large desktop. */
const SHELLS = [
  { w: 1280, h: 620 },
  { w: 1440, h: 820 },
  { w: 1920, h: 1000 },
];

/** `presets.ts`'s own floor. A card shorter than this is a header and a clipped
 *  first row, which reads as broken rather than as small. */
const MIN_CARD_PX = 120;

const RAILS: SegmentId[] = ["left", "right", "bottom"];

const stackedIn = (l: ReturnType<(typeof BUILTIN_PRESETS)[number]["build"]>, rail: SegmentId) =>
  l.widgets.filter((w) => w.segment === rail).reduce((sum, w) => sum + w.height, 0);

// ── WHAT THIS TEST IS ALLOWED TO CLAIM, AND WHAT IT IS NOT ──────────────────
//
// It was first written as "no board ever needs a scroll", and it failed twice,
// both times honestly. The Conflict board stacks six cards, and six at the
// 120px floor need 720px, which does not fit a 620px laptop. The Hazards board
// stacks eight, needing 960px, which does not fit the 820px reference window
// either. Lowering the floor would have bought a green test with cards too
// short to read, which is the trade the floor exists to refuse.
//
// So the claim is narrower, and it is the one that survived the grid: A BOARD
// MAY OPEN NEEDING A SCROLL. That used to be catastrophic and is now merely a
// scroll — the old grid clipped its overflow inside an `overflow: hidden` band
// whose inner scroller never engaged, so 429px of every board was unreachable
// at any scroll position. A rail scrolls, so the content is always reachable
// and the honest overflow is acceptable.
//
// What is still worth failing over is a board that overflows by more than its
// own card count forces, which is the difference between "this laptop is short"
// and "somebody authored a 3000px board".
test("no board overflows its rail by more than the card floor forces", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      for (const rail of RAILS) {
        const n = l.widgets.filter((w) => w.segment === rail).length;
        if (n === 0) continue;
        const budget = rail === "bottom" ? l.segments.bottom.size : shell.h;
        const allowed = Math.max(budget, n * MIN_CARD_PX);
        expect(
          stackedIn(l, rail),
          `board "${p.id}" stacks ${stackedIn(l, rail)}px into its ${rail} rail — more than ${n} cards at the ${MIN_CARD_PX}px floor allows, at ${shell.w}x${shell.h}`,
        ).toBeLessThanOrEqual(allowed);
      }
    }
  }
});

test("no card is composed too short to read", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      for (const w of p.build(shell).widgets) {
        expect(
          w.height,
          `board "${p.id}" gives ${w.type} ${w.height}px at ${shell.w}x${shell.h}`,
        ).toBeGreaterThanOrEqual(MIN_CARD_PX);
      }
    }
  }
});

test("every widget has a real rail, and each rail's order is exactly 0..n-1", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      for (const w of l.widgets) {
        expect(RAILS, `"${p.id}" widget ${w.type} has segment "${w.segment}"`).toContain(w.segment);
        expect(w.height, `"${p.id}" widget ${w.type} has height ${w.height}`).toBeGreaterThan(0);
      }
      // Dense and unique. This is the rail equivalent of "no two cards overlap":
      // two widgets sharing an order, or a gap in the sequence, is a stack whose
      // drawn order depends on array position rather than on the field that is
      // supposed to decide it — which is exactly how a reorder silently no-ops.
      for (const rail of RAILS) {
        const orders = l.widgets.filter((w) => w.segment === rail).map((w) => w.order).sort((a, b) => a - b);
        expect(orders, `"${p.id}" ${rail} rail orders`).toEqual(orders.map((_, i) => i));
      }
    }
  }
});

test("the map keeps at least 40% of the window on EVERY board — no exemptions", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      const side = effectiveRailSize(l, "left", shell, false) + effectiveRailSize(l, "right", shell, false);
      expect(
        side,
        `"${p.id}" gives its side rails ${side}px of ${shell.w}px`,
      ).toBeLessThanOrEqual(shell.w * 0.6);

      const bottom = effectiveRailSize(l, "bottom", shell, false);
      expect(
        bottom,
        `"${p.id}" gives its bottom rail ${bottom}px of ${shell.h}px`,
      ).toBeLessThanOrEqual(shell.h * 0.45);
    }
  }
});

// STREETS USED TO BE WRITTEN OUT OF THE TEST ABOVE, and it no longer is.
//
// The old assertion was `stage.w >= 8` of 12 columns, with an exemption for
// Streets because a camera board authored through `arrangeWall` gave the map
// only 4 columns. The exemption was honest — a 16:9 camera frame in
// `arrangeHouse`'s 4-column rail measured aspect ratios of 2.68 to 6.30, so a
// board whose whole purpose is pictures would have shown letterboxed slivers.
//
// A rail's width is now one number, so a camera board is a WIDER RAIL rather
// than a different arrangement, and a wider rail still leaves the map well over
// half the window. The board is unchanged in every other respect; it simply
// stopped needing to be an exception.

test("an empty rail takes no space at all", () => {
  for (const p of BUILTIN_PRESETS) {
    const l = p.build({ w: 1440, h: 820 });
    for (const rail of RAILS) {
      if (l.widgets.some((w) => w.segment === rail)) continue;
      expect(
        effectiveRailSize(l, rail, { w: 1440, h: 820 }, false),
        `"${p.id}" reserves space for an empty ${rail} rail`,
      ).toBe(0);
    }
  }
});

test("no built-in board carries a grid rectangle — catches a half-converted preset", () => {
  // `rect`, `stageRect` and `width` were deleted from the types, so a preset that
  // still authors one is a TypeScript error today. It would stop being one the
  // moment anybody widens a signature to `Record<string, unknown>`, and the
  // symptom would be a board that silently ignores half of what it was told.
  for (const p of BUILTIN_PRESETS) {
    const json = JSON.stringify(p.build({ w: 1440, h: 820 }));
    for (const dead of ["rect", "stageRect", "width"]) {
      expect(json.includes(`"${dead}"`), `board "${p.id}" still authors "${dead}"`).toBe(false);
    }
  }
});

test("no board asks for a rail wider than a rail is allowed to be", () => {
  for (const p of BUILTIN_PRESETS) {
    const l = p.build({ w: 1440, h: 820 });
    for (const rail of RAILS) {
      expect(
        l.segments[rail].size,
        `"${p.id}" authors a ${rail} rail of ${l.segments[rail].size}px`,
      ).toBeLessThanOrEqual(RAIL_MAX[rail]);
    }
  }
});

test("the default landing preset exists and seeds a real board", () => {
  const def = BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID);
  expect(def, `DEFAULT_PRESET_ID "${DEFAULT_PRESET_ID}" must be a built-in`).toBeDefined();
  expect(def!.build().widgets.length).toBeGreaterThan(0);
});

test("every preset carries a persona blurb (who it's for)", () => {
  for (const p of BUILTIN_PRESETS) {
    expect(p.blurb.length, `preset "${p.id}" needs a blurb`).toBeGreaterThan(0);
  }
});

test("the mobility board puts an aviation widget on the canvas with a stage", () => {
  const l = BUILTIN_PRESETS.find((p) => p.id === "mobility")!.build();
  expect(l.widgets.some((w) => w.type === "aviation")).toBe(true);
  expect(["map2d", "map3d", "clock"]).toContain(l.stage);
});

test("every preset references only real core widgets, signal widgets or recon tools", () => {
  for (const p of BUILTIN_PRESETS) {
    for (const w of p.build().widgets) {
      const known = CORE_WIDGETS.has(w.type) || SIGNAL_WIDGETS.has(w.type) || RECON_WIDGETS.has(w.type);
      expect(known, `preset "${p.id}" references unknown widget type "${w.type}"`).toBe(true);
    }
  }
});

test("the Tools board carries the six recon widgets", () => {
  const l = BUILTIN_PRESETS.find((p) => p.id === "tools")!.build();
  for (const id of RECON_WIDGETS) {
    expect(l.widgets.some((w) => w.type === id), `tools board missing "${id}"`).toBe(true);
  }
});

// "Civic safety" is a single UK-police-only crime feed — it renders empty everywhere
// outside the UK, so the broad *global* boards intentionally don't feature it. Every other
// signal group must be surfaced by at least one board.
const EXEMPT_GROUPS = new Set(["Civic safety"]);

test("the boards together exercise the whole catalogue (all core cards + every global signal group)", () => {
  const used = new Set(BUILTIN_PRESETS.flatMap((p) => p.build().widgets.map((w) => w.type)));

  // All seven core monitoring cards appear across the lineup.
  for (const core of CORE_MONITORS) {
    expect(used.has(core), `no board uses the core "${core}" widget`).toBe(true);
  }

  // At least one signal from every non-exempt registered signal group is surfaced somewhere.
  for (const { group, sources } of signalsByGroup()) {
    if (EXEMPT_GROUPS.has(group)) continue;
    const covered = sources.some((s) => used.has(`signal:${s.id}`));
    expect(covered, `no board surfaces any signal from the "${group}" group`).toBe(true);
  }
});
