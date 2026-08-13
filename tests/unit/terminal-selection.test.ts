import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  selectionStore,
  rowState,
  formatCoord,
  footerLine,
  SELECT_ZOOM,
  type TerminalSelection,
} from "@/lib/terminal/selection";
import { mapViewStore, type PointView } from "@/lib/mapView";

const sel = (over: Partial<TerminalSelection> = {}): TerminalSelection => ({
  id: "w1:row-7",
  title: "M 5.4 — 22 km SSE of Puerto Madero",
  lat: 14.53,
  lon: -92.4,
  cc: "MX",
  meta: "GDACS/EONET · 13h ago",
  ...over,
});

describe("rowState", () => {
  it("is idle for every row when nothing is selected", () => {
    expect(rowState(null, "w1:row-7", "MX")).toBe("idle");
    expect(rowState(null, "w2:row-1")).toBe("idle");
  });

  it("is selected when the ids match, regardless of cc", () => {
    expect(rowState(sel(), "w1:row-7", "MX")).toBe("selected");
    expect(rowState(sel(), "w1:row-7")).toBe("selected");
    expect(rowState(sel({ cc: undefined }), "w1:row-7")).toBe("selected");
  });

  it("links a different row in the same country", () => {
    expect(rowState(sel(), "w9:row-2", "MX")).toBe("linked");
  });

  it("compares country codes case-insensitively (and ignores padding)", () => {
    expect(rowState(sel({ cc: "mx" }), "w9:row-2", "MX")).toBe("linked");
    expect(rowState(sel({ cc: "MX" }), "w9:row-2", "mx")).toBe("linked");
    expect(rowState(sel({ cc: " mx " }), "w9:row-2", "Mx")).toBe("linked");
  });

  it("is idle for a different country", () => {
    expect(rowState(sel(), "w9:row-2", "US")).toBe("idle");
  });

  it("never links a row with no cc, on either side", () => {
    // Row knows no country → cannot be linked, even to a selection that does.
    expect(rowState(sel(), "w9:row-2")).toBe("idle");
    expect(rowState(sel(), "w9:row-2", "")).toBe("idle");
    expect(rowState(sel(), "w9:row-2", "   ")).toBe("idle");
    // Selection knows no country → nothing links to it, not even another blank.
    expect(rowState(sel({ cc: undefined }), "w9:row-2", "MX")).toBe("idle");
    expect(rowState(sel({ cc: undefined }), "w9:row-2")).toBe("idle");
    expect(rowState(sel({ cc: "" }), "w9:row-2", "")).toBe("idle");
  });
});

describe("formatCoord", () => {
  it("formats the northern/western hemisphere at 2dp", () => {
    expect(formatCoord(51.5074, -0.1278)).toBe("51.51N 0.13W");
  });

  it("formats the southern/eastern hemisphere at 2dp", () => {
    expect(formatCoord(-33.8688, 151.2093)).toBe("33.87S 151.21E");
  });

  it("treats zero as N and E, and pads to 2dp", () => {
    expect(formatCoord(0, 0)).toBe("0.00N 0.00E");
    expect(formatCoord(-0, -0)).toBe("0.00N 0.00E");
    expect(formatCoord(5, 5)).toBe("5.00N 5.00E");
  });

  it("returns the dash when either half is missing or not finite", () => {
    expect(formatCoord(undefined, undefined)).toBe("—");
    expect(formatCoord(51.5, undefined)).toBe("—");
    expect(formatCoord(undefined, -0.12)).toBe("—");
    expect(formatCoord(NaN, 0)).toBe("—");
    expect(formatCoord(0, Infinity)).toBe("—");
  });
});

describe("footerLine", () => {
  it("returns the exact empty-state strings for no selection", () => {
    expect(footerLine(null)).toEqual({
      title: "NOTHING SELECTED",
      coord: "—",
      meta: "CLICK ANY ROW — THE STAGE FLIES TO IT AND LINKED ROWS HIGHLIGHT",
    });
  });

  it("passes the title through verbatim and formats the coordinate", () => {
    expect(footerLine(sel())).toEqual({
      title: "M 5.4 — 22 km SSE of Puerto Madero",
      coord: "14.53N 92.40W",
      meta: "GDACS/EONET · 13h ago",
    });
  });

  it("dashes the fields a row genuinely lacks rather than blanking them", () => {
    expect(footerLine(sel({ lat: undefined, lon: undefined, meta: undefined }))).toEqual({
      title: "M 5.4 — 22 km SSE of Puerto Madero",
      coord: "—",
      meta: "—",
    });
    expect(footerLine(sel({ title: "   ", meta: "  " })).title).toBe("—");
    expect(footerLine(sel({ title: "   ", meta: "  " })).meta).toBe("—");
  });
});

