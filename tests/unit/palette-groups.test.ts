import { expect, test } from "vitest";
import {
  groupCommands,
  columnize,
  orderGroups,
  sectionPriority,
  assignWidgetSection,
  decorateCommand,
  decorate,
  matchingSetId,
  POPULAR_WIDGET_IDS,
  type Command,
  type GroupedCommands,
  type PaletteSnapshot,
} from "@/lib/console/paletteGroups";

const cmd = (id: string, label: string, hint: string, group: Command["group"]): Command =>
  ({ id, label, hint, group, run: () => {} });

// One command per section, deliberately pushed OUT of priority order so the tests
// prove groupCommands re-orders by the data-driven priority rather than echoing input.
const sample: Command[] = [
  cmd("work-1", "Copy shareable link", "share", "Workspace"),
  cmd("appear-1", "Toggle light / dark theme", "theme", "Appearance"),
  cmd("scen-1", "Middle East", "scenario", "Scenarios"),
  cmd("stage-1", "Stage → 2D map", "stage", "Stage"),
  cmd("base-1", "Satellite", "basemap", "Basemap"),
  cmd("set-1", "Everything", "layer set", "Layer sets"),
  cmd("go-1", "Fly to Kyiv", "region", "Go to"),
  cmd("cat-1", "Add Earthquakes", "natural hazards", "Natural hazards"),
  cmd("map-1", "Toggle Cameras", "layer", "Map layers"),
  cmd("open-1", "Focus Aviation", "widget", "Open widgets"),
  cmd("pop-1", "Add What's abnormal", "synthesis", "Popular widgets"),
  cmd("go-2", "Dive to a live feed", "live", "Go to"),
  cmd("prof-1", "🔎 Intelligence", "for analysts", "Profiles"),
];

// The full priority order the sample should resolve to (most-used first).
const PRIORITY_ORDER = [
  "Profiles", "Popular widgets", "Open widgets", "Map layers", "Natural hazards",
  "Go to", "Layer sets", "Basemap", "Stage", "Scenarios", "Appearance", "Workspace",
];

test("blank query keeps every command, groups render in data-driven priority order", () => {
  const g = groupCommands(sample, "");
  expect(g.map((x) => x.group)).toEqual(PRIORITY_ORDER);
  expect(g.flatMap((x) => x.commands)).toHaveLength(sample.length);
});

test("priority order is independent of input order", () => {
  const shuffled = [...sample].reverse();
  const g = groupCommands(shuffled, "");
  expect(g.map((x) => x.group)).toEqual(PRIORITY_ORDER);
});

test("within a group, incoming command order is preserved", () => {
  const g = groupCommands(sample, "");
  const go = g.find((x) => x.group === "Go to")!;
  expect(go.commands.map((c) => c.id)).toEqual(["go-1", "go-2"]);
});

test("filter matches the label (case-insensitive) and drops empty groups", () => {
  const g = groupCommands(sample, "FLY");
  expect(g.map((x) => x.group)).toEqual(["Go to"]);
  expect(g[0].commands.map((c) => c.id)).toEqual(["go-1"]);
});

test("filter matches the hint too", () => {
  const g = groupCommands(sample, "theme");
  expect(g.map((x) => x.group)).toEqual(["Appearance"]);
  expect(g[0].commands.map((c) => c.id)).toEqual(["appear-1"]);
});

test("filter matches the hint case-insensitively", () => {
  const g = groupCommands(sample, "Analysts");
  expect(g.map((x) => x.group)).toEqual(["Profiles"]);
});

test("a query that matches nothing yields an empty array", () => {
  expect(groupCommands(sample, "zzz-no-match")).toEqual([]);
});

test("partial matches across groups keep only the non-empty groups, in priority order", () => {
  const cmds: Command[] = [
    cmd("a", "🌐 World Overview", "generalist", "Profiles"),
    cmd("b", "Fly to Worthing", "region", "Go to"),
    cmd("c", "Everything (world)", "layer set", "Layer sets"),
  ];
  const g = groupCommands(cmds, "wor");
  // "wor" hits World (Profiles) + Worthing (Go to) + world (Layer sets), priority-ordered.
  expect(g.map((x) => x.group)).toEqual(["Profiles", "Go to", "Layer sets"]);
});

