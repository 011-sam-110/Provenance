import { describe, it, expect } from "vitest";
import { terminalGrid, areaName, type GridSpec } from "@/lib/terminal/grid";

// A malformed grid-template-areas is not an error a browser reports — it is a
// declaration the parser throws away, after which every child auto-places and
// the terminal renders as a pile. Vitest runs in the node environment here, so
// there is no DOM that could catch that at render time. These assertions ARE
// the check: the row-width, rectangle and no-widget-dropped invariants are
// verified on the generated string itself.

const COLS = 6;

/** Split the generated `areas` string back into rows of tokens. */
function rowsOf(spec: GridSpec): string[][] {
  return spec.areas.split("\n").map((line) => {
    const t = line.trim();
    expect(t.startsWith('"') && t.endsWith('"'), `row is not quoted: ${line}`).toBe(true);
    return t.slice(1, -1).trim().split(/\s+/);
  });
}

/**
 * Every structural guarantee, asserted on one spec. Called by nearly every test
 * below so that a shape-specific test does not have to restate the invariants.
 */
function expectWellFormed(spec: GridSpec, inputIds: string[]) {
  const rows = rowsOf(spec);
  expect(rows.length).toBeGreaterThan(0);

  // 1. Every row has the same number of whitespace-separated tokens. This is
  //    the invariant that makes the feature work at all.
  expect([...new Set(rows.map((r) => r.length))]).toEqual([COLS]);

  // 2. The row track list lines up 1:1 with the area rows.
  expect(spec.rows.trim().split(/\s+/).length).toBe(rows.length);

  // 3. No widget is ever dropped, and no widget is invented.
  expect(spec.slots.length).toBe(inputIds.length);
  expect(spec.slots.map((s) => s.id)).toEqual(inputIds);

  // 4. Every slot's area name is unique and actually appears in the template.
  const placed = new Set(rows.flat());
  expect(new Set(spec.slots.map((s) => s.area)).size).toBe(spec.slots.length);
  for (const s of spec.slots) expect(placed.has(s.area), `${s.area} is not placed`).toBe(true);

  // 5. The stage is placed whenever it is claimed, and never shares a name.
  if (spec.stage !== null) {
    expect(placed.has(spec.stage)).toBe(true);
    expect(spec.slots.some((s) => s.area === spec.stage)).toBe(false);
  }

  // 6. Every named area is a rectangle. A non-rectangular area voids the whole
  //    declaration exactly as silently as a short row does.
  const at = new Map<string, { r: number; c: number }[]>();
  rows.forEach((row, r) =>
    row.forEach((name, c) => {
      if (name === ".") return;
      const list = at.get(name) ?? [];
      list.push({ r, c });
      at.set(name, list);
    }),
  );
  for (const [name, cells] of at) {
    const r0 = Math.min(...cells.map((x) => x.r));
    const r1 = Math.max(...cells.map((x) => x.r));
    const c0 = Math.min(...cells.map((x) => x.c));
    const c1 = Math.max(...cells.map((x) => x.c));
    expect(cells.length, `${name} is not a rectangle`).toBe((r1 - r0 + 1) * (c1 - c0 + 1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) expect(rows[r][c], `${name} has a hole`).toBe(name);
    }
  }

  // 7. Area names are legal CSS custom-idents.
  for (const name of placed) {
    if (name === ".") continue;
    expect(name, `${name} is not a custom-ident`).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
  }
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("areaName", () => {
  it("produces a stable w-prefixed name per index", () => {
    expect(areaName(0)).toBe("w0");
    expect(areaName(1)).toBe("w1");
    expect(areaName(39)).toBe("w39");
  });

  it("never returns the stage's area name", () => {
    for (let i = 0; i < 500; i++) expect(areaName(i)).not.toBe("stage");
  });

  it("is always a valid CSS custom-ident", () => {
    for (let i = 0; i < 500; i++) expect(areaName(i)).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
  });

  it("never emits exponential notation, which would not be an ident", () => {
    // Above 1e21 a plain template literal would give "w1e+21" and silently void
    // the entire grid-template-areas declaration.
    expect(areaName(1e30)).toMatch(/^w\d+$/);
    expect(areaName(Number.MAX_VALUE)).toMatch(/^w\d+$/);
  });

  it("normalises junk indices rather than emitting a broken name", () => {
    expect(areaName(-1)).toBe("w0");
    expect(areaName(2.7)).toBe("w2");
    expect(areaName(Number.NaN)).toBe("w0");
    expect(areaName(Number.POSITIVE_INFINITY)).toBe("w0");
  });
});

describe("terminalGrid — CONSOLE", () => {
  it("places the stage even with no widgets at all", () => {
    const spec = terminalGrid({ mode: "console", left: [], right: [], bottom: [] });
    expect(spec.areas).toBe('". stage stage stage . ."');
    expect(spec.rows).toBe("1fr");
    expect(spec.stage).toBe("stage");
    expect(spec.slots).toEqual([]);
    expectWellFormed(spec, []);
  });

  it("keeps the six-column template so the map never resizes when a segment empties", () => {
    const spec = terminalGrid({ mode: "console", left: [], right: [], bottom: [] });
    expect(spec.columns).toBe(
      "300px minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 250px 250px",
    );
  });

  it("stacks a left-only layout one widget per row", () => {
    const spec = terminalGrid({ mode: "console", left: ["a", "b"], right: [], bottom: [] });
    expect(spec.areas).toBe(['"w0 stage stage stage . ."', '"w1 stage stage stage . ."'].join("\n"));
    expect(spec.rows).toBe("1fr 1fr");
    expectWellFormed(spec, ["a", "b"]);
  });

  it("gives a bottom-only layout one 232px dock row under a full-height stage", () => {
    const spec = terminalGrid({ mode: "console", left: [], right: [], bottom: ["a", "b", "c", "d"] });
    expect(spec.areas).toBe(
      ['". stage stage stage . ."', '"w0 w0 w1 w1 w2 w3"'].join("\n"),
    );
    expect(spec.rows).toBe("1fr 232px");
    expectWellFormed(spec, ["a", "b", "c", "d"]);
  });

  it("wraps a bottom segment past six widgets onto another dock row instead of dropping one", () => {
    const bottom = ids("b", 8);
    const spec = terminalGrid({ mode: "console", left: [], right: [], bottom });
    expect(spec.rows).toBe("1fr 232px 232px");
    expect(rowsOf(spec)[2]).toEqual(["w6", "w6", "w6", "w7", "w7", "w7"]);
    expectWellFormed(spec, bottom);
  });

  it("lays out the default overview board (left 4, right 3, bottom 1)", () => {
    const spec = terminalGrid({
      mode: "console",
      left: ["L1", "L2", "L3", "L4"],
      right: ["R1", "R2", "R3"],
      bottom: ["B1"],
    });
    expect(spec.areas).toBe(
      [
        '"w0 stage stage stage w4 w5"',
        '"w1 stage stage stage w6 ."',
        '"w2 stage stage stage . ."',
        '"w3 stage stage stage . ."',
        '"w7 w7 w7 w7 w7 w7"',
      ].join("\n"),
    );
    expect(spec.rows).toBe("1fr 1fr 1fr 1fr 232px");
    expect(spec.slots).toEqual([
      { id: "L1", area: "w0" },
      { id: "L2", area: "w1" },
      { id: "L3", area: "w2" },
      { id: "L4", area: "w3" },
      { id: "R1", area: "w4" },
      { id: "R2", area: "w5" },
      { id: "R3", area: "w6" },
      { id: "B1", area: "w7" },
    ]);
    expectWellFormed(spec, ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "B1"]);
  });

  it("fills the right segment two per row, left to right then down", () => {
    const spec = terminalGrid({ mode: "console", left: [], right: ids("r", 5), bottom: [] });
    const rows = rowsOf(spec);
    expect(rows.length).toBe(3); // ceil(5 / 2)
    expect(rows.map((r) => [r[4], r[5]])).toEqual([
      ["w0", "w1"],
      ["w2", "w3"],
      ["w4", "."],
    ]);
    expectWellFormed(spec, ids("r", 5));
  });

  it("keeps every one of 40 widgets", () => {
    const left = ids("l", 12);
    const right = ids("r", 15);
    const bottom = ids("b", 13);
    const all = [...left, ...right, ...bottom];
    expect(all.length).toBe(40);

    const spec = terminalGrid({ mode: "console", left, right, bottom });
    expect(spec.slots.length).toBe(40);
    const areas = spec.areas;
    for (const s of spec.slots) expect(areas.includes(s.area), `${s.id} lost its cell`).toBe(true);
    expectWellFormed(spec, all);
  });
});

