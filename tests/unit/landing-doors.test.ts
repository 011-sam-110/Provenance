import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATIC_PATHS } from "@/lib/seo/sitemapData";

/**
 * The doors into the map (2026-10-27). God's eye view is the map people open: every
 * "Open the map" door on the landing page and on /privacy leads to /eye, and the
 * console is one tap further, with its Sources rail open. These are source checks,
 * like tests/unit/landing-static.test.ts: the landing page must stay plain links, with
 * no MapLibre and no /api call, so no component test could hold it better.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const landing = read("app", "(site)", "page.tsx");

describe("the landing page's doors", () => {
  it("names the two doors once", () => {
    expect(landing).toContain('const EYE_HREF = "/eye";');
    expect(landing).toContain('const SOURCES_HREF = "/app?sources=open";');
  });

  it("sends no button straight to the bare console any more", () => {
    expect(landing).not.toMatch(/href="\/app"/);
  });

  it("points every primary button at one of the two doors", () => {
    const primaries = [...landing.matchAll(/className="lp-btn lp-btn-primary[^"]*" href=\{(\w+)\}/g)].map((m) => m[1]);
    expect(primaries.length).toBeGreaterThanOrEqual(4);
    for (const href of primaries) expect(["EYE_HREF", "SOURCES_HREF"]).toContain(href);
    expect(primaries.filter((h) => h === "EYE_HREF").length).toBeGreaterThanOrEqual(3);
  });

  it("types no count into a door's words", () => {
    const words = [...landing.matchAll(/const (EYE|SOURCES)_WORDS = "([^"]+)";/g)].map((m) => m[2]);
    expect(words).toHaveLength(2);
    // "3D" is a word, not a count; a standalone number is a count.
    for (const w of words) expect(w).not.toMatch(/\b\d+\b/);
  });

  it("keeps the source code link in the nav, the close and the footer (AGPL-3.0 section 13)", () => {
    expect(landing.match(/href=\{REPO_URL\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("the other doors", () => {
  it("/privacy opens God's eye view", () => {
    expect(read("app", "(site)", "privacy", "page.tsx")).toContain('<a href="/eye">Open the map</a>');
  });

  it("the sitemap lists /eye beside the console", () => {
    expect(STATIC_PATHS).toContain("/eye");
    expect(STATIC_PATHS).toContain("/app");
  });
});

describe("the map pages survive a browser with no WebGL", () => {
  it("/eye and the console's stage ask first and catch a failed start", () => {
    for (const file of [read("components", "eye", "EyeApp.tsx"), read("components", "console", "StageHost.tsx")]) {
      expect(file).toContain("useWebGL()");
      expect(file).toContain("<MapBoundary");
      expect(file).toContain("<MapFallback");
    }
  });

  it("the fallback offers the camera directory and the source code", () => {
    const fallback = read("components", "map", "MapFallback.tsx");
    expect(fallback).toContain('href="/cameras"');
    expect(fallback).toContain("BRAND.repoUrl");
  });
});