// ── sectionPriority: fixed chrome sections sort ahead of the widget catalogue ──
test("sectionPriority orders profiles < popular < map layers < a category < go to < workspace", () => {
  expect(sectionPriority("Profiles")).toBeLessThan(sectionPriority("Popular widgets"));
  expect(sectionPriority("Popular widgets")).toBeLessThan(sectionPriority("Map layers"));
  expect(sectionPriority("Map layers")).toBeLessThan(sectionPriority("Natural hazards"));
  expect(sectionPriority("Natural hazards")).toBeLessThan(sectionPriority("Go to"));
  expect(sectionPriority("Go to")).toBeLessThan(sectionPriority("Workspace"));
});

test("sectionPriority keeps widget categories in WIDGET_CATEGORY_ORDER", () => {
  // "Synthesis" (index 0) sorts ahead of "Tools" (last).
  expect(sectionPriority("Synthesis")).toBeLessThan(sectionPriority("Tools"));
  // An unknown category still sorts within the catalogue band, at its end.
  expect(sectionPriority("Zzz Unknown")).toBeGreaterThan(sectionPriority("Tools"));
  expect(sectionPriority("Zzz Unknown")).toBeLessThan(sectionPriority("Go to"));
});

test("orderGroups sorts a grouped set by priority (stable)", () => {
  const groups: GroupedCommands[] = [
    { group: "Workspace", commands: [] },
    { group: "Profiles", commands: [] },
    { group: "Map layers", commands: [] },
  ];
  expect(orderGroups(groups).map((g) => g.group)).toEqual(["Profiles", "Map layers", "Workspace"]);
});

// ── assignWidgetSection: popular widgets float out of their category ──────────
test("assignWidgetSection routes popular ids to the fast-path, others to their category", () => {
  expect(assignWidgetSection({ id: "anomaly", category: "Synthesis" }, POPULAR_WIDGET_IDS)).toBe("Popular widgets");
  expect(assignWidgetSection({ id: "signal:earthquakes", category: "Natural hazards" }, POPULAR_WIDGET_IDS)).toBe("Natural hazards");
});

test("every POPULAR_WIDGET_IDS entry resolves to the Popular section", () => {
  for (const id of POPULAR_WIDGET_IDS) {
    expect(assignWidgetSection({ id, category: "Whatever" }, POPULAR_WIDGET_IDS)).toBe("Popular widgets");
  }
});

// ── decorateCommand: stamp active/toggle state from a live snapshot ───────────
const snap: PaletteSnapshot = {
  basemap: "satellite",
  stage: "map2d",
  lang: "es",
  layers: { cameras: true, planes: false, satellites: true, webcams: false },
  activePresetId: "overview",
  activeVariantId: "intel",
  activeLayerSet: "air-space",
};
const d = (id: string) => decorateCommand(cmd(id, id, "", "X"), snap);

test("decorate marks the selected basemap / stage / profile / variant / language", () => {
  expect(d("basemap-satellite").active).toBe(true);
  expect(d("basemap-positron").active).toBeUndefined();
  expect(d("stage-map2d").active).toBe(true);
  expect(d("stage-map3d").active).toBeUndefined();
  expect(d("cpreset-overview").active).toBe(true);
  expect(d("cpreset-situation").active).toBeUndefined();
  expect(d("variant-intel").active).toBe(true);
  expect(d("variant-explore").active).toBeUndefined();
  expect(d("lang-es").active).toBe(true);
  expect(d("lang-en").active).toBeUndefined();
});

test("decorate marks the active layer set, including hyphenated ids", () => {
  expect(d("preset-air-space").active).toBe(true);
  expect(d("preset-all").active).toBeUndefined();
});

test("decorate stamps ON/OFF + active for map-layer toggles", () => {
  expect(d("toggle-cameras")).toMatchObject({ active: true, state: "ON" });
  expect(d("toggle-planes")).toMatchObject({ active: false, state: "OFF" });
  expect(d("toggle-satellites").state).toBe("ON");
});

