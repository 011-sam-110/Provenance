import { describe, expect, it } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { MAX_WATCH_VERTICES } from "@/lib/console/types";

const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const wallBlob = (extra: Record<string, unknown> = {}) => ({
  mode: "wall",
  stage: "map2d",
  segments: { left: { size: 320, collapsed: false }, right: { size: 400, collapsed: true }, bottom: { size: 0, collapsed: false } },
  widgets: [],
  focusedWidgetId: null,
  ...extra,
});

describe("sanitizeLayout — watch ring", () => {
  it("keeps a well-formed ring", () => {
    const l = sanitizeLayout(wallBlob({ watch: { ring: square } }))!;
    expect(l.watch?.ring).toEqual(square);
  });

  it("drops the key entirely when it is absent, so an untouched board is byte-identical", () => {
    const l = sanitizeLayout(wallBlob())!;
    expect("watch" in l).toBe(false);
    expect(JSON.stringify(l)).not.toContain("watch");
  });

  it("drops a ring with fewer than three vertices", () => {
    expect(sanitizeLayout(wallBlob({ watch: { ring: [[0, 0], [1, 1]] } }))!.watch).toBeUndefined();
  });

  it("drops a ring holding a non-finite or out-of-range coordinate", () => {
    const bad = [[0, 0], [1, 1], [Number.NaN, 2]];
    expect(sanitizeLayout(wallBlob({ watch: { ring: bad } }))!.watch).toBeUndefined();
    const off = [[0, 0], [1, 1], [999, 2]];
    expect(sanitizeLayout(wallBlob({ watch: { ring: off } }))!.watch).toBeUndefined();
  });

  it("drops junk shapes rather than throwing", () => {
    for (const junk of [{ watch: 7 }, { watch: null }, { watch: { ring: "nope" } }, { watch: {} }]) {
      expect(() => sanitizeLayout(wallBlob(junk))).not.toThrow();
      expect(sanitizeLayout(wallBlob(junk))!.watch).toBeUndefined();
    }
  });

  it("refuses a ring longer than the vertex cap, so a share link cannot carry a megabyte", () => {
    const huge = Array.from({ length: MAX_WATCH_VERTICES + 1 }, (_, i) => [i * 0.001, 0] as [number, number]);
    expect(sanitizeLayout(wallBlob({ watch: { ring: huge } }))!.watch).toBeUndefined();
  });

  it("round-trips through JSON unchanged", () => {
    const once = sanitizeLayout(wallBlob({ watch: { ring: square } }))!;
    const twice = sanitizeLayout(JSON.parse(JSON.stringify(once)))!;
    expect(twice.watch?.ring).toEqual(square);
  });

  it("ignores a watch ring on a RAILS board — it is a wall-board concept", () => {
    const rails = sanitizeLayout({ ...wallBlob({ watch: { ring: square } }), mode: "rails" })!;
    expect(rails.watch).toBeUndefined();
  });
});