describe("selectionStore", () => {
  // selectionStore.select() reaches the map through a DYNAMIC import, so the
  // fly lands some microtasks after select() returns. Capture it by registering
  // a stand-in for WorldMap's flyToPoint (the same imperative bridge WorldMap
  // registers on mount) and polling — guessing a fixed tick count would make
  // this test flaky the day module resolution gets slower.
  let flown: PointView[] = [];

  beforeEach(() => {
    selectionStore.clear();
    flown = [];
    mapViewStore.registerFlyToPoint((v) => flown.push(v));
  });

  afterEach(() => {
    selectionStore.clear();
    mapViewStore.registerFlyToPoint(null);
  });

  async function settleFly(): Promise<void> {
    // Exits on the first tick once a fly lands; the cap only costs wall clock in
    // the negative cases, which have to wait out a plausible window to be sure.
    for (let i = 0; i < 20 && flown.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  it("starts with nothing selected", () => {
    expect(selectionStore.get()).toBeNull();
  });

  it("select() stores the row and notifies subscribers", () => {
    let hits = 0;
    const unsub = selectionStore.subscribe(() => {
      hits += 1;
    });
    selectionStore.select(sel());
    expect(selectionStore.get()?.id).toBe("w1:row-7");
    expect(hits).toBe(1);
    unsub();
  });

  it("stores a copy, so a widget reusing its row object cannot mutate the store", () => {
    const row = sel();
    selectionStore.select(row);
    row.title = "MUTATED";
    expect(selectionStore.get()?.title).toBe("M 5.4 — 22 km SSE of Puerto Madero");
  });

  it("flies the stage to the row, in PointView's lon/lat/zoom shape", async () => {
    selectionStore.select(sel());
    await settleFly();
    expect(flown).toEqual([{ lat: 14.53, lon: -92.4, zoom: SELECT_ZOOM }]);
    // Guard the lon-not-lng trap explicitly: `lng` here is a silent no-op bug.
    expect(flown[0]).not.toHaveProperty("lng");
  });

  it("keeps the fly zoom above WorldMap's idle-spin ceiling and inside its clamp", () => {
    // The globe spin resumes below zoom 4 whenever the overlay store is empty —
    // which it is for a Terminal selection — and would drift off the selection.
    expect(SELECT_ZOOM).toBeGreaterThanOrEqual(4);
    expect(SELECT_ZOOM).toBeLessThanOrEqual(15);
  });

  it("does not fly for a row with no coordinates", async () => {
    selectionStore.select(sel({ lat: undefined, lon: undefined }));
    await settleFly();
    expect(flown).toEqual([]);
    expect(selectionStore.get()?.id).toBe("w1:row-7");
  });

  it("re-selecting the same row re-flies (the 'take me back there' gesture)", async () => {
    selectionStore.select(sel());
    await settleFly();
    flown = [];
    selectionStore.select(sel());
    await settleFly();
    expect(flown).toHaveLength(1);
  });

  it("clear() empties the selection and notifies once, then is a no-op", () => {
    selectionStore.select(sel());
    let hits = 0;
    const unsub = selectionStore.subscribe(() => {
      hits += 1;
    });
    selectionStore.clear();
    expect(selectionStore.get()).toBeNull();
    expect(hits).toBe(1);
    selectionStore.clear();
    expect(hits).toBe(1); // no spurious re-render when already empty
    unsub();
  });

  it("clear() does not move the camera", async () => {
    selectionStore.select(sel());
    await settleFly();
    flown = [];
    selectionStore.clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(flown).toEqual([]);
  });

  it("unsubscribe stops the listener", () => {
    let hits = 0;
    const unsub = selectionStore.subscribe(() => {
      hits += 1;
    });
    unsub();
    selectionStore.select(sel());
    expect(hits).toBe(0);
  });

  it("rowState reads the live store, so the footer and rows agree", () => {
    selectionStore.select(sel());
    const s = selectionStore.get();
    expect(rowState(s, "w1:row-7")).toBe("selected");
    expect(rowState(s, "w4:row-9", "mx")).toBe("linked");
    expect(footerLine(s).coord).toBe("14.53N 92.40W");
  });
});
