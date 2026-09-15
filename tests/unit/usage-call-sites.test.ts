// Where the usage events fire. The two in lib/ are exercised for real. The five in
// components are pinned by reading the source, because this repo has no component tests.
// The boot guard is the one that matters most: without it, every console load would
// count as a board switch and "boards switched per visit" would start at 1.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// persist.ts no-ops without `window`, which would make the preset tests vacuous
// (same reasoning as tests/unit/console-boards.test.ts).
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
  };
}

beforeEach(() => {
  installStorage();
  vi.resetModules();
});

async function boundCapture() {
  const { bindBeacon } = await import("@/lib/analytics/track");
  const capture = vi.fn();
  bindBeacon({ capture });
  return capture;
}

const named = (capture: ReturnType<typeof vi.fn>, name: string) => capture.mock.calls.filter(([n]) => n === name);

describe("object_opened", () => {
  it("fires on overlay.open with the object's kind and nothing else", async () => {
    const capture = await boundCapture();
    const { overlay } = await import("@/lib/overlay");
    overlay.open({ kind: "camera", id: "tfl:123", title: "Somewhere" } as never);
    expect(named(capture, "object_opened")).toEqual([["object_opened", { kind: "camera" }]]);
  });
});

describe("board_switched", () => {
  it("fires when the user moves to another board", async () => {
    const capture = await boundCapture();
    const { applyPreset } = await import("@/lib/console/presets");
    applyPreset("overview", { track: false });
    applyPreset("streets");
    expect(named(capture, "board_switched")).toEqual([["board_switched", { board: "streets" }]]);
  });

  it("does not fire for track: false, for the active board, or for a reset", async () => {
    const capture = await boundCapture();
    const { applyPreset, resetActiveBoard } = await import("@/lib/console/presets");
    applyPreset("streets", { track: false });
    applyPreset("streets");
    resetActiveBoard();
    expect(named(capture, "board_switched")).toEqual([]);
  });

  it("passes track: false on both of ConsoleShell's boot calls", () => {
    const src = readFileSync("components/shell/ConsoleShell.tsx", "utf8").replace(/\/\/.*$/gm, "");
    const calls = [...src.matchAll(/applyPreset\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toHaveLength(2);
    for (const args of calls) expect(args, args).toContain("track: false");
  });
});

describe("component call sites", () => {
  it.each([
    ["components/shell/SourceCatalog.tsx", "layer_toggled"],
    ["components/shell/CommandPalette.tsx", "layer_toggled"],
    ["components/shell/FreshnessTicker.tsx", "layer_toggled"],
    ["components/shell/CommandPalette.tsx", "share_link_copied"],
    ["components/shell/settings/DisplayTab.tsx", "share_link_copied"],
    ["lib/share/deepLink.ts", "share_link_copied"],
    ["components/shell/inspector/RulesPanel.tsx", "alert_armed"],
  ])("%s tracks %s", (file, name) => {
    expect(readFileSync(file, "utf8")).toContain(`name: "${name}"`);
  });
});
