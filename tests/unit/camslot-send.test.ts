import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shellLayoutStore } from "@/lib/console/store";
import { createDefaultLayout, type GridRect, type WidgetInstance } from "@/lib/console/types";
import { loadedCamerasStore } from "@/lib/cameras/loaded";
import { pickKey, pickStore, type PickedCamera } from "@/lib/console/widgets/camslot.pick";
import { sanitizeCamslotConfig } from "@/lib/console/widgets/camslot.model";
import { camslotTargets, sendPicksToWall } from "@/lib/console/widgets/camslot.send";

// Node environment, so nothing here renders. That is deliberate and it bounds what
// this file can claim: it covers the two exports that are pure functions of the
// layout store and the basket, and nothing about the tray that draws them.

function widget(
  id: string,
  type: string,
  rect: GridRect | undefined,
  config: Record<string, unknown> = {},
): WidgetInstance {
  return { id, type, segment: "left", order: 0, width: 4, height: 200, rect, collapsed: false, config };
}

/** `set`, not `replace`: replace runs sanitizeLayout, which fills in a rect for any
 *  widget lacking one — and the rect is precisely what these tests are pinning. */
function setBoard(...widgets: WidgetInstance[]): void {
  shellLayoutStore.set({ ...createDefaultLayout(), widgets });
}

function pick(id: string, o: Partial<PickedCamera> = {}): PickedCamera {
  return {
    ref: { k: "cam", id },
    key: pickKey({ k: "cam", id }),
    label: o.label ?? id,
    lat: o.lat ?? 51.5,
    lon: o.lon ?? -0.12,
    refreshSeconds: o.refreshSeconds,
    source: o.source,
  };
}

function streamsOf(id: string): string[] {
  const w = shellLayoutStore.get().widgets.find((x) => x.id === id);
  return sanitizeCamslotConfig(w?.config).streams.map((s) => (s.k === "yt" ? s.videoId : s.id));
}

beforeEach(() => {
  setBoard();
  pickStore.reset();
  loadedCamerasStore.set([]);
});

afterEach(() => {
  shellLayoutStore.replace(createDefaultLayout());
  pickStore.reset();
  loadedCamerasStore.set([]);
});

describe("camslotTargets", () => {
  it("lists the walls in board reading order, not the order they were authored in", () => {
    // Authored bottom-first on purpose: widgets[] is authoring order and a dragged
    // board bears no relation to it, so a menu built from the array would list the
    // walls in an order the user cannot see on screen.
    setBoard(
      widget("bottom", "camslot", { x: 0, y: 6, w: 4, h: 9 }, { name: "Prague" }),
      widget("top-right", "camslot", { x: 6, y: 0, w: 4, h: 9 }, { name: "Madrid" }),
      widget("top-left", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { name: "London" }),
    );
    expect(camslotTargets().map((t) => t.name)).toEqual(["London", "Madrid", "Prague"]);
    expect(camslotTargets().map((t) => t.id)).toEqual(["top-left", "top-right", "bottom"]);
  });

  it("numbers an unnamed wall by its place on the board, not among the unnamed ones", () => {
    setBoard(
      widget("a", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { name: "London" }),
      widget("b", "camslot", { x: 6, y: 0, w: 4, h: 9 }),
      widget("c", "camslot", { x: 0, y: 6, w: 4, h: 9 }),
    );
    // "Camera wall 2" is the second card down the board — a claim the user can check.
    // Numbering only the unnamed ones would make it the first unnamed one, which on
    // this board is also the second card, but on a board whose first two walls are
    // named would be the third. The label has to survive that.
    expect(camslotTargets().map((t) => t.name)).toEqual(["London", "Camera wall 2", "Camera wall 3"]);
  });

  it("counts only camera walls, and numbers them among themselves", () => {
    setBoard(
      widget("markets", "markets", { x: 0, y: 0, w: 4, h: 6 }),
      widget("wall", "camslot", { x: 4, y: 0, w: 4, h: 9 }),
    );
    expect(camslotTargets()).toEqual([{ id: "wall", name: "Camera wall 1", count: 0 }]);
  });

  it("prints the number of streams the wall will actually render, not the raw array length", () => {
    setBoard(
      widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, {
        // Two real refs and two that sanitizeCamslotConfig throws away. A `?c=` share
        // link can carry any JSON at all into config, so the count has to be taken
        // after that filter or the menu would advertise streams that never appear.
        streams: [{ k: "cam", id: "a" }, { k: "cam", id: "b" }, { k: "nope" }, null],
      }),
    );
    expect(camslotTargets()[0].count).toBe(2);
  });

  it("keeps a wall with no rect in the menu, sorted last", () => {
    // A widget has no rect between add() and the first sanitize pass. Dropping it
    // would make a freshly created wall unreachable from the menu that created it.
    setBoard(
      widget("unplaced", "camslot", undefined, { name: "Unplaced" }),
      widget("placed", "camslot", { x: 0, y: 3, w: 4, h: 9 }, { name: "Placed" }),
    );
    expect(camslotTargets().map((t) => t.name)).toEqual(["Placed", "Unplaced"]);
  });
});

