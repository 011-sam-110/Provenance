import { expect, test } from "vitest";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, MAX_CARDS_PER_RAIL } from "@/lib/console/presets";
import { MAP_SIGNALS, SIGNALS, signalsByGroup } from "@/lib/signals/registry";
import { MAX_WIDGETS, type SegmentId } from "@/lib/console/types";
import { dockSize, effectiveRailSize, RAIL_MAX } from "@/lib/terminal/rails";
import { COLS, MIN_H, MIN_W, overlaps } from "@/lib/terminal/layoutGrid";
import { listWidgetTypes } from "@/lib/console/registry";
import "@/lib/console/widgets";

const CORE_WIDGETS = new Set(["events", "news", "aviation", "satellites", "markets", "headlines", "locate", "anomaly", "camslot"]);
const SIGNAL_WIDGETS = new Set(SIGNALS.map((s) => `signal:${s.id}`));
// The OSINT "Tools" board's query→response recon widgets (not live signal layers).
const RECON_WIDGETS = new Set(["recon:dns", "recon:whois", "recon:certs", "recon:bgp", "recon:ports", "recon:threat"]);

// SEVEN presets. A preset is the whole workspace now — core layers, signal layers
// AND a board — because lib/monitors.ts merged into lib/console/presets.ts; the
// Sources rail's tiles and the ⌘K Profiles list drive the same seven things.
//
// Ids are stable (used by the first-run seed, the ⌘K Profiles section, the central
// preset pill, and shared `?c=` URLs), which is why the landing board still carries
// the id "overview" long after being renamed Globe.
//
// The six old MONITOR ids were world / skywatch / ground / nature / infrastructure /
// calm. Four of them are presets here. GROUND and CALM are deliberately absent:
// both were subtractive layer states rather than workspaces ("cameras and webcams",
// "cameras only") and both meant the thing STREETS already is.
const BOARD_IDS = ["overview", "world", "nature", "skywatch", "infrastructure", "intel", "streets"];

// THE LANDING BOARD IS DELIBERATELY EMPTY, so "every board has at least one widget" is
// no longer true and must not be asserted. What replaces it is narrower and still
// catches the thing that mattered: a board may not exceed the widget cap, and only the
// landing board may be empty. A second empty board would be a build() that silently
// stopped composing, which is the bug the old assertion was really guarding.
const MAY_BE_EMPTY = new Set([DEFAULT_PRESET_ID]);

// The seven core monitoring cards that must stay REGISTERED (and so addable from ⌘K)
// even though no board features them any more. `locate` is a utility card, not a
// monitoring card, so it is exempt.
const CORE_MONITORS = ["events", "news", "camslot", "aviation", "satellites", "markets", "headlines"];

test("the board lineup is exactly the seven presets, each within the cap", () => {
  const ids = BUILTIN_PRESETS.map((p) => p.id);
  expect(ids).toEqual(BOARD_IDS);
  for (const p of BUILTIN_PRESETS) {
    const l = p.build();
    if (!MAY_BE_EMPTY.has(p.id)) {
      expect(l.widgets.length, `board "${p.id}" composed no widgets`).toBeGreaterThan(0);
    }
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

/** `presets.ts`'s floor for a card in the BOTTOM strip, where the size that
 *  matters is width. Wider than the height floor because the failure is worse: a
 *  short card loses its last rows, a narrow one truncates every row it has to an
 *  ellipsis. */
const MIN_CARD_W = 240;

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
      // A WALL IS NOT A STACK, so this measurement does not describe one. Its
      // tiles are laid out three across on a grid and their `height` is the
      // height of the cell they occupy, not a contribution to a column — summing
      // them asks "how tall would this board be if it were a rail?", which is a
      // question about a board that is not being rendered. The wall's own
      // invariants are asserted further down instead.
      if (l.mode === "wall") continue;
      for (const rail of RAILS) {
        const n = l.widgets.filter((w) => w.segment === rail).length;
        if (n === 0) continue;
        // THE BOTTOM RAIL RUNS ALONG A DIFFERENT AXIS, and this test did not used
        // to know that — because no board had ever put a card there, so the branch
        // was never exercised against real content. It compared a bottom rail's
        // card sizes against `segments.bottom.size`, i.e. against the strip's own
        // HEIGHT, which is its cross axis. With cards sized by width that compares
        // 1280px of cards against a 220px strip and fails a board that is correct.
        //
        // A card's stored size is its extent along its rail's MAIN axis (see the
        // note in ConsoleWorkspace's renderRail), so the budget has to be measured
        // on that same axis: the window's height for a column, its width for a
        // strip. The floors differ too — a narrow card truncates every row to an
        // ellipsis, which costs more than a short card losing its tail.
        const horizontal = rail === "bottom";
        const budget = horizontal ? shell.w : shell.h;
        const floor = horizontal ? MIN_CARD_W : MIN_CARD_PX;
        const allowed = Math.max(budget, n * floor);
        expect(
          stackedIn(l, rail),
          `board "${p.id}" lays ${stackedIn(l, rail)}px along its ${rail} rail — more than ${n} cards at the ${floor}px floor allows, at ${shell.w}x${shell.h}`,
        ).toBeLessThanOrEqual(allowed);
      }
    }
  }
});

