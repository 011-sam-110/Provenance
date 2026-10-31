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

  it("offers its source code and licence (AGPL-3.0 section 13), in the frame and in a film's", () => {
    for (const frame of ["components/eye/EyeHud.tsx", "components/eye/EyeFilmFrame.tsx"]) {
      const hud = code(frame);
      expect(hud, frame).toContain("BRAND.repoUrl");
      expect(hud, frame).toContain("BRAND.license.url");
    }
  });

  it("offers them outside the credits' pop-up, so they are there with it closed", () => {
    const hud = code("components/eye/EyeHud.tsx");
    const popUp = hud.slice(hud.indexOf("{creditsOpen && ("), hud.indexOf("className={s.line}"));
    expect(popUp).not.toContain("BRAND.repoUrl");
    expect(popUp).not.toContain("BRAND.license.url");
    expect(hud.slice(hud.indexOf("className={s.line}"))).toContain("BRAND.repoUrl");
  });

  it("keeps a link to the landing page, in the credits' pop-up and on a film's frame", () => {
    expect(code("components/eye/EyeHud.tsx")).toMatch(/<a\s[^>]*href="\/"/);
    expect(code("components/eye/EyeFilmFrame.tsx")).toMatch(/<a\s[^>]*href="\/"/);
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
  it("Map settings links with a plain anchor", () => {
    const src = code("components/shell/inspector/tools/SettingsTool.tsx");
    expect(src).toContain("eyeSpotHref(");
    expect(src).toMatch(/<a\s[^>]*href="\/eye"/);
    expect(src).not.toMatch(/router\.push\([^)]*eye/);
  });

  it("a camera's detail links with a plain anchor", () => {
    expect(code("components/CameraDetail.tsx")).toMatch(/<a\s[^>]*href=\{eyeCameraHref\(/);
  });

  it("a place in the search box is a plain anchor, and picking one by key is a full load too", () => {
    const search = code("components/eye/EyeSearch.tsx");
    expect(search).toMatch(/<a\s[^>]*href=\{r\.href\}/);
    expect(search).toContain("window.location.assign(r.href)");
    expect(search).not.toMatch(/router\.push|next\/link|next\/navigation/);
  });
});
