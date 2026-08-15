import { expect, test } from "vitest";
import { layersForLayout } from "@/lib/console/presetLayers";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import { createDefaultLayout } from "@/lib/console/types";
import { addWidget } from "@/lib/console/reducers";

function buildById(id: string) {
  const p = BUILTIN_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p.build();
}

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

test("Conflict board → conflict/intel signals ON, all core layers OFF", () => {
  const { onSignals, onCore, core } = onLayers(buildById("situation"));
  // `displacement` left this board deliberately: it is an annual stock figure, and
  // sitting on a live conflict board it read as something that had just moved. It
  // now lives on Recon with the other reference lookups.
  expect(onSignals).toEqual(["acled", "conflict", "instability", "military-air", "protests"]);
  expect(onCore).toEqual([]); // no planes/cameras/satellites on an analyst board
  expect(core.countries).toBe(true); // base geography is never stripped
});

test("Air·Sea·Space board → planes+satellites core layers ON plus its signal layers", () => {
  const { onSignals, onCore } = onLayers(buildById("mobility"));
  expect(onCore).toEqual(["planes", "satellites"]); // aviation widget → planes, satellites widget → satellites
  expect(onSignals).toEqual(["ais", "aurora", "cables", "launches", "ports"]);
});

test("list-only widgets (events/markets/headlines/locate) imply no map layer", () => {
  // The Brief board is the case that forced `extraSignals` to exist. Its cards are
  // merged lists — anomalies, an event log, headlines — not one card per source, so
  // deriving layers from cards alone would light nothing but cameras and leave the
  // landing map empty of everything the lists beside it are describing.
  const board = BUILTIN_PRESETS.find((p) => p.id === "overview")!;
  const { core, signals } = layersForLayout(board.build(), board.mapSignals ?? []);
  expect(Object.entries(core).filter(([k, v]) => v && k !== "countries").map(([k]) => k).sort()).toEqual(["cameras"]);
  expect(Object.entries(signals).filter(([, v]) => v).map(([k]) => k).sort())
    .toEqual(["conflict", "earthquakes", "gdacs", "wildfires"]);

  // Without the declared map layers, the same board lights only its cameras card.
  expect(onLayers(board.build()).onSignals).toEqual([]);

  // A board of pure list widgets lights up nothing.
  let l = createDefaultLayout();
  l = addWidget(l, "events", "a", { segment: "left" });
  l = addWidget(l, "markets", "b", { segment: "right" });
  l = addWidget(l, "headlines", "c", { segment: "bottom" });
  const empty = onLayers(l);
  expect(empty.onCore).toEqual([]);
  expect(empty.onSignals).toEqual([]);
});

test("Recon board → recon widgets imply no layer, no core", () => {
  const { onSignals, onCore } = onLayers(buildById("tools"));
  // recon:* widgets are query→response tools, not map layers, so they light nothing.
  // The three cyber/infra cards that used to sit here as a live backdrop moved to
  // Markets & Cyber, where they are the subject rather than the wallpaper — this
  // board was carrying nine widgets, five of them in one column, so the recon
  // results a user came here to read were the ones falling off the bottom.
  expect(onSignals).toEqual(["displacement"]);
  expect(onCore).toEqual([]);
});

test("every built-in persona lights up at least one data layer (no blank-map board)", () => {
  for (const p of BUILTIN_PRESETS) {
    const { onCore, onSignals } = onLayers(p.build());
    expect(
      onCore.length + onSignals.length,
      `persona "${p.id}" must switch on at least one map layer`,
    ).toBeGreaterThan(0);
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

test("the Brief board turns webcams on", () => {
  const brief = BUILTIN_PRESETS.find((p) => p.id === "overview")!;
  expect(brief.mapCore).toContain("webcams");
  const { core } = layersForLayout(brief.build(), brief.mapSignals ?? [], brief.mapCore ?? []);
  expect(core.webcams).toBe(true);
});

// Two boards light webcams, and only two. Brief, because its job is "what changed
// since you last looked" and a ground-level view is exactly that. Streets, because
// the webcam layer IS the pedestrian-zone content that board exists to show — the
// road-camera feeds are junctions and carriageways, and a Streets board without
// webcams would be a camera board with none of the cameras people asked for.
// Everywhere else it stays off, which is the point of this test.
const WEBCAM_BOARDS = new Set(["overview", "streets"]);

test("no OTHER board turns webcams on — it stays opt-in everywhere else", () => {
  for (const p of BUILTIN_PRESETS) {
    if (WEBCAM_BOARDS.has(p.id)) continue;
    const { core } = layersForLayout(p.build(), p.mapSignals ?? [], p.mapCore ?? []);
    expect(core.webcams, `${p.id} unexpectedly lights webcams`).toBe(false);
  }
});
