import { expect, test } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";

// A board saved before the `cameras` widget was retired — or a ?c= link already sent
// to somebody — carries `type: "cameras"`. Nothing registers that type any more, and
// WidgetFrame renders null for an unregistered type. Without the migration the tile
// becomes a hole that still holds its place in the grid: no error, nothing to click.
function savedBeforeTheSwap() {
  return {
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type: "cameras", segment: "left", order: 0, height: 240, collapsed: false, config: {} },
    ],
  };
}

test("a board saved with the retired `cameras` widget loads as a camera wall", () => {
  const out = sanitizeLayout(savedBeforeTheSwap());
  expect(out).not.toBeNull();
  expect(out!.widgets).toHaveLength(1);
  expect(out!.widgets[0].type).toBe("camslot");
});

test("the migrated tile lands on camslot's own empty state, not a half-built config", () => {
  // The old widget stored {} as its config. Routing the RENAMED type through
  // readConfig is what sends it to sanitizeCamslotConfig, so a migrated tile is
  // identical to a freshly added one rather than merely similar to it.
  const out = sanitizeLayout(savedBeforeTheSwap());
  expect(out!.widgets[0].config.streams).toEqual([]);
});

test("a type nobody retired is passed through untouched", () => {
  const out = sanitizeLayout({
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type: "camslot", segment: "left", order: 0, height: 240, collapsed: false, config: { streams: [] } },
      { id: "w2", type: "events", segment: "left", order: 1, height: 240, collapsed: false, config: {} },
    ],
  });
  expect(out!.widgets.map((w) => w.type)).toEqual(["camslot", "events"]);
});

// A board can name a retired SIGNAL layer through its card, `signal:<id>`. Removed on
// 2026-10-17 with no replacement: cyber-c2 and news-coverage. EMSC's card follows its
// layer into `earthquakes`. Either way, no hole.
test("a card of a removed signal layer leaves the board, and the rest of it loads", () => {
  const out = sanitizeLayout({
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type: "headlines", segment: "right", order: 0, height: 240, collapsed: false, config: {} },
      { id: "w2", type: "signal:news-coverage", segment: "right", order: 1, height: 240, collapsed: false, config: {} },
      { id: "w3", type: "signal:cyber-c2", segment: "left", order: 0, height: 240, collapsed: false, config: {} },
      { id: "w4", type: "signal:emsc-quakes", segment: "left", order: 1, height: 240, collapsed: false, config: {} },
      { id: "w5", type: "signal:cyber-ransomware", segment: "left", order: 2, height: 240, collapsed: false, config: {} },
    ],
  });
  expect(out).not.toBeNull();
  expect(out!.widgets.map((w) => w.type).sort()).toEqual(
    ["headlines", "signal:cyber-ransomware", "signal:earthquakes"].sort(),
  );
});
