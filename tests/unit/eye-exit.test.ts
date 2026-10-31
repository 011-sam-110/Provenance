import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EYE_PLACES, consoleHref, eyeLinkQuery, parseEyeReturn, type EyeView } from "@/lib/eye/places";
import { EXIT_LABEL } from "@/lib/eye/wording";
import { wantsSourcesOpen, withoutArrivalFlags } from "@/lib/console/sourcesLink";
import { decodeViewState } from "@/lib/share/url";

/**
 * "Exit to dashboard" in God's eye view's sidebar (components/eye/EyeHud.tsx): the console at
 * the spot on screen, with its rail as the visitor left it and the way back to this view.
 * These are the rules behind it, held without a browser; tests/e2e/eye-exit.spec.ts
 * drives the real journey.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const query = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

const tower = EYE_PLACES.find((p) => p.id === "tower-bridge")!;
const MOVED: EyeView = { lat: 51.50531, lon: -0.08056, zoom: 15.7, tilt: 48, heading: 247 };

describe("the words", () => {
  it("say what it does and where it goes, in sentence case, with no dash", () => {
    expect(EXIT_LABEL).toBe("Exit to dashboard");
    expect(EXIT_LABEL).not.toMatch(/[–—]/);
  });
});

describe("the link", () => {
  const back = eyeLinkQuery({ kind: "place", place: tower, view: tower.wide }, MOVED);
  const href = consoleHref({ lat: MOVED.lat, lon: MOVED.lon, zoom: MOVED.zoom }, { back });

  it("opens the console at the same spot, and does not open the Sources rail", () => {
    expect(href.startsWith("/app?")).toBe(true);
    const q = query(href);
    const state = decodeViewState(q);
    expect(state.lat).toBeCloseTo(MOVED.lat, 5);
    expect(state.lon).toBeCloseTo(MOVED.lon, 5);
    expect(state.zoom).toBeCloseTo(MOVED.zoom, 2);
    expect(wantsSourcesOpen(q)).toBe(false);
    expect(q.has("sources")).toBe(false);
  });

  it("carries the way back to this view, which the console reads and then drops", () => {
    const q = query(href);
    const ret = parseEyeReturn(q.get("eye"));
    expect(ret?.kind).toBe("place");
    expect(ret?.placeName).toBe("Tower Bridge");
    expect(ret?.href).toBe(`/eye?${back}`);
    expect(withoutArrivalFlags("/app", `?${q.toString()}`)).toBe("/app?lat=51.50531&lon=-0.08056&z=15.7");
  });

  it("gives a browser with no saved board this view's layers and ground", () => {
    const q = query(consoleHref(MOVED, { scene: true, back }));
    expect(q.get("layers")).toBe("livecams,staticcams,planes");
    expect(q.get("base")).toBe("satellite");
    expect(q.has("sources")).toBe(false);
  });
});

describe("where it is drawn", () => {
  const hud = read("components", "eye", "EyeHud.tsx");
  const app = read("components", "eye", "EyeApp.tsx");
  const rail = read("components", "rail", "SideRail.tsx");
  const film = read("components", "eye", "EyeFilmFrame.tsx");

  it("is a plain link and a full page load, not a client-side route", () => {
    expect(hud).not.toMatch(/from "next\/link"/);
    expect(rail).not.toMatch(/from "next\/link"/);
    expect(hud).toMatch(/kind: "link",\s*id: "exit"/);
  });

  it("reads its address when it is used, from the spot on screen", () => {
    expect(hud).toContain("refreshHref: getDashboardHref");
    for (const event of ["onPointerDown", "onFocus", "onClick"]) expect(rail).toContain(`${event}={refresh}`);
    expect(app).toMatch(/getDashboardHref = useCallback\(\(\) => \{/);
    expect(app).toContain("sources: false");
  });

  it("is left out of a recording and a film, which draw their own frame", () => {
    expect(app).toMatch(/flags\.record \|\| flags\.manualClock \? \(\s*\/\/[^\n]*\s*<EyeFilmFrame/);
    expect(film).not.toContain("getDashboardHref");
    expect(film).not.toContain("data-eye-exit");
  });
});
