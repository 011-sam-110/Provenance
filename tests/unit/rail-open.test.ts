import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RAIL_NARROW_QUERY,
  coerceRailOpen,
  railExpanded,
  railMenuName,
  railWidth,
  sheetTakesEscape,
} from "@/lib/rail/railOpen";

/**
 * The shared sidebar's rules. tests/e2e/side-rail.spec.ts proves the behaviour in a browser;
 * this file holds the parts that need no DOM: how a saved value is read, the width each state
 * publishes, and the store's rule that a phone's sheet is never written down.
 */

const KEY = "tn.rail.open.v1";

describe("coerceRailOpen: how a saved value is read", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "true"],
    ["a number", 1],
    ["true alone", true],
    ["an array", [true, true]],
    ["an empty object", {}],
  ])("%s opens nothing", (_name, raw) => {
    expect(coerceRailOpen(raw)).toEqual({ eye: false, console: false });
  });

  it("opens only the surface saved as a literal true", () => {
    expect(coerceRailOpen({ eye: true, console: false })).toEqual({ eye: true, console: false });
    expect(coerceRailOpen({ eye: "true", console: 1 })).toEqual({ eye: false, console: false });
  });

  it("drops a key it does not know", () => {
    expect(coerceRailOpen({ console: true, other: true })).toEqual({ eye: false, console: true });
  });
});

describe("railExpanded and railWidth: the width value for each state", () => {
  it.each([
    // open, sheet, narrow, expanded, width
    [false, false, false, false, "64px"],
    [true, false, false, true, "232px"],
    [false, true, false, false, "64px"], // a sheet left over means nothing on a wide screen
    [true, true, false, true, "232px"],
    [false, false, true, false, "0px"],
    [true, false, true, false, "0px"], // a saved choice does not open a phone's sheet
    [false, true, true, true, "0px"], // the sheet covers the neighbours, so they do not move
    [true, true, true, true, "0px"],
  ] as const)("open=%s sheet=%s narrow=%s", (open, sheet, narrow, expanded, width) => {
    expect(railExpanded({ open, sheet, narrow })).toBe(expanded);
    expect(railWidth({ expanded: railExpanded({ open, sheet, narrow }), narrow })).toBe(width);
  });
});

describe("railMenuName: the menu button's accessible name", () => {
  it("says what the button is, and keeps the visible word inside the name", () => {
    expect(railMenuName("Provenance")).toBe("Provenance menu");
  });
  it("does not say it twice", () => {
    expect(railMenuName("Menu")).toBe("Menu");
    expect(railMenuName("Main menu")).toBe("Main menu");
  });
  it("does not take a word that only contains the letters for the word itself", () => {
    expect(railMenuName("Menus")).toBe("Menus menu");
  });
});

describe("sheetTakesEscape: the Escape protocol", () => {
  const plain = { closest: () => null } as unknown as EventTarget;
  const owned = { closest: (s: string) => (s === "[data-owns-escape]" ? {} : null) } as unknown as EventTarget;

  it("takes a plain Escape", () => {
    expect(sheetTakesEscape({ key: "Escape", defaultPrevented: false, target: plain })).toBe(true);
  });
  it("takes Escape when the target is the window or nothing, which have no closest", () => {
    expect(sheetTakesEscape({ key: "Escape", defaultPrevented: false, target: null })).toBe(true);
    expect(sheetTakesEscape({ key: "Escape", defaultPrevented: false, target: {} as EventTarget })).toBe(true);
  });
  it("stands down when something else took the press", () => {
    expect(sheetTakesEscape({ key: "Escape", defaultPrevented: true, target: plain })).toBe(false);
  });
  it("stands down inside [data-owns-escape]", () => {
    expect(sheetTakesEscape({ key: "Escape", defaultPrevented: false, target: owned })).toBe(false);
  });
  it("ignores every other key", () => {
    expect(sheetTakesEscape({ key: "Enter", defaultPrevented: false, target: plain })).toBe(false);
  });
});