describe("sendPicksToWall — an empty basket", () => {
  it("refuses with a sentence rather than making an empty wall", () => {
    setBoard();
    expect(sendPicksToWall("new")).toEqual({ ok: false, message: "Nothing picked yet." });
    expect(shellLayoutStore.get().widgets).toHaveLength(0);
  });

  it("gives the same answer for a named target, and touches nothing", () => {
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [{ k: "cam", id: "a" }] }));
    expect(sendPicksToWall("wall").message).toBe("Nothing picked yet.");
    expect(streamsOf("wall")).toEqual(["a"]);
  });
});

describe("sendPicksToWall — a target that is not there", () => {
  it("says the wall is gone and keeps the basket", () => {
    setBoard();
    pickStore.add([pick("a"), pick("b")]);

    const r = sendPicksToWall("w-removed-while-the-menu-was-open");

    expect(r.ok).toBe(false);
    expect(r.message).toBe("That camera wall is gone.");
    expect(r.widgetId).toBeUndefined();
    // The picks are the user's work. Losing them because the destination vanished
    // would punish them for something the board did.
    expect(pickStore.get().picks.map((p) => p.key)).toEqual(["cam:a", "cam:b"]);
  });

  it("treats a live widget of another type as gone rather than writing streams into it", () => {
    setBoard(widget("markets", "markets", { x: 0, y: 0, w: 4, h: 6 }));
    pickStore.add([pick("a")]);

    expect(sendPicksToWall("markets").message).toBe("That camera wall is gone.");
    expect(shellLayoutStore.get().widgets[0].config).toEqual({});
  });
});

