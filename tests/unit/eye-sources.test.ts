import { describe, expect, it } from "vitest";
import {
  EYE_OWN_IDS,
  PIN_STATE_MAX,
  coerceSaved,
  consoleOn,
  countBySignal,
  defaultSources,
  filterSections,
  hiddenKinds,
  isRoadRow,
  ownKind,
  pinCap,
  rowIsOn,
  sectionsOf,
  signalTagPicks,
  sourcesReducer,
  toSectionModel,
  type EyeSourceRow,
  type RenderedSignal,
  type SourcesState,
} from "@/lib/eye/sources";

const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const IDS = [...EYE_OWN_IDS, ...ROWS];
const reduce = (s: SourcesState, ...actions: Parameters<typeof sourcesReducer>[1][]) =>
  actions.reduce((acc, a) => sourcesReducer(acc, a), s);

describe("the defaults", () => {
  it("have all of this view's own seven on, every console row off, and nothing pinned", () => {
    const s = defaultSources();
    expect(s).toEqual({ ownOff: [], consoleOn: [], pins: [] });
    for (const id of EYE_OWN_IDS) expect(rowIsOn(s, id)).toBe(true);
    for (const id of ROWS) expect(rowIsOn(s, id)).toBe(false);
    expect(hiddenKinds(s).size).toBe(0);
    expect(consoleOn(s)).toEqual([]);
  });

  it("each call is a fresh object", () => {
    expect(defaultSources()).not.toBe(defaultSources());
  });
});

describe("the own seven", () => {
  it("are listed in the order the tray shows them", () => {
    expect([...EYE_OWN_IDS]).toEqual(["livecams", "staticcams", "ais", "planes", "road-works", "road-incidents", "road-closures"]);
  });

  it("map onto the scene's kinds, and a console layer maps onto none", () => {
    expect(ownKind("ais")).toBe("ships");
    expect(ownKind("road-closures")).toBe("closures");
    expect(ownKind("crime")).toBeNull();
    expect(ownKind("constructor")).toBeNull();
    expect(ownKind("__proto__")).toBeNull();
  });

  it("the three road rows are the ones that need London", () => {
    expect(EYE_OWN_IDS.filter(isRoadRow)).toEqual(["road-works", "road-incidents", "road-closures"]);
    expect(isRoadRow("crime")).toBe(false);
  });
});

describe("toggle", () => {
  it("switches an own row off by remembering it, and on again by forgetting it", () => {
    const off = sourcesReducer(defaultSources(), { type: "toggle", id: "ais" });
    expect(off.ownOff).toEqual(["ais"]);
    expect(rowIsOn(off, "ais")).toBe(false);
    expect([...hiddenKinds(off)]).toEqual(["ships"]);
    const on = sourcesReducer(off, { type: "toggle", id: "ais" });
    expect(on.ownOff).toEqual([]);
    expect(rowIsOn(on, "ais")).toBe(true);
  });

  it("switches a console row on by remembering it, in the order it was switched on", () => {
    const s = reduce(defaultSources(), { type: "toggle", id: "b" }, { type: "toggle", id: "a" });
    expect(consoleOn(s)).toEqual(["b", "a"]);
    expect(rowIsOn(s, "a")).toBe(true);
    expect(consoleOn(sourcesReducer(s, { type: "toggle", id: "b" }))).toEqual(["a"]);
  });

  it("never touches the pins", () => {
    const s = reduce(defaultSources(), { type: "pin", id: "a" }, { type: "toggle", id: "a" });
    expect(s.pins).toEqual(["a"]);
  });
});