test("no card is composed too small to read", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      for (const w of l.widgets) {
        // Same axis rule as the budget test above: a bottom-rail card's stored
        // size is a WIDTH, and its floor is the wider one.
        const floor = !l.mode || l.mode !== "wall" ? (w.segment === "bottom" ? MIN_CARD_W : MIN_CARD_PX) : MIN_CARD_PX;
        expect(
          w.height,
          `board "${p.id}" gives ${w.type} ${w.height}px in its ${w.segment} rail at ${shell.w}x${shell.h}`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  }
});

// ── THE SPREAD RULE ─────────────────────────────────────────────────────────
//
// A board with more cards than one rail holds spreads into a second rail rather
// than scrolling. This is the assertion behind that: four cards in an 820px
// column is ~200px each before weighting, and a fifth puts the smallest on the
// 120px floor and starts the rail scrolling — which hides a card on a board
// whose whole job is being readable in one look.
//
// It is a real constraint on authoring, not a description of it: Infrastructure
// carries six cards and Intel six, and both are only legal because they spread
// (left+right and right+bottom respectively). Squeezing either into one rail
// fails here.
test("no rail opens holding more cards than it can show", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      // A wall tiles on a grid and does not have rails to overfill.
      if (l.mode === "wall") continue;
      for (const rail of RAILS) {
        const n = l.widgets.filter((w) => w.segment === rail).length;
        expect(
          n,
          `board "${p.id}" opens with ${n} cards in its ${rail} rail — spread it to a second rail`,
        ).toBeLessThanOrEqual(MAX_CARDS_PER_RAIL);
      }
    }
  }
});

// ── A PRESET MAY NOT ASK FOR A MAP LAYER THAT DOES NOT EXIST ────────────────
//
// `signals` names MAP layers. A `dataOnly` source is registered and fetchable
// but has no layer at all — no catalog entry, no rail row, no pin — so naming
// one here asks for something that can never light, and it would do so silently:
// `layersForLayout` just writes the id into a state object nothing reads.
//
// The Country Instability Index is the only data-only source today and it IS on
// the Intel board, as a `signal:instability` WIDGET. That is the legal way to
// use one, and it is exactly the distinction this test exists to keep.
test("every preset's signal layers are real map layers", () => {
  const mappable = new Set(MAP_SIGNALS.map((s) => s.id));
  for (const p of BUILTIN_PRESETS) {
    for (const id of p.signals ?? []) {
      expect(
        mappable.has(id),
        `preset "${p.id}" asks for signal layer "${id}", which is not in MAP_SIGNALS${
          SIGNALS.some((s) => s.id === id) ? " — it is registered but dataOnly, so it can only be a widget" : ""
        }`,
      ).toBe(true);
    }
  }
});