describe("sendPicksToWall — the cadence cap", () => {
  // One 60s camera at a 5s dwell caps the wall at 12 (camslot.arm cadenceCap), so
  // thirteen picks is the smallest selection that has to refuse one.
  function thirteenFastPicks(): PickedCamera[] {
    const near = Array.from({ length: 12 }, (_, i) =>
      pick(`near${i}`, { lat: 51.5, lon: -0.12 + i * 0.001, refreshSeconds: 60 }),
    );
    // A stray, far enough out that it is unambiguously the last one centre-out.
    return [...near, pick("stray", { lat: 55.9, lon: -3.2, refreshSeconds: 60 })];
  }

  it("says how many were refused, why, and what the cap is", () => {
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [], intervalMs: 5000 }));
    pickStore.add(thirteenFastPicks());

    const r = sendPicksToWall("wall");

    expect(r.ok).toBe(true);
    expect(r.widgetId).toBe("wall");
    // The honest denominator, then the cap and the cadence that set it. MAX_PICKS is
    // 60; this wall's real ceiling is 12, and the message is the only place the user
    // ever learns that.
    expect(r.message).toContain("13 cameras here.");
    expect(r.message).toContain("Added the 12 nearest the centre.");
    expect(r.message).toContain("1 refused, because the cap is 12 because a camera here refreshes every 60s.");
    expect(streamsOf("wall")).toHaveLength(12);
  });

  it("refuses the pick furthest from the centre of the selection, not the last one added", () => {
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [], intervalMs: 5000 }));
    // The stray goes into the basket FIRST, so insertion order and centre-out order
    // disagree. Insertion order would keep the stray and drop a camera in the cluster
    // the user was working in — and would make "the 12 nearest the centre" a lie.
    const [...near] = thirteenFastPicks().slice(0, 12);
    pickStore.add([pick("stray", { lat: 55.9, lon: -3.2, refreshSeconds: 60 }), ...near]);

    sendPicksToWall("wall");

    expect(streamsOf("wall")).not.toContain("stray");
    expect(streamsOf("wall")).toHaveLength(12);
  });

  it("empties the basket when the wall took everything", () => {
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [], intervalMs: 5000 }));
    // Twelve, not thirteen: exactly the cap, so nothing is refused.
    pickStore.add(thirteenFastPicks().slice(0, 12));

    sendPicksToWall("wall");

    expect(pickStore.get().picks).toEqual([]);
  });

  it("keeps the ones the wall refused, so 'use a second wall' is still possible", () => {
    // Thirteen fast cameras into a wall whose cap is 12: twelve land, the stray is
    // refused. Emptying the basket here would destroy the camera the accompanying
    // message tells the user to send somewhere else.
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [], intervalMs: 5000 }));
    pickStore.add(thirteenFastPicks());

    const r = sendPicksToWall("wall");

    expect(r.ok).toBe(true);
    expect(pickStore.get().picks.map((p) => p.key)).toEqual(["cam:stray"]);
  });

  it("drops the area context when only part of the selection was placed", () => {
    // The leftovers are no longer "what is in this area", so the tray must stop
    // captioning them with the area's total.
    setBoard(widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, { streams: [], intervalMs: 5000 }));
    pickStore.addFromArea(thirteenFastPicks(), [[0, 0], [0, 1], [1, 1]], 143);

    sendPicksToWall("wall");

    expect(pickStore.get().ring).toBeNull();
    expect(pickStore.get().foundInArea).toBe(0);
  });

  it("keeps the basket when the wall is already full and nothing could be added", () => {
    // Twelve 60s cameras already in the wall: the cap is 12 and it is met, so every
    // incoming pick is refused. "Use a second wall" is only actionable advice if the
    // picks are still there to send.
    loadedCamerasStore.set(
      Array.from({ length: 12 }, (_, i) => ({
        id: `seat${i}`, name: `seat${i}`, lat: 51.5, lon: -0.12,
        available: true, live: true, refreshSeconds: 60,
      })),
    );
    setBoard(
      widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, {
        streams: Array.from({ length: 12 }, (_, i) => ({ k: "cam", id: `seat${i}` })),
        intervalMs: 5000,
      }),
    );
    pickStore.add([pick("extra", { refreshSeconds: 60 })]);

    const r = sendPicksToWall("wall");

    expect(r.ok).toBe(false);
    expect(r.message).toContain("This wall is full at 12");
    expect(pickStore.get().picks.map((p) => p.key)).toEqual(["cam:extra"]);
    expect(streamsOf("wall")).toHaveLength(12);
  });

  it("counts the streams already in the wall when working out the cap", () => {
    // The wall holds one 60s camera; every pick is a 300s one. Ignoring the sitting
    // tenant would compute a cap of 60 and admit all thirteen.
    loadedCamerasStore.set([
      { id: "quick", name: "quick", lat: 51.5, lon: -0.12, available: true, live: true, refreshSeconds: 60 },
    ]);
    setBoard(
      widget("wall", "camslot", { x: 0, y: 0, w: 4, h: 9 }, {
        streams: [{ k: "cam", id: "quick" }],
        intervalMs: 5000,
      }),
    );
    pickStore.add(Array.from({ length: 13 }, (_, i) => pick(`slow${i}`, { refreshSeconds: 300 })));

    const r = sendPicksToWall("wall");

    expect(r.message).toContain("the cap is 12 because a camera here refreshes every 60s");
    // 12 seats total, one already taken.
    expect(streamsOf("wall")).toHaveLength(12);
  });
});

describe("sendPicksToWall — a new wall", () => {
  it("adds one, names it from the picks, and empties the basket", () => {
    setBoard();
    pickStore.add([pick("a", { label: "London: Oxford Circus" }), pick("b", { label: "London: Strand" })]);

    const r = sendPicksToWall("new");

    expect(r.ok).toBe(true);
    expect(r.message).toBe('New camera wall "London" — 2 cameras.');
    const added = shellLayoutStore.get().widgets.find((w) => w.id === r.widgetId);
    expect(added?.type).toBe("camslot");
    expect(sanitizeCamslotConfig(added?.config).name).toBe("London");
    expect(pickStore.get().picks).toEqual([]);
  });
});
