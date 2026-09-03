import { describe, it, expect } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";
import { MIN_INTERVAL_MS, MAX_STREAMS } from "@/lib/console/widgets/camslot.model";
import { layoutSignature } from "@/lib/console/boards";
import { setWidgetConfig } from "@/lib/console/reducers";
import type { ShellLayout } from "@/lib/console/types";

function layoutWith(config: unknown, type = "camslot") {
  return {
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type, segment: "left", order: 0, width: 6, height: 240, collapsed: false, config },
    ],
    focusedWidgetId: null,
  };
}

describe("sanitizeLayout — camslot config from a share link", () => {
  it("clamps intervalMs:0, which would otherwise pump ~250 requests a second", () => {
    const l = sanitizeLayout(layoutWith({ intervalMs: 0, streams: [] }));
    expect(l?.widgets[0].config.intervalMs).toBe(MIN_INTERVAL_MS);
  });

  it("truncates an oversized playlist", () => {
    const streams = Array.from({ length: 5000 }, (_, i) => ({ k: "cam", id: `tfl:${i}` }));
    const l = sanitizeLayout(layoutWith({ streams }));
    expect((l?.widgets[0].config.streams as unknown[]).length).toBe(MAX_STREAMS);
  });

  it("drops a ytc ref — channel refs are not a v1 kind", () => {
    const l = sanitizeLayout(
      layoutWith({ streams: [{ k: "ytc", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" }] }),
    );
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("drops a videoId carrying markup", () => {
    const l = sanitizeLayout(layoutWith({ streams: [{ k: "yt", videoId: '" onerror=alert(1) x="' }] }));
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("normalises an ARRAY config instead of passing it through", () => {
    const l = sanitizeLayout(layoutWith([]));
    expect(Array.isArray(l?.widgets[0].config)).toBe(false);
    expect(l?.widgets[0].config.streams).toEqual([]);
  });

  it("keeps the good refs out of a mixed payload", () => {
    const l = sanitizeLayout(
      layoutWith({
        streams: [
          { k: "cam", id: "tfl:JamCams_00001" },
          { k: "ytc", channelId: "UCuAXFkgsw1L7xaCfnd5JJOw" },
          { k: "webcam", id: "windy:1420893641" },
        ],
      }),
    );
    expect(l?.widgets[0].config.streams).toEqual([
      { k: "cam", id: "tfl:JamCams_00001" },
      { k: "webcam", id: "windy:1420893641" },
    ]);
  });

  it("leaves other widget types' config untouched", () => {
    const l = sanitizeLayout(layoutWith({ symbol: "^FTSE", anything: [1, 2, 3] }, "markets"));
    expect(l?.widgets[0].config).toEqual({ symbol: "^FTSE", anything: [1, 2, 3] });
  });

  describe("conditions — the overlay's on/off switch survives round-trip encoded as absence", () => {
    it('keeps conditions:"off" through a share-link round trip', () => {
      const l = sanitizeLayout(layoutWith({ streams: [], conditions: "off" }));
      expect(l?.widgets[0].config.conditions).toBe("off");
    });

    it.each([true, 1, "yes", {}, [], null, "on", "ON", "OFF"])(
      "drops any non-literal value entirely: %j",
      (bad) => {
        const l = sanitizeLayout(layoutWith({ streams: [], conditions: bad }));
        expect("conditions" in (l?.widgets[0].config as object)).toBe(false);
      },
    );

    it("emits no key at all for an untouched config — the default must be byte-identical for layoutSignature", () => {
      const l = sanitizeLayout(layoutWith({ streams: [] }));
      const out = l?.widgets[0].config as object;
      expect("conditions" in out).toBe(false);
    });

    // This is the claim the whole "default = absence" encoding exists to make, and
    // it rests on a JSON.stringify subtlety (a key whose value is `undefined` is
    // dropped) rather than on anything visible in the reducer. Pin it here, because
    // the failure mode is silent: the board's "customised" dot lights up for a user
    // who turned the overlay off and back on, i.e. who changed nothing.
    it("turning the overlay off and back on restores a byte-identical layout signature", () => {
      const base = sanitizeLayout(layoutWith({ streams: [], intervalMs: 5000 }));
      expect(base).not.toBeNull();
      const before = layoutSignature(base as ShellLayout);

      const off = setWidgetConfig(base as ShellLayout, "w1", { conditions: "off" });
      expect(layoutSignature(off)).not.toBe(before);

      // What the toggle actually writes when switching back on — `undefined`, not
      // a deletion and not the string "on".
      const backOn = setWidgetConfig(off, "w1", { conditions: undefined });
      expect(layoutSignature(backOn)).toBe(before);
    });
  });
});