describe("the store", () => {
  let saved: Map<string, string>;

  /** A new module instance: what a reload, or a second tab, gets. */
  async function freshStore() {
    vi.resetModules();
    return import("@/lib/rail/railOpen");
  }

  function savedValue(): unknown {
    const raw = saved.get(KEY);
    return raw == null ? null : JSON.parse(raw);
  }

  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => saved.get(k) ?? null,
        setItem: (k: string, v: string) => void saved.set(k, v),
        removeItem: (k: string) => void saved.delete(k),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts closed, and stays closed until hydrate reads the saved choice", async () => {
    saved.set(KEY, JSON.stringify({ v: 1, d: { eye: true, console: false } }));
    const { railOpenStore } = await freshStore();
    expect(railOpenStore.isOpen("eye")).toBe(false);
    railOpenStore.hydrate();
    expect(railOpenStore.isOpen("eye")).toBe(true);
    expect(railOpenStore.isOpen("console")).toBe(false);
  });

  it("keeps a surface's choice across a reload, and does not touch the other surface", async () => {
    const first = await freshStore();
    first.railOpenStore.setOpen("console", true);
    expect(savedValue()).toEqual({ v: 1, d: { eye: false, console: true } });

    const second = await freshStore();
    second.railOpenStore.hydrate();
    expect(second.railOpenStore.isOpen("console")).toBe(true);
    expect(second.railOpenStore.isOpen("eye")).toBe(false);
  });

  it("does not put back what a second tab changed on the other surface", async () => {
    const eyeTab = await freshStore();
    eyeTab.railOpenStore.hydrate();
    const consoleTab = await freshStore();
    consoleTab.railOpenStore.hydrate();

    eyeTab.railOpenStore.setOpen("eye", true);
    consoleTab.railOpenStore.setOpen("console", true);
    expect(savedValue()).toEqual({ v: 1, d: { eye: true, console: true } });
  });

  it("a write that comes before hydrate does not lose the saved choice of the other surface", async () => {
    saved.set(KEY, JSON.stringify({ v: 1, d: { eye: true, console: false } }));
    const { railOpenStore } = await freshStore();
    railOpenStore.setOpen("console", true);
    expect(railOpenStore.isOpen("eye")).toBe(true);
    expect(savedValue()).toEqual({ v: 1, d: { eye: true, console: true } });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["an old version", JSON.stringify({ v: 0, d: { eye: true, console: true } })],
    ["a foreign shape", JSON.stringify({ v: 1, d: "open" })],
  ])("%s reads as closed and does not throw", async (_name, raw) => {
    saved.set(KEY, raw);
    const { railOpenStore } = await freshStore();
    expect(() => railOpenStore.hydrate()).not.toThrow();
    expect(railOpenStore.isOpen("eye")).toBe(false);
    expect(railOpenStore.isOpen("console")).toBe(false);
  });

  it("toggle flips the choice and saves it", async () => {
    const { railOpenStore } = await freshStore();
    railOpenStore.toggle("eye");
    expect(railOpenStore.isOpen("eye")).toBe(true);
    railOpenStore.toggle("eye");
    expect(railOpenStore.isOpen("eye")).toBe(false);
    expect(savedValue()).toEqual({ v: 1, d: { eye: false, console: false } });
  });

  it("the phone's sheet is never written down", async () => {
    const { railOpenStore } = await freshStore();
    railOpenStore.setSheet("eye", true);
    expect(railOpenStore.isSheet("eye")).toBe(true);
    expect(saved.has(KEY)).toBe(false);

    const reloaded = await freshStore();
    reloaded.railOpenStore.hydrate();
    expect(reloaded.railOpenStore.isSheet("eye")).toBe(false);
  });

  it("closeRail closes the sheet of its surface and leaves the saved choice alone", async () => {
    const { closeRail, railOpenStore } = await freshStore();
    railOpenStore.setOpen("eye", true);
    railOpenStore.setSheet("eye", true);
    railOpenStore.setSheet("console", true);

    closeRail("eye");

    expect(railOpenStore.isSheet("eye")).toBe(false);
    expect(railOpenStore.isSheet("console")).toBe(true);
    expect(railOpenStore.isOpen("eye")).toBe(true);
    expect(savedValue()).toEqual({ v: 1, d: { eye: true, console: false } });
  });

  it("tells its listeners only when something changed", async () => {
    const { railOpenStore } = await freshStore();
    const heard = vi.fn();
    const off = railOpenStore.subscribe(heard);

    railOpenStore.setOpen("eye", false);
    railOpenStore.setSheet("eye", false);
    expect(heard).not.toHaveBeenCalled();

    railOpenStore.setOpen("eye", true);
    railOpenStore.setSheet("eye", true);
    expect(heard).toHaveBeenCalledTimes(2);

    off();
    railOpenStore.setOpen("eye", false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("importing it with no window is inert, and a write is a quiet no-op", async () => {
    vi.unstubAllGlobals();
    const { railOpenStore } = await freshStore();
    expect(() => railOpenStore.setOpen("eye", true)).not.toThrow();
    expect(railOpenStore.isOpen("eye")).toBe(true);
  });
});

describe("rail.module.css agrees with the rules above", () => {
  // A media query and a width cannot import a constant, so the two copies are compared here.
  const css = readFileSync(join(process.cwd(), "components/rail/rail.module.css"), "utf8");

  it("draws the widths that railWidth publishes", () => {
    expect(css).toMatch(/\.rail\s*\{[^}]*\bwidth:\s*64px/);
    expect(css).toMatch(/\.rail\[data-expanded="true"\]\s*\{[^}]*\bwidth:\s*232px/);
  });

  it("uses the same narrow pass as the store", () => {
    expect(css).toContain(`@media ${RAIL_NARROW_QUERY}`);
  });

  it("publishes 0px on a phone from the first paint, before any script has run", () => {
    expect(css).toMatch(/:global\(html\):has\(\.rail\)\s*\{\s*--rail-w:\s*0px/);
  });
});
