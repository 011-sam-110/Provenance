import { describe, it, expect } from "vitest";
import {
  coerceTerminalSkin,
  basemapForSkin,
  DEFAULT_TERMINAL_SKIN,
} from "@/lib/terminal/skin";
import { BASEMAPS, DEFAULT_BASEMAP } from "@/lib/basemaps";

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

  it("defaults to light", () => {
    // The Terminal was designed and shipped as dark OSINT chrome; light is now the
    // opening state. If this ever flips back, that has to be a deliberate edit,
    // not a drift.
    expect(DEFAULT_TERMINAL_SKIN).toBe("light");
  });
});

describe("basemapForSkin", () => {
  it("pairs light with positron and dark with dark", () => {
    expect(basemapForSkin("light")).toBe("positron");
    expect(basemapForSkin("dark")).toBe("dark");
  });

  it("the DEFAULT basemap is never the OPPOSITE skin's basemap", () => {
    // The two constants live in different files and neither imports the other, so
    // nothing but this line stops them drifting apart. Drift is not a crash: it is
    // a first-time visitor getting light chrome wrapped around CARTO Dark Matter,
    // which is the exact render ConsoleShell's skin⇄basemap effect exists to
    // prevent and cannot, because that effect deliberately skips its first run so
    // a deep-linked `?base=` is never clobbered.
    //
    // THIS USED TO BE A STRICT EQUALITY and it was weakened deliberately, not
    // because it started failing. DEFAULT_BASEMAP is now `streets`, which is
    // neither skin's implied basemap — so equality would reject a default that is
    // perfectly correct. What actually has to hold is the thing the strict form
    // was standing in for: the default must not be the basemap belonging to the
    // skin we are NOT shipping. Liberty is a light vector style, so light chrome
    // wraps it happily; `dark` is the value this must never take while the default
    // skin is light.
    //
    // If a future default is a raster style with no obvious brightness (satellite,
    // topo), this assertion stops being enough and the pairing needs a real
    // light/dark property on the registry rather than a name comparison.
    expect(DEFAULT_BASEMAP).not.toBe(basemapForSkin(DEFAULT_TERMINAL_SKIN === "light" ? "dark" : "light"));
    expect(Object.keys(BASEMAPS)).toContain(DEFAULT_BASEMAP);
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