describe("terminalGrid — WALL", () => {
  it("places the stage even with no widgets at all", () => {
    const spec = terminalGrid({ mode: "wall", left: [], right: [], bottom: [] });
    expect(spec.areas).toBe(['"stage stage . . . ."', '"stage stage . . . ."'].join("\n"));
    expect(spec.rows).toBe("1fr 1fr");
    expect(spec.stage).toBe("stage");
    expect(spec.slots).toEqual([]);
    expectWellFormed(spec, []);
  });

  it("uses six equal scanning columns", () => {
    const spec = terminalGrid({ mode: "wall", left: ["a"], right: [], bottom: [] });
    expect(spec.columns).toBe("repeat(6, minmax(185px, 1fr))");
  });

  it("doubles every logical row so the stage block is 2 cols x 2 rows", () => {
    const spec = terminalGrid({ mode: "wall", left: ["a", "b"], right: [], bottom: [] });
    const rows = rowsOf(spec);
    expect(rows.length).toBe(4);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[2]).toEqual(rows[3]);
    expect(rows[2].slice(0, 2)).toEqual(["stage", "stage"]);
    expectWellFormed(spec, ["a", "b"]);
  });

  it("handles a left-only layout", () => {
    const spec = terminalGrid({ mode: "wall", left: ["a", "b"], right: [], bottom: [] });
    expect(spec.areas).toBe(
      [
        '"w0 w1 . . . ."',
        '"w0 w1 . . . ."',
        '"stage stage . . . ."',
        '"stage stage . . . ."',
      ].join("\n"),
    );
  });

  it("handles a bottom-only layout", () => {
    const bottom = ids("b", 4);
    const spec = terminalGrid({ mode: "wall", left: [], right: [], bottom });
    expect(spec.areas).toBe(
      [
        '"w0 w1 w2 w3 . ."',
        '"w0 w1 w2 w3 . ."',
        '"stage stage . . . ."',
        '"stage stage . . . ."',
      ].join("\n"),
    );
    expectWellFormed(spec, bottom);
  });

  it("lays out the default overview board (left 4, right 3, bottom 1)", () => {
    const spec = terminalGrid({
      mode: "wall",
      left: ["L1", "L2", "L3", "L4"],
      right: ["R1", "R2", "R3"],
      bottom: ["B1"],
    });
    expect(spec.areas).toBe(
      [
        '"w0 w1 w2 w3 w4 w5"',
        '"w0 w1 w2 w3 w4 w5"',
        '"stage stage w6 w7 . ."',
        '"stage stage w6 w7 . ."',
      ].join("\n"),
    );
    expect(spec.rows).toBe("1fr 1fr 1fr 1fr");
    expect(spec.slots.map((s) => s.id)).toEqual(["L1", "L2", "L3", "L4", "R1", "R2", "R3", "B1"]);
    expectWellFormed(spec, ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "B1"]);
  });

  it("grows rows until all 40 widgets have a cell", () => {
    const left = ids("l", 12);
    const right = ids("r", 15);
    const bottom = ids("b", 13);
    const all = [...left, ...right, ...bottom];
    expect(all.length).toBe(40);

    const spec = terminalGrid({ mode: "wall", left, right, bottom });
    expect(spec.slots.length).toBe(40);
    // 6 in the first row, 4 alongside the stage block, then 6 per row: 7 logical
    // rows, each emitted twice.
    expect(rowsOf(spec).length).toBe(14);
    const areas = spec.areas;
    for (const s of spec.slots) expect(areas.includes(s.area), `${s.id} lost its cell`).toBe(true);
    expectWellFormed(spec, all);
  });
});