// THE THEME PILL TEST IS GONE, with the command it decorated. "Toggle light / dark
// theme" was removed from the palette when dark was removed from the product, and a
// state pill for a command nobody can run is not a behaviour worth pinning. The
// `appear-1` fixture below still exercises the Appearance group, so the grouping
// path this file exists for is unchanged.

test("decorate leaves stateless commands untouched", () => {
  const a = d("add-events");
  expect(a.active).toBeUndefined();
  expect(a.state).toBeUndefined();
  const f = d("focus-w1");
  expect(f.active).toBeUndefined();
});

test("decorate maps over a whole list without mutating inputs", () => {
  const input = [cmd("basemap-satellite", "Satellite", "basemap", "Basemap")];
  const out = decorate(input, snap);
  expect(out[0].active).toBe(true);
  expect(input[0].active).toBeUndefined(); // original not mutated
});

// ── matchingSetId: which named layer set (if any) the live layers equal ───────
const SETS = [
  { id: "all", state: { cameras: true, planes: true, satellites: true } },
  { id: "none", state: { cameras: false, planes: false, satellites: false } },
  { id: "cameras", state: { cameras: true, planes: false, satellites: false } },
];

test("matchingSetId returns the exact-matching set id", () => {
  expect(matchingSetId({ cameras: true, planes: true, satellites: true }, SETS)).toBe("all");
  expect(matchingSetId({ cameras: false, planes: false, satellites: false }, SETS)).toBe("none");
  expect(matchingSetId({ cameras: true, planes: false, satellites: false }, SETS)).toBe("cameras");
});

test("matchingSetId returns null when an extra layer is on (honest custom state)", () => {
  // webcams on is in neither set's key space → counts as a difference → no match.
  expect(matchingSetId({ cameras: true, planes: false, satellites: false, webcams: true }, SETS)).toBeNull();
});

test("matchingSetId returns null when nothing matches", () => {
  expect(matchingSetId({ cameras: false, planes: true, satellites: false }, SETS)).toBeNull();
});

// ── columnize: lay ordered sections into side-by-side mega-menu columns ───────
const sec = (group: string, n: number): GroupedCommands =>
  ({ group, commands: Array.from({ length: n }, (_, i) => cmd(`${group}-${i}`, `${group} ${i}`, "", group)) });

test("columnize preserves section order when read column-major", () => {
  const sections = [sec("Profiles", 4), sec("Go to", 4), sec("Add widget", 4), sec("Stage", 4)];
  const cols = columnize(sections, 2);
  const order = cols.flat().map((s) => s.group);
  expect(order).toEqual(["Profiles", "Go to", "Add widget", "Stage"]);
});

test("columnize fills columns with no gaps and never splits a section", () => {
  const sections = [sec("Profiles", 40), sec("Go to", 2), sec("Stage", 2)]; // one huge section
  const cols = columnize(sections, 3);
  expect(cols.every((c) => c.length > 0)).toBe(true); // no empty column
  // every section appears exactly once, intact
  const groups = cols.flat().map((s) => s.group).sort();
  expect(groups).toEqual(["Go to", "Profiles", "Stage"]);
});

test("columnize caps the column count at the number of sections", () => {
  const cols = columnize([sec("Profiles", 3), sec("Go to", 3)], 5);
  expect(cols).toHaveLength(2);
});

test("columnize with one column keeps everything in a single column", () => {
  const sections = [sec("Profiles", 3), sec("Go to", 3), sec("Stage", 3)];
  const cols = columnize(sections, 1);
  expect(cols).toHaveLength(1);
  expect(cols[0].map((s) => s.group)).toEqual(["Profiles", "Go to", "Stage"]);
});

test("columnize returns no columns for no sections", () => {
  expect(columnize([], 3)).toEqual([]);
});

test("columnize roughly balances even sections across columns", () => {
  const sections = [sec("Profiles", 3), sec("Go to", 3), sec("Add widget", 3), sec("Stage", 3), sec("Scenarios", 3), sec("Appearance", 3)];
  const cols = columnize(sections, 3);
  expect(cols).toHaveLength(3);
  // 6 equal sections into 3 columns → 2 sections each
  expect(cols.map((c) => c.length)).toEqual([2, 2, 2]);
});