describe("pin, move and unpin", () => {
  it("pins at the end, or at an index", () => {
    const s = reduce(defaultSources(), { type: "pin", id: "a" }, { type: "pin", id: "b" }, { type: "pin", id: "c", at: 1 });
    expect(s.pins).toEqual(["a", "c", "b"]);
    expect(sourcesReducer(s, { type: "pin", id: "d", at: 0 }).pins).toEqual(["d", "a", "c", "b"]);
    expect(sourcesReducer(s, { type: "pin", id: "d", at: 99 }).pins).toEqual(["a", "c", "b", "d"]);
    expect(sourcesReducer(s, { type: "pin", id: "d", at: -3 }).pins).toEqual(["d", "a", "c", "b"]);
  });

  it("pinning what is pinned does nothing, or moves it when given a place", () => {
    const s = reduce(defaultSources(), { type: "pin", id: "a" }, { type: "pin", id: "b" });
    expect(sourcesReducer(s, { type: "pin", id: "a" })).toBe(s);
    expect(sourcesReducer(s, { type: "pin", id: "a", at: 1 }).pins).toEqual(["b", "a"]);
    expect(sourcesReducer(s, { type: "pin", id: "a", at: 0 })).toBe(s);
  });

  it("moves a pin by a step, and stops at the ends", () => {
    const s = reduce(defaultSources(), { type: "pin", id: "a" }, { type: "pin", id: "b" }, { type: "pin", id: "c" });
    expect(sourcesReducer(s, { type: "move", id: "c", delta: -1 }).pins).toEqual(["a", "c", "b"]);
    expect(sourcesReducer(s, { type: "move", id: "a", delta: 1 }).pins).toEqual(["b", "a", "c"]);
    expect(sourcesReducer(s, { type: "move", id: "a", delta: -1 })).toBe(s);
    expect(sourcesReducer(s, { type: "move", id: "c", delta: 1 })).toBe(s);
    expect(sourcesReducer(s, { type: "move", id: "zzz", delta: 1 })).toBe(s);
  });

  it("unpins, and unpinning what is not pinned changes nothing", () => {
    const s = reduce(defaultSources(), { type: "pin", id: "a" }, { type: "pin", id: "b" });
    expect(sourcesReducer(s, { type: "unpin", id: "a" }).pins).toEqual(["b"]);
    expect(sourcesReducer(s, { type: "unpin", id: "zzz" })).toBe(s);
  });
});

describe("the caps", () => {
  it("the bar holds five on a wide screen and six on a phone", () => {
    expect(pinCap(false)).toBe(5);
    expect(pinCap(true)).toBe(6);
  });

  it("the state holds at most six, and a seventh is refused", () => {
    expect(PIN_STATE_MAX).toBe(6);
    const six = ROWS.slice(0, 6).reduce((s, id) => sourcesReducer(s, { type: "pin", id }), defaultSources());
    expect(six.pins).toHaveLength(6);
    expect(sourcesReducer(six, { type: "pin", id: "g" })).toBe(six);
    expect(sourcesReducer(six, { type: "pin", id: "g", at: 0 })).toBe(six);
  });
});

describe("coerceSaved", () => {
  it("gives the defaults for anything that is not an object", () => {
    for (const raw of [null, undefined, "x", 3, true, [], ["a"]]) expect(coerceSaved(raw, IDS)).toEqual(defaultSources());
  });

  it("drops the wrong shapes field by field", () => {
    const s = coerceSaved({ pins: "a", ownOff: { 0: "ais" }, consoleOn: [1, null, "a", {}] }, IDS);
    expect(s).toEqual({ ownOff: [], consoleOn: ["a"], pins: [] });
  });

  it("drops ids this deployment does not offer, and puts a console id nowhere an own one belongs", () => {
    const s = coerceSaved({ ownOff: ["ais", "a", "nonsense"], consoleOn: ["a", "ais", "gone"], pins: ["a", "gone", "ais"] }, IDS);
    expect(s.ownOff).toEqual(["ais"]);
    expect(s.consoleOn).toEqual(["a"]);
    expect(s.pins).toEqual(["a", "ais"]);
  });

  it("keeps each id once", () => {
    const s = coerceSaved({ ownOff: ["ais", "ais"], consoleOn: ["a", "b", "a"], pins: ["b", "b", "a", "b"] }, IDS);
    expect(s).toEqual({ ownOff: ["ais"], consoleOn: ["a", "b"], pins: ["b", "a"] });
  });

  it("caps nine pins at six, in order", () => {
    const nine = [...EYE_OWN_IDS, "a", "b"];
    expect(coerceSaved({ pins: nine }, IDS).pins).toEqual(nine.slice(0, 6));
  });

  it("maps a retired layer to the layer that replaced it, and drops one that was removed", () => {
    const ids = [...IDS, "earthquakes"];
    const s = coerceSaved({ consoleOn: ["emsc-quakes", "cyber-c2", "a"], pins: ["emsc-quakes", "news-coverage", "earthquakes"] }, ids);
    expect(s.consoleOn).toEqual(["earthquakes", "a"]);
    expect(s.pins).toEqual(["earthquakes"]);
  });

  it("is not fooled by names on Object's prototype", () => {
    const s = coerceSaved({ consoleOn: ["constructor", "toString", "__proto__"], pins: ["hasOwnProperty"] }, IDS);
    expect(s).toEqual(defaultSources());
  });

  it("load runs the same repair", () => {
    const s = sourcesReducer(defaultSources(), { type: "load", saved: { consoleOn: ["a", "gone"] }, rowIds: IDS });
    expect(s.consoleOn).toEqual(["a"]);
  });
});

