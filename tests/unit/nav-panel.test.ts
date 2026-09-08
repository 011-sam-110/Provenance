// tests/unit/nav-panel.test.ts
//
// lib/console/navPanel.ts (owned by claude-nav) — the pure hover/focus/keyboard
// state machine behind the nav panel, deliberately the same shape as
// lib/console/mapRail.ts (module state + listener Set + useSyncExternalStore,
// nothing touching window/document at module scope so it is inert under the node
// vitest environment). This file mirrors tests/unit/map-rail.test.ts's structure.
//
// No localStorage stub needed — nav-spec §5 states this store is NOT persisted
// (same as mapRailStore).

import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS } from "@/lib/console/presets";
import {
  CLOSE_GRACE_MS,
  CROSSFADE_MS,
  HEIGHT_TRANSITION_MS,
  HOVER_OPEN_DELAY_MS,
  boardStep,
  navPanelStore,
  nextOpenDelay,
  type NavPanelState,
} from "@/lib/console/navPanel";

describe("timing constants exist and are the pinned values from nav-spec §5", () => {
  it("HOVER_OPEN_DELAY_MS is 100ms", () => {
    expect(HOVER_OPEN_DELAY_MS).toBe(100);
  });
  it("CLOSE_GRACE_MS is 300ms", () => {
    expect(CLOSE_GRACE_MS).toBe(300);
  });
  it("HEIGHT_TRANSITION_MS is 220ms", () => {
    expect(HEIGHT_TRANSITION_MS).toBe(220);
  });
  it("CROSSFADE_MS is 150ms", () => {
    expect(CROSSFADE_MS).toBe(150);
  });
});

describe("nextOpenDelay — the whole 'moving between labels resizes without closing' rule", () => {
  it("is HOVER_OPEN_DELAY_MS when currently closed (debounce against a fast mouse pass-through)", () => {
    const closed: NavPanelState = { openId: null };
    expect(nextOpenDelay(closed, "world")).toBe(HOVER_OPEN_DELAY_MS);
  });

  it("is 0 when a panel is already open and retargeting to a DIFFERENT scene (instant retarget)", () => {
    const openOnWorld: NavPanelState = { openId: "world" };
    expect(nextOpenDelay(openOnWorld, "intel")).toBe(0);
  });

  it("is 0 when a panel is already open on the SAME scene", () => {
    const openOnWorld: NavPanelState = { openId: "world" };
    expect(nextOpenDelay(openOnWorld, "world")).toBe(0);
  });

  it("is 0 for every scene while any panel is open, not just a hardcoded pair", () => {
    const openOnStreets: NavPanelState = { openId: "streets" };
    for (const p of BUILTIN_PRESETS) {
      expect(nextOpenDelay(openOnStreets, p.id)).toBe(0);
    }
  });
});

describe("boardStep — roving-focus arithmetic over the 7 board tabs, mirrors mapRail's railStep", () => {
  const order = BUILTIN_PRESETS.map((p) => p.id);

  it("the tab order really is the 7 built-in preset ids, in declared order", () => {
    // Pins the order itself, not just the arithmetic over whatever it happens to
    // be — nav-spec §0 names exactly these seven, in this order.
    expect(order).toEqual(["overview", "world", "nature", "skywatch", "infrastructure", "intel", "streets"]);
  });

  it("steps forward by one within the row", () => {
    expect(boardStep(order, "overview", 1)).toBe("world");
    expect(boardStep(order, "world", 1)).toBe("nature");
  });

  it("steps backward by one within the row", () => {
    expect(boardStep(order, "world", -1)).toBe("overview");
    expect(boardStep(order, "nature", -1)).toBe("world");
  });

  it("wraps forward off the last tab back to the first", () => {
    expect(boardStep(order, "streets", 1)).toBe("overview");
  });

  it("wraps backward off the first tab back to the last", () => {
    expect(boardStep(order, "overview", -1)).toBe("streets");
  });

  it("a full lap in either direction returns to the start", () => {
    let f = order[0];
    let b = order[0];
    for (let i = 0; i < order.length; i++) {
      f = boardStep(order, f, 1);
      b = boardStep(order, b, -1);
    }
    expect(f).toBe(order[0]);
    expect(b).toBe(order[0]);
  });

  it("forward and backward disagree at 7 items (unlike mapRail's degenerate n=2 case)", () => {
    // map-rail.test.ts pins that at n=2 both directions coincide — worth pinning
    // the opposite here so a future accidental copy-paste of that arithmetic (or
    // a change that shrinks the board list) is caught: with 7 boards, +1 and -1
    // from the same tab must land on different neighbours.
    for (const id of order) {
      expect(boardStep(order, id, 1)).not.toBe(boardStep(order, id, -1));
    }
  });
});

describe("navPanelStore — open/close/retarget, and the redundant-call-does-not-emit contract", () => {
  it("starts closed", () => {
    expect(navPanelStore.get()).toEqual({ openId: null });
  });

  it("open(id) sets openId", () => {
    navPanelStore.close();
    navPanelStore.open("world");
    expect(navPanelStore.get()).toEqual({ openId: "world" });
    navPanelStore.close();
  });

  it("open(id) again with a DIFFERENT id retargets", () => {
    navPanelStore.close();
    navPanelStore.open("world");
    navPanelStore.open("intel");
    expect(navPanelStore.get()).toEqual({ openId: "intel" });
    navPanelStore.close();
  });

  it("close() resets to null", () => {
    navPanelStore.open("world");
    navPanelStore.close();
    expect(navPanelStore.get()).toEqual({ openId: null });
  });

  it("a redundant close() while already closed does not wake subscribers", () => {
    navPanelStore.close();
    let calls = 0;
    const unsub = navPanelStore.subscribe(() => {
      calls++;
    });
    navPanelStore.close();
    expect(calls).toBe(0);
    unsub();
  });

  it("re-opening the SAME already-open scene does not emit a redundant notification", () => {
    navPanelStore.close();
    navPanelStore.open("world");
    let calls = 0;
    const unsub = navPanelStore.subscribe(() => {
      calls++;
    });
    navPanelStore.open("world");
    expect(calls).toBe(0);
    unsub();
    navPanelStore.close();
  });

  it("retargeting to a different scene DOES notify subscribers", () => {
    navPanelStore.close();
    navPanelStore.open("world");
    let calls = 0;
    const unsub = navPanelStore.subscribe(() => {
      calls++;
    });
    navPanelStore.open("intel");
    expect(calls).toBe(1);
    unsub();
    navPanelStore.close();
  });

  it("subscribe returns an unsubscribe function that actually stops delivery", () => {
    navPanelStore.close();
    let calls = 0;
    const unsub = navPanelStore.subscribe(() => {
      calls++;
    });
    unsub();
    navPanelStore.open("world");
    expect(calls).toBe(0);
    navPanelStore.close();
  });
});
