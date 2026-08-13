import { describe, it, expect } from "vitest";
import {
  coerceTerminalSkin,
  basemapForSkin,
  DEFAULT_TERMINAL_SKIN,
} from "@/lib/terminal/skin";
import { BASEMAPS } from "@/lib/basemaps";

describe("coerceTerminalSkin", () => {
  it("accepts the two literals", () => {
    expect(coerceTerminalSkin("dark")).toBe("dark");
    expect(coerceTerminalSkin("light")).toBe("light");
  });

  it("falls back for anything else", () => {
    for (const junk of [undefined, null, "", "DARK", "Light", 0, 1, {}, [], "positron"]) {
      expect(coerceTerminalSkin(junk)).toBe(DEFAULT_TERMINAL_SKIN);
    }
  });

  it("defaults to dark — the Terminal's designed identity", () => {
    // A skin flip on upgrade would be a change nobody asked for. If this ever
    // becomes light, that has to be a deliberate edit, not a drift.
    expect(DEFAULT_TERMINAL_SKIN).toBe("dark");
  });
});

describe("basemapForSkin", () => {
  it("pairs light with positron and dark with dark", () => {
    expect(basemapForSkin("light")).toBe("positron");
    expect(basemapForSkin("dark")).toBe("dark");
  });

  it("names basemaps that actually exist", () => {
    // The whole mechanism is a string handed to mapViewStore.setBasemap. A typo
    // here would be a blank map, not a type error — BASEMAPS is the only thing
    // that can catch it.
    expect(Object.keys(BASEMAPS)).toContain(basemapForSkin("light"));
    expect(Object.keys(BASEMAPS)).toContain(basemapForSkin("dark"));
  });

  it("is an involution across the two skins", () => {
    // The swap rule in ConsoleShell reads "if the current basemap is the OTHER
    // skin's default, move it to mine". That is only correct while the two skins
    // map to different basemaps.
    expect(basemapForSkin("light")).not.toBe(basemapForSkin("dark"));
  });
});
