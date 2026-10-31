import { describe, expect, it } from "vitest";
import { EYE_CONSOLE_LAYERS, consoleHref, hasSavedBoard } from "@/lib/eye/places";
import { SOURCES_PARAM, wantsSourcesOpen, withoutArrivalFlags } from "@/lib/console/sourcesLink";
import { ACTIVE_LAYERS } from "@/lib/layers";
import { decodeViewState } from "@/lib/share/url";
import { PERSIST_KEY } from "@/lib/variants/store";

/**
 * The landing page's "All sources" opens the console with its Sources rail open. These are the
 * rules behind that link, held without a browser. God's eye view's "Exit to dashboard" is the
 * same link without the flag (tests/unit/eye-exit.test.ts).
 */

const VIEW = { lat: 51.50135, lon: -0.1218, zoom: 15.9 };
const query = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("the Sources link", () => {
  it("opens the console at the same spot with the rail open", () => {
    const href = consoleHref(VIEW, { sources: true });
    expect(href.startsWith("/app?")).toBe(true);
    const q = query(href);
    expect(q.get("lat")).toBe("51.50135");
    expect(q.get("lon")).toBe("-0.1218");
    expect(q.get("z")).toBe("15.9");
    expect(wantsSourcesOpen(q)).toBe(true);
    // Without `scene`, the console keeps the visitor's own layers and ground.
    expect(q.has("layers")).toBe(false);
    expect(q.has("base")).toBe(false);
  });

  it("carries the scene's layers and ground only when asked, in keys the console reads", () => {
    const q = query(consoleHref(VIEW, { sources: true, scene: true }));
    expect(q.get("layers")).toBe("livecams,staticcams,planes");
    expect(q.get("base")).toBe("satellite");
    for (const k of EYE_CONSOLE_LAYERS) expect(ACTIVE_LAYERS).toContain(k);
    // The console's own decoder reads them back, so the link is not a dead letter.
    const state = decodeViewState(q);
    expect(state.layers).toEqual(["livecams", "staticcams", "planes"]);
    expect(state.basemap).toBe("satellite");
  });

  it("carries this view's own link last, as eye=, and still reads as a Sources link", () => {
    const back = "place=tower-bridge&lat=51.50531&lon=-0.08056&z=15.7&heading=247&tilt=48";
    const href = consoleHref(VIEW, { sources: true, back });
    expect(href).toMatch(/^\/app\?lat=[-\d.]+&lon=[-\d.]+&z=[\d.]+.*sources=open/);
    expect(href.endsWith(`&eye=${encodeURIComponent(back)}`)).toBe(true);
    expect(href.indexOf("sources=open")).toBeLessThan(href.indexOf("eye="));
    const q = query(href);
    expect(q.get("eye")).toBe(back);
    expect(wantsSourcesOpen(q)).toBe(true);
    // The scene's keys sit before it too.
    const withScene = consoleHref(VIEW, { sources: true, scene: true, back });
    expect(withScene.indexOf("base=satellite")).toBeLessThan(withScene.indexOf("eye="));
  });

  it("keeps the old plain link when no option is given", () => {
    expect(consoleHref(VIEW)).toBe("/app?lat=51.50135&lon=-0.1218&z=15.9");
  });
});

describe("a saved console board keeps its own layers", () => {
  it("reads the variant spine's own key", () => {
    expect(PERSIST_KEY).toBe("tn.variant.v1");
    const store = new Map([[PERSIST_KEY, "{}"]]);
    expect(hasSavedBoard({ getItem: (k) => store.get(k) ?? null }, PERSIST_KEY)).toBe(true);
  });

  it("treats no storage, an empty storage and a throwing storage as no board", () => {
    expect(hasSavedBoard(undefined, PERSIST_KEY)).toBe(false);
    expect(hasSavedBoard({ getItem: () => null }, PERSIST_KEY)).toBe(false);
    const throwing = {
      getItem(): string | null {
        throw new Error("SecurityError");
      },
    };
    expect(hasSavedBoard(throwing, PERSIST_KEY)).toBe(false);
  });
});

describe("sources=open on the console", () => {
  it("opens the rail only for the exact value", () => {
    expect(SOURCES_PARAM).toBe("sources");
    expect(wantsSourcesOpen(new URLSearchParams("sources=open"))).toBe(true);
    expect(wantsSourcesOpen(new URLSearchParams("sources=1"))).toBe(false);
    expect(wantsSourcesOpen(new URLSearchParams("sources="))).toBe(false);
    expect(wantsSourcesOpen(new URLSearchParams("lat=1"))).toBe(false);
  });

  it("drops the flag and keeps everything else, in order", () => {
    expect(withoutArrivalFlags("/app", "?lat=51.5&sources=open&z=15", "#x")).toBe("/app?lat=51.5&z=15#x");
    expect(withoutArrivalFlags("/app", "?sources=open")).toBe("/app");
    expect(withoutArrivalFlags("/app", "")).toBe("/app");
  });

  it("drops eye= with sources=, and keeps the view, the layers, the base and the hash", () => {
    const back = encodeURIComponent("place=tower-bridge&lat=51.5&lon=-0.08&z=15.7&heading=247&tilt=48");
    const search = `?lat=51.5&lon=-0.08&z=15.7&layers=livecams,planes&base=satellite&sources=open&eye=${back}`;
    expect(withoutArrivalFlags("/app", search, "#map")).toBe(
      "/app?lat=51.5&lon=-0.08&z=15.7&layers=livecams%2Cplanes&base=satellite#map",
    );
    expect(withoutArrivalFlags("/app", `?eye=${back}`)).toBe("/app");
  });
});
