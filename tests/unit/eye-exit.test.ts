import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EYE_PLACES, consoleHref, eyeLinkQuery, type EyeView } from "@/lib/eye/places";
import { EXIT_LABEL } from "@/lib/eye/wording";
import { wantsSourcesOpen, withoutArrivalFlags } from "@/lib/console/sourcesLink";
import { decodeViewState } from "@/lib/share/url";

/**
 * "Exit to main dashboard" on God's eye view (components/eye/EyeHud.tsx): the console at
 * the spot on screen, with its rail as the visitor left it.
 * These are the rules behind it, held without a browser; tests/e2e/eye-exit.spec.ts
 * drives the real journey.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const query = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

const tower = EYE_PLACES.find((p) => p.id === "tower-bridge")!;
const MOVED: EyeView = { lat: 51.50531, lon: -0.08056, zoom: 15.7, tilt: 48, heading: 247 };

describe("the words", () => {
  it("say what it does and where it goes, in sentence case, with no dash", () => {
    expect(EXIT_LABEL).toBe("Exit to main dashboard");
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

  it("carries this view's own link, which the console drops without reading", () => {
    const q = query(href);
    expect(q.get("eye")).toBe(back);
    expect(withoutArrivalFlags("/app", `?${q.toString()}`)).toBe("/app?lat=51.50531&lon=-0.08056&z=15.7");
  });

  it("gives a browser with no saved board this view's layers and ground, as the Sources link does", () => {
    const q = query(consoleHref(MOVED, { scene: true, back }));
    expect(q.get("layers")).toBe("livecams,staticcams,planes");
    expect(q.get("base")).toBe("satellite");
    expect(q.has("sources")).toBe(false);
  });
});

describe("where it is drawn", () => {
  const hud = read("components", "eye", "EyeHud.tsx");
  const app = read("components", "eye", "EyeApp.tsx");

  it("is a plain link and a full page load, not a client-side route", () => {
    expect(hud).not.toMatch(/from "next\/link"/);
    expect(hud).toMatch(/<a\s[^>]*className=\{`\$\{styles\.btn\} \$\{styles\.exit\}`\}/);
  });

  it("reads its address when it is used, from the spot on screen", () => {
    expect(app).toMatch(/getDashboardHref = useCallback\(\(\) => consoleLink\(false\)/);
    expect(app).toMatch(/getSourcesHref = useCallback\(\(\) => consoleLink\(true\)/);
  });

  it("is left out of a recording and a film", () => {
    expect(app).toMatch(/getDashboardHref=\{flags\.record \|\| flags\.manualClock \? undefined : getDashboardHref\}/);
  });
});
