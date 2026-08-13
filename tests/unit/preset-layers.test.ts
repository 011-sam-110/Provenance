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