describe("terminalGrid — invariants across both modes", () => {
  const SHAPES: { left: number; right: number; bottom: number }[] = [
    { left: 0, right: 0, bottom: 0 },
    { left: 1, right: 0, bottom: 0 },
    { left: 0, right: 1, bottom: 0 },
    { left: 0, right: 0, bottom: 1 },
    { left: 4, right: 3, bottom: 1 },
    { left: 1, right: 9, bottom: 0 },
    { left: 9, right: 1, bottom: 0 },
    { left: 0, right: 0, bottom: 6 },
    { left: 0, right: 0, bottom: 7 },
    { left: 0, right: 0, bottom: 13 },
    { left: 12, right: 15, bottom: 13 },
    { left: 17, right: 17, bottom: 16 },
  ];

  for (const mode of ["console", "wall"] as const) {
    for (const shape of SHAPES) {
      it(`${mode}: L${shape.left} R${shape.right} B${shape.bottom} is a well-formed template`, () => {
        const left = ids("l", shape.left);
        const right = ids("r", shape.right);
        const bottom = ids("b", shape.bottom);
        const spec = terminalGrid({ mode, left, right, bottom });
        expectWellFormed(spec, [...left, ...right, ...bottom]);
      });
    }
  }

  it("gives a widget the same area name in both modes, so a mode switch never remounts it", () => {
    const args = { left: ids("l", 4), right: ids("r", 3), bottom: ids("b", 2) };
    const a = terminalGrid({ mode: "console", ...args });
    const b = terminalGrid({ mode: "wall", ...args });
    expect(a.slots).toEqual(b.slots);
  });

  it("never returns fewer slots than the ids it was given", () => {
    for (const mode of ["console", "wall"] as const) {
      for (const n of [0, 1, 5, 8, 17, 40, 50]) {
        const left = ids("l", n);
        const spec = terminalGrid({ mode, left, right: [], bottom: [] });
        expect(spec.slots.length, `${mode} dropped a widget at n=${n}`).toBe(n);
      }
    }
  });
});