describe("hiddenKinds and consoleOn", () => {
  it("name the scene's kinds that are off, whatever the order", () => {
    const s = reduce(defaultSources(), { type: "toggle", id: "planes" }, { type: "toggle", id: "road-works" }, { type: "toggle", id: "livecams" });
    expect([...hiddenKinds(s)].sort()).toEqual(["livecams", "planes", "works"]);
  });

  it("consoleOn hands back a copy", () => {
    const s = reduce(defaultSources(), { type: "toggle", id: "a" });
    consoleOn(s).push("zzz");
    expect(s.consoleOn).toEqual(["a"]);
  });
});

const row = (id: string, section: string, title: string, label = id.toUpperCase()): EyeSourceRow => ({
  id,
  label,
  color: "#123456",
  section,
  sectionTitle: title,
  own: section === "view",
  layer: false,
  credit: `${id} credit`,
  precision: "exact",
});

describe("sections", () => {
  const rows = [
    row("livecams", "view", "This view", "Live cams"),
    row("ais", "view", "This view", "Ships"),
    row("quakes", "hazards", "Natural hazards & weather", "Earthquakes"),
    row("aq", "human", "Human cost & environment", "Air quality · stations"),
    row("fires", "hazards", "Natural hazards & weather", "Wildfires"),
  ];

  it("group in the order they first appear, This view first", () => {
    const s = sectionsOf(rows);
    expect(s.map((x) => x.id)).toEqual(["view", "hazards", "human"]);
    expect(s[1].rows.map((r) => r.id)).toEqual(["quakes", "fires"]);
  });

  it("carry the rail's full title and the strip's short name", () => {
    const s = sectionsOf(rows);
    expect(s[0]).toMatchObject({ title: "This view", short: "This view" });
    expect(s[1]).toMatchObject({ title: "Natural hazards & weather", short: "Hazards" });
    expect(s[2]).toMatchObject({ title: "Human cost & environment", short: "Air quality" });
  });

  it("fall back to the full title for a section nobody gave a short name", () => {
    expect(sectionsOf([row("x", "brand-new", "Brand new things")])[0].short).toBe("Brand new things");
  });

  it("turn into the console's section model, with the credit as the attribution", () => {
    const m = toSectionModel(sectionsOf(rows)[1]);
    expect(m.title).toBe("Natural hazards & weather");
    expect(m.rows.map((r) => [r.id, r.label, r.attribution])).toEqual([
      ["quakes", "Earthquakes", "quakes credit"],
      ["fires", "Wildfires", "fires credit"],
    ]);
  });

  it("search by label, any case, and drop the sections left empty", () => {
    const s = sectionsOf(rows);
    expect(filterSections(s, "  WILD ").map((x) => x.id)).toEqual(["hazards"]);
    expect(filterSections(s, "wild")[0].rows.map((r) => r.id)).toEqual(["fires"]);
    expect(filterSections(s, "zzz")).toEqual([]);
    expect(filterSections(s, "").map((x) => x.id)).toEqual(["view", "hazards", "human"]);
  });
});

describe("what is on screen", () => {
  const f = (signalId: string, id: string, at: [number, number] | null = [-0.12, 51.5], label = id): RenderedSignal => ({
    signalId,
    id,
    label,
    lon: at ? at[0] : null,
    lat: at ? at[1] : null,
  });

  it("counts each feature once however many tiles or layers drew it", () => {
    const counts = countBySignal([f("crime", "1"), f("crime", "1"), f("crime", "2"), f("quakes", "9"), f("", "x"), f("crime", "")]);
    expect(counts.get("crime")).toBe(2);
    expect(counts.get("quakes")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("names up to the cap, taking each switched-on layer in turn", () => {
    const seen = [f("crime", "c1"), f("crime", "c2"), f("crime", "c3"), f("quakes", "q1")];
    expect(signalTagPicks(seen, ["crime", "quakes"], 2).map((x) => x.id)).toEqual(["c1", "q1"]);
    expect(signalTagPicks(seen, ["quakes", "crime"], 3).map((x) => x.id)).toEqual(["q1", "c1", "c2"]);
    expect(signalTagPicks(seen, ["crime"], 1).map((x) => x.id)).toEqual(["c1"]);
  });

  it("names points only, with a label, once each, and only for layers that are on", () => {
    const seen = [f("crime", "line", null), f("crime", "nolabel", [0, 0], ""), f("crime", "c1"), f("crime", "c1"), f("quakes", "q1")];
    expect(signalTagPicks(seen, ["crime"], 5).map((x) => x.id)).toEqual(["c1"]);
    expect(signalTagPicks(seen, [], 5)).toEqual([]);
    expect(signalTagPicks(seen, ["crime"], 0)).toEqual([]);
  });
});
