import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The God's eye view's wiring, held where a type check cannot hold it. Static routes
 * and the AGPL offer are pinned the same way for /app and /privacy
 * (console-static.test.ts, privacy-page.test.ts).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const PAGE = "app/(console)/eye/page.tsx";

describe("/eye", () => {
  it("is a page inside app/(console), so the static-route guard covers it", () => {
    expect(existsSync(resolve(ROOT, PAGE))).toBe(true);
    expect(code(PAGE)).toContain('canonical: "/eye"');
  });

  it("offers its source code and licence (AGPL-3.0 section 13)", () => {
    const hud = code("components/eye/EyeHud.tsx");
    expect(hud).toContain("BRAND.repoUrl");
    expect(hud).toContain("BRAND.license.url");
  });

  it("opens the map at its own view and keeps the console's URL writer off", () => {
    expect(code("components/eye/EyeApp.tsx")).toMatch(/<WorldMap\s+openAt=\{openAt\}/);
    const map = code("components/WorldMap.tsx");
    expect(map).toContain("const initial = openAt ? {} : readInitialViewState();");
    expect(map).toContain("const urlWrite = openAt ? () => {} : () => scheduleUrlWrite(map);");
  });
});

describe("the ways in are full page loads", () => {
  // The view writes the console's layer and basemap stores in memory. A client-side
  // route would carry a booted console's state into it, and its writes back out.
  it("the person on the console's map assigns the address", () => {
    const src = code("components/console/EyePerson.tsx");
    expect(code("lib/console/eyePerson.ts")).toContain("eyeSpotHref(");
    expect(src).toContain("window.location.assign(");
    expect(src).not.toMatch(/router\.push\([^)]*/);
  });

  it("a camera's detail links with a plain anchor", () => {
    expect(code("components/CameraDetail.tsx")).toMatch(/<a\s[^>]*href=\{eyeCameraHref\(/);
  });

  it("the way to the console's Sources is a plain anchor too, now in the Sources tray", () => {
    expect(code("components/eye/EyeSources.tsx")).toMatch(/<a\s[^>]*href="\/app\?sources=open"/);
  });
});
