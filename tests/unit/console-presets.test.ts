import { expect, test } from "vitest";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID } from "@/lib/console/presets";
import { SIGNALS, signalsByGroup } from "@/lib/signals/registry";
import { MAX_WIDGETS } from "@/lib/console/types";

const CORE_WIDGETS = new Set(["events", "news", "cameras", "aviation", "satellites", "markets", "headlines", "locate", "anomaly", "camslot"]);
const SIGNAL_WIDGETS = new Set(SIGNALS.map((s) => `signal:${s.id}`));
// The OSINT "Tools" board's query→response recon widgets (not live signal layers).
const RECON_WIDGETS = new Set(["recon:dns", "recon:whois", "recon:certs", "recon:bgp", "recon:ports", "recon:threat"]);

// Deliberately FEW: six broad boards, one per navbar-pill slot. Ids are stable (used by
// the first-run seed, the ⌘K Profiles section, the central preset pill, and shared URLs).
const BOARD_IDS = ["overview", "situation", "earth", "mobility", "markets", "tools", "streets"];

// The seven core monitoring cards the union of boards must all surface (the "use all our
// widgets" intent). `locate` is a utility card, not a monitoring board card, so it's exempt.
const CORE_MONITORS = ["events", "news", "cameras", "aviation", "satellites", "markets", "headlines"];

test("the board lineup is exactly the five broad boards, each non-empty and within the cap", () => {
  const ids = BUILTIN_PRESETS.map((p) => p.id);
  expect(ids).toEqual(BOARD_IDS);
  for (const p of BUILTIN_PRESETS) {
    const l = p.build();
    expect(l.widgets.length).toBeGreaterThan(0);
    expect(l.widgets.length).toBeLessThanOrEqual(MAX_WIDGETS);
  }
});

// ── The invariant that was missing ──────────────────────────────────────────
// Boards were authored in absolute rows with no idea how tall the window was. On a
// 1440x900 screen the workspace band measured 820px and the landing board rendered
// 1249px — and because the band is `overflow: hidden` while the grid carries an
// inline min-height equal to its own content, the grid never overflows ITSELF and
// its `overflow: auto` never engages. 429px of every board was clipped and
// genuinely unreachable: the landing board's Headlines card sat at rows 40-50 and
// never drew at all. No test failed, because no test knew how tall a board was.

const ROWS = [24, 28, 32, 40]; // small laptop → large desktop

test("no board is taller than the rows it was built for — nothing below the fold", () => {
  for (const rows of ROWS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(rows);
      const items = [...l.widgets.map((w) => w.rect!), ...(l.stageRect ? [l.stageRect] : [])];
      const bottom = items.reduce((m, r) => Math.max(m, r.y + r.h), 0);
      expect(bottom, `board "${p.id}" is ${bottom} rows tall in a ${rows}-row budget`).toBeLessThanOrEqual(rows);
    }
  }
});

test("every widget on every board has a rectangle, and none of them overlap", () => {
  for (const rows of ROWS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(rows);
      const rects = l.widgets.map((w) => {
        expect(w.rect, `"${p.id}" widget ${w.type} has no rect`).toBeDefined();
        return { id: w.type, ...w.rect! };
      });
      if (l.stageRect) rects.push({ id: "__stage", ...l.stageRect });
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(hit, `"${p.id}": ${a.id} overlaps ${b.id} at ${rows} rows`).toBe(false);
        }
      }
    }
  }
});

test("the map is the tallest thing on every board, and nothing is left empty beneath it", () => {
  for (const rows of ROWS) {
    for (const p of BUILTIN_PRESETS) {
      const l = p.build(rows);
      const stage = l.stageRect!;
      // The old defaults gave the stage 4 of 12 columns and 14 of ~40 rows, which
      // left a ~470x400px black rectangle under it — larger in area than the map.
      // Six reviewers each named that hole first, so it gets an assertion.
      // EXEMPTION, argued rather than assumed. Streets is a wall of camera tiles:
      // arrangeHouse's 8-of-12-column map leaves cards in a 4-column rail at
      // measured aspect ratios of 2.68 to 6.30, and a 16:9 camera frame rendered
      // into that is a letterboxed sliver. It is authored with arrangeWall instead,
      // where the map takes one card's width (4 columns) over two bands. The hole
      // this assertion exists to prevent is still impossible there — the coverage
      // check below runs on Streets unchanged and proves every cell is filled.
      const wallBoards = new Set(["streets"]);
      if (!wallBoards.has(p.id)) {
        expect(stage.w, `"${p.id}" map is only ${stage.w} columns`).toBeGreaterThanOrEqual(8);
      }

      // Every cell to the right of the rail, for the full height, is covered by
      // either the map or a docked card. That is what makes the void impossible
      // rather than merely absent from today's boards.
      const covering = [stage, ...l.widgets.map((w) => w.rect!)];
      for (let x = stage.x; x < 12; x++) {
        for (let y = 0; y < rows; y++) {
          const covered = covering.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
          expect(covered, `"${p.id}" leaves cell (${x},${y}) empty at ${rows} rows`).toBe(true);
        }
      }
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

test("the five boards together exercise the whole catalogue (all core cards + every global signal group)", () => {
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