// Every card a preset places has to be a type the registry knows. A typo here
// mounts nothing and reports nothing — `getWidgetType` returns undefined and the
// frame renders an empty box — so a misspelt id is a card-shaped hole rather
// than an error anyone would see.
test("every card a preset places is a registered widget type", () => {
  const known = new Set(listWidgetTypes().map((t) => t.id));
  for (const p of BUILTIN_PRESETS) {
    for (const w of p.build().widgets) {
      expect(known.has(w.type), `preset "${p.id}" places unregistered widget "${w.type}"`).toBe(true);
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

test("a rails board carries no rectangle, and a wall board carries nothing else", () => {
  // `stageRect` and `width` are deleted from the types, so a preset that still
  // authors one is a TypeScript error today. It would stop being one the moment
  // anybody widens a signature to `Record<string, unknown>`, and the symptom
  // would be a board that silently ignores half of what it was told.
  //
  // `rect` is no longer in that list unconditionally — it is load-bearing on a
  // wall — so the guard is now two-sided and BOTH sides matter. A rails board
  // authoring a rect is the half-converted preset this test was written for; a
  // wall board NOT authoring one is the failure that has no symptom you can see,
  // because a tile with no rect is mounted, holds its config and its fetches,
  // and draws nothing at all.
  for (const p of BUILTIN_PRESETS) {
    const l = p.build({ w: 1440, h: 820 });
    const json = JSON.stringify(l);

    for (const dead of ["stageRect", "width"]) {
      expect(json.includes(`"${dead}"`), `board "${p.id}" still authors "${dead}"`).toBe(false);
    }

    if (l.mode === "wall") {
      expect(l.widgets.length, `wall board "${p.id}" is empty`).toBeGreaterThan(0);
      for (const w of l.widgets) {
        expect(w.rect, `wall board "${p.id}" leaves ${w.type} unplaced`).toBeTruthy();
      }
    } else {
      expect(json.includes('"rect"'), `rails board "${p.id}" still authors "rect"`).toBe(false);
    }
  }
});

// ── The wall's own invariants ───────────────────────────────────────────────
// The rail assertions above skip these boards, so everything a wall board has to
// guarantee is asserted here rather than nowhere.
test("a wall board tiles inside twelve columns without overlapping itself", () => {
  for (const shell of SHELLS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(shell);
      if (l.mode !== "wall") continue;
      const rects = l.widgets.map((w) => w.rect!);

      for (const r of rects) {
        expect(r.x, `"${p.id}" places a tile at x=${r.x}`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `"${p.id}" runs a tile off the right edge`).toBeLessThanOrEqual(COLS);
        expect(r.y, `"${p.id}" places a tile above the board`).toBeGreaterThanOrEqual(0);
        expect(r.w, `"${p.id}" composes a tile ${r.w} columns wide`).toBeGreaterThanOrEqual(MIN_W);
        expect(r.h, `"${p.id}" composes a tile ${r.h} rows tall`).toBeGreaterThanOrEqual(MIN_H);
      }

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(
            overlaps(rects[i], rects[j]),
            `"${p.id}" overlaps two tiles at ${shell.w}x${shell.h}`,
          ).toBe(false);
        }
      }
    }
  }
});

test("a wall board opens with its map dock closed", () => {
  // The map is the picker, not the hero, and the wall gets the window until the
  // user asks for the map. A dock that opened open would be the rails board with
  // extra steps.
  for (const p of BUILTIN_PRESETS) {
    const l = p.build({ w: 1440, h: 820 });
    if (l.mode !== "wall") continue;
    expect(l.segments.right.collapsed, `wall board "${p.id}" opens with the dock showing`).toBe(true);
    expect(
      dockSize(l, { w: 1440, h: 820 }),
      `wall board "${p.id}" reserves width for a closed dock`,
    ).toBe(0);
    // …and it still remembers a width to reopen to, or the first click on the
    // control gives a sliver clamped up from zero rather than a usable map.
    expect(l.segments.right.size, `wall board "${p.id}" forgets its dock width`).toBeGreaterThan(0);
  }
});

test("exactly one built-in board is a wall, and the landing board is not", () => {
  const walls = BUILTIN_PRESETS.filter((p) => p.build({ w: 1440, h: 820 }).mode === "wall");
  expect(walls.map((p) => p.id)).toEqual(["streets"]);
  expect(
    BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.build({ w: 1440, h: 820 }).mode,
  ).toBe("rails");
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

test("the default landing preset exists, and seeds an EMPTY board on the globe", () => {
  const def = BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID);
  expect(def, `DEFAULT_PRESET_ID "${DEFAULT_PRESET_ID}" must be a built-in`).toBeDefined();

  // INVERTED ON PURPOSE. This used to assert the landing board had widgets; the product
  // decision is now that it has none — /app opens on a bare rotating globe. Asserting
  // the zero rather than deleting the test keeps the direction pinned: if a widget ever
  // creeps back onto the landing board, this goes red and someone has to mean it.
  const l = def!.build();
  expect(l.widgets, "the landing board must stay empty").toEqual([]);

  // The stage is the other half of "just the rotating globe". WorldMap only runs its
  // idle spin in the 3D projection, and with the 3D/2D switch removed from the console
  // this literal is the only thing that can choose it for a new visitor.
  expect(l.stage, "the landing board must open on the 3D globe").toBe("map3d");
});

test("every preset carries a persona blurb (who it's for)", () => {
  for (const p of BUILTIN_PRESETS) {
    expect(p.blurb.length, `preset "${p.id}" needs a blurb`).toBeGreaterThan(0);
  }
});

// The "mobility board puts an aviation widget on the canvas" test is GONE because the
// Transit board is gone. What it actually protected — that a board declares a stage the
// shell can render — applies to every board, so it is asserted for all of them here
// rather than for one board that no longer exists.
test("every board declares a stage the shell can render", () => {
  for (const p of BUILTIN_PRESETS) {
    expect(["map2d", "map3d", "clock"], `board "${p.id}"`).toContain(p.build().stage);
  }
});

test("every preset references only real core widgets, signal widgets or recon tools", () => {
  for (const p of BUILTIN_PRESETS) {
    for (const w of p.build().widgets) {
      const known = CORE_WIDGETS.has(w.type) || SIGNAL_WIDGETS.has(w.type) || RECON_WIDGETS.has(w.type);
      expect(known, `preset "${p.id}" references unknown widget type "${w.type}"`).toBe(true);
    }
  }
});

// The "Tools board carries the six recon widgets" test is GONE with the Recon board.
// The recon widgets themselves are NOT gone — they are still registered and still
// addable from ⌘K — so the guarantee moves to the registry, which is now the only thing
// standing between them and being unreachable.
test("the recon widgets survive the loss of the board that showcased them", () => {
  const registered = new Set(listWidgetTypes().map((t) => t.id));
  for (const id of RECON_WIDGETS) {
    expect(registered.has(id), `recon widget "${id}" is no longer registered`).toBe(true);
  }
});

// "Civic safety" is a single UK-police-only crime feed — it renders empty everywhere
// outside the UK, so the broad *global* boards intentionally don't feature it. Every other
// signal group must be surfaced by at least one board.
const EXEMPT_GROUPS = new Set(["Civic safety"]);

// THE COVERAGE GUARANTEE MOVED FROM THE BOARDS TO THE REGISTRY, and that is a real
// weakening rather than a rename — say so plainly. The old test asserted that the seven
// boards, between them, put every core card and every signal group in front of a user
// who never opened a menu. Two boards cannot do that and are not trying to: the landing
// board is empty by design and Streets is four camera slots.
//
// What is still worth pinning is the thing that would make the removal DESTRUCTIVE
// rather than merely narrowing: a widget that no board mentions must still be reachable.
// Every core card and every non-exempt signal group must therefore still have a
// registered widget type, because the ⌘K palette builds itself from that registry
// (CommandPalette.tsx) and it is now the only route to most of these.
//
// If this goes red, a widget has become genuinely unreachable — not merely unfeatured.
test("every core card and signal group is still REACHABLE, even with no board featuring it", () => {
  const registered = new Set(listWidgetTypes().map((t) => t.id));

  for (const core of CORE_MONITORS) {
    expect(registered.has(core), `core widget "${core}" is no longer registered`).toBe(true);
  }

  for (const { group, sources } of signalsByGroup()) {
    if (EXEMPT_GROUPS.has(group)) continue;
    const covered = sources.some((s) => registered.has(`signal:${s.id}`));
    expect(covered, `no registered widget for any signal in the "${group}" group`).toBe(true);
  }
});
