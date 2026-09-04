import { expect, test } from "vitest";
import { layersForLayout } from "@/lib/console/presetLayers";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID } from "@/lib/console/presets";
import { createDefaultLayout } from "@/lib/console/types";
import { addWidget } from "@/lib/console/reducers";

// signal ids that are ON, and core layer keys that are ON (excluding the always-on
// `countries` base layer, which is geography, not a data layer).
function onLayers(layout: ReturnType<typeof createDefaultLayout>) {
  const { core, signals } = layersForLayout(layout);
  const onSignals = Object.entries(signals).filter(([, v]) => v).map(([k]) => k).sort();
  const onCore = Object.entries(core)
    .filter(([k, v]) => v && k !== "countries")
    .map(([k]) => k)
    .sort();
  return { core, signals, onSignals, onCore };
}

// THE CONFLICT AND TRANSIT BOARD CASES ARE GONE with those boards. Both were really
// testing one thing — that widget types map to map layers through WIDGET_TO_SIGNAL /
// WIDGET_TO_CORE — using whichever board happened to feature those widgets. That
// mapping is unchanged, so it is asserted directly from a hand-built layout instead of
// borrowing a board, which is also why this no longer breaks the next time a board is
// retired.
test("widget types imply their map layers, board or no board", () => {
  let l = createDefaultLayout();
  l = addWidget(l, "signal:conflict", "a", { segment: "left" });
  l = addWidget(l, "signal:protests", "b", { segment: "left" });
  const conflict = onLayers(l);
  expect(conflict.onSignals).toEqual(["conflict", "protests"]);
  expect(conflict.onCore).toEqual([]); // signal cards imply no core layer

  let m = createDefaultLayout();
  m = addWidget(m, "aviation", "c", { segment: "left" });
  m = addWidget(m, "satellites", "d", { segment: "left" });
  m = addWidget(m, "signal:ais", "e", { segment: "left" });
  const transit = onLayers(m);
  expect(transit.onCore).toEqual(["planes", "satellites"]);
  expect(transit.onSignals).toEqual(["ais"]);

  expect(onLayers(createDefaultLayout()).core.countries).toBe(true); // base geography is never stripped
});

test("list-only widgets (events/markets/headlines/locate) imply no map layer", () => {
  // The `extraSignals` escape hatch is still exercised, just not through a board any
  // more. The Brief board used to be the live case: its cards were merged lists, so
  // deriving layers from cards alone lit nothing and left the landing map empty of
  // everything the lists beside it described. The landing board is now empty of both
  // cards AND declared layers, so the mechanism is tested on its own terms.
  const { core, signals } = layersForLayout(
    createDefaultLayout(),
    ["conflict", "earthquakes", "gdacs", "wildfires"],
    ["cameras"],
  );
  expect(Object.entries(core).filter(([k, v]) => v && k !== "countries").map(([k]) => k).sort()).toEqual(["cameras"]);
  expect(Object.entries(signals).filter(([, v]) => v).map(([k]) => k).sort())
    .toEqual(["conflict", "earthquakes", "gdacs", "wildfires"]);

  // A board of pure list widgets lights up nothing.
  let l = createDefaultLayout();
  l = addWidget(l, "events", "a", { segment: "left" });
  l = addWidget(l, "markets", "b", { segment: "right" });
  l = addWidget(l, "headlines", "c", { segment: "bottom" });
  const empty = onLayers(l);
  expect(empty.onCore).toEqual([]);
  expect(empty.onSignals).toEqual([]);
});

test("recon widgets imply no layer and no core", () => {
  // recon:* widgets are query→response tools, not map layers, so they light nothing.
  // Asserted from a hand-built layout now that the Recon board is gone — the property
  // belongs to the widget type, never to the board that happened to carry it.
  let l = createDefaultLayout();
  const RECON = ["recon:dns", "recon:whois", "recon:certs", "recon:bgp", "recon:ports", "recon:threat"];
  RECON.forEach((id, i) => { l = addWidget(l, id, "r" + i, { segment: "left" }); });
  const { onSignals, onCore } = onLayers(l);
  expect(onSignals).toEqual([]);
  expect(onCore).toEqual([]);
});

// THE "NO BLANK-MAP BOARD" RULE IS DELIBERATELY BROKEN, by exactly one board.
// The landing board is now a bare rotating globe: no widgets, no mapSignals, no
// mapCore, and therefore no data layers at all. That is the product decision, so the
// rule is narrowed rather than deleted — a SECOND blank board would still be a bug,
// because every other board exists to show something.
test("no board except the landing globe opens on a blank map", () => {
  for (const p of BUILTIN_PRESETS) {
    const { onCore, onSignals } = onLayers(p.build());
    const lit = onCore.length + onSignals.length;
    if (p.id === DEFAULT_PRESET_ID) {
      expect(lit, "the landing globe must stay blank").toBe(0);
    } else {
      expect(lit, `persona "${p.id}" must switch on at least one map layer`).toBeGreaterThan(0);
    }
  }
});

// --- core-layer escape hatch (mapCore) --------------------------------------

test("a board can light a core layer that no widget implies", () => {
  // Webcams is the case this exists for: there is no webcams widget, so
  // WIDGET_TO_CORE can never imply it and the reset forces it off — meaning
  // before `extraCore` no board could show webcams however it was composed.
  const bare = createDefaultLayout();
  expect(layersForLayout(bare).core.webcams).toBe(false);
  expect(layersForLayout(bare, [], ["webcams"]).core.webcams).toBe(true);
});

test("an explicit core request wins over the reset, and leaves the others alone", () => {
  const { core } = layersForLayout(createDefaultLayout(), [], ["webcams"]);
  expect(core.webcams).toBe(true);
  expect(core.cameras).toBe(false);
  expect(core.planes).toBe(false);
  expect(core.satellites).toBe(false);
});

// ONE board lights webcams now, not two. The landing board dropped its `mapCore` with
// its widgets, so Streets is the only one left — and it is the one that always had the
// stronger claim: the webcam layer IS the pedestrian-zone content that board exists to
// show, since the road-camera feeds are junctions and carriageways. Everywhere else it
// stays off, which is the point of this test.
const WEBCAM_BOARDS = new Set(["streets"]);

test("no OTHER board turns webcams on — it stays opt-in everywhere else", () => {
  for (const p of BUILTIN_PRESETS) {
    if (WEBCAM_BOARDS.has(p.id)) continue;
    const { core } = layersForLayout(p.build(), p.mapSignals ?? [], p.mapCore ?? []);
    expect(core.webcams, `${p.id} unexpectedly lights webcams`).toBe(false);
  }
});
